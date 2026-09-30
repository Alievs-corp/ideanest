package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.payment.application.CampaignFunds;
import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.application.DisputeService;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payment.application.RefundService;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.pledge.application.ReservationCleanerJob;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.money.Money;
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
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
 * Raising a paid pledge while its campaign takes pledges, and charging the difference — #171.
 *
 * <p>End to end through the requests that make it: a pledge paid for on the provider's page and
 * settled by a signed webhook, then {@code POST /v1/pledges/{id}/raise}, then the provider's webhook
 * about the difference. The scripted provider opens both pages; scripted deliveries settle them.
 *
 * <p>Every scenario starts from the same campaign: Standard at 25.00 (ten places), Deluxe at 60.00
 * (two places), and a Mug add-on at 10.00 (three places), with a backer who paid 25.00 for Standard.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aPaidRaiseChargesTheDifferenceAndMovesThePledge()} — the difference and nothing else
 *       is charged, and the pledge, the places and the campaign's total move only once it is paid.
 *   <li>{@link #aDeclinedRaiseChangesNothing()} — a refused payment leaves the pledge as it was.
 *   <li>{@link #aRetriedRaiseChargesOnce()} and {@link #twoRaisesAtOnceOpenOnePage()} — one page, one
 *       charge, however the request arrives.
 *   <li>{@link #aFailedCampaignRefundsEveryCharge()} and {@link #aSuccessfulCampaignPaysOutTheNewTotal()}
 *       — the difference is refunded and paid out with the rest.
 * </ul>
 */
class PledgeRaiseApiTests extends AbstractIntegrationTest {

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
    private CampaignRefundJob refunds;

    @Autowired
    private ReservationCleanerJob cleaner;

    @Autowired
    private PayoutGateway payouts;

    /** The pledges this suite paid for, whose payment rows it removes — see {@code PaymentRows}. */
    private final List<UUID> paidPledges = new ArrayList<>();

    @Autowired
    private RefundService refundService;

    @Autowired
    private PaymentTransactionRepository transactionRows;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DisputeService disputes;

    @BeforeEach
    void refundsApproved() {
        provider.willRefund();
        provider.answerEveryRefund();
        provider.willOpenHostedPayments();
    }

    @AfterEach
    void clearPayments() {
        provider.willRefund();
        provider.answerEveryRefund();
        provider.willOpenHostedPayments();
        jdbc().update("DELETE FROM provider_webhook_events");
        // This suite's pledges' events, which no relay here publishes: left behind, a later suite's relay
        // would deliver them against campaigns that suite may already have removed.
        for (UUID pledgeId : paidPledges) {
            jdbc().update("DELETE FROM outbox_events WHERE aggregate_id = ?", pledgeId);
        }
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        // `granted_by` is RESTRICT, so a grant left behind stops IdentitySchemaTests emptying `users`.
        jdbc().update("DELETE FROM staff_role_grants WHERE note = '#174 fixture'");
    }

    // ------------------------------------------------------------------
    // The charge
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a raise charges exactly the difference, and the pledge moves only once it is paid")
    void aPaidRaiseChargesTheDifferenceAndMovesThePledge() {
        Scenario paid = aPaidPledge("raise-paid");

        ResponseEntity<Map<String, Object>> opened = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());

        assertThat(opened.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Deluxe 60 and two mugs 20 is 80, and 25 is already paid.
        assertThat(money(opened.getBody(), "amount")).isEqualTo("55.00");
        assertThat(money(opened.getBody(), "total")).isEqualTo("80.00");
        assertThat((String) opened.getBody().get("redirectUrl")).startsWith("https://");

        HostedPaymentRequest asked = provider.hostedPayments().getLast();
        assertThat(asked.pledgeId()).isEqualTo(paid.pledgeId());
        assertThat(asked.amount().amount()).isEqualByComparingTo("55.00");
        assertThat(asked.idempotencyKey()).startsWith("pledge-raise-");

        // Nothing about the pledge has moved yet. The places the raise needs are held as reserved.
        Map<String, Object> pending = read(paid);
        assertThat(pending.get("state")).isEqualTo("COLLECTED");
        assertThat(amount(pending, "total")).isEqualTo("25.00");
        assertThat(pending.get("rewardTierId")).isEqualTo(paid.standard().toString());
        assertThat(raiseOf(pending).get("state")).isEqualTo("PENDING");
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 1));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 2));
        assertThat(stock(paid.standard())).isEqualTo(new Stock(1, 0));
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));

        assertThat(deliver((String) opened.getBody().get("providerTransactionId"), "charge_succeeded")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        Map<String, Object> raised = read(paid);
        assertThat(raised.get("state")).isEqualTo("COLLECTED");
        assertThat(amount(raised, "total")).isEqualTo("80.00");
        assertThat(amount(raised, "base")).isEqualTo("60.00");
        assertThat(amount(raised, "addons")).isEqualTo("20.00");
        assertThat(raised.get("rewardTierId")).isEqualTo(paid.deluxe().toString());
        assertThat(addonsOf(raised)).containsExactly(Map.of("rewardTierId", paid.mug().toString(), "quantity", 2));
        assertThat(raiseOf(raised).get("state")).isEqualTo("SUCCEEDED");

        // The held places are committed, and the place on Standard the pledge gave up goes back.
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(1, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(2, 0));
        assertThat(stock(paid.standard())).isEqualTo(new Stock(0, 0));

        // The campaign raised the difference more, from the same backer.
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("80.00"), 1));
        assertThat(settledCharges(paid.pledgeId())).containsExactly(new BigDecimal("25.00"), new BigDecimal("55.00"));
        UUID raiseCharge = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND status = 'SUCCEEDED' AND amount = 55.00",
                UUID.class,
                paid.pledgeId());
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM ledger_entries WHERE transaction_id = ?", Long.class, raiseCharge))
                .isEqualTo(2L);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM outbox_events WHERE aggregate_id = ? AND event_type = 'pledge.edited'",
                        Long.class,
                        paid.pledgeId()))
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("a declined payment leaves the pledge, its places and the campaign's total as they were")
    void aDeclinedRaiseChangesNothing() {
        Scenario paid = aPaidPledge("raise-declined");
        String transaction = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");

        assertThat(deliver(transaction, "charge_failed").getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> after = read(paid);
        assertThat(amount(after, "total")).isEqualTo("25.00");
        assertThat(after.get("rewardTierId")).isEqualTo(paid.standard().toString());
        assertThat(addonsOf(after)).isEmpty();
        assertThat(raiseOf(after).get("state")).isEqualTo("FAILED");
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.standard())).isEqualTo(new Stock(1, 0));
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
        assertThat(settledCharges(paid.pledgeId())).containsExactly(new BigDecimal("25.00"));

        // Nothing is in flight any more, so the backer may try again at once.
        assertThat(raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString()).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a retried raise answers the page it opened, and a payment counted twice is counted once")
    void aRetriedRaiseChargesOnce() {
        Scenario paid = aPaidPledge("raise-retry");
        String key = UUID.randomUUID().toString();
        int pagesBefore = pagesFor(paid.pledgeId());

        Object first = raiseToDeluxeWithTwoMugs(paid, key).getBody().get("providerTransactionId");
        ResponseEntity<Map<String, Object>> again = raiseToDeluxeWithTwoMugs(paid, key);

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(again.getBody().get("providerTransactionId")).isEqualTo(first);
        assertThat(pagesFor(paid.pledgeId())).isEqualTo(pagesBefore + 1);

        String eventId = "evt-" + UUID.randomUUID();
        deliver(eventId, (String) first, "charge_succeeded");
        deliver(eventId, (String) first, "charge_succeeded");
        deliver((String) first, "charge_succeeded");

        assertThat(settledCharges(paid.pledgeId())).containsExactly(new BigDecimal("25.00"), new BigDecimal("55.00"));
        assertThat(amount(read(paid), "total")).isEqualTo("80.00");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("80.00"), 1));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(2, 0));
    }

    @Test
    @DisplayName("two raises at once open one page; the other is told a raise is already in flight")
    void twoRaisesAtOnceOpenOnePage() throws Exception {
        Scenario paid = aPaidPledge("raise-race");
        int pagesBefore = pagesFor(paid.pledgeId());

        CountDownLatch start = new CountDownLatch(1);
        Callable<HttpStatus> attempt = () -> {
            start.await();
            return (HttpStatus) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString()).getStatusCode();
        };
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<HttpStatus> one = pool.submit(attempt);
            Future<HttpStatus> two = pool.submit(attempt);
            start.countDown();
            assertThat(List.of(one.get(), two.get()))
                    .containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);
        } finally {
            pool.shutdownNow();
        }

        assertThat(pagesFor(paid.pledgeId())).isEqualTo(pagesBefore + 1);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM pledge_raises WHERE pledge_id = ? AND state = 'PENDING'",
                        Long.class,
                        paid.pledgeId()))
                .isEqualTo(1L);
        // One hold, not two.
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 1));

        ResponseEntity<Map<String, Object>> third = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());
        assertThat(third.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(third.getBody()).containsEntry("code", "PLEDGE_RAISE_IN_PROGRESS");
    }

    // ------------------------------------------------------------------
    // What is refused
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a paid pledge cannot be lowered, left the same, charged at another figure, or withdrawn")
    void loweringAndWithdrawingAreRefused() {
        Scenario paid = aPaidPledge("raise-lower", "30.00");

        ResponseEntity<Map<String, Object>> lower = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("25.00"), "expectedAmount", azn("1.00")));
        assertThat(lower.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(lower.getBody()).containsEntry("code", "PLEDGE_DECREASE_NOT_ALLOWED");

        ResponseEntity<Map<String, Object>> same = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("30.00"), "expectedAmount", azn("1.00")));
        assertThat(same.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(same.getBody()).containsEntry("code", "RAISE_NOT_AN_INCREASE");

        ResponseEntity<Map<String, Object>> moved = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("40.00"), "expectedAmount", azn("5.00")));
        assertThat(moved.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(moved.getBody()).containsEntry("code", "RAISE_AMOUNT_CHANGED");
        assertThat(meta(moved.getBody()).get("actual")).isEqualTo(Map.of("amount", "10.00", "currency", "AZN"));

        ResponseEntity<Map<String, Object>> withdrawn = rest.exchange(
                "/v1/pledges/" + paid.pledgeId(),
                HttpMethod.DELETE,
                new HttpEntity<>(null, headers(paid.backer(), UUID.randomUUID().toString())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(withdrawn.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(withdrawn.getBody()).containsEntry("code", "PLEDGE_CANNOT_BE_CANCELLED");

        // Nothing was opened, held or charged by any of them.
        assertThat(pagesFor(paid.pledgeId())).isEqualTo(1);
        assertThat(stock(paid.standard())).isEqualTo(new Stock(1, 0));
        assertThat(amount(read(paid), "total")).isEqualTo("30.00");
        assertThat(read(paid).get("latestRaise")).isNull();
    }

    @Test
    @DisplayName("a raise that needs more places than are left is refused, and holds nothing")
    void aSoldOutRaiseHoldsNothing() {
        Scenario paid = aPaidPledge("raise-sold-out");

        ResponseEntity<Map<String, Object>> refused = raise(paid, UUID.randomUUID().toString(), Map.of(
                "addons", List.of(Map.of("rewardTierId", paid.mug().toString(), "quantity", 4)),
                "expectedAmount", azn("40.00")));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "REWARD_SOLD_OUT");
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));
        assertThat(read(paid).get("latestRaise")).isNull();
    }

    @Test
    @DisplayName("a draft and a legacy confirmed pledge are changed with the edit, exactly as before")
    void draftsAndConfirmedPledgesAreEdited() {
        Scenario draft = aCampaign("raise-draft");
        UUID draftId = draft(draft, draft.backer(), "25.00");
        paidPledges.add(draftId);

        ResponseEntity<Map<String, Object>> notRaised = raise(
                draft.backer(), draftId, UUID.randomUUID().toString(), Map.of(
                        "contribution", azn("30.00"), "expectedAmount", azn("5.00")));
        assertThat(notRaised.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(notRaised.getBody()).containsEntry("code", "PLEDGE_NOT_RAISABLE");
        assertThat(meta(notRaised.getBody()))
                .containsEntry("state", "DRAFT")
                .containsEntry("use", "PATCH /v1/pledges/{id}");

        // A draft is still being chosen, and may go either way.
        assertThat(patch(draft.backer(), draftId, Map.of("contribution", azn("40.00"))).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> loweredDraft = patch(draft.backer(), draftId, Map.of(
                "contribution", azn("27.00")));
        assertThat(loweredDraft.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(amount(loweredDraft.getBody(), "total")).isEqualTo("27.00");

        Account legacy = account("raise-confirmed-backer");
        UUID confirmedId = draft(draft, legacy, "25.00");
        paidPledges.add(confirmedId);
        post(legacy, "/v1/pledges/" + confirmedId + "/confirm", UUID.randomUUID().toString(), Map.of());
        assertThat(state(confirmedId)).isEqualTo("CONFIRMED");

        ResponseEntity<Map<String, Object>> legacyRaise = raise(
                legacy, confirmedId, UUID.randomUUID().toString(), Map.of(
                        "contribution", azn("30.00"), "expectedAmount", azn("5.00")));
        assertThat(legacyRaise.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(meta(legacyRaise.getBody())).containsEntry("state", "CONFIRMED");

        ResponseEntity<Map<String, Object>> raisedByEdit = patch(legacy, confirmedId, Map.of("contribution", azn("35.00")));
        assertThat(raisedByEdit.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(amount(raisedByEdit.getBody(), "total")).isEqualTo("35.00");
        assertThat(patch(legacy, confirmedId, Map.of("contribution", azn("30.00"))).getBody())
                .containsEntry("code", "PLEDGE_DECREASE_NOT_ALLOWED");
        assertThat(pagesFor(confirmedId)).as("an edit charges nothing").isZero();

        // And a paid pledge is not edited: it is raised.
        Scenario paid = aPaidPledge("raise-not-patched");
        ResponseEntity<Map<String, Object>> patchedPaid = patch(paid.backer(), paid.pledgeId(), Map.of(
                "contribution", azn("40.00")));
        assertThat(patchedPaid.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(patchedPaid.getBody()).containsEntry("code", "PLEDGE_NOT_EDITABLE");
        assertThat(read(paid).get("raisable")).isEqualTo(true);
    }

    @Test
    @DisplayName("once the campaign stops taking pledges a raise is refused, and the pledge manager works as before")
    void aClosedCampaignRefusesARaise() {
        Scenario paid = aPaidPledge("raise-closed");

        ResponseEntity<Map<String, Object>> stillRunning = post(
                paid.backer(),
                "/v1/pledges/" + paid.pledgeId() + "/upgrade",
                UUID.randomUUID().toString(),
                Map.of("rewardTierId", paid.deluxe().toString()));
        assertThat(stillRunning.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(stillRunning.getBody()).containsEntry("code", "CAMPAIGN_STILL_TAKING_PLEDGES");
        assertThat(meta(stillRunning.getBody())).containsEntry("use", "POST /v1/pledges/{id}/raise");

        close(paid.projectId());

        assertThat(read(paid).get("raisable")).isEqualTo(false);
        ResponseEntity<Map<String, Object>> refused = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_LIVE");
        assertThat(pagesFor(paid.pledgeId())).isEqualTo(1);

        // §4.8's PM-09 after the deadline: recorded beside the pledge, charged separately, and the
        // campaign's figures left alone.
        ResponseEntity<Map<String, Object>> upgraded = post(
                paid.backer(),
                "/v1/pledges/" + paid.pledgeId() + "/upgrade",
                UUID.randomUUID().toString(),
                Map.of("rewardTierId", paid.deluxe().toString()));
        assertThat(upgraded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(upgraded.getBody().get("rewardTierId")).isEqualTo(paid.deluxe().toString());
        assertThat(amount(upgraded.getBody(), "total")).isEqualTo("25.00");
        assertThat(pagesFor(paid.pledgeId())).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Holds that lapse
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a raise nobody paid for gives its places back, and a payment that arrives late is still applied")
    void aLapsedRaiseIsReleasedAndALatePaymentStillApplies() {
        Scenario paid = aPaidPledge("raise-late");
        String transaction = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");

        lapse(paid.pledgeId());
        cleaner.releaseLapsedRaises(Instant.now());

        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("EXPIRED");
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));

        deliver(transaction, "charge_succeeded");

        Map<String, Object> raised = read(paid);
        assertThat(raiseOf(raised).get("state")).isEqualTo("SUCCEEDED");
        assertThat(amount(raised, "total")).isEqualTo("80.00");
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(1, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(2, 0));
        assertThat(stock(paid.standard())).isEqualTo(new Stock(0, 0));
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("80.00"), 1));
    }

    @Test
    @DisplayName("a late payment for a raise that was superseded is not applied, and is refunded on its own")
    void aSupersededRaiseIsRefunded() {
        Scenario paid = aPaidPledge("raise-superseded");
        String first = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        lapse(paid.pledgeId());

        // A new raise replaces the lapsed one, and is paid for.
        ResponseEntity<Map<String, Object>> second = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("35.00"), "expectedAmount", azn("10.00")));
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
        deliver((String) second.getBody().get("providerTransactionId"), "charge_succeeded");
        assertThat(amount(read(paid), "total")).isEqualTo("35.00");

        // Then the first payment arrives after all.
        deliver(first, "charge_succeeded");

        Map<String, Object> after = read(paid);
        assertThat(amount(after, "total")).as("the first raise is not applied on top").isEqualTo("35.00");
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM pledge_raises WHERE charge_key LIKE 'pledge-raise-%' AND pledge_id = ?"
                                + " ORDER BY created_at LIMIT 1",
                        String.class,
                        paid.pledgeId()))
                .isEqualTo("UNAPPLIED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("35.00"), 1));

        refunds.refundDue(Instant.now());

        List<RefundRequest> sent = sentFor(paid.pledgeId());
        assertThat(sent).hasSize(1);
        assertThat(sent.getFirst().providerTransactionId()).isEqualTo(first);
        assertThat(sent.getFirst().amount().amount()).isEqualByComparingTo("55.00");
        Map<String, Object> refund = jdbc().queryForMap(
                "SELECT reason, requested_by, full_refund, state FROM refunds WHERE pledge_id = ?", paid.pledgeId());
        assertThat(refund.get("reason")).isEqualTo("RAISE_NOT_APPLIED");
        assertThat(refund.get("requested_by")).isNull();
        assertThat(refund.get("full_refund")).isEqualTo(false);
        assertThat(refund.get("state")).isEqualTo("SUCCEEDED");
        // The pledge the refund did not touch still stands.
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("35.00"), 1));
    }

    // ------------------------------------------------------------------
    // Refunds and payouts
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign that fails refunds every charge on a raised pledge, each against its own payment")
    void aFailedCampaignRefundsEveryCharge() {
        Scenario paid = aPaidPledge("raise-refund");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        deliver(raised, "charge_succeeded");
        end(paid.projectId(), "UNSUCCESSFUL");

        refunds.refundDue(Instant.now());

        List<RefundRequest> sent = sentFor(paid.pledgeId());
        assertThat(sent)
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactlyInAnyOrder(paid.providerTransactionId() + "=25.00", raised + "=55.00");
        assertThat(jdbc().queryForList(
                        "SELECT reason FROM refunds WHERE pledge_id = ? AND state = 'SUCCEEDED'",
                        String.class,
                        paid.pledgeId()))
                .containsOnly("CAMPAIGN_FAILED")
                .hasSize(2);
        // Both were meant to return everything (V53's intent); the pledge ended when the second settled.
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM refunds WHERE pledge_id = ? AND full_refund", Long.class, paid.pledgeId()))
                .isEqualTo(2L);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId())).as("nothing is refunded twice").hasSize(2);
    }

    @Test
    @DisplayName("a campaign that succeeds pays out the raised total")
    void aSuccessfulCampaignPaysOutTheNewTotal() {
        Scenario paid = aPaidPledge("raise-payout");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        deliver(raised, "charge_succeeded");
        end(paid.projectId(), "SUCCESSFUL");

        refunds.refundDue(Instant.now());

        CampaignFunds funds = payouts.fundsOf(paid.projectId(), "AZN");
        assertThat(funds.collected().amount()).isEqualByComparingTo("80.00");
        assertThat(funds.refunded().amount()).isEqualByComparingTo("0.00");
        assertThat(funds.net().amount()).isEqualByComparingTo("80.00");
        assertThat(sentFor(paid.pledgeId())).isEmpty();
    }

    // ------------------------------------------------------------------
    // A refund decides the pledge only when it settles (#174's review)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a refund whose answer was lost is not taken for the last one: the pledge is refunded once every charge is")
    void aLostRefundAnswerDoesNotEndThePledgeEarly() {
        Scenario paid = aPaidPledge("raise-lost-answer");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        deliver(raised, "charge_succeeded");
        end(paid.projectId(), "UNSUCCESSFUL");

        // The first charge's refund reaches the provider and its answer never comes back; the raise's
        // refund goes through. Before the fix the second was "the full one" and ended the pledge.
        provider.loseRefundAnswers(1);
        refunds.refundDue(Instant.now());

        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(paid.providerTransactionId() + "=25.00", raised + "=55.00");
        assertThat(refundStates(paid.pledgeId())).containsExactlyInAnyOrder("REQUESTED", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).as("25.00 has not certainly gone back").isEqualTo("COLLECTED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("80.00"), 1));

        // An hour on, the provider still calls the first payment paid: that refund failed.
        refunds.refundDue(Instant.now().plus(Duration.ofHours(2)));
        assertThat(refundStates(paid.pledgeId())).containsExactlyInAnyOrder("FAILED", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");

        // After the retry interval it is sent again, whatever the pledge's state, and that one ends it.
        refunds.refundDue(Instant.now().plus(Duration.ofHours(8)));
        assertThat(sentFor(paid.pledgeId())).hasSize(3);
        assertThat(sentFor(paid.pledgeId()).getLast().providerTransactionId()).isEqualTo(paid.providerTransactionId());
        assertThat(refundStates(paid.pledgeId())).containsExactlyInAnyOrder("FAILED", "SUCCEEDED", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));

        refunds.refundDue(Instant.now().plus(Duration.ofHours(20)));
        assertThat(sentFor(paid.pledgeId())).as("nothing is refunded twice").hasSize(3);
    }

    @Test
    @DisplayName("a campaign halted while a raise is on the page: the raise is not applied and both charges come back")
    void aRaisePaidWhileTheCampaignIsRefundedIsNotApplied() {
        Scenario paid = aPaidPledge("raise-halted");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        end(paid.projectId(), "SUSPENDED");

        // The halt's refund of the first charge is sent, and its answer is late.
        provider.loseRefundAnswers(1);
        refunds.refundDue(Instant.now());
        assertThat(refundStates(paid.pledgeId())).containsExactly("REQUESTED");

        // Then the difference is paid. It is not applied: the campaign no longer takes pledges and the
        // pledge's money is on its way back.
        deliver(raised, "charge_succeeded");

        Map<String, Object> after = read(paid);
        assertThat(raiseOf(after).get("state")).isEqualTo("UNAPPLIED");
        assertThat(amount(after, "total")).isEqualTo("25.00");
        assertThat(after.get("state")).isEqualTo("COLLECTED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));

        // The provider confirms the first refund, and the raise's charge is refunded on its own.
        provider.willLookUp(paid.providerTransactionId(), PaymentLookup.State.RETURNED);
        refunds.refundDue(Instant.now().plus(Duration.ofHours(2)));

        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactlyInAnyOrder(paid.providerTransactionId() + "=25.00", raised + "=55.00");
        assertThat(jdbc().queryForList(
                        "SELECT reason FROM refunds WHERE pledge_id = ? AND state = 'SUCCEEDED'", String.class, paid.pledgeId()))
                .containsExactlyInAnyOrder("CAMPAIGN_HALTED", "RAISE_NOT_APPLIED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).as("the pledge's 25.00 leaves, and the 55.00 was never counted")
                .isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a raise paid after the campaign closed is not applied: the decided total is not moved, and it is refunded")
    void aRaisePaidAfterTheCloseIsNotApplied() {
        Scenario paid = aPaidPledge("raise-after-close");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        close(paid.projectId());

        deliver(raised, "charge_succeeded");

        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("UNAPPLIED");
        assertThat(amount(read(paid), "total")).isEqualTo("25.00");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 0));
        assertThat(payouts.fundsOf(paid.projectId(), "AZN").net().amount()).isEqualByComparingTo("25.00");

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(raised + "=55.00");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");
    }

    @Test
    @DisplayName("a raise paid after part of the pledge was refunded is not applied, and no new raise is started")
    void aRaisePaidAfterAPartialRefundIsNotApplied() {
        Scenario paid = aPaidPledge("raise-after-partial");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");

        ResponseEntity<Map<String, Object>> partial = staffRefund(paid.pledgeId(), azn("5.00"));
        assertThat(partial.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(partial.getBody()).containsEntry("state", "SUCCEEDED");

        deliver(raised, "charge_succeeded");

        Map<String, Object> after = read(paid);
        assertThat(raiseOf(after).get("state")).isEqualTo("UNAPPLIED");
        assertThat(amount(after, "total")).isEqualTo("25.00");
        assertThat(after.get("raisable")).isEqualTo(false);
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(paid.providerTransactionId() + "=5.00", raised + "=55.00");
        assertThat(state(paid.pledgeId())).as("20.00 of it still stands").isEqualTo("COLLECTED");

        ResponseEntity<Map<String, Object>> again = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("30.00"), "expectedAmount", azn("5.00")));
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "PLEDGE_NOT_RAISABLE");
        assertThat(meta(again.getBody())).containsEntry("reason", "REFUNDED");
    }

    @Test
    @DisplayName("#175: a chargeback lost on a raise's charge: no new raise, and a failed campaign refunds only the first charge")
    void aChargebackOnARaisesCharge() {
        Scenario paid = aRaisedPledge("raise-chargeback");
        UUID raiseCharge = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'"
                        + " AND idempotency_key LIKE 'pledge-raise-%'",
                UUID.class,
                paid.pledgeId());
        UUID dispute = disputes.notified(
                        ProviderName.PAYRIFF,
                        "case-" + UUID.randomUUID(),
                        raiseCharge,
                        Money.of(new BigDecimal("55.00"), "AZN"),
                        Money.of(new BigDecimal("0.00"), "AZN"),
                        "fraudulent",
                        null)
                .id();

        assertThat(post(admin(), "/v1/admin/disputes/" + dispute + "/resolve", null, Map.of("outcome", "LOST"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(jdbc().queryForMap(
                        "SELECT reason, charge_transaction_id, full_refund FROM refunds WHERE pledge_id = ?",
                        paid.pledgeId()))
                .containsEntry("reason", "CHARGEBACK")
                .containsEntry("charge_transaction_id", raiseCharge)
                .containsEntry("full_refund", true);
        assertThat(state(paid.pledgeId())).as("the first charge still stands").isEqualTo("COLLECTED");

        // Money of the pledge has gone back, so it is not raised again (hasRefundOfPledgeMoney).
        ResponseEntity<Map<String, Object>> again = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("90.00"), "expectedAmount", azn("10.00")));
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "PLEDGE_NOT_RAISABLE");

        end(paid.projectId(), "UNSUCCESSFUL");
        refunds.refundDue(Instant.now());

        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(paid.providerTransactionId() + "=25.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a raise paid after the pledge was refunded is not applied, and its charge is refunded")
    void aRaisePaidAfterTheRefundIsRefunded() {
        Scenario paid = aPaidPledge("raise-after-refund");
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");

        assertThat(staffRefund(paid.pledgeId(), null).getBody()).containsEntry("state", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));

        deliver(raised, "charge_succeeded");

        Map<String, Object> after = read(paid);
        assertThat(raiseOf(after).get("state")).isEqualTo("UNAPPLIED");
        assertThat(amount(after, "total")).isEqualTo("25.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(paid.providerTransactionId() + "=25.00", raised + "=55.00");
        assertThat(jdbc().queryForObject(
                        "SELECT reason FROM refunds WHERE pledge_id = ? AND amount = 55.00", String.class, paid.pledgeId()))
                .isEqualTo("RAISE_NOT_APPLIED");
    }

    // ------------------------------------------------------------------
    // Staff refunds and disputes on a raised pledge
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a staff refund of the rest returns every charge of a raised pledge, each against its own payment")
    void aStaffFullRefundReturnsEveryCharge() {
        Scenario paid = aRaisedPledge("raise-staff-full");

        ResponseEntity<Map<String, Object>> issued = staffRefund(paid.pledgeId(), null);

        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(issued.getBody()).containsEntry("state", "SUCCEEDED").containsEntry("fullRefund", true);
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.amount().amount().toPlainString())
                .containsExactly("55.00", "25.00");
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM refunds WHERE pledge_id = ? AND state = 'SUCCEEDED' AND full_refund",
                        Long.class,
                        paid.pledgeId()))
                .isEqualTo(2L);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a staff refund of an amount is split across the charges, newest first, up to what the pledge has left")
    void aStaffRefundOfAnAmountIsSplitAcrossCharges() {
        Scenario paid = aRaisedPledge("raise-staff-split");

        ResponseEntity<Map<String, Object>> sixty = staffRefund(paid.pledgeId(), azn("60.00"));
        assertThat(sixty.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.amount().amount().toPlainString())
                .containsExactly("55.00", "5.00");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("80.00"), 1));

        ResponseEntity<Map<String, Object>> tooMuch = staffRefund(paid.pledgeId(), azn("25.00"));
        assertThat(tooMuch.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(tooMuch.getBody()).containsEntry("code", "REFUND_EXCEEDS_COLLECTION");
        assertThat((String) tooMuch.getBody().get("detail")).as("what the pledge has left, not one charge").contains("20.00");

        assertThat(staffRefund(paid.pledgeId(), null).getBody()).containsEntry("state", "SUCCEEDED");
        assertThat(sentFor(paid.pledgeId()).getLast().amount().amount()).isEqualByComparingTo("20.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a staff refund is replayed under its key, every part of it, and reaches no provider twice")
    void aStaffRefundIsReplayed() {
        Scenario paid = aRaisedPledge("raise-staff-replay");
        String key = "refund-" + UUID.randomUUID();

        Object first = staffRefund(paid.pledgeId(), null, key).getBody().get("id");
        Object again = staffRefund(paid.pledgeId(), null, key).getBody().get("id");

        assertThat(again).isEqualTo(first);
        assertThat(sentFor(paid.pledgeId())).hasSize(2);
        List<String> keys = jdbc().queryForList(
                "SELECT idempotency_key FROM refunds WHERE pledge_id = ?", String.class, paid.pledgeId());
        assertThat(keys).hasSize(2).contains(key);
        assertThat(keys).filteredOn(part -> !part.equals(key)).singleElement().asString().startsWith("refund-part-");
    }

    @Test
    @DisplayName("a partial staff refund, then a failed campaign: the rest of every charge comes back and the pledge ends refunded")
    void aPartialRefundThenAFailedCampaignRefundsTheRest() {
        Scenario paid = aRaisedPledge("raise-partial-then-fail");
        assertThat(staffRefund(paid.pledgeId(), azn("10.00")).getBody()).containsEntry("state", "SUCCEEDED");
        end(paid.projectId(), "UNSUCCESSFUL");

        refunds.refundDue(Instant.now());

        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.amount().amount().toPlainString())
                .containsExactlyInAnyOrder("10.00", "25.00", "45.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId())).hasSize(3);
    }

    @Test
    @DisplayName("an upheld dispute on a raised pledge refunds every charge")
    void anUpheldDisputeRefundsEveryCharge() {
        Scenario paid = aRaisedPledge("raise-dispute");

        Optional<UUID> refunded = refundService.refundForDispute(
                admin().id(), paid.pledgeId(), "Upheld in a test.", "backer-dispute-" + UUID.randomUUID());

        assertThat(refunded).isPresent();
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.amount().amount().toPlainString())
                .containsExactly("55.00", "25.00");
        assertThat(jdbc().queryForList(
                        "SELECT reason FROM refunds WHERE pledge_id = ? AND state = 'SUCCEEDED'", String.class, paid.pledgeId()))
                .containsOnly("DISPUTE_CONCEDED")
                .hasSize(2);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    // ------------------------------------------------------------------
    // Late payments, pages that do not open, and requests that are refused
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a late payment after the places sold out is not applied, moves no stock, and is refunded")
    void aLatePaymentAfterTheStockWentIsRefunded() {
        Scenario paid = aPaidPledge("raise-late-sold-out");
        String transaction = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        lapse(paid.pledgeId());
        cleaner.releaseLapsedRaises(Instant.now());
        // Somebody else takes both Deluxe places while the payment is on its way.
        jdbc().update("UPDATE reward_tiers SET claimed_quantity = 2 WHERE id = ?", paid.deluxe());

        deliver(transaction, "charge_succeeded");

        Map<String, Object> after = read(paid);
        assertThat(raiseOf(after).get("state")).isEqualTo("UNAPPLIED");
        assertThat(amount(after, "total")).isEqualTo("25.00");
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(2, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.standard())).isEqualTo(new Stock(1, 0));
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(transaction + "=55.00");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");
    }

    @Test
    @DisplayName("a page that cannot be opened holds nothing, and lets the backer try again at once")
    void aPageThatCannotOpenHoldsNothing() {
        Scenario paid = aPaidPledge("raise-no-page");
        provider.willRefuseHostedPayments();

        ResponseEntity<Map<String, Object>> refused = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(refused.getBody()).containsEntry("code", "PAYMENT_UNAVAILABLE");
        // The endpoint runs in the idempotency store's transaction, so the raise and its hold went back
        // with the refusal (PledgeRaiseCheckout); either way nothing is pending and nothing is held.
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM pledge_raises WHERE pledge_id = ? AND state = 'PENDING'",
                        Long.class,
                        paid.pledgeId()))
                .isZero();
        assertThat(read(paid).get("raisable")).isEqualTo(true);
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(0, 0));
        assertThat(stock(paid.mug())).isEqualTo(new Stock(0, 0));

        provider.willOpenHostedPayments();
        assertThat(raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString()).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("another backer's pledge is not found, a foreign return address and a reused key are refused, and nothing is held")
    void refusedRequestsHoldNothing() {
        Scenario paid = aPaidPledge("raise-refused");

        Account stranger = account("raise-stranger");
        ResponseEntity<Map<String, Object>> foreign = raise(stranger, paid.pledgeId(), UUID.randomUUID().toString(), Map.of(
                "contribution", azn("30.00"), "expectedAmount", azn("5.00")));
        assertThat(foreign.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        ResponseEntity<Map<String, Object>> elsewhere = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("30.00"),
                "expectedAmount", azn("5.00"),
                "successUrl", "https://evil.example.com/pledges"));
        assertThat(elsewhere.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(elsewhere.getBody()).containsEntry("code", "INVALID_RETURN_URL");

        assertThat(read(paid).get("latestRaise")).isNull();
        assertThat(pagesFor(paid.pledgeId())).isEqualTo(1);

        String key = UUID.randomUUID().toString();
        assertThat(raise(paid, key, Map.of("contribution", azn("30.00"), "expectedAmount", azn("5.00")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> reused = raise(paid, key, Map.of(
                "contribution", azn("40.00"), "expectedAmount", azn("15.00")));
        assertThat(reused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(reused.getBody()).containsEntry("code", "IDEMPOTENCY_KEY_REUSED");
        assertThat(pagesFor(paid.pledgeId())).isEqualTo(2);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM pledge_raises WHERE pledge_id = ?", Long.class, paid.pledgeId()))
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("a pending raise can be resumed on the provider's page until its hold runs out, and not after it ends")
    void aPendingRaiseCanBeResumed() {
        Scenario paid = aPaidPledge("raise-resume");
        ResponseEntity<Map<String, Object>> opened = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());

        Map<String, Object> pending = raiseOf(read(paid));
        assertThat(pending.get("state")).isEqualTo("PENDING");
        assertThat(pending.get("resumeUrl")).isEqualTo(opened.getBody().get("redirectUrl"));

        lapse(paid.pledgeId());
        Map<String, Object> lapsed = raiseOf(read(paid));
        assertThat(lapsed.get("state")).as("the cleaner has not reached it").isEqualTo("PENDING");
        assertThat(lapsed).containsEntry("resumeUrl", null);

        // A new raise, paid: no page to go back to.
        ResponseEntity<Map<String, Object>> next = raise(paid, UUID.randomUUID().toString(), Map.of(
                "contribution", azn("35.00"), "expectedAmount", azn("10.00")));
        assertThat(raiseOf(read(paid)).get("resumeUrl")).isEqualTo(next.getBody().get("redirectUrl"));
        deliver((String) next.getBody().get("providerTransactionId"), "charge_succeeded");
        assertThat(raiseOf(read(paid))).containsEntry("state", "SUCCEEDED").containsEntry("resumeUrl", null);
    }

    // ------------------------------------------------------------------
    // A paid raise nothing settled (rolling deployment)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a raise's charge recorded by something that did not settle the raise is applied by the sweep")
    void anOrphanedPaidRaiseIsApplied() {
        Scenario paid = aPaidPledge("raise-orphan-applied");
        ResponseEntity<Map<String, Object>> opened = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());
        settleWithoutTheRaise(paid, opened);
        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("PENDING");

        assertThat(cleaner.settlePaidRaises(Instant.now())).isEqualTo(1);

        Map<String, Object> raised = read(paid);
        assertThat(raiseOf(raised).get("state")).isEqualTo("SUCCEEDED");
        assertThat(amount(raised, "total")).isEqualTo("80.00");
        assertThat(stock(paid.deluxe())).isEqualTo(new Stock(1, 0));
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("80.00"), 1));
        assertThat(cleaner.settlePaidRaises(Instant.now())).as("settled once").isZero();
    }

    @Test
    @DisplayName("an orphaned paid raise that can no longer be applied is marked unapplied by the sweep and refunded")
    void anOrphanedPaidRaiseIsRefunded() {
        Scenario paid = aPaidPledge("raise-orphan-refunded");
        ResponseEntity<Map<String, Object>> opened = raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString());
        settleWithoutTheRaise(paid, opened);
        lapse(paid.pledgeId());
        cleaner.releaseLapsedRaises(Instant.now());
        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("EXPIRED");
        jdbc().update("UPDATE reward_tiers SET claimed_quantity = 2 WHERE id = ?", paid.deluxe());

        assertThat(cleaner.settlePaidRaises(Instant.now())).isEqualTo(1);
        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("UNAPPLIED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.amount().amount().toPlainString())
                .containsExactly("55.00");
    }

    @Test
    @DisplayName("a payout never includes a raise's charge that is owed back, before or after its refund")
    void aPayoutLeavesOutAnUnappliedRaise() {
        Scenario paid = aPaidPledge("raise-payout-unapplied");
        String transaction = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        lapse(paid.pledgeId());
        cleaner.releaseLapsedRaises(Instant.now());
        jdbc().update("UPDATE reward_tiers SET claimed_quantity = 2 WHERE id = ?", paid.deluxe());
        deliver(transaction, "charge_succeeded");
        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("UNAPPLIED");

        CampaignFunds before = payouts.fundsOf(paid.projectId(), "AZN");
        assertThat(before.collected().amount()).isEqualByComparingTo("25.00");
        assertThat(before.net().amount()).isEqualByComparingTo("25.00");

        refunds.refundDue(Instant.now());
        CampaignFunds after = payouts.fundsOf(paid.projectId(), "AZN");
        assertThat(after.collected().amount()).isEqualByComparingTo("25.00");
        assertThat(after.refunded().amount()).isEqualByComparingTo("0.00");
        assertThat(after.net().amount()).isEqualByComparingTo("25.00");
    }

    // ------------------------------------------------------------------
    // Parts that lose their answer, and what the payment's status can prove (#174's second review)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a staff refund part whose answer is lost does not stop the next part, and is reconciled")
    void aStaffPartWithALostAnswerIsReconciled() {
        Scenario paid = aPaidPledge("raise-staff-lost");
        String raised = raiseAndPay(paid);
        provider.loseRefundAnswerFor(raised);

        ResponseEntity<Map<String, Object>> issued = staffRefund(paid.pledgeId(), null);

        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(issued.getBody()).as("the part without an outcome is the answer").containsEntry("state", "REQUESTED");
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(raised + "=55.00", paid.providerTransactionId() + "=25.00");
        assertThat(refundStates(paid.pledgeId())).containsExactlyInAnyOrder("REQUESTED", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");

        // An hour on, the provider still calls the raise's payment paid, and that refund was all of it:
        // it did not happen. It fails, and the rest can be refunded.
        refunds.refundDue(Instant.now().plus(Duration.ofHours(2)));
        assertThat(refundStates(paid.pledgeId())).containsExactlyInAnyOrder("FAILED", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");

        assertThat(staffRefund(paid.pledgeId(), null).getBody()).containsEntry("state", "SUCCEEDED");
        assertThat(sentFor(paid.pledgeId()).getLast().amount().amount()).isEqualByComparingTo("55.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("an upheld dispute whose part lost its answer waits for it, then completes without refunding twice")
    void aDisputeWithALostPartCompletesOnRetry() {
        Scenario paid = aPaidPledge("raise-dispute-lost");
        String raised = raiseAndPay(paid);
        provider.loseRefundAnswerFor(raised);
        UUID staffId = admin().id();

        assertThat(refundService.refundForDispute(staffId, paid.pledgeId(), "Upheld.", "backer-dispute-" + UUID.randomUUID()))
                .isEmpty();
        assertThat(refundService.refundForDispute(staffId, paid.pledgeId(), "Upheld.", "backer-dispute-" + UUID.randomUUID()))
                .as("still without an outcome: not refunded again beside it")
                .isEmpty();
        assertThat(sentFor(paid.pledgeId())).hasSize(2);

        provider.willLookUp(raised, PaymentLookup.State.RETURNED);
        refunds.refundDue(Instant.now().plus(Duration.ofHours(2)));
        assertThat(refundStates(paid.pledgeId())).containsOnly("SUCCEEDED").hasSize(2);
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");

        assertThat(refundService.refundForDispute(staffId, paid.pledgeId(), "Upheld.", "backer-dispute-" + UUID.randomUUID()))
                .isPresent();
        assertThat(sentFor(paid.pledgeId())).as("nothing sent twice").hasSize(2);
    }

    @Test
    @DisplayName("a lost remainder refund is not settled from a 'returned' status another refund of the charge explains")
    void aReturnedStatusDoesNotSettleARemainderRefund() {
        Scenario paid = aPaidPledge("raise-remainder-lost");
        String raised = raiseAndPay(paid);
        // 10.00 of the raise's 55.00 goes back first.
        assertThat(staffRefund(paid.pledgeId(), azn("10.00")).getBody()).containsEntry("state", "SUCCEEDED");
        end(paid.projectId(), "UNSUCCESSFUL");
        provider.loseRefundAnswerFor(raised);

        refunds.refundDue(Instant.now());
        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactlyInAnyOrder(
                        raised + "=10.00", paid.providerTransactionId() + "=25.00", raised + "=45.00");

        provider.willLookUp(raised, PaymentLookup.State.RETURNED);
        refunds.refundDue(Instant.now().plus(Duration.ofHours(2)));

        Map<String, Object> remainder = jdbc().queryForMap(
                "SELECT state, review_reason FROM refunds WHERE pledge_id = ? AND amount = 45.00", paid.pledgeId());
        assertThat(remainder.get("state")).as("not proven either way").isEqualTo("REQUESTED");
        assertThat((String) remainder.get("review_reason")).contains("another refund");
        assertThat(state(paid.pledgeId())).isEqualTo("COLLECTED");

        // Left for a person: not asked about again, and nothing is sent in its place.
        provider.willLookUp(raised, PaymentLookup.State.SUCCEEDED);
        refunds.refundDue(Instant.now().plus(Duration.ofHours(10)));
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM refunds WHERE pledge_id = ? AND amount = 45.00", String.class, paid.pledgeId()))
                .isEqualTo("REQUESTED");
        assertThat(sentFor(paid.pledgeId())).hasSize(3);
    }

    @Test
    @DisplayName("a staff refund of an amount draws on a charge owed back last, so the backer gets both")
    void aStaffRefundLeavesTheOwedBackChargeLast() {
        Scenario paid = aPaidPledge("raise-staff-owed");
        String transaction = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        lapse(paid.pledgeId());
        cleaner.releaseLapsedRaises(Instant.now());
        jdbc().update("UPDATE reward_tiers SET claimed_quantity = 2 WHERE id = ?", paid.deluxe());
        deliver(transaction, "charge_succeeded");
        assertThat(raiseOf(read(paid)).get("state")).isEqualTo("UNAPPLIED");

        assertThat(staffRefund(paid.pledgeId(), azn("20.00")).getBody()).containsEntry("state", "SUCCEEDED");
        refunds.refundDue(Instant.now());

        assertThat(sentFor(paid.pledgeId()))
                .extracting(request -> request.providerTransactionId() + "=" + request.amount().amount().toPlainString())
                .containsExactly(paid.providerTransactionId() + "=20.00", transaction + "=55.00");
        assertThat(state(paid.pledgeId())).as("5.00 of the pledge still stands").isEqualTo("COLLECTED");
    }

    @Test
    @DisplayName("a refund part's key cannot collide with another request's, and a key spent on another pledge is refused")
    void refundPartKeysDoNotCollide() {
        Scenario first = aRaisedPledge("raise-key-first");
        Scenario second = aPaidPledge("raise-key-second");
        String key = "refund-" + "k".repeat(193);
        assertThat(key).hasSize(200);

        // What a suffixed part key would have been, spent first by another request.
        assertThat(staffRefund(second.pledgeId(), azn("1.00"), key.substring(0, 198) + "#2").getBody())
                .containsEntry("state", "SUCCEEDED");
        assertThat(staffRefund(first.pledgeId(), null, key).getBody()).containsEntry("state", "SUCCEEDED");
        assertThat(sentFor(first.pledgeId())).hasSize(2);
        assertThat(state(first.pledgeId())).isEqualTo("REFUNDED");

        ResponseEntity<Map<String, Object>> elsewhere = staffRefund(second.pledgeId(), null, key);
        assertThat(elsewhere.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(elsewhere.getBody()).containsEntry("code", "IDEMPOTENCY_KEY_REUSED");
        assertThat(sentFor(second.pledgeId())).as("only the 1.00").hasSize(1);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Scenario(
            UUID projectId,
            UUID standard,
            UUID deluxe,
            UUID mug,
            Account backer,
            UUID pledgeId,
            String providerTransactionId) {
    }

    private record Stock(int claimed, int reserved) {
    }

    private record Totals(BigDecimal pledged, int backers) {
    }

    private Scenario aCampaign(String prefix) {
        Account creator = account(prefix + "-creator");
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator,
                null,
                Map.of("title", "A campaign whose backers raise " + SEQUENCE.incrementAndGet()));
        UUID projectId = UUID.fromString((String) created.getBody().get("id"));
        UUID standard = tier(creator, projectId, "Standard", "25.00", false, 10);
        UUID deluxe = tier(creator, projectId, "Deluxe", "60.00", false, 2);
        UUID mug = tier(creator, projectId, "Mug", "10.00", true, 3);
        Campaigns.launch(dataSource, projectId);
        return new Scenario(projectId, standard, deluxe, mug, account(prefix + "-backer"), null, null);
    }

    private Scenario aPaidPledge(String prefix) {
        return aPaidPledge(prefix, "25.00");
    }

    /** A pledge for Standard, paid for through the payment page and a signed success webhook. */
    private Scenario aPaidPledge(String prefix, String contribution) {
        Scenario campaign = aCampaign(prefix);
        UUID pledgeId = draft(campaign, campaign.backer(), contribution);
        paidPledges.add(pledgeId);

        String transaction = (String) post(
                        campaign.backer(),
                        "/v1/pledges/" + pledgeId + "/payment",
                        UUID.randomUUID().toString(),
                        Map.of("language", "en"))
                .getBody()
                .get("providerTransactionId");
        assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(state(pledgeId)).isEqualTo("COLLECTED");
        return new Scenario(
                campaign.projectId(),
                campaign.standard(),
                campaign.deluxe(),
                campaign.mug(),
                campaign.backer(),
                pledgeId,
                transaction);
    }

    /** Raises a paid pledge to Deluxe with two mugs and pays the 55.00; the raise's payment. */
    private String raiseAndPay(Scenario paid) {
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        assertThat(deliver(raised, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(amount(read(paid), "total")).isEqualTo("80.00");
        return raised;
    }

    /** A pledge paid for at 25.00 and raised to Deluxe with two mugs, 80.00, the difference paid. */
    private Scenario aRaisedPledge(String prefix) {
        Scenario paid = aPaidPledge(prefix);
        String raised = (String) raiseToDeluxeWithTwoMugs(paid, UUID.randomUUID().toString())
                .getBody()
                .get("providerTransactionId");
        assertThat(deliver(raised, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(amount(read(paid), "total")).isEqualTo("80.00");
        return paid;
    }

    /**
     * What a node of the release before raises did with a raise's success webhook: the charge settled
     * and posted, and the raise left as it was (V83's rolling-deployment note).
     */
    private void settleWithoutTheRaise(Scenario paid, ResponseEntity<Map<String, Object>> opened) {
        transactionRows.save(PaymentTransaction.charge(
                paid.pledgeId(),
                paid.projectId(),
                Money.of(new BigDecimal("55.00"), "AZN"),
                ProviderName.PAYRIFF,
                new ChargeResult(
                        ProviderOutcome.APPROVED, (String) opened.getBody().get("providerTransactionId"), null, null, "{}"),
                1,
                "pledge-raise-" + opened.getBody().get("raiseId")));
    }

    private ResponseEntity<Map<String, Object>> staffRefund(UUID pledgeId, Map<String, Object> amount) {
        return staffRefund(pledgeId, amount, "refund-" + UUID.randomUUID());
    }

    private ResponseEntity<Map<String, Object>> staffRefund(UUID pledgeId, Map<String, Object> amount, String key) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pledgeId", pledgeId.toString());
        body.put("amount", amount);
        body.put("reason", "BACKER_REQUEST");
        body.put("detail", "The backer asked, in a test.");
        return post(admin(), "/v1/admin/refunds", key, body);
    }

    /** A member of staff who may issue refunds: a user row holding a V48 grant, as #43's suite makes one. */
    private Account admin() {
        UUID id = Campaigns.creator(dataSource, "raise-refund-administrator");
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, 'SUPER_ADMIN', ?, '#174 fixture')
                ON CONFLICT DO NOTHING
                """,
                id,
                id);
        String token = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(token, id);
    }

    private List<String> refundStates(UUID pledgeId) {
        return jdbc().queryForList("SELECT state FROM refunds WHERE pledge_id = ?", String.class, pledgeId);
    }

    private UUID draft(Scenario campaign, Account backer, String contribution) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", campaign.projectId().toString());
        body.put("rewardTierId", campaign.standard().toString());
        body.put("contribution", azn(contribution));
        ResponseEntity<Map<String, Object>> draft = post(backer, "/v1/pledges/draft", UUID.randomUUID().toString(), body);
        assertThat(draft.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) draft.getBody().get("id"));
    }

    private UUID tier(Account creator, UUID project, String title, String price, boolean isAddon, Integer limit) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("description", "Something to receive.");
        body.put("price", azn(price));
        body.put("shippingType", "NONE");
        body.put("isAddon", isAddon);
        body.put("limitQuantity", limit);
        ResponseEntity<Map<String, Object>> created =
                exchange("/v1/projects/" + project + "/rewards", HttpMethod.POST, creator, null, body);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** Deluxe with a contribution of its price, and two mugs: 80.00, which is 55.00 more than 25.00. */
    private ResponseEntity<Map<String, Object>> raiseToDeluxeWithTwoMugs(Scenario paid, String key) {
        return raise(paid, key, Map.of(
                "rewardTierId", paid.deluxe().toString(),
                "contribution", azn("60.00"),
                "addons", List.of(Map.of("rewardTierId", paid.mug().toString(), "quantity", 2)),
                "expectedAmount", azn("55.00"),
                "language", "en",
                "successUrl", "https://ideanest.az/en/pledges/" + paid.pledgeId() + "?payment=returned"));
    }

    private ResponseEntity<Map<String, Object>> raise(Scenario paid, String key, Map<String, Object> body) {
        return raise(paid.backer(), paid.pledgeId(), key, body);
    }

    private ResponseEntity<Map<String, Object>> raise(
            Account caller, UUID pledgeId, String key, Map<String, Object> body) {
        return post(caller, "/v1/pledges/" + pledgeId + "/raise", key, body);
    }

    private ResponseEntity<Map<String, Object>> patch(Account caller, UUID pledgeId, Map<String, Object> body) {
        return exchange("/v1/pledges/" + pledgeId, HttpMethod.PATCH, caller, UUID.randomUUID().toString(), body);
    }

    private Map<String, Object> read(Scenario paid) {
        ResponseEntity<Map<String, Object>> read =
                exchange("/v1/pledges/" + paid.pledgeId(), HttpMethod.GET, paid.backer(), null, null);
        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.OK);
        return read.getBody();
    }

    private ResponseEntity<Map<String, Object>> post(Account caller, String path, String key, Object body) {
        return exchange(path, HttpMethod.POST, caller, key, body);
    }

    private ResponseEntity<Map<String, Object>> exchange(
            String path, HttpMethod method, Account caller, String key, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, headers(caller, key)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders headers(Account caller, String key) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(caller.accessToken());
        if (key != null) {
            headers.set("Idempotency-Key", key);
        }
        return headers;
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
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    /** Puts the pledge's pending raise past its hold, as the payment window running out would. */
    private void lapse(UUID pledgeId) {
        jdbc().update(
                "UPDATE pledge_raises SET hold_expires_at = now() - interval '1 minute'"
                        + " WHERE pledge_id = ? AND state = 'PENDING'",
                pledgeId);
    }

    /** Closes the campaign the way its deadline would. */
    private void close(UUID projectId) {
        jdbc().update(
                """
                UPDATE projects
                   SET state = 'SUCCESSFUL',
                       launched_at = now() - interval '31 days',
                       deadline = now() - interval '1 day'
                 WHERE id = ?
                """,
                projectId);
    }

    /** Moves a campaign to where the finaliser or moderation would have put it. */
    private void end(UUID projectId, String state) {
        jdbc().update(
                """
                UPDATE projects
                   SET state = ?,
                       launched_at = now() - interval '31 days',
                       deadline = now() - interval '1 day',
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

    private int pagesFor(UUID pledgeId) {
        return (int) provider.hostedPayments().stream()
                .filter(request -> request.pledgeId().equals(pledgeId))
                .count();
    }

    private List<BigDecimal> settledCharges(UUID pledgeId) {
        return jdbc().queryForList(
                "SELECT amount FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'"
                        + " ORDER BY created_at",
                BigDecimal.class,
                pledgeId);
    }

    private Stock stock(UUID rewardTierId) {
        return jdbc().queryForObject(
                "SELECT claimed_quantity, reserved_quantity FROM reward_tiers WHERE id = ?",
                (row, index) -> new Stock(row.getInt("claimed_quantity"), row.getInt("reserved_quantity")),
                rewardTierId);
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

    private static Map<String, Object> azn(String amount) {
        return Map.of("amount", amount, "currency", "AZN");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> raiseOf(Map<String, Object> pledge) {
        return (Map<String, Object>) pledge.get("latestRaise");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> addonsOf(Map<String, Object> pledge) {
        return (List<Map<String, Object>>) pledge.get("addons");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> body) {
        return (Map<String, Object>) body.get("meta");
    }

    @SuppressWarnings("unchecked")
    private static String amount(Map<String, Object> pledge, String part) {
        return money((Map<String, Object>) pledge.get("amounts"), part);
    }

    @SuppressWarnings("unchecked")
    private static String money(Map<String, Object> holder, String key) {
        Map<String, Object> money = (Map<String, Object>) holder.get(key);
        assertThat(money.get("amount")).isInstanceOf(String.class);
        return new BigDecimal((String) money.get("amount")).setScale(2).toPlainString();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
