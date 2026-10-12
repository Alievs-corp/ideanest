package az.ideanest.payment.application;

import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.LedgerBalance;
import az.ideanest.ledger.application.LedgerReader;
import az.ideanest.payment.domain.TransactionType;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * provider's payout gets. So {@code escrow} is money held across the provider's balance
 * <em>and</em> the bank account — collected through the one, paid out from the other — and the
 * three checks here still balance, because {@code settledTotals} sums every provider and the
 * ledger never distinguished them.
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

    private final LedgerReader ledger;
    private final PaymentTransactionRepository transactions;
    private final Clock clock;

    public LedgerReconciliation(
            LedgerReader ledger, PaymentTransactionRepository transactions, Clock clock) {
        this.ledger = ledger;
        this.transactions = transactions;
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
        findings.addAll(disagreementsWithPayments(balances, settled));

        return new ReconciliationReport(
                clock.instant().truncatedTo(ChronoUnit.MICROS),
                balances.size(),
                List.copyOf(findings));
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
     * <p>The platform's five singletons are all money it holds or has disbursed, so each is
     * non-negative. A creator's account is the claim they have on the platform, recorded as a
     * credit, so it is non-positive — a positive one is money paid beyond what was earned.
     */
    private static List<ReconciliationFinding> impossibleSigns(List<LedgerBalance> balances) {
        List<ReconciliationFinding> findings = new ArrayList<>();

        for (LedgerBalance balance : balances) {
            boolean creator = balance.account().startsWith("creator:");
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
     * <p>{@code escrow + psp_fee == charges − payouts − refunds}. Escrow is debited by every
     * collection and credited by every payout, refund and provider fee; {@code psp_fee} is the
     * only one of those four with no transaction row behind it, because a chargeback's fee is
     * taken from the platform's balance rather than from a backer's card. Adding it back to
     * escrow puts both sides in the same terms.
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
                    || balance.account().equals(LedgerAccount.PSP_FEE.name())) {
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
