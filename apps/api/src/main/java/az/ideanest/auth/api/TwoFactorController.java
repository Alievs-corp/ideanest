package az.ideanest.auth.api;

import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.IssuedTokens;
import az.ideanest.auth.application.TwoFactorChallenges;
import az.ideanest.auth.application.TwoFactorChallenges.CompletionCommand;
import az.ideanest.auth.application.TwoFactorEnrolment;
import az.ideanest.auth.application.TwoFactorEnrolmentService;
import az.ideanest.auth.domain.Totp;
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
 * Two-factor authentication: enrolling, confirming, completing a sign-in, and
 * switching it off.
 *
 * <p>§10.2 names {@code /2fa/enable} and {@code /2fa/verify}. Two more are here
 * because those two cannot honestly carry four operations:
 *
 * <ul>
 *   <li><strong>{@code /2fa/confirm}</strong> — {@code /2fa/verify} is
 *       unauthenticated by necessity, since the caller has no session yet, and
 *       confirming an enrolment must require a bearer token. One endpoint with
 *       two authentication models and a branch deciding which applies is
 *       exactly where a bypass hides.</li>
 *   <li><strong>{@code /2fa/disable}</strong> — switching a security control off
 *       is not the same operation as switching it on, and folding it into
 *       {@code /2fa/enable} would mean one handler where the difference between
 *       hardening an account and weakening it is a field in the body.</li>
 * </ul>
 *
 * <p>Every path is rate limited. A six-digit code is guessable by definition,
 * and the count of attempts is the only thing that makes it not worth trying.
 */
@RestController
@RequestMapping("/v1/auth/2fa")
public class TwoFactorController {

    private final TwoFactorEnrolmentService enrolments;
    private final TwoFactorChallenges challenges;
    private final TokenResponses responses;
    private final RateLimiter rateLimiter;
    private final AuthProperties properties;

    public TwoFactorController(
            TwoFactorEnrolmentService enrolments,
            TwoFactorChallenges challenges,
            TokenResponses responses,
            RateLimiter rateLimiter,
            AuthProperties properties) {
        this.enrolments = enrolments;
        this.challenges = challenges;
        this.responses = responses;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /**
     * Starts an enrolment: generates a secret and returns it once.
     *
     * <p>Two-factor is <strong>not</strong> on when this returns. Nothing about
     * signing in changes until {@code /2fa/confirm} succeeds, which is what
     * stops a phone that dies between the two calls from becoming a lockout.
     */
    @PostMapping("/enable")
    public ResponseEntity<TwoFactorEnrolmentResponse> enable(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody EnableTwoFactorRequest request) {

        UUID userId = subjectOf(accessToken);
        limitChanges(userId);

        TwoFactorEnrolment enrolment = enrolments.start(userId, request.password());

        return ResponseEntity.ok()
                // The secret is in this body. Nothing between us and the client
                // may keep a copy.
                .cacheControl(CacheControl.noStore())
                .body(new TwoFactorEnrolmentResponse(
                        enrolment.secret(),
                        enrolment.otpauthUri(),
                        Totp.DIGITS,
                        Totp.PERIOD.toSeconds(),
                        "SHA1"));
    }

    /**
     * Confirms an enrolment with a current code, and returns the recovery codes.
     *
     * <p>The only response that will ever contain them: what is stored is a
     * hash, so they cannot be shown again — only replaced.
     */
    @PostMapping("/confirm")
    public ResponseEntity<RecoveryCodesResponse> confirm(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody ConfirmTwoFactorRequest request) {

        UUID userId = subjectOf(accessToken);
        limitChanges(userId);

        // The session this request arrived on is the one that just proved a
        // code, so it is marked as two-factor authenticated rather than being
        // made to sign in again for the privilege.
        UUID sessionId = UUID.fromString(accessToken.getClaimAsString("sid"));

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new RecoveryCodesResponse(enrolments.confirm(userId, sessionId, request.code())));
    }

    /**
     * The second half of a sign-in: a challenge and a code, for a session.
     *
     * <p>Unauthenticated, because the caller has no session — that is the point
     * of it. What stands in for one is the challenge, which is single-use,
     * expires in minutes, and was only issued to somebody who sent the right
     * password.
     */
    @PostMapping("/verify")
    public ResponseEntity<TokenResponse> verify(
            @Valid @RequestBody VerifyTwoFactorRequest request, HttpServletRequest httpRequest) {

        AuthProperties.RateLimit limits = properties.rateLimit();
        // The same allowance as sign-in itself, because this is sign-in: the
        // per-challenge limit inside the service bounds one challenge, a wrong code
        // counting against the account's sign-in back-off bounds the account
        // (#587), and this bounds one client working through many.
        RateLimits.enforce(rateLimiter.recordAttempt(
                "2fa:verify:ip:" + ClientAddress.of(httpRequest), limits.signInsPerAddress(), limits.window()));

        IssuedTokens tokens = challenges.complete(
                new CompletionCommand(request.challenge(), request.code(), request.recoveryCode()));

        return responses.of(tokens, request.wantsTokenInBody());
    }

    /**
     * Switches two-factor off. Costs the current password and a current code —
     * or a recovery code, for the user whose phone is the reason they are here.
     */
    @PostMapping("/disable")
    public ResponseEntity<Void> disable(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody DisableTwoFactorRequest request) {

        UUID userId = subjectOf(accessToken);
        limitChanges(userId);

        enrolments.disable(userId, request.password(), request.code(), request.recoveryCode());

        return ResponseEntity.noContent().build();
    }

    /**
     * Bounds enrolment changes per account.
     *
     * <p>Keyed on the user rather than the address: the caller holds an access
     * token, so the account is known and is the thing being attacked. Each
     * attempt costs an Argon2 verification, which is expensive on purpose and
     * therefore worth spending somebody else's CPU on.
     */
    private void limitChanges(UUID userId) {
        AuthProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt(
                "2fa:change:" + userId, limits.twoFactorChangesPerUser(), limits.window()));
    }

    /** The user, from a signature we made. Never from anything the caller chose. */
    private static UUID subjectOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
