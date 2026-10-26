package az.ideanest.auth.api;

import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.AccountCredentialsService;
import az.ideanest.auth.application.PasswordResetService;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.ratelimit.ClientAddress;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The credentials on an account: the password, and the address that signs in —
 * §4.1's A-06, A-12 and A-13.
 *
 * <h2>Five paths, and why they are not two</h2>
 *
 * <p>§10.2 names the capabilities rather than the routes, and folding them
 * together fails the same way {@link TwoFactorController} says its four do:
 *
 * <ul>
 *   <li><strong>{@code /forgot-password} and {@code /reset-password}</strong> are
 *       both unauthenticated by necessity — the caller cannot sign in, which is
 *       the entire situation — while {@code /change-password} must require a
 *       bearer token. One handler with two authentication models and a branch
 *       deciding which applies is where a bypass hides.
 *   <li><strong>{@code /change-email} and {@code /confirm-email-change}</strong>
 *       are split for the same reason: the first requires a session and the
 *       current password, the second requires neither and is authorised entirely
 *       by the link it carries.
 * </ul>
 *
 * <h2>Every path is rate limited, and the keys differ on purpose</h2>
 *
 * <p>The two unauthenticated password paths are limited per source address
 * <em>and</em> per email address, the pair registration uses: a per-address limit
 * alone does not bound an attacker with many source addresses working on one
 * account, and a per-email limit alone does not bound one client working through
 * a list. The three authenticated paths are limited per account, because the
 * caller holds a token and the account is the thing being attacked — the same
 * argument {@link TwoFactorController#limitChanges} makes, and each attempt here
 * costs an Argon2 verification too.
 *
 * <h2>Nothing here is cacheable</h2>
 *
 * <p>Every response is {@code no-store}. Two of them are answers about a
 * credential and the rest are the outcome of changing one; an intermediary
 * holding any of them is holding a fact about an account's security state.
 */
@RestController
@RequestMapping("/v1/auth")
public class CredentialController {

    private final PasswordResetService resets;
    private final AccountCredentialsService credentials;
    private final RateLimiter rateLimiter;
    private final AuthProperties properties;

    public CredentialController(
            PasswordResetService resets,
            AccountCredentialsService credentials,
            RateLimiter rateLimiter,
            AuthProperties properties) {
        this.resets = resets;
        this.credentials = credentials;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /**
     * §4.1's A-06: asks for a reset link.
     *
     * <p><strong>Always 202, whether or not the address has an account.</strong>
     * The same decision {@link AuthController#register} takes and for the same
     * reason: an endpoint that answers "no such account" hands anybody with a
     * breach list the subset of those people who are here.
     *
     * <p>What differs from registration is that an address with no account
     * receives <em>nothing</em>. Registration writes to an already-registered
     * address, whose owner deserves to know somebody is probing it; here the
     * address is whatever was typed into a public form, and mailing it would make
     * this platform a delivery service for strangers.
     */
    @PostMapping("/forgot-password")
    public ResponseEntity<Void> forgotPassword(
            @Valid @RequestBody ForgotPasswordRequest request, HttpServletRequest httpRequest) {

        AuthProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt(
                "password:forgot:ip:" + ClientAddress.of(httpRequest),
                limits.passwordResetsPerAddress(),
                limits.window()));

        EmailAddress email = EmailAddress.of(request.email());

        // Per address as well as per source, so a distributed attempt on one
        // mailbox is still bounded. What it buys is not secrecy — the response is
        // identical either way — but that somebody cannot be buried in reset links
        // until they stop reading their mail.
        RateLimits.enforce(rateLimiter.recordAttempt(
                "password:forgot:email:" + email.value(), limits.passwordResetsPerEmail(), limits.window()));

        resets.request(email);

        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * §4.1's A-06: spends the link and sets the password.
     *
     * <p>Every session the account had is revoked by the service, this one
     * included — there is no session here, but there may be several elsewhere, and
     * a reset is asked for precisely when the old password is believed to be
     * known.
     */
    @PostMapping("/reset-password")
    public ResponseEntity<Void> resetPassword(
            @Valid @RequestBody ResetPasswordRequest request, HttpServletRequest httpRequest) {

        AuthProperties.RateLimit limits = properties.rateLimit();
        // Not about guessing the token — it is 256 bits — but about not letting one
        // client spend the database and an Argon2 hash on the attempt. The same
        // argument AuthController makes about email verification.
        RateLimits.enforce(rateLimiter.recordAttempt(
                "password:reset:ip:" + ClientAddress.of(httpRequest),
                limits.passwordResetsPerAddress(),
                limits.window()));

        resets.reset(request.token(), request.password());

        return noContent();
    }

    /**
     * §4.1's A-13: changes the password, given the current one.
     *
     * <p><strong>The caller is signed out by succeeding.</strong> Every session is
     * revoked including the one this request arrived on, which
     * {@link AccountCredentialsService} argues is the only defensible rule — so a
     * client must expect its next call to fail with a 401 and send the user to
     * sign in again. Saying so before the form is submitted is the client's job.
     */
    @PostMapping("/change-password")
    public ResponseEntity<Void> changePassword(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody ChangePasswordRequest request) {

        UUID userId = subjectOf(accessToken);
        limitCredentialChanges(userId);

        credentials.changePassword(userId, request.currentPassword(), request.newPassword());

        return noContent();
    }

    /**
     * §4.1's A-12: asks to move the account to another address.
     *
     * <p>202 rather than 204, and the difference is the point: nothing about the
     * account has changed yet. {@code users.email} moves when the new address
     * follows its link, and until then the old address still signs in, still
     * receives, and still resets.
     *
     * <p>The same 202 when the address already has an account (#587), so that this
     * form cannot be used to ask whether one does. Its owner is told instead.
     */
    @PostMapping("/change-email")
    public ResponseEntity<Void> changeEmail(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody ChangeEmailRequest request) {

        UUID userId = subjectOf(accessToken);
        limitCredentialChanges(userId);

        credentials.requestEmailChange(userId, request.currentPassword(), EmailAddress.of(request.newEmail()));

        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * §4.1's A-12: spends the link and moves the address.
     *
     * <p>Unauthenticated, exactly as {@code /verify-email} is, and for the same
     * reason: the credential is the token in the message. The person following it
     * is reading the new mailbox, which is the one place they are least likely to
     * be signed in.
     *
     * <p>Limited per source address only. There is no account to key on until the
     * token has been read, and reading it is the work being bounded.
     */
    @PostMapping("/confirm-email-change")
    public ResponseEntity<Void> confirmEmailChange(
            @Valid @RequestBody ConfirmEmailChangeRequest request, HttpServletRequest httpRequest) {

        AuthProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt(
                "email:change:confirm:ip:" + ClientAddress.of(httpRequest),
                limits.verificationsPerAddress(),
                limits.window()));

        credentials.confirmEmailChange(request.token());

        return noContent();
    }

    /**
     * Bounds credential changes per account.
     *
     * <p>Keyed on the user rather than the address, because the caller holds an
     * access token: the account is known, and it is the thing under attack. One
     * counter for both endpoints rather than two, so that somebody working through
     * a stolen token cannot get twice the allowance by alternating between them.
     */
    private void limitCredentialChanges(UUID userId) {
        AuthProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt(
                "credential:change:" + userId, limits.credentialChangesPerUser(), limits.window()));
    }

    private static ResponseEntity<Void> noContent() {
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /** The user, from a signature we made. Never from anything the caller chose. */
    private static UUID subjectOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
