package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.application.DisputeService;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.shared.money.Money;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
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
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

/**
 * Money that has already gone back is never sent back again — #175 and #176.
 *
 * <p>Two ways the platform could pay a backer twice. A chargeback the platform lost returned the money
 * through the card network, and the refund paths did not count it (#175). A refund whose provider call
 * ended unreachable was recorded as failed and sent again, whether or not the provider had reversed the
 * payment (#176). Pledges are paid through the real flow — draft, payment page, signed webhook — and the
 * campaign-refunds job and the staff refund API are driven as they are in production.
 */
class RefundSafetyApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private CampaignRefundJob job;

    @Autowired
    private DisputeService disputes;

    @Autowired
    private PayoutGateway gateway;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private PaymentTransactionRepository transactions;

    private final List<UUID> paidPledges = new ArrayList<>();
    private final List<UUID> projects = new ArrayList<>();

    @BeforeEach
    void refundsApproved() {
        provider.reset();
    }

    @AfterEach
    void clear() {
        provider.reset();
        jdbc().update("DELETE FROM provider_webhook_events");
        PaymentRows.clearProjects(dataSource, projects);
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        // `granted_by` is RESTRICT, so a grant left behind stops IdentitySchemaTests emptying `users`.
        jdbc().update("DELETE FROM staff_role_grants WHERE note = '#175 fixture'");
    }

    // ------------------------------------------------------------------
    // #175: a lost chargeback is money gone back
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#175: a chargeback lost, then the campaign fails: the charge is not refunded again")
    void aLostChargebackIsNotRefundedWhenTheCampaignFails() {
        Paid paid = aPaidPledge("chargeback-then-failed", "25.00");
        Account admin = admin();

        assertThat(resolve(chargeback(paid, "25.00"), "LOST", admin).getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> recorded = jdbc().queryForMap(
                "SELECT reason, state, amount, charge_transaction_id, refund_transaction_id, requested_by"
                        + " FROM refunds WHERE pledge_id = ?",
                paid.pledgeId());
        assertThat(recorded.get("reason")).isEqualTo(RefundReason.CHARGEBACK.name());
        assertThat(recorded.get("state")).isEqualTo("SUCCEEDED");
        assertThat((BigDecimal) recorded.get("amount")).isEqualByComparingTo("25.00");
        assertThat(recorded.get("charge_transaction_id")).isEqualTo(paid.chargeId());
        assertThat(recorded.get("refund_transaction_id")).isNotNull();
        assertThat(recorded.get("requested_by")).isEqualTo(admin.id());
        assertThat(state(paid.pledgeId())).isEqualTo("CHARGEBACK");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
        assertThat(gateway.fundsOf(paid.projectId(), "AZN").refunded().amount())
                .as("the payout does not pay the creator money the network took back")
                .isEqualByComparingTo("25.00");

        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(Instant.now());
        job.refundDue(Instant.now().plus(Duration.ofDays(1)));

        assertThat(sentFor(paid.pledgeId())).isEmpty();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM refunds WHERE pledge_id = ?", Long.class, paid.pledgeId()))
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("#175: after a lost chargeback, staff cannot refund that money again")
    void aLostChargebackIsNotRefundedByStaff() {
        Paid paid = aPaidPledge("chargeback-then-staff", "25.00");
        resolve(chargeback(paid, "25.00"), "LOST", admin());

        ResponseEntity<Map<String, Object>> everything = staffRefund(paid.pledgeId(), null, "BACKER_REQUEST");
        ResponseEntity<Map<String, Object>> some = staffRefund(paid.pledgeId(), azn("5.00"), "BACKER_REQUEST");

        assertThat(everything.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(some.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(sentFor(paid.pledgeId())).isEmpty();
    }

    @Test
    @DisplayName("#175: a partial chargeback leaves only the rest of the charge to refund")
    void aPartialChargebackLeavesTheRest() {
        Paid paid = aPaidPledge("chargeback-partial", "25.00");
        resolve(chargeback(paid, "10.00"), "LOST", admin());
        assertThat(state(paid.pledgeId())).as("money is left on it").isEqualTo("COLLECTED");

        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(Instant.now());

        List<RefundRequest> sent = sentFor(paid.pledgeId());
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().amount().amount()).isEqualByComparingTo("15.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("#175: staff cannot issue a refund under the chargeback reason")
    void theChargebackReasonIsNotIssuable() {
        Paid paid = aPaidPledge("chargeback-reason", "25.00");

        ResponseEntity<Map<String, Object>> refused = staffRefund(paid.pledgeId(), null, "CHARGEBACK");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "REFUND_REASON_NOT_ISSUABLE");
        assertThat(sentFor(paid.pledgeId())).isEmpty();
    }

    @Test
    @DisplayName("#175: a case resolved against the platform twice moves the money once, and answers both times")
    void aDisputeResolvedTwiceMovesTheMoneyOnce() {
        Paid paid = aPaidPledge("chargeback-twice", "25.00");
        UUID dispute = chargeback(paid, "25.00");
        Account admin = admin();

        assertThat(resolve(dispute, "LOST", admin).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resolve(dispute, "CONCEDED", admin).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM refunds WHERE idempotency_key = ?", Long.class, "chargeback-" + dispute))
                .isEqualTo(1L);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM transactions WHERE idempotency_key = ?", Long.class, "dispute-" + dispute))
                .isEqualTo(1L);
        assertThat(state(paid.pledgeId())).isEqualTo("CHARGEBACK");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("#175: two chargebacks on one pledge: the second takes the rest, and the pledge ends charged back")
    void twoChargebacksEndThePledge() {
        Paid paid = aPaidPledge("chargeback-two", "25.00");
        Account admin = admin();

        resolve(chargeback(paid, "10.00"), "LOST", admin);
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");
        resolve(chargeback(paid, "15.00"), "LOST", admin);

        assertThat(jdbc().queryForList(
                        "SELECT amount || ':' || full_refund FROM refunds WHERE pledge_id = ? ORDER BY amount",
                        String.class,
                        paid.pledgeId()))
                .as("the second took everything the charge had left")
                .containsExactly("10.00:false", "15.00:true");
        assertThat(state(paid.pledgeId())).isEqualTo("CHARGEBACK");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));

        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId())).isEmpty();
    }

    @Test
    @DisplayName("#175: V84 backfills a loss recorded before it, with no author when the resolver is gone")
    void v84BackfillsAnOldLoss() {
        Paid paid = aPaidPledge("chargeback-backfill", "25.00");
        UUID dispute = chargeback(paid, "25.00");
        // What the release before #175 left behind: the case resolved, its loss transaction, no refund row.
        // The resolver's account since deleted: disputes.handled_by is ON DELETE SET NULL.
        jdbc().update(
                "UPDATE disputes SET state = 'LOST', resolved_at = now(), handled_by = NULL WHERE id = ?", dispute);
        transactions.save(PaymentTransaction.refund(
                paid.pledgeId(),
                paid.projectId(),
                Money.of(new BigDecimal("25.00"), "AZN"),
                ProviderName.PAYRIFF,
                new RefundResult(ProviderOutcome.APPROVED, "case-" + UUID.randomUUID(), null, null, null),
                "dispute-" + dispute));

        replay("V84__record_chargebacks_as_refunds.sql");
        replay("V84__record_chargebacks_as_refunds.sql");

        Map<String, Object> row = jdbc().queryForMap(
                "SELECT reason, state, amount, full_refund, requested_by, charge_transaction_id FROM refunds"
                        + " WHERE pledge_id = ?",
                paid.pledgeId());
        assertThat(row.get("reason")).isEqualTo("CHARGEBACK");
        assertThat(row.get("state")).isEqualTo("SUCCEEDED");
        assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo("25.00");
        assertThat(row.get("full_refund")).isEqualTo(true);
        assertThat(row.get("requested_by")).isNull();
        assertThat(row.get("charge_transaction_id")).isEqualTo(paid.chargeId());

        assertThat(staffRefund(paid.pledgeId(), null, "BACKER_REQUEST").getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId())).isEmpty();
    }

    // ------------------------------------------------------------------
    // #176: an unreachable refund is an unknown one
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#176: V85 reopens a refund recorded failed as unreachable, and the provider is asked before any resend")
    void v85ReopensAnUnreachableRefund() {
        Paid paid = aPaidPledge("unreachable-old", "25.00");
        end(paid.projectId(), "UNSUCCESSFUL");
        UUID old = failedAsUnreachable(paid);

        replay("V85__reopen_unreachable_refunds.sql");

        Map<String, Object> reopened = jdbc().queryForMap(
                "SELECT state, settled_at, failure_code, failure_message, review_reason FROM refunds WHERE id = ?", old);
        assertThat(reopened.get("state")).isEqualTo("REQUESTED");
        assertThat(reopened.get("settled_at")).isNull();
        assertThat(reopened.get("failure_code")).isNull();
        assertThat(reopened.get("failure_message")).isNull();
        assertThat(reopened.get("review_reason")).isNull();

        provider.willLookUp(paid.providerTransactionId(), PaymentLookup.State.RETURNED);
        job.refundDue(Instant.now());

        assertThat(sentFor(paid.pledgeId())).as("the provider had applied it").isEmpty();
        assertThat(refundStates(paid.pledgeId())).containsExactly("SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("#176: V85 leaves an unreachable refund beside a later one on the same charge to a person, and sends nothing")
    void v85LeavesAReopenedRefundBesideALaterOneToAPerson() {
        Paid paid = aPaidPledge("unreachable-then-refunded", "25.00");
        end(paid.projectId(), "UNSUCCESSFUL");
        UUID old = failedAsUnreachable(paid);
        // The release before #176 then refunded the charge again, past retry-after.
        job.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");

        replay("V85__reopen_unreachable_refunds.sql");

        Map<String, Object> reopened = jdbc().queryForMap("SELECT state, review_reason FROM refunds WHERE id = ?", old);
        assertThat(reopened.get("state")).isEqualTo("REQUESTED");
        assertThat((String) reopened.get("review_reason")).contains("another refund");

        job.refundDue(Instant.now().plus(Duration.ofDays(1)));

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(jdbc().queryForObject("SELECT state FROM refunds WHERE id = ?", String.class, old))
                .isEqualTo("REQUESTED");
    }

    @Test
    @DisplayName("#176: a campaign refund applied by the provider whose answer was lost is settled, not sent again")
    void anUnreachableCampaignRefundIsReconciledNotResent() {
        Paid paid = aPaidPledge("unreachable-applied", "25.00");
        end(paid.projectId(), "UNSUCCESSFUL");
        provider.nextRefundAppliedButUnreachable();

        job.refundDue(Instant.now());

        assertThat(refundStates(paid.pledgeId())).containsExactly("REQUESTED");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");

        // Past the retry interval as well as the reconciliation's: nothing is sent before the provider is asked.
        job.refundDue(Instant.now().plus(Duration.ofHours(7)));
        job.refundDue(Instant.now().plus(Duration.ofHours(14)));

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(refundStates(paid.pledgeId())).containsExactly("SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("#176: an unreachable refund the provider never applied is sent again only after the reconciliation")
    void anUnreachableRefundThatDidNotHappenIsResentAfterReconcile() {
        Paid paid = aPaidPledge("unreachable-lost", "25.00");
        end(paid.projectId(), "UNSUCCESSFUL");
        provider.nextRefundUnreachableAndNotApplied();

        job.refundDue(Instant.now());
        job.refundDue(Instant.now().plus(Duration.ofHours(7)));

        assertThat(sentFor(paid.pledgeId())).as("reconciled, not re-sent").hasSize(1);
        assertThat(refundStates(paid.pledgeId())).containsExactly("FAILED");

        job.refundDue(Instant.now().plus(Duration.ofHours(14)));

        assertThat(sentFor(paid.pledgeId())).hasSize(2);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("#176: a staff refund whose answer was lost answers pending, and a second one sends nothing")
    void anUnreachableStaffRefundIsPending() {
        Paid paid = aPaidPledge("unreachable-staff", "25.00");
        provider.nextRefundAppliedButUnreachable();

        ResponseEntity<Map<String, Object>> first = staffRefund(paid.pledgeId(), null, "BACKER_REQUEST");

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(first.getBody()).containsEntry("state", "REQUESTED");
        assertThat(first.getBody().get("failureCode")).isNull();

        ResponseEntity<Map<String, Object>> second = staffRefund(paid.pledgeId(), null, "BACKER_REQUEST");
        ResponseEntity<Map<String, Object>> part = staffRefund(paid.pledgeId(), azn("1.00"), "BACKER_REQUEST");

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(part.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(sentFor(paid.pledgeId())).hasSize(1);

        job.refundDue(Instant.now().plus(Duration.ofHours(2)));

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(refundStates(paid.pledgeId())).containsExactly("SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Paid(UUID projectId, UUID pledgeId, UUID chargeId, String providerTransactionId) {
    }

    private record Totals(BigDecimal pledged, int backers) {
    }

    /** A pledge paid for through the payment page and a signed success webhook. */
    private Paid aPaidPledge(String prefix, String amount) {
        Account creator = account(prefix + "-creator");
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects",
                        creator.accessToken(),
                        null,
                        Map.of("title", "A campaign that pays back once " + SEQUENCE.incrementAndGet()))
                .getBody()
                .get("id"));
        projects.add(projectId);
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", amount, "currency", "AZN"));
        UUID pledgeId = UUID.fromString((String) post(
                        "/v1/pledges/draft", backer.accessToken(), UUID.randomUUID().toString(), body)
                .getBody()
                .get("id"));
        paidPledges.add(pledgeId);
        String transaction = (String) post(
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
        UUID chargeId = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'",
                UUID.class,
                pledgeId);
        return new Paid(projectId, pledgeId, chargeId, transaction);
    }

    private UUID chargeback(Paid paid, String amount) {
        return disputes.notified(
                        ProviderName.PAYRIFF,
                        "case-" + UUID.randomUUID(),
                        paid.chargeId(),
                        Money.of(new BigDecimal(amount), "AZN"),
                        Money.of(new BigDecimal("0.00"), "AZN"),
                        "fraudulent",
                        null)
                .id();
    }

    /** A campaign refund the release before #176 recorded FAILED as unreachable, seven hours ago. */
    private UUID failedAsUnreachable(Paid paid) {
        UUID id = UUID.randomUUID();
        jdbc().update(
                """
                INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, amount, currency, full_refund,
                                     reason, detail, state, failure_code, failure_message, requested_by,
                                     requested_at, settled_at, idempotency_key)
                VALUES (?, ?, ?, ?, 25.00, 'AZN', true, 'CAMPAIGN_FAILED', 'Sent before #176', 'FAILED',
                        'provider_unreachable', 'Epoint could not be reached', NULL,
                        now() - interval '7 hours', now() - interval '7 hours', ?)
                """,
                id,
                paid.pledgeId(),
                paid.projectId(),
                paid.chargeId(),
                "campaign-refund:" + paid.chargeId() + ":1");
        return id;
    }

    /**
     * Runs a migration again, against rows written the way the release before it wrote them. V84 and V85
     * are written to be re-runnable for exactly this; the schema ends as Flyway left it.
     */
    private void replay(String migration) {
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/" + migration)).execute(dataSource);
    }

    private ResponseEntity<Map<String, Object>> resolve(UUID disputeId, String outcome, Account admin) {
        return post("/v1/admin/disputes/" + disputeId + "/resolve", admin.accessToken(), null, Map.of("outcome", outcome));
    }

    private ResponseEntity<Map<String, Object>> staffRefund(UUID pledgeId, Map<String, Object> amount, String reason) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pledgeId", pledgeId.toString());
        body.put("amount", amount);
        body.put("reason", reason);
        body.put("detail", "The backer asked, in a test.");
        return post("/v1/admin/refunds", admin().accessToken(), "refund-" + UUID.randomUUID(), body);
    }

    private static Map<String, Object> azn(String amount) {
        return Map.of("amount", amount, "currency", "AZN");
    }

    /** Moves a campaign to where the finaliser would have put it. */
    private void end(UUID projectId, String state) {
        jdbc().update(
                """
                UPDATE projects
                   SET state = ?,
                       finalized_at = now(),
                       outcome_goal_amount = goal_amount,
                       outcome_pledged_amount = pledged_amount,
                       outcome_backers_count = backers_count
                 WHERE id = ?
                """,
                state,
                projectId);
    }

    private List<RefundRequest> sentFor(UUID pledgeId) {
        return provider.refunds().stream().filter(request -> request.pledgeId().equals(pledgeId)).toList();
    }

    private List<String> refundStates(UUID pledgeId) {
        return jdbc().queryForList(
                "SELECT state FROM refunds WHERE pledge_id = ? ORDER BY requested_at", String.class, pledgeId);
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

    /** A member of staff who may resolve disputes and issue refunds: a user row holding a V48 grant. */
    private Account admin() {
        UUID id = Campaigns.creator(dataSource, "refund-safety-administrator");
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, 'ADMINISTRATOR', ?, '#175 fixture')
                ON CONFLICT DO NOTHING
                """,
                id,
                id);
        return tokenFor(id);
    }

    private Account account(String prefix) {
        return tokenFor(Campaigns.creator(dataSource, prefix + "-" + SEQUENCE.incrementAndGet()));
    }

    private Account tokenFor(UUID id) {
        String token = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(token, id);
    }

    private ResponseEntity<Map<String, Object>> post(String path, String token, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, HttpMethod.POST, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
