package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.RecordingVerificationNotifier;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/**
 * §4.1's A-06, A-12 and A-13 over HTTP, against a real database and a real Argon2
 * hash — #271 and #277.
 *
 * <p>The assertions that matter are the ones about what must <em>not</em> happen. A
 * reset request must not say whether the address has an account. A reset link must not
 * work twice, must not survive its hour, and must not leave a session alive. An address
 * change must not move the account before the new address answers, and must not be
 * reachable with an access token alone. Each of those is a way these three features
 * could appear to work while being worth nothing — or, in two cases, while being the
 * account takeover they exist to prevent.
 *
 * <p>The clock is frozen per test rather than slept through, exactly as
 * {@code TwoFactorApiTests} does: an hour of token expiry and six of an address change
 * are not things a test suite can wait for, and {@link AdjustableClock} is the
 * application's own clock.
 */
class CredentialApiTests extends AbstractIntegrationTest {

    /** Every test gets its own address, because the per-email rate limits are real here. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";
    private static final String NEW_PASSWORD = "a-different-long-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private RecordingVerificationNotifier notifier;

    @Autowired
    private UserAccounts users;

    @Autowired
    private UserCredentialRepository credentials;

    @Autowired
    private JwtDecoder jwtDecoder;

    @Autowired
    private AdjustableClock clock;

    @BeforeEach
    void freezeTimeAndClearMessages() {
        clock.freeze();
        notifier.clear();
    }

    @AfterEach
    void releaseTime() {
        // The context, and therefore the clock, is shared with every other integration
        // test. Leaving it frozen would break them somewhere else.
        clock.reset();
    }

    // ------------------------------------------------------------------
    // A-06: password reset
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reset request answers the same for an address with an account and one without")
    void resetRequestIsNotAnEnumerationOracle() {
        EmailAddress registered = registered().email();
        EmailAddress stranger = uniqueEmail();

        ResponseEntity<String> known = forgot(registered);
        ResponseEntity<String> unknown = forgot(stranger);

        // The status, and nothing else, is what a caller can observe. An endpoint that
        // answered differently would hand anybody with a breach list the subset of
        // those people who have accounts here.
        assertThat(known.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        // What differs is invisible from outside, and it is the half that matters:
        // nothing at all is sent to an address with no account, so this form cannot be
        // used to put a message in a stranger's inbox.
        assertThat(notifier.resetsSentTo(registered)).isEqualTo(1);
        assertThat(notifier.resetsSentTo(stranger)).isZero();
    }

    @Test
    @DisplayName("a reset link sets the password, and the old one stops working")
    void resetReplacesThePassword() {
        Account account = registered();
        forgot(account.email());

        String token = notifier.resetTokenSentTo(account.email()).orElseThrow();

        assertThat(reset(token, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(signIn(account.email(), PASSWORD).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(signIn(account.email(), NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a reset link works once")
    void resetLinkIsSingleUse() {
        Account account = registered();
        forgot(account.email());
        String token = notifier.resetTokenSentTo(account.email()).orElseThrow();

        assertThat(reset(token, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // A link that still worked would mean a forwarded message is a standing key to
        // the account, which is the whole reason the row is claimed rather than read.
        assertThat(reset(token, "yet-another-long-password").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("asking twice retires the first link")
    void askingAgainInvalidatesTheOlderLink() {
        Account account = registered();

        forgot(account.email());
        String first = notifier.resetTokenSentTo(account.email()).orElseThrow();
        forgot(account.email());
        String second = notifier.resetTokenSentTo(account.email()).orElseThrow();

        assertThat(second).isNotEqualTo(first);
        // Two live links would double the window in which a leaked message still works,
        // and nobody ever intends to use the older one.
        assertThat(reset(first, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(reset(second, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("a reset link expires after its hour")
    void resetLinkExpires() {
        Account account = registered();
        forgot(account.email());
        String token = notifier.resetTokenSentTo(account.email()).orElseThrow();

        clock.advance(Duration.ofHours(1).plusSeconds(1));

        assertThat(reset(token, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(signIn(account.email(), PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a resettable password still has to satisfy the policy, and a refused one does not burn the link")
    void weakPasswordIsRefusedWithoutSpendingTheLink() {
        Account account = registered();
        forgot(account.email());
        String token = notifier.resetTokenSentTo(account.email()).orElseThrow();

        assertThat(reset(token, "short").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        // The link surviving is the point. Burning it on the way to a 400 is the reset
        // flow's most common self-inflicted support ticket: somebody fixes their typo
        // and finds the link dead.
        assertThat(reset(token, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("a verification link cannot be spent as a reset link")
    void purposeIsChecked() {
        EmailAddress email = uniqueEmail();
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        String verification = notifier.tokenSentTo(email).orElseThrow();

        // Email is the channel an attacker with mailbox access already controls. The
        // purpose column is what stops one capability from becoming the other.
        assertThat(reset(verification, NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a reset kills every session the account had")
    void resetRevokesSessions() {
        Account account = registered();
        String accessToken = account.accessToken();
        assertThat(me(accessToken).getStatusCode()).isEqualTo(HttpStatus.OK);

        forgot(account.email());
        reset(notifier.resetTokenSentTo(account.email()).orElseThrow(), NEW_PASSWORD);

        // The session behind it is dead, so the refresh cookie cannot mint another --
        // and since #587 neither does the access token it already issued keep working.
        // A reset is asked for precisely when the old password is believed to be known.
        assertThat(refresh(account.refreshToken()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(me(accessToken).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(notifier.passwordChangeNoticesSentTo(account.email())).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // A-13: password change
    // ------------------------------------------------------------------

    @Test
    @DisplayName("changing the password requires the current one")
    void passwordChangeCostsTheCurrentPassword() {
        Account account = registered();

        // An access token is fifteen minutes of somebody else's session if it leaks.
        // Making it permanent is not something it should buy.
        assertThat(changePassword(account, "not-the-password", NEW_PASSWORD).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(signIn(account.email(), PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("changing the password replaces it and ends every session, including the caller's")
    void passwordChangeReplacesAndRevokes() {
        Account account = registered();

        assertThat(changePassword(account, PASSWORD, NEW_PASSWORD).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(signIn(account.email(), NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
        // Including the session that asked. "Every session except this one" is a rule
        // the client would have to be trusted to have picked correctly, and the person
        // changing a password on a machine they suspect is the one who most needs the
        // others gone.
        assertThat(refresh(account.refreshToken()).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(notifier.passwordChangeNoticesSentTo(account.email())).isEqualTo(1);
    }

    @Test
    @DisplayName("an unauthenticated caller cannot change a password")
    void passwordChangeNeedsAToken() {
        assertThat(rest.exchange(
                                "/v1/auth/change-password",
                                HttpMethod.POST,
                                new HttpEntity<>(
                                        Map.of("currentPassword", PASSWORD, "newPassword", NEW_PASSWORD),
                                        jsonHeaders()),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // A-12: address change
    // ------------------------------------------------------------------

    @Test
    @DisplayName("asking to change the address changes nothing until the new address answers")
    void addressDoesNotMoveOnRequest() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();

        assertThat(changeEmail(account, PASSWORD, wanted).getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        // The failure this prevents is the one V44 is written about: one typo and the
        // account is behind a mailbox nobody can read, because sign-in is by address
        // and so is the reset that would fix it.
        assertThat(users.findByEmail(account.email())).isPresent();
        assertThat(users.findByEmail(wanted)).isEmpty();
        assertThat(signIn(account.email(), PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("both addresses are written to")
    void bothAddressesAreTold() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();

        changeEmail(account, PASSWORD, wanted);

        // The capability says "confirmation to both addresses" and this is why: the
        // notice to the old address is how somebody losing their account finds out, at
        // the address they still hold.
        assertThat(notifier.emailChangeTokenSentTo(wanted)).isPresent();
        assertThat(notifier.emailChangeNoticesSentTo(account.email())).isEqualTo(1);
    }

    @Test
    @DisplayName("confirming moves the address, and the new one signs in")
    void confirmingMovesTheAddress() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();
        changeEmail(account, PASSWORD, wanted);
        String token = notifier.emailChangeTokenSentTo(wanted).orElseThrow();

        assertThat(confirmEmailChange(token).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        UserAccount moved = users.findByEmail(wanted).orElseThrow();
        assertThat(moved.id()).isEqualTo(account.userId());
        // Verified by arriving: the only way to reach the confirmation is to have read
        // the message sent to this address, which is exactly the proof the flag records.
        assertThat(moved.emailVerified()).isTrue();
        assertThat(signIn(wanted, PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(signIn(account.email(), PASSWORD).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("an address change requires the current password")
    void addressChangeCostsTheCurrentPassword() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();

        // The address on an account is what a reset is sent to, so moving it is the
        // last step of taking the account over. A stolen access token must not be
        // enough on its own.
        assertThat(changeEmail(account, "not-the-password", wanted).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(notifier.emailChangeTokenSentTo(wanted)).isEmpty();
    }

    @Test
    @DisplayName("an address that already has an account is answered like any other, and its owner is told")
    void addressAlreadyTakenIsNotAnOracle() {
        Account account = registered();
        Account other = registered();
        EmailAddress free = uniqueEmail();

        ResponseEntity<String> taken = changeEmail(account, PASSWORD, other.email());
        ResponseEntity<String> untaken = changeEmail(registered(), PASSWORD, free);

        // #587. A 409 here answered "is this address registered?" for anybody with an
        // account and a list of addresses to walk through the form.
        assertThat(taken.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(taken.getStatusCode()).isEqualTo(untaken.getStatusCode());
        assertThat(taken.getBody()).isEqualTo(untaken.getBody());

        // No link that could move this account onto somebody else's address; the owner
        // of that address is told instead, as registration tells them. And the caller's
        // own mailbox gets the notice it would have got either way, so watching it
        // reveals nothing either.
        assertThat(notifier.emailChangeTokenSentTo(other.email())).isEmpty();
        assertThat(notifier.emailChangeAttemptsSentTo(other.email())).isEqualTo(1);
        assertThat(notifier.emailChangeNoticesSentTo(account.email())).isEqualTo(1);
        assertThat(users.findByEmail(other.email()).orElseThrow().id()).isEqualTo(other.userId());
    }

    @Test
    @DisplayName("asking for a taken address still retires the outstanding link, as any request does")
    void aTakenAddressRetiresTheOutstandingLinkToo() {
        Account account = registered();
        Account other = registered();
        EmailAddress first = uniqueEmail();

        changeEmail(account, PASSWORD, first);
        String firstToken = notifier.emailChangeTokenSentTo(first).orElseThrow();
        changeEmail(account, PASSWORD, other.email());

        // Otherwise the first link still working would say the second request was the
        // kind that did nothing -- the oracle the 202 exists to remove.
        assertThat(confirmEmailChange(firstToken).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a confirmation link works once")
    void confirmationLinkIsSingleUse() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();
        changeEmail(account, PASSWORD, wanted);
        String token = notifier.emailChangeTokenSentTo(wanted).orElseThrow();

        assertThat(confirmEmailChange(token).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(confirmEmailChange(token).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a confirmation link expires")
    void confirmationLinkExpires() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();
        changeEmail(account, PASSWORD, wanted);
        String token = notifier.emailChangeTokenSentTo(wanted).orElseThrow();

        clock.advance(Duration.ofHours(6).plusSeconds(1));

        assertThat(confirmEmailChange(token).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(users.findByEmail(account.email())).isPresent();
    }

    @Test
    @DisplayName("asking twice retires the first confirmation link")
    void askingAgainInvalidatesTheOlderConfirmation() {
        Account account = registered();
        EmailAddress first = uniqueEmail();
        EmailAddress second = uniqueEmail();

        changeEmail(account, PASSWORD, first);
        String firstToken = notifier.emailChangeTokenSentTo(first).orElseThrow();
        changeEmail(account, PASSWORD, second);
        String secondToken = notifier.emailChangeTokenSentTo(second).orElseThrow();

        // The address nobody wants any more is the one still sitting in a mailbox that
        // may have been lost.
        assertThat(confirmEmailChange(firstToken).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(confirmEmailChange(secondToken).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(users.findByEmail(second)).isPresent();
    }

    @Test
    @DisplayName("an address change leaves the sessions alone")
    void addressChangeDoesNotRevokeSessions() {
        Account account = registered();
        EmailAddress wanted = uniqueEmail();
        changeEmail(account, PASSWORD, wanted);
        confirmEmailChange(notifier.emailChangeTokenSentTo(wanted).orElseThrow());

        // Nothing about the credential changed. The sessions were issued to the same
        // person and the same password still opens them; signing everybody out would be
        // ceremony rather than security.
        assertThat(refresh(account.refreshToken()).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Fixtures and calls
    // ------------------------------------------------------------------

    /** A registered, signed-in account and both halves of its session. */
    private record Account(EmailAddress email, UUID userId, String accessToken, String refreshToken) {
    }

