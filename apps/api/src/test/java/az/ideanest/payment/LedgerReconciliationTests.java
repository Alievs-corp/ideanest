package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import az.ideanest.ledger.application.LedgerBalance;
import az.ideanest.ledger.application.LedgerReader;
import az.ideanest.payment.application.LedgerReconciliation;
import az.ideanest.payment.application.LedgerReconciliationJob;
import az.ideanest.payment.application.ReconciliationFinding;
import az.ideanest.payment.application.ReconciliationReport;
import az.ideanest.payment.application.SettledTotal;
import az.ideanest.payment.domain.TransactionType;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * §8.4's {@code ledger-reconciliation} — issue #70.
 *
 * <p>A plain unit test: the whole of it is arithmetic over two queries, and the point of
 * separating {@link LedgerReconciliation} from its job was to make that testable without a
 * scheduler or a database.
 *
 * <p>WHAT THESE COVER, and each is a way the platform's money can be wrong that the others
 * would not catch:
 *
 * <ul>
 *   <li><strong>the books balance.</strong> V41's deferred trigger should make an unbalanced
 *       posting impossible, which is exactly why a check for one is worth having: it can only
 *       fail for a row that arrived past both the application and the trigger.
 *   <li><strong>no account holds a sign it cannot.</strong> Two errors of opposite sign
 *       balance perfectly, so the first check would pass over a creator who had been paid
 *       twice. {@code AccountTotal} names that case as alert-worthy in as many words.
 *   <li><strong>the ledger agrees with the transactions.</strong> The only one of the three
 *       that catches a posting the application never made at all.
 *   <li><strong>a discrepancy is not a failed job.</strong> Throwing would make the runner
 *       back off and eventually stop scheduling — which is the wrong response to having found
 *       something.
 *   <li><strong>a pass that has never run says so.</strong> A reconciliation that silently
 *       stops looks exactly like a platform whose books balance.
 * </ul>
 */
class LedgerReconciliationTests {

    private static final Instant NOW = Instant.parse("2026-08-20T02:30:00Z");
    private static final String AZN = "AZN";
    private static final String CREATOR = "creator:" + UUID.fromString("0193f2a1-0000-7000-8000-000000000002");

    private LedgerReader ledger;
    private PaymentTransactionRepository transactions;
    private LedgerReconciliation reconciliation;

