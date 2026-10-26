package az.ideanest.payment.application;

import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.LedgerBalance;
import az.ideanest.ledger.application.LedgerReader;
import az.ideanest.ledger.application.ProjectTotal;
import az.ideanest.payment.domain.TransactionType;
import az.ideanest.payment.infrastructure.CreatorDebtRepository;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §8.4's {@code ledger-reconciliation}: does the platform's money add up? Issue #70.
 *
 * <h2>Three questions, and each one can be wrong on its own</h2>
 *
 * <ol>
 *   <li><strong>Do the books balance?</strong> Summed per currency across every account, the
 *       debits must equal the credits. V41's deferred constraint trigger refuses a posting
 *       that does not, so a failure here means a row arrived past both the application and the
 *       trigger — which is the one thing this whole job exists to notice.
 *   <li><strong>Does any account hold a sign it cannot?</strong> Escrow below zero is the
 *       platform having paid out money it never took. A creator's account above zero is a
 *       creator paid more than they earned — {@code AccountTotal} names that one in as many
 *       words as "worth an alert when it does". Neither is caught by the first check, because
 *       two errors of opposite sign balance perfectly.
 *   <li><strong>Does the ledger agree with the record of what moved?</strong> Escrow plus the
 *       provider's fees must equal the settled charges less the payouts and the money returned.
 *       The left-hand side comes from the ledger and the right from {@code transactions}, so
 *       this is the only one of the three that could catch a posting the application simply
 *       never made.
 * </ol>
 *
 * <h2>And escrow per campaign (#587)</h2>
 *
 * <p>Check two reads escrow as one pool, and a pool hides a campaign that returned more than it
 * took behind every other campaign's money — a refund on a paid-out campaign did exactly that,
 * silently. So the second check is asked again per campaign: what the campaign holds — escrow
 * plus {@code psp_fee} and {@code platform_expense}, check three's terms, because a full refund
 * of a charge the provider kept a fee on leaves that campaign's escrow short by the fee for
 * reasons that are nobody's mistake — must not be below zero, unless a creator debt answers for
 * the difference (a chargeback lost after the payout, §9.8). Reported as
 * {@code PLATFORM_ACCOUNT_NEGATIVE} on {@code escrow:<campaign>}.
 *
 * <h2>WHY THERE IS NO COMPARISON AGAINST A PROVIDER'S SETTLEMENT REPORT</h2>
 *
 * Because there is no provider. §9.3's choice is #60 and carries {@code status:
 * needs-decision}; {@code PaymentProviders} discovers no implementation, and hosted card
 * tokenisation (#55) is blocked behind the same decision. A settlement comparison written
 * now would be a parser for a file format nobody has agreed to, checked against a fixture
 * this repository invented — which is worse than an absence, because it would look like
 * coverage.
 *
 * <p>Check three is the shape that comparison will take, against the one counterparty that
 * exists today: the platform's own record of every transaction it believes settled. When a
 * provider is chosen, its report becomes a fourth source on the same right-hand side, and
 * the arithmetic below does not change.
 *
 * <h2>Escrow spans two places since #397</h2>
 *
 * <p>Creators are paid by bank transfer from IdeyaNest's own account (epic #392): a
 * {@code PAYOUT} transaction whose provider is {@code BANK_TRANSFER}, with the same posting a
 * provider's payout gets. Since #399 a refund past the provider's refund window goes the same
 * way, as a {@code REFUND} transaction under {@code BANK_TRANSFER} with the ordinary posting.
 * So {@code escrow} is money held across the provider's balance <em>and</em> the bank account
 * — collected through the one, paid out or refunded from either — and the three checks here
 * still balance, because {@code settledTotals} sums every provider and the ledger never
 * distinguished them.
 *
 * <p>What does split is the comparison above, when it is written: a provider's settlement
 * report knows nothing of a bank transfer, so it is compared only against transactions whose
 * provider is that provider, never against {@code BANK_TRANSFER} rows. Those are checked
 * against the bank's statement instead, by their {@code provider_transaction_id}, which is the
 * bank's reference.
 *
 * <h2>It reports rather than repairs</h2>
 *
 * Nothing here writes to the ledger. An imbalance is a fact about money that a person has to
 * look at — the correcting entry depends on which of a dozen things went wrong, and a job
 * that guessed would turn a detectable problem into an undetectable one. {@code
 * ReconciliationReport} is what it produces and {@code LedgerReconciliationJob} is what runs
 * it on §8.4's daily schedule.
 */
@Service
public class LedgerReconciliation {

    private static final Set<String> CREDIT_NORMAL =
            Set.of(LedgerAccount.PLATFORM_FEE.name(), LedgerAccount.TAX_PAYABLE.name());

    /** What a campaign holds, in check three's terms: escrow with the fees that left it put back. */
    private static final List<LedgerAccount> HELD =
            List.of(LedgerAccount.ESCROW, LedgerAccount.PSP_FEE, LedgerAccount.PLATFORM_EXPENSE);

    private final LedgerReader ledger;
    private final PaymentTransactionRepository transactions;
    private final CreatorDebtRepository debts;
    private final Clock clock;

    public LedgerReconciliation(
            LedgerReader ledger, PaymentTransactionRepository transactions, CreatorDebtRepository debts, Clock clock) {
        this.ledger = ledger;
        this.transactions = transactions;
        this.debts = debts;
        this.clock = clock;
    }

    /** One pass over the whole platform. */
    @Transactional(readOnly = true)
    public ReconciliationReport reconcile() {
        List<LedgerBalance> balances = ledger.balances();
        List<SettledTotal> settled = transactions.settledTotals();

        List<ReconciliationFinding> findings = new ArrayList<>();
        findings.addAll(unbalancedCurrencies(balances));
        findings.addAll(impossibleSigns(balances));
        findings.addAll(campaignsHoldingLessThanNothing());
        findings.addAll(disagreementsWithPayments(balances, settled));

        return new ReconciliationReport(
                clock.instant().truncatedTo(ChronoUnit.MICROS),
                balances.size(),
                List.copyOf(findings));
    }

    /**
     * Check two, per campaign (#587): no campaign holds less than nothing, beyond what its creator was
     * made to owe.
     *
     * <p>Only the campaigns below zero are read, and the debts only for those, so the cost is one
     * aggregate on a healthy platform.
     */
    private List<ReconciliationFinding> campaignsHoldingLessThanNothing() {
        List<ReconciliationFinding> findings = new ArrayList<>();
        for (ProjectTotal held : ledger.projectsBelowZero(HELD)) {
            BigDecimal owed = debts.owedFor(held.projectId(), held.currency());
            if (held.net().add(owed == null ? BigDecimal.ZERO : owed).signum() < 0) {
                findings.add(ReconciliationFinding.campaignEscrowNegative(
                        held.projectId(), held.currency(), held.net()));
            }
        }
        return findings;
    }

    /** Check one: per currency, the whole ledger sums to zero. */
    private static List<ReconciliationFinding> unbalancedCurrencies(List<LedgerBalance> balances) {
        List<ReconciliationFinding> findings = new ArrayList<>();

        for (Map.Entry<String, BigDecimal> currency : summedPerCurrency(balances).entrySet()) {
            if (currency.getValue().signum() != 0) {
                findings.add(ReconciliationFinding.ledgerNotZero(currency.getKey(), currency.getValue()));
            }
        }
        return findings;
    }

    /**
     * Check two: no account holds a balance whose sign is impossible.
     *
     * <p>Escrow, {@code psp_fee}, {@code refunds} and {@code platform_expense} are money the platform
     * holds or has disbursed, so each is non-negative. A creator's account is the claim they have on
     * the platform, recorded as a credit, so it is non-positive — a positive one is money paid beyond
     * what was earned.
     *
     * <p>{@code platform_fee} and {@code tax_payable} are credited when a payout splits its gross
     * (#401): the platform's revenue and what it owes a tax authority, both credits. Nothing debits
     * either, so neither has a sign to get wrong in the direction this check reads, and they are left
     * out of it rather than reported as negative for being what they are.
     */
    private static List<ReconciliationFinding> impossibleSigns(List<LedgerBalance> balances) {
        List<ReconciliationFinding> findings = new ArrayList<>();

        for (LedgerBalance balance : balances) {
            boolean creator = balance.account().startsWith("creator:");
            if (CREDIT_NORMAL.contains(balance.account())) {
                continue;
            }
            int sign = balance.net().amount().signum();

            if (creator && sign > 0) {
                findings.add(ReconciliationFinding.creatorOverpaid(
                        balance.account(), balance.net().currency(), balance.net().amount()));
            } else if (!creator && sign < 0) {
                findings.add(ReconciliationFinding.platformAccountNegative(
                        balance.account(), balance.net().currency(), balance.net().amount()));
            }
        }
        return findings;
    }

    /**
     * Check three: the ledger's view of what the platform holds agrees with the transactions.
     *
     * <p>{@code escrow + psp_fee + platform_expense == charges − payouts − refunds}. Escrow is
     * debited by every collection and credited by every payout, refund and fee; {@code psp_fee}
     * and {@code platform_expense} are the ones with no transaction row behind them — the
     * provider keeps its commission before a charge arrives, a chargeback's fee is taken from the
     * platform's balance, and a bank charges for a transfer out of IdeyaNest's account (#401).
     * Adding them back to escrow puts both sides in the same terms. What a payout credits to
     * {@code platform_fee}, {@code tax_payable} and {@code refunds} never touches escrow, so it is
     * on neither side.
     *
     * <p>Chargebacks are counted with refunds: {@code DisputeService} records a lost case as a
     * {@code REFUND} transaction, on the argument that it is the same movement seen from the
     * other side. Both types are summed anyway, so a change of mind there cannot silently
     * unbalance this.
     */
    private static List<ReconciliationFinding> disagreementsWithPayments(
            List<LedgerBalance> balances, List<SettledTotal> settled) {

        Map<String, BigDecimal> held = new LinkedHashMap<>();
        for (LedgerBalance balance : balances) {
            if (balance.account().equals(LedgerAccount.ESCROW.name())
                    || balance.account().equals(LedgerAccount.PSP_FEE.name())
                    || balance.account().equals(LedgerAccount.PLATFORM_EXPENSE.name())) {
                held.merge(balance.net().currency(), balance.net().amount(), BigDecimal::add);
            }
        }

        Map<String, BigDecimal> moved = new LinkedHashMap<>();
        for (SettledTotal total : settled) {
            BigDecimal signed = switch (total.type()) {
                case CHARGE -> total.total();
                case PAYOUT, REFUND, CHARGEBACK -> total.total().negate();
                /*
                 * A verification is a zero-or-minimal authorisation that is reversed, and a
                 * chargeback reversal returns money the platform never posted out. Neither
                 * produces a ledger entry, so neither belongs on this side of the comparison.
                 */
                case VERIFICATION, CHARGEBACK_REVERSAL -> BigDecimal.ZERO;
            };
            moved.merge(total.currency(), signed, BigDecimal::add);
        }

        List<ReconciliationFinding> findings = new ArrayList<>();
        for (String currency : union(held, moved)) {
            BigDecimal ledgerSide = held.getOrDefault(currency, BigDecimal.ZERO);
            BigDecimal paymentSide = moved.getOrDefault(currency, BigDecimal.ZERO);

            // `compareTo` and not `equals`: `0` and `0.00` are the same amount and different
            // BigDecimals, and one comes from a SUM over an empty set.
            if (ledgerSide.compareTo(paymentSide) != 0) {
                findings.add(
                        ReconciliationFinding.disagreesWithPayments(currency, ledgerSide, paymentSide));
            }
        }
        return findings;
    }

    private static Map<String, BigDecimal> summedPerCurrency(List<LedgerBalance> balances) {
        Map<String, BigDecimal> sums = new LinkedHashMap<>();
        for (LedgerBalance balance : balances) {
            sums.merge(balance.net().currency(), balance.net().amount(), BigDecimal::add);
        }
        return sums;
    }

    private static List<String> union(Map<String, BigDecimal> left, Map<String, BigDecimal> right) {
        List<String> currencies = new ArrayList<>(left.keySet());
        for (String currency : right.keySet()) {
            if (!currencies.contains(currency)) currencies.add(currency);
        }
        return currencies;
    }
}
