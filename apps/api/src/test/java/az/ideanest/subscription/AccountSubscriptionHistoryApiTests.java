package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
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

/**
 * One account's subscriptions and payments, as the console's account page reads them — #23.
 *
 * <p><strong>The test that carries the design is {@link #anyMemberOfStaffMayReadIt()}'s
 * premise</strong>, asserted from the other side by {@link #aCreatorMayNot()}: this is the
 * account page's pledge list's rule, not the revenue report's. A moderator deciding about an
 * account sees what it paid.
 *
 * <p>{@code subscriptions} is cleared after each test for {@code SubscriptionApiTests}' reason
 * (V62's one-open-per-account index). {@code subscription_payments} cannot be, and every
 * assertion about it is scoped to an account this test created.
 */
class AccountSubscriptionHistoryApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    private String adminToken;

    @AfterEach
    void clearSubscriptions() {
        new JdbcTemplate(dataSource).update("DELETE FROM subscriptions");
    }

    @Test
    @DisplayName("staff see what an account held and what it paid, with the plan named")
    void anyMemberOfStaffMayReadIt() {
        Account creator = account();
        post("/v1/me/subscription", creator.token(), Map.of("planId", growthPlanId()));
        String subscriptionId = (String) ((Map<?, ?>) get("/v1/me/subscription", creator.token())
                        .getBody()
                        .get("subscription"))
                .get("id");
        post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin(),
                Map.of("method", "CASH", "reference", "receipt 12"));

        ResponseEntity<Map<String, Object>> history =
                get("/v1/admin/users/" + creator.id() + "/subscriptions", admin());

        assertThat(history.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(history.getHeaders().getCacheControl()).contains("no-store");

        Map<String, Object> held = only(history.getBody().get("subscriptions"));
        assertThat(held.get("state")).isEqualTo("ACTIVE");
        assertThat(held.get("planCode")).isEqualTo("GROWTH");
        assertThat(held.get("price")).isEqualTo("49.00");

        Map<String, Object> paid = only(history.getBody().get("payments"));
        assertThat(paid.get("amount")).isEqualTo("49.00");
        assertThat(paid.get("method")).isEqualTo("CASH");
        assertThat(paid.get("reference")).isEqualTo("receipt 12");
        assertThat(paid.get("subscriptionId")).isEqualTo(subscriptionId);
        // The page is already about this one account, so its address is not repeated per row.
        assertThat(paid.get("accountEmail")).isNull();
    }

    @Test
    @DisplayName("an account that never subscribed is two empty lists, not a 404")
    void nothingHeldIsNotAnError() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> history =
                get("/v1/admin/users/" + creator.id() + "/subscriptions", admin());

        // "Has never paid us" and "is not a person" are different answers.
        assertThat(history.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(list(history.getBody().get("subscriptions"))).isEmpty();
        assertThat(list(history.getBody().get("payments"))).isEmpty();
    }

    @Test
    @DisplayName("an identifier that names nobody is the account page's own 404")
    void anUnknownAccountIsNotFound() {
        ResponseEntity<Map<String, Object>> history =
                get("/v1/admin/users/" + UUID.randomUUID() + "/subscriptions", admin());

        assertThat(history.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        // The same code the account page's other reads answer with, so the page fails one way.
        assertThat(history.getBody().get("code")).isEqualTo("ACCOUNT_NOT_FOUND");
    }

    @Test
    @DisplayName("a creator cannot read anybody's history, their own included")
    void aCreatorMayNot() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> refused =
                get("/v1/admin/users/" + creator.id() + "/subscriptions", creator.token());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("reading it is recorded, as counts and never as amounts")
    void theReadIsAudited() {
        Account creator = account();

        get("/v1/admin/users/" + creator.id() + "/subscriptions", admin());

        List<String> details = new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT detail FROM audit_logs WHERE entity_id = ? AND detail LIKE 'subscriptions=%'",
                        String.class,
                        creator.id());
        assertThat(details).containsExactly("subscriptions=0; payments=0");
    }

    /* ------------------------------------------------------------------
     * Fixtures
     * --------------------------------------------------------------- */

    private record Account(String token, UUID id) {
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("history" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "History Creator"),
                String.class);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                mapType());

        return new Account(
                (String) signedIn.getBody().get("accessToken"),
                users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    /** The bootstrapped administrator, token issued rather than signed in — see `SubscriptionApiTests`. */
    private String admin() {
        if (adminToken != null) {
            return adminToken;
        }
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        adminToken = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return adminToken;
    }

    private String growthPlanId() {
        ResponseEntity<Map<String, Object>> catalogue = get("/v1/plans", null);
        return list(catalogue.getBody().get("plans")).stream()
                .filter(plan -> "GROWTH".equals(plan.get("code")))
                .map(plan -> (String) plan.get("id"))
                .findFirst()
                .orElseThrow();
    }

    private ResponseEntity<Map<String, Object>> get(String path, String token) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers(token)), mapType());
    }

    private ResponseEntity<Map<String, Object>> post(String path, String token, Map<String, Object> body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers(token)), mapType());
    }

    private static HttpHeaders headers(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        if (token != null) {
            headers.setBearerAuth(token);
        }
        return headers;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object value) {
        return (List<Map<String, Object>>) value;
    }

    private static Map<String, Object> only(Object value) {
        List<Map<String, Object>> rows = list(value);
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapType() {
        return new ParameterizedTypeReference<>() {};
    }
}
