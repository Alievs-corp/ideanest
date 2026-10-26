package az.ideanest.audit;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.io.IOException;
import java.net.InetAddress;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
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

/**
 * The privileged actions that already existed, over HTTP, leaving rows behind.
 *
 * <p>{@link AuditLogTests} proves what {@link AuditLog} guarantees. This proves the
 * other half, which is the half that rots: that the call sites are wired, and that
 * the values nobody passes as an argument — the source address, the user agent, and
 * §18.1's request identifier — really do arrive on the row when the action came in
 * over a request. A unit test of the recording API cannot show either.
 *
 * <p>Every test uses its own account, because closing one revokes its sessions and
 * because the per-account rate limits are deliberately reachable.
 */
class PrivilegedActionAuditTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** Long enough for {@code Correlation.acceptableIdentifier}, which is what the log accepts. */
    private static final String USER_AGENT = "IdeaNestAuditTests/1.0";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository entries;

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Account(String accessToken, UUID id, EmailAddress email) {
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("audit" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return signIn(email);
    }

    private Account signIn(EmailAddress email) {
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id, email);
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    /** A request that looks like a client's: a bearer token, a user agent, a request identifier. */
    private static HttpHeaders request(String accessToken, String requestId) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        headers.set(HttpHeaders.USER_AGENT, USER_AGENT);
        if (requestId != null) {
            headers.set("X-Request-Id", requestId);
        }
        return headers;
    }

    private List<AuditEntry> rowsAbout(String entityType, UUID entityId) {
        return entries.findByEntityTypeAndEntityIdOrderByOccurredAtDesc(entityType, entityId);
    }

    private static List<String> actionsIn(List<AuditEntry> rows) {
        return rows.stream().map(AuditEntry::getAction).toList();
    }

    // ------------------------------------------------------------------
    // §17.4's export
    // ------------------------------------------------------------------

    @Test
    @DisplayName("exporting an account is recorded, with where the request came from")
    void exportingAnAccountIsRecorded() throws IOException {
        Account account = account();
        String requestId = UUID.randomUUID().toString();

        ResponseEntity<String> response = rest.exchange(
                "/v1/me/export",
                HttpMethod.GET,
                new HttpEntity<>(request(account.accessToken(), requestId)),
                String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(rowsAbout("account", account.id()))
                .filteredOn(entry -> entry.getAction().equals("account.exported"))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.getActorId()).isEqualTo(account.id());
                    assertThat(entry.getActorType()).isEqualTo(AuditActorType.USER);
                    assertThat(entry.getOutcome()).isEqualTo(AuditOutcome.SUCCEEDED);
                    // The client's own identifier, honoured because CorrelationFilter
                    // found it well formed. Without it on the row there is no way to
                    // reach the log lines of the request that produced the export.
                    assertThat(entry.getRequestId()).isEqualTo(requestId);
                    assertThat(entry.getTraceId()).isNotNull();
                    assertThat(entry.getUserAgent()).isEqualTo(USER_AGENT);
                    // A literal, so this parses without a lookup. The suite calls
                    // itself, and whether the container hands back the IPv4 or the
                    // IPv6 spelling of that is not this test's business.
                    assertThat(InetAddress.getByName(entry.getSourceAddress()).isLoopbackAddress())
                            .isTrue();
                });
    }

    @Test
    @DisplayName("a request identifier the log would have refused does not reach the row either")
    void aMalformedRequestIdentifierIsReplaced() throws IOException {
        Account account = account();

        // A newline forges a log entry, which is why CorrelationFilter drops a
        // malformed inbound identifier and mints one instead. The audit row carries
        // whatever it minted, so the two still join — what it must never carry is
        // the caller's string.
        rest.exchange(
                "/v1/me/export",
                HttpMethod.GET,
                new HttpEntity<>(request(account.accessToken(), "not a request id")),
                String.class);

        assertThat(rowsAbout("account", account.id()))
                .filteredOn(entry -> entry.getAction().equals("account.exported"))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.getRequestId()).isNotNull().isNotEqualTo("not a request id");
                    assertThat(InetAddress.getByName(entry.getSourceAddress()).isLoopbackAddress())
                            .isTrue();
                });
    }

    // ------------------------------------------------------------------
    // §17.4's deletion
    // ------------------------------------------------------------------

    @Test
    @DisplayName("closing an account, and changing one's mind, are both recorded — and so is the sign-out that comes with it")
    void closingAnAccountIsRecorded() {
        Account account = account();

        ResponseEntity<String> requested = rest.exchange(
                "/v1/me/deletion",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("password", PASSWORD), request(account.accessToken(), null)),
                String.class);
        assertThat(requested.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        // Signed in again: the request ended every session, the one that made it
        // included, and since #587 that ends its access token too. Signing in is
        // allowed during the grace period precisely so that a change of mind is
        // possible.
        ResponseEntity<String> cancelled = rest.exchange(
                "/v1/me/deletion",
                HttpMethod.DELETE,
                new HttpEntity<>(request(signIn(account.email()).accessToken(), null)),
                String.class);
        assertThat(cancelled.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // Three actions, one account, one table. Revoking every session is part of
        // closing an account — §17.4 says so — and it is a privileged action in its
        // own right, recorded by SessionRevoker rather than by the endpoint.
        assertThat(actionsIn(rowsAbout("account", account.id())))
                .contains("account.deletion_requested", "account.deletion_cancelled", "session.revoked_all");
    }

    // ------------------------------------------------------------------
    // §17.3's device list
    // ------------------------------------------------------------------

    @Test
    @DisplayName("revoking a device is recorded against the session, by the account that revoked it")
    void revokingASessionIsRecorded() {
        Account account = account();

        ResponseEntity<List<Map<String, Object>>> listed = rest.exchange(
                "/v1/auth/sessions",
                HttpMethod.GET,
                new HttpEntity<>(request(account.accessToken(), null)),
                new ParameterizedTypeReference<List<Map<String, Object>>>() {});
        assertThat(listed.getBody()).isNotEmpty();

        UUID sessionId = UUID.fromString((String) listed.getBody().get(0).get("id"));

        ResponseEntity<String> revoked = rest.exchange(
                "/v1/auth/sessions/" + sessionId,
                HttpMethod.DELETE,
                new HttpEntity<>(request(account.accessToken(), null)),
                String.class);
        assertThat(revoked.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(rowsAbout("session", sessionId)).singleElement().satisfies(entry -> {
            assertThat(entry.getAction()).isEqualTo("session.revoked");
            // The owner, derived from the reason. A user clearing a device from the
            // list did it themselves; a revocation the platform decided on — a reused
            // refresh token, a password change — is recorded as SYSTEM.
            assertThat(entry.getActorId()).isEqualTo(account.id());
            assertThat(entry.getActorType()).isEqualTo(AuditActorType.USER);
            assertThat(entry.getDetail()).contains("USER_REVOKED");
        });
    }

    @Test
    @DisplayName("revoking a session that is not there records nothing")
    void revokingNothingRecordsNothing() {
        Account account = account();
        UUID unknown = UUID.randomUUID();

        ResponseEntity<String> response = rest.exchange(
                "/v1/auth/sessions/" + unknown,
                HttpMethod.DELETE,
                new HttpEntity<>(request(account.accessToken(), null)),
                String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        // Nothing was withdrawn. A row here would make a stale client look like a
        // security event, and in a table nothing can prune it would look like one
        // for ever.
        assertThat(rowsAbout("session", unknown)).isEmpty();
    }
}
