package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import az.ideanest.fee.application.FeeBreakdown;
import az.ideanest.fee.application.FeeSchedules;
import az.ideanest.ledger.application.LedgerBalance;
import az.ideanest.ledger.application.LedgerReader;
import az.ideanest.payment.application.CampaignFunds;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payout.application.CampaignFinance;
import az.ideanest.payout.application.CampaignFinanceService;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.access.ProjectAuthorisation;
import az.ideanest.shared.access.ProjectCapability;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * §4.7's CD-16 — the creator's financial summary. Issue #99.
 *
 * <p>A plain unit test: every decision worth checking here is arithmetic and a choice of which
 * source to read, and neither needs a database. What it guards:
 *
 * <ul>
 *   <li><strong>the capability is asked for first.</strong> This is the second dashboard read
 *       that returns money and the first that returns a payout history; a collaborator brought
 *       on to write the story must not see either.
 *   <li><strong>projected and settled are different answers.</strong> Before a payout exists
 *       the fees are what today's schedule would charge; afterwards they are what the payout
 *       was priced at, read from the row rather than recomputed — so a campaign that ran across
 *       a rate change is not silently re-quoted.
 *   <li><strong>the refunds come off after the fees.</strong> The other order takes a platform
 *       fee on money that went back to a backer, and {@code PayoutService} makes the same
 *       choice at the moment it matters.
 *   <li><strong>a creator is never shown a negative payout</strong>, which would be a debt the
 *       platform invented.
 *   <li><strong>only what was actually paid counts as paid.</strong> A cancelled payout is in
 *       the history and is not in the total.
 * </ul>
 */
class CampaignFinanceTests {

    private static final UUID PROJECT = UUID.fromString("0193f2a1-0000-7000-8000-000000000001");
    private static final UUID CREATOR = UUID.fromString("0193f2a1-0000-7000-8000-000000000002");
    private static final UUID SCHEDULE = UUID.fromString("0193f2a1-0000-7000-8000-000000000003");
    private static final UUID CALLER = UUID.fromString("0193f2a1-0000-7000-8000-000000000004");

    private static final Instant NOW = Instant.parse("2026-08-19T12:00:00Z");
    private static final String AZN = "AZN";

    private ProjectAuthorisation projects;
    private PayoutGateway gateway;
    private FeeSchedules fees;
    private PayoutRepository payouts;
    private LedgerReader ledger;
    private CampaignFinanceService service;

