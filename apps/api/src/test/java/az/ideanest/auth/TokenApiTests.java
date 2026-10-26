package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.domain.SessionRevocationReason;
import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/**
 * Sign-in, refresh rotation, and reuse detection, over HTTP.
 *
 * <p>The test that matters most here is
 * {@link #reusingARotatedTokenKillsTheWholeFamily()}. Everything else in this
 * file is table stakes; that one is the reason the design has a token family at
 * all.
 */
class TokenApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private SessionRepository sessions;

    @Autowired
    private JwtDecoder jwtDecoder;

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private EmailAddress registeredUser() {
        EmailAddress email = EmailAddress.of("token" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return email;
    }

    private ResponseEntity<Map<String, Object>> signIn(EmailAddress email, String password, boolean tokenInBody) {
        Map<String, String> body = tokenInBody
                ? Map.of("email", email.value(), "password", password, "tokenDelivery", "body")
                : Map.of("email", email.value(), "password", password);

        return rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(body, jsonHeaders()),
                new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private ResponseEntity<String> refreshWithBody(String refreshToken) {
        return rest.exchange(
                "/v1/auth/refresh",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("refreshToken", refreshToken), jsonHeaders()),
                String.class);
    }

    private static String refreshTokenOf(ResponseEntity<Map<String, Object>> response) {
        return (String) response.getBody().get("refreshToken");
    }

    private static String accessTokenOf(ResponseEntity<Map<String, Object>> response) {
        return (String) response.getBody().get("accessToken");
    }

    // ------------------------------------------------------------------
    // Sign-in
    // ------------------------------------------------------------------

    @Test
    @DisplayName("signing in returns an access token and puts the refresh token in a cookie")
    void signInIssuesTokens() {
        EmailAddress email = registeredUser();

        ResponseEntity<Map<String, Object>> response = signIn(email, PASSWORD, false);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(accessTokenOf(response)).isNotBlank();
        // Not in the body by default. A browser client that could read it would
        // be one cross-site scripting bug away from a thirty-day credential.
        assertThat(refreshTokenOf(response)).isNull();

        String cookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        assertThat(cookie).isNotNull();
        assertThat(cookie).contains("ideanest_refresh=");
        assertThat(cookie).contains("HttpOnly");
        assertThat(cookie).contains("SameSite=Strict");
        assertThat(cookie).contains("Path=/v1/auth");

        // Tokens must not be cached by anything between us and the client.
        assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test
    @DisplayName("a native client can ask for the refresh token in the body")
    void nativeClientsGetTheTokenInTheBody() {
        EmailAddress email = registeredUser();

        ResponseEntity<Map<String, Object>> response = signIn(email, PASSWORD, true);

        assertThat(refreshTokenOf(response)).isNotBlank();
    }

    @Test
    @DisplayName("the access token carries our issuer, audience, subject, and session")
    void accessTokenClaims() {
        EmailAddress email = registeredUser();
        ResponseEntity<Map<String, Object>> response = signIn(email, PASSWORD, true);

        Jwt token = jwtDecoder.decode(accessTokenOf(response));

        assertThat(token.getIssuer().toString()).isEqualTo("https://api.ideanest.test");
        assertThat(token.getAudience()).contains("ideanest");
        assertThat(token.getSubject()).isNotNull();
        assertThat(token.getClaimAsString("sid")).isNotNull();
        assertThat(token.<Boolean>getClaim("email_verified")).isFalse();
        // Fifteen minutes, because revoking a session cannot reach a token
        // already issued and this value is exactly that window.
        assertThat(Duration.between(Instant.now(), token.getExpiresAt()))
                .isLessThanOrEqualTo(Duration.ofMinutes(15))
                .isGreaterThan(Duration.ofMinutes(13));
        // Nothing anyone could be identified by. A JWT is base64, not
        // encryption, and it gets pasted into bug reports.
        assertThat(token.getClaims()).doesNotContainKeys("email", "name");
    }

    @Test
    @DisplayName("a wrong password and an unknown account are refused identically")
    void refusalsAreIndistinguishable() {
        EmailAddress known = registeredUser();

        ResponseEntity<String> wrongPassword = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", known.value(), "password", "not-the-password"), jsonHeaders()),
                String.class);

        ResponseEntity<String> unknownAccount = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", "nobody" + SEQUENCE.incrementAndGet() + "@example.com", "password", PASSWORD),
                        jsonHeaders()),
                String.class);

        // Byte-identical. Any difference here answers "does this address have an
        // account?" for anyone who cares to ask, which is the oracle
        // registration goes out of its way to close.
        assertThat(unknownAccount.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(wrongPassword.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(unknownAccount.getBody()).isEqualTo(wrongPassword.getBody());
    }

    @Test
    @DisplayName("too many sign-in attempts are refused")
    void signInIsRateLimited() {
        EmailAddress email = registeredUser();

        for (int attempt = 0; attempt < 5; attempt++) {
            rest.exchange(
                    "/v1/auth/login",
                    HttpMethod.POST,
                    new HttpEntity<>(Map.of("email", email.value(), "password", "wrong-password"), jsonHeaders()),
                    String.class);
        }

        ResponseEntity<String> refused = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email.value(), "password", PASSWORD), jsonHeaders()),
                String.class);

        // Guessing is the attack this exists to make expensive, and the correct
        // password is refused too — otherwise the limiter is only an obstacle
        // to people who are wrong.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    @DisplayName("the refusal after five failures is a thirty-second back-off, not a fifteen-minute lockout")
    void signInBacksOffRatherThanLockingOut() {
        EmailAddress email = registeredUser();

        for (int attempt = 0; attempt < 5; attempt++) {
            signIn(email, "wrong-password", true);
        }
        ResponseEntity<Map<String, Object>> refused = signIn(email, PASSWORD, true);

        // #587. Somebody who knows an address could previously keep its owner out
        // for a quarter of an hour at a time with five wrong guesses.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(refused.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isEqualTo("30");
    }

    @Test
    @DisplayName("successful sign-ins do not count against the account's budget")
    void successfulSignInsAreNotCounted() {
        EmailAddress email = registeredUser();

        // #587: the counter used to be spent before the password was checked, so a
        // person signing in on a sixth device inside fifteen minutes was refused.
        for (int signIn = 0; signIn < 8; signIn++) {
            assertThat(signIn(email, PASSWORD, true).getStatusCode()).isEqualTo(HttpStatus.OK);
        }

        // And a correct password clears the failures before it: four wrong, one
        // right, four wrong again is never refused.
        for (int attempt = 0; attempt < 4; attempt++) {
            signIn(email, "wrong-password", true);
        }
        assertThat(signIn(email, PASSWORD, true).getStatusCode()).isEqualTo(HttpStatus.OK);
        for (int attempt = 0; attempt < 4; attempt++) {
            assertThat(signIn(email, "wrong-password", true).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        }
        assertThat(signIn(email, PASSWORD, true).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Using the access token
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the access token opens an authenticated endpoint")
    void accessTokenAuthenticates() {
        EmailAddress email = registeredUser();
        String accessToken = accessTokenOf(signIn(email, PASSWORD, true));

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        ResponseEntity<Map<String, Object>> me = rest.exchange(
                "/v1/me",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(me.getBody()).containsEntry("email", email.value());
        assertThat(me.getBody()).containsEntry("emailVerified", false);
    }

    @Test
    @DisplayName("a forged or absent token opens nothing")
    void forgedTokensAreRefused() {
        assertThat(rest.getForEntity("/v1/me", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbnlvbmUifQ.");

        // "alg: none" is the oldest JWT bypass there is. The decoder is pinned
        // to RS256 precisely so that this is not a question of luck.
        assertThat(rest.exchange("/v1/me", HttpMethod.GET, new HttpEntity<>(headers), String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // Refresh and rotation
    // ------------------------------------------------------------------

    @Test
    @DisplayName("refreshing returns a new access token and a different refresh token")
    void refreshRotatesTheToken() {
        EmailAddress email = registeredUser();
        String firstRefresh = refreshTokenOf(signIn(email, PASSWORD, true));

        ResponseEntity<String> refreshed = refreshWithBody(firstRefresh);

        assertThat(refreshed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(refreshed.getBody()).contains("\"accessToken\"");
        // The whole point of rotation: the presented token is spent.
        assertThat(refreshed.getBody()).doesNotContain(firstRefresh);
    }

    @Test
    @DisplayName("reusing a rotated refresh token revokes the entire session")
    void reusingARotatedTokenKillsTheWholeFamily() {
        EmailAddress email = registeredUser();
        ResponseEntity<Map<String, Object>> signIn = signIn(email, PASSWORD, true);
        String first = refreshTokenOf(signIn);

        ResponseEntity<String> rotated = refreshWithBody(first);
        assertThat(rotated.getStatusCode()).isEqualTo(HttpStatus.OK);
        String second = extractRefreshToken(rotated.getBody());

        // The theft: somebody presents the token that was already exchanged.
        ResponseEntity<String> replay = refreshWithBody(first);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // Revoking only the replayed token would leave whoever holds the newest
        // one signed in — and there is no way to know whether that is the user
        // or the thief. So the newest one dies too.
        assertThat(refreshWithBody(second).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        UUID sessionId = UUID.fromString(sessionIdFromAccessToken(accessTokenOf(signIn)));
        assertThat(sessions.findById(sessionId))
                .get()
                .extracting(session -> session.getRevokedReason())
                // Recorded, not inferred: an incident review needs to know that
                // this session died because a token was replayed.
                .isEqualTo(SessionRevocationReason.TOKEN_REUSE);
    }

    @Test
    @DisplayName("a refresh token that was never issued is refused")
    void unknownRefreshTokenIsRefused() {
        assertThat(refreshWithBody("not-a-real-refresh-token").getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a cookie refresh needs the client header, and works with it")
    void cookieRefreshRequiresTheClientHeader() {
        EmailAddress email = registeredUser();
        ResponseEntity<Map<String, Object>> signIn = signIn(email, PASSWORD, false);
        String cookie = cookieValue(signIn.getHeaders().getFirst(HttpHeaders.SET_COOKIE));

        HttpHeaders withoutClientHeader = jsonHeaders();
        withoutClientHeader.add(HttpHeaders.COOKIE, "ideanest_refresh=" + cookie);

        // A form post from another origin can send a cookie but cannot set this
        // header. §17.3 asks for both locks; this is the second one.
        assertThat(rest.exchange(
                                "/v1/auth/refresh",
                                HttpMethod.POST,
                                new HttpEntity<>(Map.of(), withoutClientHeader),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        HttpHeaders withClientHeader = jsonHeaders();
        withClientHeader.add(HttpHeaders.COOKIE, "ideanest_refresh=" + cookie);
        withClientHeader.add("X-IdeaNest-Client", "web");

        ResponseEntity<String> refreshed = rest.exchange(
                "/v1/auth/refresh", HttpMethod.POST, new HttpEntity<>(Map.of(), withClientHeader), String.class);

        assertThat(refreshed.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The browser is handed the successor the same way, and still cannot
        // read it.
        assertThat(refreshed.getHeaders().getFirst(HttpHeaders.SET_COOKIE)).contains("HttpOnly");
    }

    // ------------------------------------------------------------------
    // Sign-out
    // ------------------------------------------------------------------

    @Test
    @DisplayName("signing out ends the session and clears the cookie")
    void signOutEndsTheSession() {
        EmailAddress email = registeredUser();
        String refreshToken = refreshTokenOf(signIn(email, PASSWORD, true));

        ResponseEntity<String> signOut = rest.exchange(
                "/v1/auth/logout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("refreshToken", refreshToken), jsonHeaders()),
                String.class);

        assertThat(signOut.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(signOut.getHeaders().getFirst(HttpHeaders.SET_COOKIE)).contains("Max-Age=0");
        assertThat(refreshWithBody(refreshToken).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("signing out without a token is not an error")
    void signOutWithoutATokenSucceeds() {
        // The caller wanted to be signed out and is. Refusing would only tell
        // whoever asked that the token they sent is unknown.
        ResponseEntity<String> response =
                rest.exchange("/v1/auth/logout", HttpMethod.POST, new HttpEntity<>(Map.of(), jsonHeaders()), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("an access token issued before a sign-out keeps working until it expires")
    void accessTokensOutliveTheirSession() {
        EmailAddress email = registeredUser();
        ResponseEntity<Map<String, Object>> signIn = signIn(email, PASSWORD, true);
        String accessToken = accessTokenOf(signIn);

        rest.exchange(
                "/v1/auth/logout",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("refreshToken", refreshTokenOf(signIn)), jsonHeaders()),
                String.class);

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        // Asserting a limitation on purpose. A stateless token cannot be
        // recalled, so revocation takes effect when it expires — at most
        // fifteen minutes. Anyone who assumes sign-out is instantaneous should
        // find this test rather than an incident.
        assertThat(rest.exchange("/v1/me", HttpMethod.GET, new HttpEntity<>(headers), String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String sessionIdFromAccessToken(String accessToken) {
        return jwtDecoder.decode(accessToken).getClaimAsString("sid");
    }

    private static String cookieValue(String setCookieHeader) {
        String withoutName = setCookieHeader.substring(setCookieHeader.indexOf('=') + 1);
        return withoutName.substring(0, withoutName.indexOf(';'));
    }

    private static String extractRefreshToken(String responseBody) {
        String marker = "\"refreshToken\":\"";
        int start = responseBody.indexOf(marker) + marker.length();
        return responseBody.substring(start, responseBody.indexOf('"', start));
    }
}