    private static EmailAddress uniqueEmail() {
        return EmailAddress.of("credentials" + SEQUENCE.incrementAndGet() + "@example.com");
    }

    private Account registered() {
        EmailAddress email = uniqueEmail();
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        // Verified before signing in. An unverified account may do almost nothing, and
        // none of these tests is about that rule.
        rest.postForEntity(
                "/v1/auth/verify-email", Map.of("token", notifier.tokenSentTo(email).orElseThrow()), String.class);

        Map<String, Object> tokens = signIn(email, PASSWORD).getBody();
        String accessToken = (String) tokens.get("accessToken");

        return new Account(
                email,
                UUID.fromString(jwtDecoder.decode(accessToken).getSubject()),
                accessToken,
                (String) tokens.get("refreshToken"));
    }

    private ResponseEntity<String> forgot(EmailAddress email) {
        return rest.postForEntity("/v1/auth/forgot-password", Map.of("email", email.value()), String.class);
    }

    private ResponseEntity<String> reset(String token, String password) {
        return rest.postForEntity(
                "/v1/auth/reset-password", Map.of("token", token, "password", password), String.class);
    }

    private ResponseEntity<String> changePassword(Account account, String current, String next) {
        return rest.exchange(
                "/v1/auth/change-password",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("currentPassword", current, "newPassword", next), bearer(account.accessToken())),
                String.class);
    }

    private ResponseEntity<String> changeEmail(Account account, String password, EmailAddress newEmail) {
        return rest.exchange(
                "/v1/auth/change-email",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("currentPassword", password, "newEmail", newEmail.value()),
                        bearer(account.accessToken())),
                String.class);
    }

    private ResponseEntity<String> confirmEmailChange(String token) {
        return rest.postForEntity("/v1/auth/confirm-email-change", Map.of("token", token), String.class);
    }

    private ResponseEntity<Map<String, Object>> signIn(EmailAddress email, String password) {
        return rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", password, "tokenDelivery", "body"),
                        jsonHeaders()),
                mapOfObjects());
    }

    private ResponseEntity<String> refresh(String refreshToken) {
        return rest.exchange(
                "/v1/auth/refresh",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("refreshToken", refreshToken), jsonHeaders()),
                String.class);
    }

    private ResponseEntity<String> me(String accessToken) {
        return rest.exchange("/v1/me", HttpMethod.GET, new HttpEntity<>(bearer(accessToken)), String.class);
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapOfObjects() {
        return new ParameterizedTypeReference<>() {};
    }
}
