package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.domain.Totp;
import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/**
 * Two-factor authentication over HTTP, against a real database.
 *
 * <p>The tests that matter are the ones asserting what must <em>not</em>
 * happen: an unconfirmed enrolment must not demand a code, a correct password
 * must not produce a session, a challenge must not work twice, and a code must
 * not work twice. Each of those is a way the feature could appear to work while
 * being worth nothing.
 *
 * <p>The clock is frozen for each test rather than slept through. Three HTTP
 * calls have to land in the same thirty-second step for a code to still be
 * current, and on a busy CI machine they do not reliably do that by themselves.
 */
class TwoFactorApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private JwtDecoder jwtDecoder;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private SessionRepository sessions;

    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void freezeTime() {
        clock.freeze();
    }

    @AfterEach
    void releaseTime() {
        // The context, and therefore the clock, is shared with every other
        // integration test. Leaving it frozen would break them somewhere else.
        clock.reset();
    }

    // ------------------------------------------------------------------
    // Enrolment
    // ------------------------------------------------------------------

    @Test
    @DisplayName("starting an enrolment does not switch two-factor on")
    void enrolmentAloneChangesNothing() {
        Account account = registeredAndSignedIn();

        ResponseEntity<Map<String, Object>> enrolment = enable(account, PASSWORD);

        assertThat(enrolment.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((String) enrolment.getBody().get("secret")).isNotBlank();
        assertThat((String) enrolment.getBody().get("otpauthUri")).startsWith("otpauth://totp/IdeyaNest:");

        // The failure this prevents is a lockout: a phone that dies between
        // scanning the picture and typing a code would otherwise leave the user
        // holding a password that no longer signs them in.
        ResponseEntity<Map<String, Object>> signIn = signIn(account.email());
        assertThat(signIn.getBody()).doesNotContainKey("twoFactorRequired");
        assertThat((String) signIn.getBody().get("accessToken")).isNotBlank();
    }

    @Test
    @DisplayName("starting an enrolment requires the current password")
    void enrolmentCostsThePassword() {
        Account account = registeredAndSignedIn();

        // An access token is fifteen minutes of somebody's session if it leaks.
        // Bolting a second factor onto an account is not something it should buy.
        assertThat(enable(account, "not-the-password").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("an unauthenticated caller cannot start an enrolment")
    void enrolmentNeedsAToken() {
        assertThat(rest.exchange(
                                "/v1/auth/2fa/enable",
                                HttpMethod.POST,
                                new HttpEntity<>(Map.of("password", PASSWORD), jsonHeaders()),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a wrong code does not confirm an enrolment")
    void confirmationRefusesAWrongCode() {
        Account account = registeredAndSignedIn();
        enable(account, PASSWORD);
        byte[] secret = secretOf(account.userId());

        assertThat(confirm(account, wrongCode(secret)).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        // Still off, which is the part that matters: a refused confirmation
        // must not leave the account half-enrolled.
        assertThat(signIn(account.email()).getBody()).doesNotContainKey("twoFactorRequired");
    }

    @Test
    @DisplayName("a correct code confirms the enrolment and returns recovery codes once")
    void confirmationEnablesAndIssuesRecoveryCodes() {
        Account account = registeredAndSignedIn();
        enable(account, PASSWORD);
        byte[] secret = secretOf(account.userId());

        ResponseEntity<Map<String, Object>> confirmed = confirm(account, currentCode(secret));

        assertThat(confirmed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(recoveryCodesOf(confirmed)).hasSize(10);
        assertThat(confirmed.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test
    @DisplayName("an enrolment cannot be restarted once it is confirmed")
    void enrolmentCannotBeSilentlyReplaced() {
        Enrolled account = enrolled();

        // Otherwise "start enrolling again" is a way to switch the second factor
        // off with a password alone — which is the thing it exists to stop.
        assertThat(enable(account.account(), PASSWORD).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // ------------------------------------------------------------------
    // Signing in with two-factor on
    // ------------------------------------------------------------------

    @Test
    @DisplayName("with two-factor on, a correct password returns a challenge and no session")
    void passwordAloneIsNotASession() {
        Enrolled account = enrolled();

        ResponseEntity<Map<String, Object>> signIn = signIn(account.email());

        assertThat(signIn.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(signIn.getBody()).containsEntry("twoFactorRequired", true);
        assertThat((String) signIn.getBody().get("challenge")).isNotBlank();
        // The whole point. Anything in here that opens an endpoint would make
        // the second factor decorative.
        assertThat(signIn.getBody()).doesNotContainKey("accessToken");
        assertThat(signIn.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
    }

    @Test
    @DisplayName("the challenge and a correct code return tokens, and the session records the second factor")
    void challengeAndCodeReturnTokens() {
        Enrolled account = enrolled();
        String challenge = challengeFrom(signIn(account.email()));

        ResponseEntity<Map<String, Object>> verified = verify(challenge, currentCode(account.secret()), null);

        assertThat(verified.getStatusCode()).isEqualTo(HttpStatus.OK);
        String accessToken = (String) verified.getBody().get("accessToken");
        assertThat(accessToken).isNotBlank();

        // What a payout action will read, in the token and in the row behind it.
        assertThat(jwtDecoder.decode(accessToken).getClaimAsStringList("amr")).contains("otp");
        UUID sessionId = UUID.fromString(jwtDecoder.decode(accessToken).getClaimAsString("sid"));
        assertThat(sessions.findById(sessionId)).get().extracting(session -> session.getTwoFactorAt()).isNotNull();
    }

    @Test
    @DisplayName("a session from a password alone does not claim a second factor")
    void passwordOnlySessionsSaySo() {
        Account account = registeredAndSignedIn();

        // The claim has to come from the session rather than the account, or
        // switching two-factor on would retroactively bless yesterday's
        // password-only sign-in.
        assertThat(jwtDecoder.decode(account.accessToken()).getClaimAsStringList("amr"))
                .containsExactly("pwd");
    }

    @Test
    @DisplayName("a wrong code does not complete the sign-in")
    void aWrongCodeIsRefused() {
        Enrolled account = enrolled();
        String challenge = challengeFrom(signIn(account.email()));

        assertThat(verify(challenge, wrongCode(account.secret()), null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a challenge cannot be spent twice")
    void aChallengeIsSingleUse() {
        Enrolled account = enrolled();
        String challenge = challengeFrom(signIn(account.email()));

        assertThat(verify(challenge, currentCode(account.secret()), null).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // A step forward, so that the second attempt carries a code that has
        // never been used. What is being tested is the challenge, and a stale
        // code would prove the wrong thing.
        clock.advance(Totp.PERIOD);

        assertThat(verify(challenge, currentCode(account.secret()), null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a code cannot be used twice, even inside its own window")
    void aCodeCannotBeReplayed() {
        Enrolled account = enrolled();
        String code = currentCode(account.secret());

        assertThat(verify(challengeFrom(signIn(account.email())), code, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // Same thirty-second step, fresh challenge. Somebody who read the code
        // over a shoulder, or out of a proxy log, must not have another thirty
        // seconds to use it.
        assertThat(verify(challengeFrom(signIn(account.email())), code, null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a challenge expires")
    void aChallengeDoesNotWait() {
        Enrolled account = enrolled();
        String challenge = challengeFrom(signIn(account.email()));

        clock.advance(Duration.ofMinutes(6));

        // Five minutes is the configured life. A challenge captured from a log
        // is worth nothing by the time anybody reads it.
        assertThat(verify(challenge, currentCode(account.secret()), null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("code guesses against one challenge run out")
    void codeGuessesAreRateLimited() {
        Enrolled account = enrolled();
        String challenge = challengeFrom(signIn(account.email()));

        for (int attempt = 0; attempt < 5; attempt++) {
            verify(challenge, wrongCode(account.secret()), null);
        }

        // Six digits with a step of skew either side is three chances in a
        // million per attempt. The count of attempts is the only thing that
        // keeps that a small number, so the correct code is refused too.
        assertThat(verify(challenge, currentCode(account.secret()), null).getStatusCode())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    // ------------------------------------------------------------------
    // Recovery codes
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a recovery code signs somebody in once and then never again")
    void recoveryCodesAreSingleUse() {
        Enrolled account = enrolled();
        String recoveryCode = account.recoveryCodes().get(0);

        assertThat(verify(challengeFrom(signIn(account.email())), null, recoveryCode)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        String secondChallenge = challengeFrom(signIn(account.email()));
        assertThat(verify(secondChallenge, null, recoveryCode).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        // And the challenge is still good: a spent recovery code is a refused
        // attempt, not a broken sign-in.
        clock.advance(Totp.PERIOD);
        assertThat(verify(secondChallenge, currentCode(account.secret()), null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Switching it off
    // ------------------------------------------------------------------

    @Test
    @DisplayName("switching two-factor off requires the password as well as a code")
    void disablingCostsThePassword() {
        Enrolled account = enrolled();

        ResponseEntity<String> refused =
                disable(account.account(), "not-the-password", currentCode(account.secret()));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        // Still on. A stolen access token must not be able to take the second
        // factor away, which is the first thing anyone holding one would do.
        assertThat(signIn(account.email()).getBody()).containsEntry("twoFactorRequired", true);

        ResponseEntity<String> accepted = disable(account.account(), PASSWORD, currentCode(account.secret()));
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(signIn(account.email()).getBody()).doesNotContainKey("twoFactorRequired");
    }

    @Test
    @DisplayName("switching two-factor off requires a code as well as the password")
    void disablingCostsACode() {
        Enrolled account = enrolled();

        // Without this the whole feature is worth one password, which is the
        // thing it was added to stop being enough.
        assertThat(disable(account.account(), PASSWORD, wrongCode(account.secret()))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        assertThat(signIn(account.email()).getBody()).containsEntry("twoFactorRequired", true);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered account with a live access token, and no second factor. */
    private record Account(EmailAddress email, UUID userId, String accessToken) {
    }

    /** The same, with two-factor confirmed and the codes it was issued. */
    private record Enrolled(Account account, byte[] secret, List<String> recoveryCodes) {

        EmailAddress email() {
            return account.email();
        }
    }

    private Account registeredAndSignedIn() {
        EmailAddress email = EmailAddress.of("twofactor" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        String accessToken = (String) signIn(email).getBody().get("accessToken");
        return new Account(email, UUID.fromString(jwtDecoder.decode(accessToken).getSubject()), accessToken);
    }

    private Enrolled enrolled() {
        Account account = registeredAndSignedIn();
        enable(account, PASSWORD);
        byte[] secret = secretOf(account.userId());
        ResponseEntity<Map<String, Object>> confirmed = confirm(account, currentCode(secret));
        assertThat(confirmed.getStatusCode()).isEqualTo(HttpStatus.OK);

        // The code that confirmed the enrolment is spent, so tests that sign in
        // afterwards need a different step. Moving on one keeps that honest
        // without waiting thirty seconds for it.
        clock.advance(Totp.PERIOD);

        return new Enrolled(account, secret, recoveryCodesOf(confirmed));
    }

    // ------------------------------------------------------------------
    // Calls
    // ------------------------------------------------------------------

    private ResponseEntity<Map<String, Object>> signIn(EmailAddress email) {
        return rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"),
                        jsonHeaders()),
                mapOfObjects());
    }

    private ResponseEntity<Map<String, Object>> enable(Account account, String password) {
        return rest.exchange(
                "/v1/auth/2fa/enable",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("password", password), bearer(account.accessToken())),
                mapOfObjects());
    }

    private ResponseEntity<Map<String, Object>> confirm(Account account, String code) {
        return rest.exchange(
                "/v1/auth/2fa/confirm",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("code", code), bearer(account.accessToken())),
                mapOfObjects());
    }

    private ResponseEntity<Map<String, Object>> verify(String challenge, String code, String recoveryCode) {
        Map<String, String> body = new java.util.LinkedHashMap<>();
        body.put("challenge", challenge);
        body.put("tokenDelivery", "body");
        if (code != null) {
            body.put("code", code);
        }
        if (recoveryCode != null) {
            body.put("recoveryCode", recoveryCode);
        }

        return rest.exchange(
                "/v1/auth/2fa/verify", HttpMethod.POST, new HttpEntity<>(body, jsonHeaders()), mapOfObjects());
    }

    private ResponseEntity<String> disable(Account account, String password, String code) {
        return rest.exchange(
                "/v1/auth/2fa/disable",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("password", password, "code", code), bearer(account.accessToken())),
                String.class);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    /**
     * The secret as the server stores it.
     *
     * <p>Read from the database rather than decoded from the response, so that
     * the test computes codes from the same bytes the server verifies against.
     * That the printed form is the right base32 for those bytes is what
     * {@code TotpTests} asserts, against the RFC.
     */
    private byte[] secretOf(UUID userId) {
        return jdbc().queryForObject(
                "SELECT secret FROM user_two_factor WHERE user_id = ?", byte[].class, userId);
    }

    private String currentCode(byte[] secret) {
        return Totp.codeAt(secret, Totp.stepAt(clock.instant()));
    }

    /** Six digits that are certainly not accepted right now. */
    private String wrongCode(byte[] secret) {
        long step = Totp.stepAt(clock.instant());
        Set<String> valid = Set.of(
                Totp.codeAt(secret, step - 1), Totp.codeAt(secret, step), Totp.codeAt(secret, step + 1));

        for (int candidate = 0; candidate < 10; candidate++) {
            String code = String.format(Locale.ROOT, "%06d", candidate);
            if (!valid.contains(code)) {
                return code;
            }
        }
        throw new IllegalStateException("Ten candidates and all of them valid is not possible");
    }

    private static String challengeFrom(ResponseEntity<Map<String, Object>> signIn) {
        assertThat(signIn.getBody()).containsEntry("twoFactorRequired", true);
        return (String) signIn.getBody().get("challenge");
    }

    @SuppressWarnings("unchecked")
    private static List<String> recoveryCodesOf(ResponseEntity<Map<String, Object>> confirmed) {
        return (List<String>) confirmed.getBody().get("recoveryCodes");
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
        return new ParameterizedTypeReference<Map<String, Object>>() {};
    }
}
