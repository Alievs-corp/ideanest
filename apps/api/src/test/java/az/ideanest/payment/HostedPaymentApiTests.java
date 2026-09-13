package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
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
 * Charged at confirmation — IDN-EXT-01 (#39), §6.2's {@code DRAFT → COLLECTED}.
 *
 * <p>End to end through the two requests that make it: the backer's
 * {@code POST /v1/pledges/{id}/payment}, and the provider's webhook saying the payment went through
 * or did not. The scripted provider opens the page; a scripted delivery settles it.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aSuccessfulPaymentCollectsAndCounts()} — the money, the pledge and the campaign's
 *       total move together, and the total moves for the first time in the platform's life.
 *   <li>{@link #aSecondDeliveryMovesNothingTwice()} — a payment is counted once however often the
 *       provider says so.
 *   <li>{@link #aFailedPaymentLeavesTheDraft()} — nothing is counted for money nobody took.
 * </ul>
 */
class HostedPaymentApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ScriptedPaymentProvider provider;

    /**
     * The deliveries this suite made. ProviderWebhookApiTests reads that table as its own, and a row
     * left here would be the first one it finds. Transactions and ledger rows are append-only by
     * trigger and stay, as every payment suite's do.
     */
    @AfterEach
    void clearDeliveries() {
        jdbc().update("DELETE FROM provider_webhook_events");
    }

    @Test
    @DisplayName("opening the payment page holds the draft and records a pending charge, and moves no money")
    void openingThePageHoldsTheDraft() {
        Checkout checkout = aDraft("hosted-open");
        String key = UUID.randomUUID().toString();

        ResponseEntity<Map<String, Object>> page = pay(checkout, key);

        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((String) page.getBody().get("redirectUrl")).startsWith("https://");
        String transaction = (String) page.getBody().get("providerTransactionId");
        assertThat(transaction).startsWith("scripted-hosted-");

        HostedPaymentRequest asked = provider.hostedPayments().getLast();
        assertThat(asked.pledgeId()).isEqualTo(checkout.pledgeId());
        assertThat(asked.amount().amount()).isEqualByComparingTo("25.00");
        assertThat(asked.idempotencyKey()).isEqualTo(key);

        // Still a draft, held for the payment window rather than the five minutes.
        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(reservationExpiresAt(checkout.pledgeId()))
                .isAfter(Instant.now().plus(Duration.ofMinutes(10)));
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a successful payment collects the pledge, posts the ledger and counts towards the campaign")
    void aSuccessfulPaymentCollectsAndCounts() {
        Checkout checkout = aDraft("hosted-paid");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(state(checkout.pledgeId())).isEqualTo("COLLECTED");
        Map<String, Object> pledge = jdbc().queryForMap(
                "SELECT confirmed_at, collected_at FROM pledges WHERE id = ?", checkout.pledgeId());
        assertThat(pledge.get("confirmed_at")).isNotNull();
        assertThat(pledge.get("collected_at")).isNotNull();

        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        UUID settled = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND status = 'SUCCEEDED'", UUID.class, checkout.pledgeId());
        assertThat(jdbc().queryForObject("SELECT count(*) FROM ledger_entries WHERE transaction_id = ?", Long.class, settled))
                .isEqualTo(2L);

        // The first time anything in production has moved these two columns.
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
    }

    @Test
    @DisplayName("a second delivery about the same payment moves nothing twice")
    void aSecondDeliveryMovesNothingTwice() {
        Checkout checkout = aDraft("hosted-twice");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        String eventId = "evt-" + UUID.randomUUID();
        deliver(eventId, transaction, "charge_succeeded");
        // The same event again, which the webhook table refuses, and a different event about the
        // same payment, which the settled row refuses.
        deliver(eventId, transaction, "charge_succeeded");
        deliver(transaction, "charge_succeeded");

        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
    }

    @Test
    @DisplayName("a failed payment leaves the draft to its hold and counts nothing")
    void aFailedPaymentLeavesTheDraft() {
        Checkout checkout = aDraft("hosted-failed");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        assertThat(deliver(transaction, "charge_failed").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "FAILED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("only a draft can be paid for")
    void onlyADraftCanBePaidFor() {
        Checkout checkout = aDraft("hosted-again");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        deliver(transaction, "charge_succeeded");

        ResponseEntity<Map<String, Object>> again = pay(checkout, UUID.randomUUID().toString());

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "PLEDGE_NOT_DRAFT");
    }

    @Test
    @DisplayName("a retried request answers the page it opened rather than opening a second")
    void aRetryReplaysThePage() {
        Checkout checkout = aDraft("hosted-retry");
        String key = UUID.randomUUID().toString();

        Object first = pay(checkout, key).getBody().get("providerTransactionId");
        Object second = pay(checkout, key).getBody().get("providerTransactionId");

        assertThat(second).isEqualTo(first);
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
    }

    @Test
    @DisplayName("paying needs an Idempotency-Key, and somebody else's pledge is not found")
    void keyAndOwnership() {
        Checkout checkout = aDraft("hosted-guard");

        assertThat(pay(checkout.backer(), checkout.pledgeId(), null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(pay(account("hosted-stranger"), checkout.pledgeId(), UUID.randomUUID().toString()).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(provider.hostedPayments()).noneMatch(request -> request.pledgeId().equals(checkout.pledgeId()));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Checkout(Account backer, UUID projectId, UUID pledgeId) {
    }

    private record Totals(BigDecimal pledged, int backers) {
    }

    private Checkout aDraft(String prefix) {
        Account creator = account(prefix + "-creator");
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                null,
                Map.of("title", "A campaign paid for on a page " + SEQUENCE.incrementAndGet()));
        UUID projectId = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));
        ResponseEntity<Map<String, Object>> draft = exchange(
                "/v1/pledges/draft", HttpMethod.POST, backer.accessToken(), UUID.randomUUID().toString(), body);
        assertThat(draft.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return new Checkout(backer, projectId, UUID.fromString((String) draft.getBody().get("id")));
    }

    private ResponseEntity<Map<String, Object>> pay(Checkout checkout, String key) {
        return pay(checkout.backer(), checkout.pledgeId(), key);
    }

    private ResponseEntity<Map<String, Object>> pay(Account caller, UUID pledgeId, String key) {
        return exchange(
                "/v1/pledges/" + pledgeId + "/payment",
                HttpMethod.POST,
                caller.accessToken(),
                key,
                Map.of("language", "en", "successUrl", "https://ideanest.test/back/ok"));
    }

    private ResponseEntity<String> deliver(String transaction, String type) {
        return deliver("evt-" + UUID.randomUUID(), transaction, type);
    }

    private ResponseEntity<String> deliver(String eventId, String transaction, String type) {
        String body = """
                {"id":"%s","type":"%s","providerTransactionId":"%s"}"""
                .formatted(eventId, type, transaction);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        return rest.exchange(
                "/v1/webhooks/psp/payriff", HttpMethod.POST, new HttpEntity<>(body.getBytes(), headers), String.class);
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), json),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        var user = users.findByEmailAndDeletedAtIsNull(email).orElseThrow();
        return new Account((String) signedIn.getBody().get("accessToken"), user.getId());
    }

    private ResponseEntity<Map<String, Object>> exchange(
            String path, HttpMethod method, String token, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private String state(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    private Instant reservationExpiresAt(UUID pledgeId) {
        return jdbc().queryForObject("SELECT reservation_expires_at FROM pledges WHERE id = ?", Instant.class, pledgeId);
    }

    private List<String> charges(UUID pledgeId) {
        return jdbc().queryForList(
                "SELECT status FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' ORDER BY created_at, status DESC",
                String.class,
                pledgeId);
    }

    private Totals totals(UUID projectId) {
        return jdbc().queryForObject(
                "SELECT pledged_amount, backers_count FROM projects WHERE id = ?",
                (row, index) -> new Totals(row.getBigDecimal("pledged_amount"), row.getInt("backers_count")),
                projectId);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
