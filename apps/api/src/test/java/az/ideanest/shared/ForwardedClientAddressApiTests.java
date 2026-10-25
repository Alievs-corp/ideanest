package az.ideanest.shared;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.shared.ratelimit.AbuseProperties;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.RecordingVerificationNotifier;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
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
 * The client's address behind the proxy, through the real container — issue #578.
 *
 * <p>Production is reached through Traefik and, for the browser, the web container's
 * {@code /v1} rewrite, so the peer of every connection is a proxy. Without
 * {@code server.forward-headers-strategy: native} every per-address limit was one
 * bucket shared by every visitor, and session and audit rows named the proxy. That
 * setting works through Tomcat's {@code RemoteIpValve}, which a MockMvc test never
 * runs; this suite is on {@code RANDOM_PORT} with a real connector, so these requests
 * pass through the valve exactly as production's do.
 *
 * <p><strong>The test client is the proxy.</strong> It connects from loopback, which
 * is inside the valve's default trusted ranges just as the Docker network Traefik and
 * the web container share is. What cannot be shown here is a connection from a
 * public address, because there is none to connect from; that half of the rule is
 * Tomcat's default, and {@code application.yml} says why it must stay the default.
 *
 * <p>The buckets are asserted through {@code /v1/search}, whose per-address limit is
 * the only one on its endpoint. This profile sets that limit far out of reach, because
 * every other suite calls from the same address, so a bucket is spent directly through
 * the limiter rather than by a hundred thousand requests. The refusal itself is still
 * the endpoint's, from the address the container resolved.
 */
class ForwardedClientAddressApiTests extends AbstractIntegrationTest {

    /** Every test gets its own account, because the per-email limits are real here. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private RateLimiter rateLimiter;

    @Autowired
    private AbuseProperties abuse;

    @Autowired
    private RecordingVerificationNotifier notifier;

    @Autowired
    private JwtDecoder jwtDecoder;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("two readers behind the same proxy do not share a 429")
    void eachForwardedAddressIsItsOwnBucket() {
        spendTheSearchBudgetOf("203.0.113.9");

        // The whole of the bug, from the other side: before #578 these three requests
        // were one client, so the reader who spent the budget refused the other two.
        assertThat(search("203.0.113.9").getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(search("203.0.113.10").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(search(null).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a fresh forwarded address starts with the whole allowance")
    void aForwardedAddressIsCountedUnderItsOwnName() {
        // The proxy's own address spends first, so a budget this full afterwards can
        // only be the forwarded address's.
        search(null);
        search(null);

        ResponseEntity<String> first = search("203.0.113.12");
        ResponseEntity<String> second = search("203.0.113.12");

        assertThat(remaining(first)).isEqualTo(abuse.searchesPerAddress() - 1);
        assertThat(remaining(second)).isEqualTo(abuse.searchesPerAddress() - 2);
    }

    @Test
    @DisplayName("prepending an address to the header does not buy a new bucket")
    void theRightMostHopThatIsNotAProxyWins() {
        spendTheSearchBudgetOf("203.0.113.11");

        // What a client that has been refused would try: send a header of its own and
        // let the proxy append the real address after it. The valve reads from the
        // right, so the address the client typed is never reached.
        assertThat(search("198.51.100.1, 203.0.113.11").getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        // A private hop to the right of it is another proxy, and is passed over the
        // same way loopback is.
        assertThat(search("203.0.113.11, 10.0.0.5").getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        // And the typed address was charged nothing: its first request of its own
        // still finds a full budget.
        assertThat(remaining(search("198.51.100.1"))).isEqualTo(abuse.searchesPerAddress() - 1);
    }

    @Test
    @DisplayName("the session and the audit row name the forwarded address, not the proxy")
    void sessionsAndAuditRowsRecordTheForwardedAddress() {
        EmailAddress email = registeredAndVerified();

        ResponseEntity<Map<String, Object>> signedIn = signIn(email, "203.0.113.20");
        assertThat(signedIn.getStatusCode()).isEqualTo(HttpStatus.OK);
        UUID userId = UUID.fromString(jwtDecoder
                .decode((String) signedIn.getBody().get("accessToken"))
                .getSubject());

        assertThat(jdbc().queryForList(
                        "SELECT host(ip_address) FROM sessions WHERE user_id = ?", String.class, userId))
                .containsExactly("203.0.113.20");

        // A privileged action that anybody can provoke and that is recorded inside the
        // request, so AuditEnvironment reads the address from the request itself.
        ResponseEntity<String> requested = rest.exchange(
                "/v1/auth/forgot-password",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email.value()), forwardedFor("203.0.113.21")),
                String.class);
        assertThat(requested.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        assertThat(jdbc().queryForList(
                        "SELECT host(source_address) FROM audit_logs WHERE entity_id = ? AND action = ?",
                        String.class,
                        userId,
                        AuditAction.PASSWORD_RESET_REQUESTED.action()))
                .containsExactly("203.0.113.21");
    }

    // ------------------------------------------------------------------
    // Fixtures and calls
    // ------------------------------------------------------------------

    /** What a client that has used up its allowance looks like to the limiter. */
    private void spendTheSearchBudgetOf(String address) {
        for (int attempt = 0; attempt < abuse.searchesPerAddress(); attempt++) {
            rateLimiter.recordAttempt("search:ip:" + address, abuse.searchesPerAddress(), abuse.window());
        }
    }

    private ResponseEntity<String> search(String forwardedFor) {
        return rest.exchange(
                "/v1/search?q=nothing-matches-this",
                HttpMethod.GET,
                new HttpEntity<>(forwardedFor(forwardedFor)),
                String.class);
    }

    private EmailAddress registeredAndVerified() {
        EmailAddress email = EmailAddress.of("forwarded" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        rest.postForEntity(
                "/v1/auth/verify-email", Map.of("token", notifier.tokenSentTo(email).orElseThrow()), String.class);
        return email;
    }

    private ResponseEntity<Map<String, Object>> signIn(EmailAddress email, String forwardedFor) {
        return rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"),
                        forwardedFor(forwardedFor)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /** JSON headers, with the proxy's {@code X-Forwarded-For} when there is one. */
    private static HttpHeaders forwardedFor(String value) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (value != null) {
            headers.set("X-Forwarded-For", value);
        }
        return headers;
    }

    private static int remaining(ResponseEntity<String> response) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        String value = response.getHeaders().getFirst("X-RateLimit-Remaining");
        assertThat(value).as("X-RateLimit-Remaining").isNotNull();
        return Integer.parseInt(value);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
