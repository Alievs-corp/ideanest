package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

/**
 * Every backer refunded in full — IDN-EXT-01 (#40), §9.7.
 *
 * <p>Pledges are paid for through the real flow — draft, payment page, signed webhook — so the refund
 * starts from the charge row, the ledger and the totals a real payment leaves. The campaign is then
 * moved to its end state by hand, because the edges into it are the finaliser's and moderation's and
 * have their own tests.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aSecondPassRefundsNothingTwice()} — Epoint's {@code /reverse} has no duplicate
 *       protection, so the platform's is the only one.
 *   <li>{@link #aLostOutcomeIsSettledFromTheReturnedStatus()} — a refund whose answer was lost is
 *       never re-sent blind.
 * </ul>
 */
class CampaignRefundTests extends AbstractIntegrationTest {

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

    @Autowired
    private CampaignRefundJob job;

    @BeforeEach
    void refundsApproved() {
        provider.willRefund();
    }

    /** The pledges this suite paid for, whose payment rows it removes — see {@code PaymentRows}. */
    private final List<UUID> paidPledges = new ArrayList<>();

    @AfterEach
    void clearDeliveries() {
        provider.willRefund();
        jdbc().update("DELETE FROM provider_webhook_events");
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
    }

    @Test
    @DisplayName("an unsuccessful campaign's paid pledges are refunded in full, by the platform, and leave its totals")
    void anUnsuccessfulCampaignIsRefunded() {
        Paid paid = aPaidPledge("refund-failed");
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(Instant.now());

        Map<String, Object> refund = refundOf(paid.pledgeId());
        assertThat(refund.get("state")).isEqualTo("SUCCEEDED");
        assertThat(refund.get("reason")).isEqualTo(RefundReason.CAMPAIGN_FAILED.name());
        assertThat(refund.get("requested_by")).isNull();
        assertThat((BigDecimal) refund.get("amount")).isEqualByComparingTo("25.00");
        assertThat(refund.get("full_refund")).isEqualTo(true);

        RefundRequest sent = sentFor(paid.pledgeId()).getFirst();
        assertThat(sent.providerTransactionId()).isEqualTo(paid.providerTransactionId());
        assertThat(sent.amount().amount()).isEqualByComparingTo("25.00");

        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM transactions WHERE pledge_id = ? AND type = 'REFUND' AND status = 'SUCCEEDED'",
                        Long.class,
                        paid.pledgeId()))
                .isEqualTo(1L);
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a second pass refunds nothing twice")
    void aSecondPassRefundsNothingTwice() {
        Paid paid = aPaidPledge("refund-twice");
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(Instant.now());
        job.refundDue(Instant.now());
        job.refundDue(Instant.now().plus(Duration.ofDays(1)));

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(refundCount(paid.pledgeId())).isEqualTo(1L);
    }

    @Test
    @DisplayName("a suspended or cancelled campaign's backers are refunded as a halt")
    void aHaltIsRefunded() {
        Paid suspended = aPaidPledge("refund-suspended");
        end(suspended.projectId(), "SUSPENDED");
        Paid cancelled = aPaidPledge("refund-cancelled");
        end(cancelled.projectId(), "CANCELED");

        job.refundDue(Instant.now());

        assertThat(refundOf(suspended.pledgeId()).get("reason")).isEqualTo(RefundReason.CAMPAIGN_HALTED.name());
        assertThat(refundOf(cancelled.pledgeId()).get("reason")).isEqualTo(RefundReason.CAMPAIGN_HALTED.name());
        assertThat(state(cancelled.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("a campaign still funding, or a successful one, is not refunded")
    void successfulAndLiveCampaignsAreLeftAlone() {
        Paid live = aPaidPledge("refund-live");
        Paid successful = aPaidPledge("refund-successful");
        end(successful.projectId(), "SUCCESSFUL");

        job.refundDue(Instant.now());

        assertThat(sentFor(live.pledgeId())).isEmpty();
        assertThat(sentFor(successful.pledgeId())).isEmpty();
        assertThat(state(successful.pledgeId())).isEqualTo("COLLECTED");
        assertThat(totals(successful.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
    }

    @Test
    @DisplayName("a refused refund is recorded, and sent again only after the retry interval")
    void aRefusedRefundWaitsBeforeItIsRetried() {
        Paid paid = aPaidPledge("refund-refused");
        end(paid.projectId(), "UNSUCCESSFUL");
        provider.willRefuseRefunds("transaction_too_old");

        job.refundDue(Instant.now());
        assertThat(refundOf(paid.pledgeId()).get("state")).isEqualTo("FAILED");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");

        provider.willRefund();
        job.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId())).as("not on the next pass").hasSize(1);

        job.refundDue(Instant.now().plus(Duration.ofHours(7)));
        assertThat(sentFor(paid.pledgeId())).hasSize(2);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("a refund whose outcome was lost is settled from the provider's returned status, not re-sent")
    void aLostOutcomeIsSettledFromTheReturnedStatus() {
        Paid paid = aPaidPledge("refund-lost");
        end(paid.projectId(), "UNSUCCESSFUL");
        // A platform refund the process recorded and never settled: the crash between asking the
        // provider and writing down its answer.
        UUID charge = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'",
                UUID.class,
                paid.pledgeId());
        jdbc().update(
                """
                INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, amount, currency, full_refund,
                                     reason, detail, state, requested_by, requested_at, idempotency_key)
                VALUES (?, ?, ?, ?, 25.00, 'AZN', true, 'CAMPAIGN_FAILED', 'Lost in a crash', 'REQUESTED', NULL,
                        now() - interval '2 hours', ?)
                """,
                UUID.randomUUID(),
                paid.pledgeId(),
                paid.projectId(),
                charge,
                "campaign-refund:" + paid.pledgeId() + ":1");
        provider.willLookUp(paid.providerTransactionId(), PaymentLookup.State.RETURNED);

        job.refundDue(Instant.now());

        assertThat(sentFor(paid.pledgeId())).as("never re-sent blind").isEmpty();
        assertThat(refundOf(paid.pledgeId()).get("state")).isEqualTo("SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Paid(UUID projectId, UUID pledgeId, String providerTransactionId) {
    }

    private record Totals(BigDecimal pledged, int backers) {
    }

    /** A pledge of 25.00 AZN paid for through the payment page and a signed success webhook. */
    private Paid aPaidPledge(String prefix) {
        Account creator = account(prefix + "-creator");
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                creator.accessToken(),
                null,
                Map.of("title", "A campaign that pays everybody back " + SEQUENCE.incrementAndGet()));
        UUID projectId = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));
        UUID pledgeId = UUID.fromString((String) exchange(
                        "/v1/pledges/draft", backer.accessToken(), UUID.randomUUID().toString(), body)
                .getBody()
                .get("id"));
        paidPledges.add(pledgeId);

        String transaction = (String) exchange(
                        "/v1/pledges/" + pledgeId + "/payment",
                        backer.accessToken(),
                        UUID.randomUUID().toString(),
                        Map.of("language", "en"))
                .getBody()
                .get("providerTransactionId");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        String delivery = """
                {"id":"evt-%s","type":"charge_succeeded","providerTransactionId":"%s"}"""
                .formatted(UUID.randomUUID(), transaction);
        assertThat(rest.exchange(
                                "/v1/webhooks/psp/payriff",
                                HttpMethod.POST,
                                new HttpEntity<>(delivery.getBytes(), headers),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(pledgeId)).isEqualTo("COLLECTED");
        return new Paid(projectId, pledgeId, transaction);
    }

    /** Moves a campaign to where the finaliser or moderation would have put it. */
    private void end(UUID projectId, String state) {
        jdbc().update(
                """
                UPDATE projects
                   SET state = ?,
                       finalized_at = CASE WHEN ? IN ('SUCCESSFUL', 'UNSUCCESSFUL') THEN now() END,
                       outcome_goal_amount = CASE WHEN ? IN ('SUCCESSFUL', 'UNSUCCESSFUL') THEN goal_amount END,
                       outcome_pledged_amount = CASE WHEN ? IN ('SUCCESSFUL', 'UNSUCCESSFUL') THEN pledged_amount END,
                       outcome_backers_count = CASE WHEN ? IN ('SUCCESSFUL', 'UNSUCCESSFUL') THEN backers_count END
                 WHERE id = ?
                """,
                state,
                state,
                state,
                state,
                state,
                projectId);
    }

    private List<RefundRequest> sentFor(UUID pledgeId) {
        return provider.refunds().stream().filter(request -> request.pledgeId().equals(pledgeId)).toList();
    }

    private Map<String, Object> refundOf(UUID pledgeId) {
        return jdbc().queryForMap(
                "SELECT state, reason, requested_by, amount, full_refund FROM refunds WHERE pledge_id = ?"
                        + " ORDER BY requested_at DESC LIMIT 1",
                pledgeId);
    }

    private long refundCount(UUID pledgeId) {
        return jdbc().queryForObject("SELECT count(*) FROM refunds WHERE pledge_id = ?", Long.class, pledgeId);
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

    private ResponseEntity<Map<String, Object>> exchange(String path, String token, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, HttpMethod.POST, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private String state(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
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