    @BeforeEach
    void setUp() {
        ledger = mock(LedgerReader.class);
        transactions = mock(PaymentTransactionRepository.class);
        reconciliation = new LedgerReconciliation(ledger, transactions, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("a platform that has taken one pledge and paid nothing out balances")
    void aSimpleLedgerBalances() {
        booksOf(balance("escrow", "1000.00"), balance(CREATOR, "-1000.00"));
        settled(total(TransactionType.CHARGE, "1000.00"));

        ReconciliationReport report = reconciliation.reconcile();

        assertThat(report.balanced()).isTrue();
        assertThat(report.accountsChecked()).isEqualTo(2);
        assertThat(report.runAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("a platform that has taken nothing is balanced rather than unchecked")
    void anEmptyPlatformBalances() {
        booksOf();
        settled();

        assertThat(reconciliation.reconcile().balanced()).isTrue();
    }

    @Test
    @DisplayName("says so when the debits and the credits do not meet")
    void anUnbalancedLedgerIsFound() {
        booksOf(balance("escrow", "1000.00"), balance(CREATOR, "-900.00"));
        // The transactions agree with escrow, so only the first check can catch this.
        settled(total(TransactionType.CHARGE, "1000.00"));

        ReconciliationReport report = reconciliation.reconcile();

        assertThat(kinds(report)).contains(ReconciliationFinding.Kind.UNBALANCED);
        assertThat(report.findings().getFirst().detail()).contains("100.00");
    }

    /**
     * The case the first check cannot see. Both halves of this ledger sum to zero, and one of
     * them is a creator holding money the platform does not owe them.
     */
    @Test
    @DisplayName("finds a creator paid more than they earned, which a balanced ledger hides")
    void anImpossibleSignIsFound() {
        booksOf(balance("escrow", "-500.00"), balance(CREATOR, "500.00"));
        settled(total(TransactionType.CHARGE, "1000.00"), total(TransactionType.PAYOUT, "1500.00"));

        ReconciliationReport report = reconciliation.reconcile();

        assertThat(kinds(report)).contains(ReconciliationFinding.Kind.IMPOSSIBLE_SIGN);
        assertThat(report.findings().stream().map(ReconciliationFinding::detail))
                .anySatisfy(detail -> assertThat(detail).contains("paid more than they earned"));

        /*
         * And the parts beside the sentence — issue #403. The console renders this to a
         * person in one of four languages and cannot translate English prose, so it builds
         * its own sentence from these: which of the two IMPOSSIBLE_SIGN findings this is,
         * whose account, and how much. `kind` alone cannot say, because the other one reads
         * in the opposite direction.
         */
        assertThat(report.findings())
                .filteredOn(finding -> finding.code() == ReconciliationFinding.Code.CREATOR_OVERPAID)
                .singleElement()
                .satisfies(finding -> {
                    assertThat(finding.account()).isEqualTo(CREATOR);
                    assertThat(finding.amount()).isEqualByComparingTo("500.00");
                    assertThat(finding.otherAmount()).isNull();
                    assertThat(finding.kind()).isEqualTo(ReconciliationFinding.Kind.IMPOSSIBLE_SIGN);
                });
    }

    @Test
    @DisplayName("finds a collection that moved money and was never posted")
    void aMissingPostingIsFound() {
        // The books are internally consistent and describe one pledge; the transactions
        // describe two. Only the third check sees it.
        booksOf(balance("escrow", "1000.00"), balance(CREATOR, "-1000.00"));
        settled(total(TransactionType.CHARGE, "2000.00"));

        ReconciliationReport report = reconciliation.reconcile();

        assertThat(kinds(report)).containsExactly(ReconciliationFinding.Kind.DISAGREES_WITH_PAYMENTS);
        assertThat(report.findings().getFirst().detail()).contains("1000.00").contains("2000.00");
    }

    /**
     * A chargeback's fee is taken from the platform's balance rather than from a backer's
     * card, so it has a ledger posting and no transaction row. Adding `psp_fee` back to escrow
     * is what puts both sides of the comparison in the same terms.
     */
    @Test
    @DisplayName("counts a provider fee that has no transaction row behind it")
    void theProviderFeeIsPutBackOnTheLedgerSide() {
        booksOf(
                balance("escrow", "880.00"),
                balance("psp_fee", "20.00"),
                balance("refunds", "100.00"),
                balance(CREATOR, "-1000.00"));
        settled(total(TransactionType.CHARGE, "1000.00"), total(TransactionType.REFUND, "100.00"));

        assertThat(reconciliation.reconcile().balanced()).isTrue();
    }

    @Test
    @DisplayName("ignores the two transaction kinds that never produce a posting")
    void verificationsAndReversalsAreNotMoney() {
        booksOf(balance("escrow", "1000.00"), balance(CREATOR, "-1000.00"));
        settled(
                total(TransactionType.CHARGE, "1000.00"),
                total(TransactionType.VERIFICATION, "1.00"),
                total(TransactionType.CHARGEBACK_REVERSAL, "50.00"));

        assertThat(reconciliation.reconcile().balanced()).isTrue();
    }

    @Test
    @DisplayName("compares an empty sum against a zero balance without calling it a discrepancy")
    void zeroAndZeroPointZeroAreTheSameAmount() {
        booksOf(balance("escrow", "0.00"), balance(CREATOR, "0"));
        settled(total(TransactionType.CHARGE, "0"));

        assertThat(reconciliation.reconcile().balanced()).isTrue();
    }

    @Test
    @DisplayName("never adds two currencies together")
    void currenciesAreReconciledSeparately() {
        booksOf(
                balance("escrow", "1000.00", AZN),
                balance(CREATOR, "-1000.00", AZN),
                balance("escrow", "500.00", "USD"),
                balance(CREATOR, "-400.00", "USD"));
        settled(total(TransactionType.CHARGE, "1000.00", AZN), total(TransactionType.CHARGE, "500.00", "USD"));

        ReconciliationReport report = reconciliation.reconcile();

        // The manat side is fine and the dollar side is not, and no finding mentions both.
        assertThat(report.findings()).allSatisfy(finding -> assertThat(finding.currency()).isEqualTo("USD"));
        assertThat(kinds(report)).contains(ReconciliationFinding.Kind.UNBALANCED);
    }

    @Test
    @DisplayName("a discrepancy is a finding, not a failed job")
    void theJobDoesNotThrowOverAFinding() {
        booksOf(balance("escrow", "1000.00"), balance(CREATOR, "-900.00"));
        settled(total(TransactionType.CHARGE, "1000.00"));

        LedgerReconciliationJob job = new LedgerReconciliationJob(
                reconciliation,
                new PaymentProperties(null, null, null, null, new PaymentProperties.Reconciliation("-"), null));

        // Throwing is how a ScheduledJob reports that it could not run: the runner counts the
        // attempt, backs off, and eventually stops scheduling. A pass that ran and found
        // something has not failed.
        job.run();

        assertThat(job.lastReport().balanced()).isFalse();
        assertThat(job.schedule()).isEqualTo("-");
        assertThat(job.name()).isEqualTo("ledger-reconciliation");
    }

    @Test
    @DisplayName("a job that has never run says so, rather than looking like a clean pass")
    void neverHavingRunIsItsOwnAnswer() {
        LedgerReconciliationJob job = new LedgerReconciliationJob(
                reconciliation,
                new PaymentProperties(null, null, null, null, new PaymentProperties.Reconciliation("-"), null));

        assertThat(job.lastReport().hasRun()).isFalse();
        assertThat(job.lastReport().balanced()).isTrue();
    }

    @Test
    @DisplayName("a deployment that configures no schedule still gets a daily one")
    void theScheduleHasADefault() {
        assertThat(PaymentProperties.Reconciliation.defaults().schedule()).isNotBlank();
        assertThat(new PaymentProperties.Reconciliation(null).schedule()).isNotBlank();
        assertThat(new PaymentProperties(null, null, null, null, null, null).reconciliation()).isNotNull();
    }

    /* ---------------------------------------------------------------------- */

    private void booksOf(LedgerBalance... balances) {
        when(ledger.balances()).thenReturn(List.of(balances));
    }

    private void settled(SettledTotal... totals) {
        when(transactions.settledTotals()).thenReturn(List.of(totals));
    }

    private static LedgerBalance balance(String account, String net) {
        return balance(account, net, AZN);
    }

    private static LedgerBalance balance(String account, String net, String currency) {
        return new LedgerBalance(account, Money.of(new BigDecimal(net), currency));
    }

    private static SettledTotal total(TransactionType type, String amount) {
        return total(type, amount, AZN);
    }

    private static SettledTotal total(TransactionType type, String amount, String currency) {
        return new SettledTotal(type, currency, new BigDecimal(amount));
    }

    private static List<ReconciliationFinding.Kind> kinds(ReconciliationReport report) {
        return report.findings().stream().map(ReconciliationFinding::kind).toList();
    }
}