    @BeforeEach
    void setUp() {
        projects = mock(ProjectAuthorisation.class);
        gateway = mock(PayoutGateway.class);
        fees = mock(FeeSchedules.class);
        payouts = mock(PayoutRepository.class);
        ledger = mock(LedgerReader.class);

        when(payouts.historyOf(PROJECT)).thenReturn(List.of());
        when(ledger.balancesOf(PROJECT)).thenReturn(List.of());

        service = new CampaignFinanceService(
                projects,
                gateway,
                fees,
                payouts,
                ledger,
                new PayoutProperties(Duration.ofDays(14), new BigDecimal("5000.00"), (short) 2, AZN, null),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("asks for VIEW_FINANCES before it reads anything")
    void theCapabilityIsAskedForFirst() {
        collected("1000.00", "0.00");
        priced("1000.00", "50.00", "29.00", "921.00");

        service.of(PROJECT, CALLER);

        verify(projects).requireCapability(PROJECT, CALLER, ProjectCapability.VIEW_FINANCES);
    }

    @Test
    @DisplayName("prices a campaign with no payout against the schedule in force now")
    void anUnpaidCampaignIsProjected() {
        collected("1000.00", "0.00");
        priced("1000.00", "50.00", "29.00", "921.00");

        CampaignFinance finance = service.of(PROJECT, CALLER);

        assertThat(finance.basis()).isEqualTo(CampaignFinance.Basis.PROJECTED);
        assertThat(finance.gross()).isEqualTo(Money.of(new BigDecimal("1000.00"), AZN));
        assertThat(finance.platformFee()).isEqualTo(Money.of(new BigDecimal("50.00"), AZN));
        assertThat(finance.processingFee()).isEqualTo(Money.of(new BigDecimal("29.00"), AZN));
        assertThat(finance.net()).isEqualTo(Money.of(new BigDecimal("921.00"), AZN));
        assertThat(finance.feeScheduleId()).isEqualTo(SCHEDULE);
        assertThat(finance.paidOut()).isEqualTo(Money.zero(AZN));
    }

    /**
     * The order the platform charges in, checked. Taking the refund off the gross first would
     * price the fee on 900 rather than on 1000 — better for the creator by four manat and
     * wrong, because the fee was earned on the money that was actually taken.
     */
    @Test
    @DisplayName("takes the fees off the gross and the refunds off what is left")
    void refundsComeOffAfterTheFees() {
        collected("1000.00", "100.00");
        priced("1000.00", "50.00", "29.00", "921.00");

        CampaignFinance finance = service.of(PROJECT, CALLER);

        assertThat(finance.refunded()).isEqualTo(Money.of(new BigDecimal("100.00"), AZN));
        assertThat(finance.net()).isEqualTo(Money.of(new BigDecimal("821.00"), AZN));
    }

    @Test
    @DisplayName("never shows a creator a negative payout, which would be a debt nobody owes")
    void aRefundedCampaignOwesNothingRatherThanLess() {
        collected("1000.00", "2000.00");
        priced("1000.00", "50.00", "29.00", "921.00");

        assertThat(service.of(PROJECT, CALLER).net()).isEqualTo(Money.zero(AZN));
    }

    @Test
    @DisplayName("reads a calculated payout's own figures rather than pricing it again")
    void aPaidCampaignIsSettled() {
        collected("1000.00", "0.00");
        // A schedule that would now charge twice as much. A settled summary must not use it.
        priced("1000.00", "100.00", "29.00", "871.00");
        when(payouts.historyOf(PROJECT)).thenReturn(List.of(payout("1000.00", "50.00", "29.00", "921.00")));

        CampaignFinance finance = service.of(PROJECT, CALLER);

        assertThat(finance.basis()).isEqualTo(CampaignFinance.Basis.SETTLED);
        assertThat(finance.platformFee()).isEqualTo(Money.of(new BigDecimal("50.00"), AZN));
        assertThat(finance.net()).isEqualTo(Money.of(new BigDecimal("921.00"), AZN));
    }

    @Test
    @DisplayName("counts a payout as paid only once it was")
    void onlyPaidPayoutsAreInTheTotal() {
        collected("1000.00", "0.00");
        Payout calculated = payout("1000.00", "50.00", "29.00", "921.00");
        when(payouts.historyOf(PROJECT)).thenReturn(List.of(calculated));

        CampaignFinance finance = service.of(PROJECT, CALLER);

        assertThat(finance.paidOut()).isEqualTo(Money.zero(AZN));
        // And the payout is still on the record, because a creator who saw one calculated and
        // then saw nothing would have no way to tell a cancellation from a broken screen.
        assertThat(finance.payouts()).hasSize(1);
        assertThat(finance.payouts().getFirst().net()).isEqualTo(Money.of(new BigDecimal("921.00"), AZN));
    }

    @Test
    @DisplayName("says the platform withholds no tax, rather than saying nothing about tax")
    void taxIsZeroAndSaysWhy() {
        collected("1000.00", "0.00");
        priced("1000.00", "50.00", "29.00", "921.00");

        CampaignFinance finance = service.of(PROJECT, CALLER);

        assertThat(finance.taxWithheld()).isEqualTo(Money.zero(AZN));
        assertThat(finance.taxCollected()).isFalse();
    }

    /**
     * V41's deferred trigger refuses a posting that does not balance, so this can only be
     * false for a row that arrived past both the application and the trigger — which is
     * exactly the day somebody needs to see it rather than be reassured.
     */
    @Test
    @DisplayName("reports whether this campaign's books balance, per currency")
    void reconciliationIsComputedRatherThanAsserted() {
        collected("1000.00", "0.00");
        priced("1000.00", "50.00", "29.00", "921.00");

        when(ledger.balancesOf(PROJECT))
                .thenReturn(List.of(
                        new LedgerBalance("escrow", Money.of(new BigDecimal("1000.00"), AZN)),
                        new LedgerBalance("creator:" + CREATOR, Money.of(new BigDecimal("-1000.00"), AZN))));
        assertThat(service.of(PROJECT, CALLER).reconciled()).isTrue();

        when(ledger.balancesOf(PROJECT))
                .thenReturn(List.of(new LedgerBalance("escrow", Money.of(new BigDecimal("1000.00"), AZN))));
        assertThat(service.of(PROJECT, CALLER).reconciled()).isFalse();
    }

    @Test
    @DisplayName("answers for a campaign that has taken nothing at all")
    void anEmptyCampaignAnswersInZeroes() {
        when(gateway.fundsOf(eq(PROJECT), any())).thenReturn(CampaignFunds.none(AZN));
        priced("0.00", "0.00", "0.00", "0.00");

        CampaignFinance finance = service.of(PROJECT, CALLER);

        assertThat(finance.gross()).isEqualTo(Money.zero(AZN));
        assertThat(finance.net()).isEqualTo(Money.zero(AZN));
        assertThat(finance.payouts()).isEmpty();
        // Nothing posted is a balanced set of books, not an unbalanced one.
        assertThat(finance.reconciled()).isTrue();
    }

    private void collected(String gross, String refunded) {
        when(gateway.fundsOf(eq(PROJECT), any()))
                .thenReturn(new CampaignFunds(
                        Money.of(new BigDecimal(gross), AZN), Money.of(new BigDecimal(refunded), AZN)));
    }

    private void priced(String gross, String platformFee, String processingFee, String net) {
        when(fees.priceOf(any(), any(), eq(PROJECT)))
                .thenReturn(new FeeBreakdown(
                        Money.of(new BigDecimal(gross), AZN),
                        Money.of(new BigDecimal(platformFee), AZN),
                        Money.of(new BigDecimal(processingFee), AZN),
                        Money.of(new BigDecimal(net), AZN),
                        SCHEDULE));
    }

    private static Payout payout(String gross, String platformFee, String processingFee, String net) {
        return Payout.calculated(
                PROJECT,
                CREATOR,
                Money.of(new BigDecimal(gross), AZN),
                Money.of(new BigDecimal(platformFee), AZN),
                Money.of(new BigDecimal(processingFee), AZN),
                Money.zero(AZN),
                Money.of(new BigDecimal(net), AZN),
                SCHEDULE,
                NOW.plus(Duration.ofDays(14)),
                (short) 1,
                "payout-test");
    }
}
