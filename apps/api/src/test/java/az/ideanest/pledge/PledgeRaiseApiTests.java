package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.application.CampaignFunds;
import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.pledge.application.ReservationCleanerJob;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

    @BeforeEach
    void refundsApproved() {
        provider.willRefund();
    }

    @AfterEach
    void clearPayments() {
        jdbc().update("DELETE FROM provider_webhook_events");
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
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
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM refunds WHERE pledge_id = ? AND full_refund", Long.class, paid.pledgeId()))
                .as("the one that left nothing is the full refund")
                .isEqualTo(1L);
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
