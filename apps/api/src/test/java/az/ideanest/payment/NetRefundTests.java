package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.application.LedgerReconciliation;
import az.ideanest.payment.application.ProviderFees;
import az.ideanest.payment.application.ReconciliationFinding;
import az.ideanest.payment.application.RefundBankTransfers;
import az.ideanest.payment.application.RefundTerms;
import az.ideanest.payment.application.RefundWindows;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.shared.money.Money;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.BankDetailsKeys;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * A failed campaign's backers are refunded net of the payment provider's fee — #436.
 *
 * <p>The suite's provider is given Payriff's 3% for the length of each test, so a pledge of 100.00 paid
 * through the real flow — draft, payment page, signed webhook — posts 3.00 to {@code psp_fee} with its
 * charge, as #427 does in production. Whether the charge is taken under the net rule is the switch
 * {@link RefundTerms} reads, flipped by hand around the checkout. The campaign is then moved to its end
 * state and the {@code campaign-refunds} job is run, as in {@code CampaignRefundTests}.
 *
 * <p>The tests that carry the decision:
 *
 * <ul>
 *   <li>{@link #aFlaggedChargeIsRefundedNetOfTheFee()} — 100.00 paid, 97.00 back, the books at zero.
 *   <li>{@link #theChargeDecidesNotTodaysSetting()} — the cut-over follows the words the backer read.
 *   <li>{@link #theBankTransferOwesTheSameNetAmount()} — past the provider's window, the same 97.00.
 * </ul>
 */
class NetRefundTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String NOTE = "#436 fixture";
    private static final String IBAN = "AZ21NABZ00000000137010001944";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private CampaignRefundJob job;

    @Autowired
    private RefundTerms terms;

    @Autowired
    private ProviderFees fees;

    @Autowired
    private RefundWindows windows;

    @Autowired
    private RefundBankTransfers bankRefunds;

    @Autowired
    private Ledger ledger;

    @Autowired
    private LedgerReconciliation reconciliation;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private AdjustableClock clock;

    private final List<UUID> paidPledges = new ArrayList<>();
    private final List<UUID> projects = new ArrayList<>();
    private Object configuredFees;
    private Object configuredTerms;
    private Object configuredWindows;
    private BankDetailsKeys.Installed keys;

    @BeforeEach
    void payriffsRate() {
        provider.reset();
        provider.willRefund();
        configuredFees = ReflectionTestUtils.getField(fees, "properties");
        configuredTerms = ReflectionTestUtils.getField(terms, "withholdProviderFee");
        configuredWindows = ReflectionTestUtils.getField(windows, "windows");
        keys = BankDetailsKeys.installCipher(bankRefunds);
        feeOf("0.03");
    }

    @AfterEach
    void restore() {
        ReflectionTestUtils.setField(fees, "properties", configuredFees);
        ReflectionTestUtils.setField(terms, "withholdProviderFee", configuredTerms);
        ReflectionTestUtils.setField(windows, "windows", configuredWindows);
        keys.close();
        clock.reset();
        provider.reset();
        jdbc().update("DELETE FROM provider_webhook_events");
        PaymentRows.clearProjects(dataSource, projects);
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        jdbc().update("DELETE FROM support_tickets WHERE subject = ?", NOTE);
        jdbc().update("DELETE FROM staff_role_grants WHERE note = ?", NOTE);
    }

    // ------------------------------------------------------------------
    // The amount
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a charge taken under the rule is refunded less the fee posted with it, and the pledge is refunded in full")
    void aFlaggedChargeIsRefundedNetOfTheFee() {
        Paid paid = aPaidPledge("net-failed", "100.00", true);
        assertThat(flagOf(paid.chargeId())).isTrue();
        assertThat(ledger.debitedTo(paid.chargeId(), LedgerAccount.PSP_FEE, "AZN")).isEqualTo(azn("3.00"));
        Map<String, BigDecimal> gapsBefore = reconciliationGaps();
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        Map<String, Object> refund = refundOf(paid.pledgeId());
        assertThat(refund.get("state")).isEqualTo("SUCCEEDED");
        assertThat(refund.get("reason")).isEqualTo("CAMPAIGN_FAILED");
        assertThat((BigDecimal) refund.get("amount")).isEqualByComparingTo("97.00");
        assertThat((BigDecimal) refund.get("withheld_fee")).isEqualByComparingTo("3.00");
        assertThat((String) refund.get("detail")).contains("less the payment provider's fee of 3.00 AZN");
        assertThat(sentFor(paid.pledgeId())).singleElement().satisfies(sent -> {
            assertThat(sent.amount()).isEqualTo(azn("97.00"));
            assertThat(sent.providerTransactionId()).isEqualTo(paid.providerTransactionId());
        });
        assertThat(state(paid.pledgeId())).as("the fee is settled, not owed").isEqualTo("REFUNDED");
        assertThat(totals(paid.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));

        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, paid.projectId(), "AZN"))
                .as("escrow took 100.00, gave 3.00 to the provider and 97.00 back: nothing left, nothing negative")
                .isEqualTo(azn("0.00"));
        assertThat(ledger.balanceOf(LedgerAccount.PSP_FEE, paid.projectId(), "AZN")).isEqualTo(azn("3.00"));
        assertThat(ledger.balanceOf(LedgerAccount.REFUNDS, paid.projectId(), "AZN")).isEqualTo(azn("97.00"));
        assertThat(reconciliationGaps())
                .as("escrow + psp_fee = charges - refunds holds on the net refund")
                .isEqualTo(gapsBefore);
    }

    @Test
    @DisplayName("a second pass does not send the withheld fee")
    void theFeeIsNeverSentLater() {
        Paid paid = aPaidPledge("net-twice", "100.00", true);
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());
        job.refundDue(clock.instant());
        job.refundDue(clock.instant().plus(Duration.ofDays(1)));

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM refunds WHERE pledge_id = ?", Long.class, paid.pledgeId()))
                .isEqualTo(1L);
        assertThat(staffRefund(paid.pledgeId(), Map.of("amount", "3.00", "currency", "AZN")).getStatusCode())
                .as("nothing is left on the pledge for a staff refund to send either")
                .isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    @DisplayName("a suspended or cancelled campaign withholds the fee as well")
    void aHaltWithholdsTheFee() {
        Paid suspended = aPaidPledge("net-suspended", "100.00", true);
        end(suspended.projectId(), "SUSPENDED");
        Paid cancelled = aPaidPledge("net-cancelled", "50.00", true);
        end(cancelled.projectId(), "CANCELED");

        job.refundDue(clock.instant());

        assertThat(refundOf(suspended.pledgeId()))
                .containsEntry("reason", "CAMPAIGN_HALTED")
                .satisfies(row -> assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo("97.00"));
        assertThat(refundOf(cancelled.pledgeId()))
                .satisfies(row -> assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo("48.50"))
                .satisfies(row -> assertThat((BigDecimal) row.get("withheld_fee")).isEqualByComparingTo("1.50"));
        assertThat(state(cancelled.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("a charge taken before the switch is refunded in full, whatever the setting says when it is refunded")
    void theChargeDecidesNotTodaysSetting() {
        Paid before = aPaidPledge("net-before", "100.00", false);
        withholding(true);
        end(before.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        assertThat(flagOf(before.chargeId())).isFalse();
        assertThat(refundOf(before.pledgeId()))
                .satisfies(row -> assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo("100.00"))
                .satisfies(row -> assertThat((BigDecimal) row.get("withheld_fee")).isEqualByComparingTo("0.00"));
        assertThat(sentFor(before.pledgeId())).singleElement().satisfies(sent -> assertThat(sent.amount())
                .isEqualTo(azn("100.00")));
        assertThat(state(before.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("a payment settles under the terms of the page it was opened on, not the setting when the provider answers")
    void thePageDecidesNotTheWebhook() {
        Opened opened = anOpenedPayment("net-page", "100.00", true);
        withholding(false);
        Paid paid = settle(opened);

        assertThat(flagOf(paid.chargeId())).isTrue();
        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(clock.instant());
        assertThat((BigDecimal) refundOf(paid.pledgeId()).get("amount")).isEqualByComparingTo("97.00");
    }

    @Test
    @DisplayName("a charge under the rule with no fee posted is refunded in full")
    void noFeePostedMeansAFullRefund() {
        ReflectionTestUtils.setField(fees, "properties", new ProviderFeeProperties(Map.of()));
        Paid paid = aPaidPledge("net-no-fee", "100.00", true);
        assertThat(flagOf(paid.chargeId())).isTrue();
        assertThat(ledger.debitedTo(paid.chargeId(), LedgerAccount.PSP_FEE, "AZN").isZero()).isTrue();
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        assertThat(refundOf(paid.pledgeId()))
                .satisfies(row -> assertThat((BigDecimal) row.get("amount")).isEqualByComparingTo("100.00"))
                .satisfies(row -> assertThat((BigDecimal) row.get("withheld_fee")).isEqualByComparingTo("0.00"));
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("the fee is the one posted with the charge, not today's rate")
    void thePostedFeeNotTheRate() {
        Paid paid = aPaidPledge("net-rate", "100.00", true);
        feeOf("0.05");
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        assertThat((BigDecimal) refundOf(paid.pledgeId()).get("withheld_fee")).isEqualByComparingTo("3.00");
    }

    @Test
    @DisplayName("a staff refund keeps its own amount, and the campaign refund afterwards sends the rest less the fee")
    void aStaffRefundFirst() {
        Paid paid = aPaidPledge("net-staff", "100.00", true);
        ResponseEntity<Map<String, Object>> staff = staffRefund(paid.pledgeId(), Map.of("amount", "40.00", "currency", "AZN"));
        assertThat(staff.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sentFor(paid.pledgeId())).singleElement().satisfies(sent -> assertThat(sent.amount())
                .as("staff refunds are out of #436's scope")
                .isEqualTo(azn("40.00")));
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        List<Map<String, Object>> rows = jdbc().queryForList(
                "SELECT reason, amount, withheld_fee FROM refunds WHERE pledge_id = ? ORDER BY requested_at, id",
                paid.pledgeId());
        assertThat(rows).hasSize(2);
        assertThat((BigDecimal) rows.get(0).get("withheld_fee")).isEqualByComparingTo("0.00");
        assertThat(rows.get(1).get("reason")).isEqualTo("CAMPAIGN_FAILED");
        assertThat((BigDecimal) rows.get(1).get("amount")).isEqualByComparingTo("57.00");
        assertThat((BigDecimal) rows.get(1).get("withheld_fee")).isEqualByComparingTo("3.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("a staff refund under a campaign's reason keeps the fee back, as the platform's own would")
    void aStaffRefundUnderACampaignReasonIsNet() {
        Paid paid = aPaidPledge("net-staff-failed", "100.00", true);

        ResponseEntity<Map<String, Object>> issued = staffRefund(paid.pledgeId(), null, "CAMPAIGN_FAILED");

        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(asMap(issued.getBody().get("amount"))).containsEntry("amount", "97.00");
        assertThat(asMap(issued.getBody().get("withheldFee")))
                .as("the response says what was kept back")
                .containsEntry("amount", "3.00")
                .containsEntry("currency", "AZN");
        assertThat(sentFor(paid.pledgeId())).singleElement().satisfies(sent -> assertThat(sent.amount())
                .isEqualTo(azn("97.00")));
        Map<String, Object> refund = refundOf(paid.pledgeId());
        assertThat((BigDecimal) refund.get("withheld_fee")).isEqualByComparingTo("3.00");
        assertThat(state(paid.pledgeId())).as("the fee is settled, not owed").isEqualTo("REFUNDED");

        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(clock.instant());
        assertThat(sentFor(paid.pledgeId())).as("the sweep finds nothing more owed").hasSize(1);
    }

    @Test
    @DisplayName("a partial staff refund under a campaign's reason keeps the fee back once, and the rest is net of it")
    void aPartialStaffRefundUnderACampaignReasonKeepsTheFeeOnce() {
        Paid paid = aPaidPledge("net-staff-partial", "100.00", true);

        assertThat(staffRefund(paid.pledgeId(), Map.of("amount", "98.00", "currency", "AZN"), "CAMPAIGN_HALTED"))
                .satisfies(refused -> {
                    assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
                    assertThat(refused.getBody()).containsEntry("code", "REFUND_EXCEEDS_COLLECTION");
                    assertThat(asMap(refused.getBody().get("meta"))).containsEntry("remaining", "97.00 AZN");
                });

        assertThat(staffRefund(paid.pledgeId(), Map.of("amount", "50.00", "currency", "AZN"), "CAMPAIGN_HALTED")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(refundable(paid.pledgeId(), "CAMPAIGN_HALTED"))
                .as("47.00 left to send, and the fee already kept back is not kept back twice")
                .containsEntry("remaining", Map.of("amount", "47.00", "currency", "AZN"))
                .containsEntry("withheldFee", Map.of("amount", "0.00", "currency", "AZN"));

        assertThat(staffRefund(paid.pledgeId(), null, "CAMPAIGN_HALTED").getStatusCode()).isEqualTo(HttpStatus.OK);

        List<Map<String, Object>> rows = jdbc().queryForList(
                "SELECT amount, withheld_fee FROM refunds WHERE pledge_id = ? ORDER BY requested_at, id",
                paid.pledgeId());
        assertThat(rows).hasSize(2);
        assertThat((BigDecimal) rows.get(0).get("amount")).isEqualByComparingTo("50.00");
        assertThat((BigDecimal) rows.get(0).get("withheld_fee")).isEqualByComparingTo("3.00");
        assertThat((BigDecimal) rows.get(1).get("amount")).isEqualByComparingTo("47.00");
        assertThat((BigDecimal) rows.get(1).get("withheld_fee")).isEqualByComparingTo("0.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("what a refund could send is net of the fee for a campaign's reason and whole for any other")
    void theRefundableFigureFollowsTheReason() {
        Paid paid = aPaidPledge("net-refundable", "100.00", true);

        assertThat(refundable(paid.pledgeId(), "CAMPAIGN_FAILED"))
                .containsEntry("pledgeId", paid.pledgeId().toString())
                .containsEntry("projectId", paid.projectId().toString())
                .containsEntry("backerId", paid.backer().id().toString())
                .containsEntry("remaining", Map.of("amount", "97.00", "currency", "AZN"))
                .containsEntry("withheldFee", Map.of("amount", "3.00", "currency", "AZN"));
        assertThat(refundable(paid.pledgeId(), "BACKER_REQUEST"))
                .containsEntry("remaining", Map.of("amount", "100.00", "currency", "AZN"))
                .containsEntry("withheldFee", Map.of("amount", "0.00", "currency", "AZN"));
        assertThat(sentFor(paid.pledgeId())).as("asking sends nothing").isEmpty();
    }

    @Test
    @DisplayName("a staff refund under a backer's request is whole, whatever the charge was taken under")
    void aStaffRefundForAnotherReasonIsWhole() {
        Paid paid = aPaidPledge("net-staff-whole", "100.00", true);

        ResponseEntity<Map<String, Object>> issued = staffRefund(paid.pledgeId(), null, "BACKER_REQUEST");

        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(asMap(issued.getBody().get("amount"))).containsEntry("amount", "100.00");
        assertThat(issued.getBody()).doesNotContainKey("withheldFee");
    }

    // ------------------------------------------------------------------
    // Past the provider's window (#399)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("past the provider's window the bank transfer owes the same net amount, and the books close at zero")
    void theBankTransferOwesTheSameNetAmount() {
        ReflectionTestUtils.setField(windows, "windows", Map.of(ProviderName.AZERICARD, Duration.ofDays(1)));
        Paid paid = aPaidPledge("net-bank", "100.00", true);
        clock.advance(Duration.ofDays(2));
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        assertThat(sentFor(paid.pledgeId())).as("never sent to the provider").isEmpty();
        Map<String, Object> refund = refundOf(paid.pledgeId());
        assertThat(refund.get("state")).isEqualTo("AWAITING_BANK_DETAILS");
        assertThat((BigDecimal) refund.get("amount")).isEqualByComparingTo("97.00");
        assertThat((BigDecimal) refund.get("withheld_fee")).isEqualByComparingTo("3.00");

        Map<String, Object> shown = get("/v1/pledges/" + paid.pledgeId(), paid.backer()).getBody();
        assertThat(asMap(shown.get("refundAwaitingBankTransfer"))).containsEntry("amount", "97.00");
        assertThat(asMap(shown.get("refundWithheldFee"))).containsEntry("amount", "3.00");
        assertThat(shown.get("refunded")).isNull();

        UUID refundId = (UUID) refund.get("id");
        assertThat(recordDetails(staff("net-support", "MODERATOR"), paid.pledgeId(), ticketFromBacker(paid))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> revealed = get(
                "/v1/admin/refunds/" + refundId + "/bank-details", staff("net-finance", "FINANCE"));
        assertThat(revealed.getBody().toString()).contains("97.00");
        assertThat(recordTransfer(staff("net-finance", "FINANCE"), refundId).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(jdbc().queryForObject(
                        "SELECT amount FROM transactions WHERE idempotency_key = ?",
                        BigDecimal.class,
                        refund.get("idempotency_key") + "-bank"))
                .isEqualByComparingTo("97.00");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(ledger.balanceOf(LedgerAccount.ESCROW, paid.projectId(), "AZN")).isEqualTo(azn("0.00"));
    }

    @Test
    @DisplayName("a refused net refund routed to a bank transfer by hand keeps the fee back too")
    void aRefusalRoutedByHandKeepsTheFeeBack() {
        Paid paid = aPaidPledge("net-refused", "100.00", true);
        provider.willRefuseRefunds("15400");
        end(paid.projectId(), "UNSUCCESSFUL");
        job.refundDue(clock.instant());
        Map<String, Object> refused = refundOf(paid.pledgeId());
        assertThat(refused.get("state")).isEqualTo("FAILED");

        ResponseEntity<Map<String, Object>> routed =
                post("/v1/admin/refunds/" + refused.get("id") + "/bank-transfer", staff("net-finance", "FINANCE"), null, null);

        assertThat(routed.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> owed = refundOf(paid.pledgeId());
        assertThat(owed.get("state")).isEqualTo("AWAITING_BANK_DETAILS");
        assertThat((BigDecimal) owed.get("amount")).isEqualByComparingTo("97.00");
        assertThat((BigDecimal) owed.get("withheld_fee")).isEqualByComparingTo("3.00");
        job.refundDue(clock.instant().plus(Duration.ofDays(1)));
        assertThat(sentFor(paid.pledgeId())).as("the sweep finds nothing more owed").hasSize(1);
    }

    // ------------------------------------------------------------------
    // What the backer is shown
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the backer's pledge and list show what came back and the fee that was withheld")
    void theBackerSeesTheNetAmount() {
        Paid paid = aPaidPledge("net-shown", "100.00", true);
        Map<String, Object> before = get("/v1/pledges/" + paid.pledgeId(), paid.backer()).getBody();
        assertThat(before).containsEntry("refunded", null).containsEntry("refundWithheldFee", null);
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        Map<String, Object> after = get("/v1/pledges/" + paid.pledgeId(), paid.backer()).getBody();
        assertThat(after).containsEntry("state", "REFUNDED");
        assertThat(asMap(after.get("refunded"))).containsEntry("amount", "97.00").containsEntry("currency", "AZN");
        assertThat(asMap(after.get("refundWithheldFee"))).containsEntry("amount", "3.00");
        Map<String, Object> listed = listed(paid.backer(), paid.pledgeId());
        assertThat(asMap(listed.get("refunded"))).containsEntry("amount", "97.00");
        assertThat(asMap(listed.get("refundWithheldFee"))).containsEntry("amount", "3.00");
    }

    @Test
    @DisplayName("a pledge refunded in full shows the whole amount and no withheld fee")
    void aFullRefundShowsNoFee() {
        Paid paid = aPaidPledge("net-full-shown", "100.00", false);
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        Map<String, Object> after = get("/v1/pledges/" + paid.pledgeId(), paid.backer()).getBody();
        assertThat(asMap(after.get("refunded"))).containsEntry("amount", "100.00");
        assertThat(after).containsEntry("refundWithheldFee", null);
    }

    // ------------------------------------------------------------------
    // The schema (V101)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("V101 adds both columns, defaulted so every existing row means refunded in full")
    void theMigration() {
        assertThat(jdbc().queryForMap(
                        """
                        SELECT is_nullable, column_default FROM information_schema.columns
                         WHERE table_name = 'transactions' AND column_name = 'provider_fee_withheld_on_refund'
                        """))
                .containsEntry("is_nullable", "NO")
                .containsEntry("column_default", "false");
        assertThat(jdbc().queryForMap(
                        """
                        SELECT is_nullable, column_default, numeric_scale FROM information_schema.columns
                         WHERE table_name = 'refunds' AND column_name = 'withheld_fee'
                        """))
                .containsEntry("is_nullable", "NO")
                .containsEntry("column_default", "0")
                .containsEntry("numeric_scale", 2);
        assertThat(jdbc().queryForObject(
                        "SELECT success FROM flyway_schema_history WHERE version = '101'", Boolean.class))
                .isTrue();
    }

    @Test
    @DisplayName("only a campaign-outcome refund may withhold a fee, and only a charge may carry the rule")
    void theSchemaHoldsTheScope() {
        Paid paid = aPaidPledge("net-schema", "100.00", true);
        assertThatThrownBy(() -> jdbc().update(
                        """
                        INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, amount, currency,
                                             withheld_fee, full_refund, reason, detail, state, requested_by,
                                             requested_at, idempotency_key)
                        VALUES (?, ?, ?, ?, 97.00, 'AZN', 3.00, true, 'BACKER_REQUEST', 'A staff refund', 'REQUESTED',
                                ?, now(), ?)
                        """,
                        UUID.randomUUID(),
                        paid.pledgeId(),
                        paid.projectId(),
                        paid.chargeId(),
                        paid.backer().id(),
                        "net-schema-" + UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("refunds_withheld_fee_campaign_only");
        assertThatThrownBy(() -> jdbc().update(
                        """
                        INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency, provider,
                                                  provider_transaction_id, attempt_number, idempotency_key,
                                                  provider_fee_withheld_on_refund)
                        VALUES (?, ?, ?, 'REFUND', 'SUCCEEDED', 1.00, 'AZN', 'AZERICARD', ?, 1, ?, true)
                        """,
                        UUID.randomUUID(),
                        paid.pledgeId(),
                        paid.projectId(),
                        "net-schema-" + UUID.randomUUID(),
                        "net-schema-" + UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("transactions_fee_withheld_on_charge_only");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Opened(UUID projectId, UUID pledgeId, String providerTransactionId, Account backer) {
    }

    private record Paid(UUID projectId, UUID pledgeId, UUID chargeId, String providerTransactionId, Account backer) {
    }

    private record Totals(BigDecimal pledged, int backers) {
    }

    private void feeOf(String rate) {
        ReflectionTestUtils.setField(
                fees, "properties", new ProviderFeeProperties(Map.of(ProviderName.AZERICARD, new BigDecimal(rate))));
    }

    private void withholding(boolean on) {
        ReflectionTestUtils.setField(terms, "withholdProviderFee", on);
    }

    /** A pledge paid through the payment page and a signed webhook, with the rule on or off at checkout. */
    private Paid aPaidPledge(String prefix, String amount, boolean underTheRule) {
        return settle(anOpenedPayment(prefix, amount, underTheRule));
    }

    private Opened anOpenedPayment(String prefix, String amount, boolean underTheRule) {
        withholding(underTheRule);
        Account creator = account(prefix + "-creator");
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects",
                        creator,
                        null,
                        Map.of("title", "A campaign that refunds net of the fee " + SEQUENCE.incrementAndGet()))
                .getBody()
                .get("id"));
        projects.add(projectId);
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", amount, "currency", "AZN"));
        UUID pledgeId = UUID.fromString((String) post("/v1/pledges/draft", backer, UUID.randomUUID().toString(), body)
                .getBody()
                .get("id"));
        paidPledges.add(pledgeId);
        String transaction = (String) post(
                        "/v1/pledges/" + pledgeId + "/payment", backer, UUID.randomUUID().toString(), Map.of("language", "en"))
                .getBody()
                .get("providerTransactionId");
        return new Opened(projectId, pledgeId, transaction, backer);
    }

    private Paid settle(Opened opened) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        String delivery = """
                {"id":"evt-%s","type":"charge_succeeded","providerTransactionId":"%s"}"""
                .formatted(UUID.randomUUID(), opened.providerTransactionId());
        assertThat(rest.exchange(
                                "/v1/webhooks/psp/azericard",
                                HttpMethod.POST,
                                new HttpEntity<>(delivery.getBytes(), headers),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(opened.pledgeId())).isEqualTo("COLLECTED");
        UUID chargeId = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'",
                UUID.class,
                opened.pledgeId());
        return new Paid(opened.projectId(), opened.pledgeId(), chargeId, opened.providerTransactionId(), opened.backer());
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

    private boolean flagOf(UUID chargeId) {
        return jdbc().queryForObject(
                "SELECT provider_fee_withheld_on_refund FROM transactions WHERE id = ?", Boolean.class, chargeId);
    }

    /** The newest refund of the pledge. */
    private Map<String, Object> refundOf(UUID pledgeId) {
        return jdbc().queryForMap(
                """
                SELECT id, state, reason, amount, withheld_fee, detail, idempotency_key FROM refunds
                 WHERE pledge_id = ? ORDER BY requested_at DESC, id DESC LIMIT 1
                """,
                pledgeId);
    }

    private ResponseEntity<Map<String, Object>> staffRefund(UUID pledgeId, Map<String, Object> amount) {
        return staffRefund(pledgeId, amount, "BACKER_REQUEST");
    }

    private Map<String, Object> refundable(UUID pledgeId, String reason) {
        ResponseEntity<Map<String, Object>> answer = get(
                "/v1/admin/refunds/refundable?pledgeId=" + pledgeId + "&reason=" + reason, staff("net-issuer", "FINANCE"));
        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        return answer.getBody();
    }

    private ResponseEntity<Map<String, Object>> staffRefund(UUID pledgeId, Map<String, Object> amount, String reason) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pledgeId", pledgeId.toString());
        body.put("amount", amount);
        body.put("reason", reason);
        body.put("detail", "The backer asked, in a test.");
        return post("/v1/admin/refunds", staff("net-issuer", "FINANCE"), "refund-" + UUID.randomUUID(), body);
    }

    private ResponseEntity<Map<String, Object>> recordDetails(Account staff, UUID pledgeId, UUID ticket) {
        return exchange(
                HttpMethod.PUT,
                "/v1/admin/pledges/" + pledgeId + "/refund-bank-details",
                staff,
                null,
                Map.of("iban", IBAN, "holderName", "Test Backer", "ticketId", ticket.toString()));
    }

    private ResponseEntity<Map<String, Object>> recordTransfer(Account staff, UUID refundId) {
        return post(
                "/v1/admin/refunds/" + refundId + "/bank-transfer/record",
                staff,
                null,
                Map.of("bankReference", "NET-REF-" + refundId, "transferredOn", LocalDate.now(ZoneOffset.UTC).toString()));
    }

    private UUID ticketFromBacker(Paid paid) {
        UUID id = UUID.randomUUID();
        jdbc().update(
                "INSERT INTO support_tickets (id, requester_id, subject, subject_type, subject_ref) VALUES (?, ?, ?, 'PLEDGE', ?)",
                id,
                paid.backer().id(),
                NOTE,
                paid.pledgeId());
        return id;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> listed(Account backer, UUID pledgeId) {
        List<Map<String, Object>> pledges =
                (List<Map<String, Object>>) get("/v1/me/pledges", backer).getBody().get("pledges");
        return pledges.stream()
                .filter(pledge -> pledgeId.toString().equals(pledge.get("pledgeId")))
                .findFirst()
                .orElseThrow();
    }

    /**
     * What the ledger reconciliation finds wrong, as a gap per check and currency. The suites share one
     * database, so the test compares the gaps before and after rather than asking for none.
     */
    private Map<String, BigDecimal> reconciliationGaps() {
        Map<String, BigDecimal> gaps = new TreeMap<>();
        for (ReconciliationFinding finding : reconciliation.reconcile().findings()) {
            if (finding.code() == ReconciliationFinding.Code.DISAGREES_WITH_PAYMENTS) {
                gaps.put(finding.code() + ":" + finding.currency(), finding.amount().subtract(finding.otherAmount()));
            } else if (finding.code() == ReconciliationFinding.Code.LEDGER_NOT_ZERO) {
                gaps.put(finding.code() + ":" + finding.currency(), finding.amount());
            }
        }
        return gaps;
    }

    private List<RefundRequest> sentFor(UUID pledgeId) {
        return provider.refunds().stream().filter(request -> request.reference().equals(pledgeId)).toList();
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

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private static Money azn(String amount) {
        return Money.of(new BigDecimal(amount), "AZN");
    }

    /** A member of staff holding one V48 role. */
    private Account staff(String handle, String role) {
        UUID id = Campaigns.creator(dataSource, handle);
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """,
                id,
                role,
                id,
                NOTE);
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

    private ResponseEntity<Map<String, Object>> get(String path, Account account) {
        return exchange(HttpMethod.GET, path, account, null, null);
    }

    private ResponseEntity<Map<String, Object>> post(String path, Account account, String idempotencyKey, Object body) {
        return exchange(HttpMethod.POST, path, account, idempotencyKey, body);
    }

    private ResponseEntity<Map<String, Object>> exchange(
            HttpMethod method, String path, Account account, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(account.accessToken());
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
