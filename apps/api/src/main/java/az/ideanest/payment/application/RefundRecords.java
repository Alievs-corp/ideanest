package az.ideanest.payment.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.application.BankRefundRefusedException.Reason;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundBankTransfer;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.RefundState;
import az.ideanest.payment.infrastructure.DisputeRepository;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.infrastructure.RefundBankTransferRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.pledge.application.PledgeRefunds;
import az.ideanest.shared.money.CurrencyMismatchException;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * The two database halves of a refund, each in its own transaction — #67.
 *
 * <h2>Why this is a separate bean and not three methods on {@code RefundService}</h2>
 *
 * <p>Because {@code @Transactional} is applied by a proxy, and a proxy is only in the way
 * when a call arrives from outside. {@code RefundService.issue} calling its own
 * {@code @Transactional} method would run it on {@code this}, the annotation would do
 * nothing at all, and the refund would be recorded with no transaction and no error —
 * which is the worst shape a defect can have on this code path, because it works in every
 * test that does not kill the process at the right moment.
 *
 * <p>So the boundary is a bean boundary. {@code RefundService} orchestrates and calls
 * across; the commits happen here.
 *
 * <p>Every method is package-private except by necessity: nothing outside this package has
 * any business writing a refund without going through the overdraft check and the
 * idempotency replay that {@code RefundService} performs around them.
 */
@Service
public class RefundRecords {

    private static final Logger log = LoggerFactory.getLogger(RefundRecords.class);

    /**
     * The zone a bank transfer's value date is reckoned in — #400. The bank and the console both
     * date a transfer in Baku, and {@code PayoutService} checks a payout's transfer date the same
     * way; in UTC, a transfer recorded between midnight and four in the morning in Baku would be
     * refused as dated in the future.
     */
    private static final ZoneId BANK_ZONE = ZoneId.of("Asia/Baku");

    /** The key a refund routed to a bank transfer by hand is recorded under, followed by the refused one's id. */
    static final String BANK_REFUND_KEY_PREFIX = "bank-refund:";

    /** The key a lost chargeback's refund row is recorded under, followed by the dispute's id — #175. */
    static final String CHARGEBACK_KEY_PREFIX = "chargeback-";

    private final RefundRepository refunds;
    private final PaymentTransactionRepository transactions;
    private final Ledger ledger;
    private final PledgeRefunds pledges;
    private final AuditLog audit;
    private final Clock clock;
    private final RefundBankTransferRepository bankTransfers;
    private final DisputeRepository disputes;
    private final Outbox outbox;
    private final ObjectMapper json;
    private final RefundTerms terms;

    public RefundRecords(
            RefundRepository refunds,
            PaymentTransactionRepository transactions,
            Ledger ledger,
            PledgeRefunds pledges,
            AuditLog audit,
            Clock clock,
            RefundBankTransferRepository bankTransfers,
            DisputeRepository disputes,
            Outbox outbox,
            ObjectMapper json,
            RefundTerms terms) {
        this.refunds = refunds;
        this.transactions = transactions;
        this.ledger = ledger;
        this.pledges = pledges;
        this.audit = audit;
        this.clock = clock;
        this.bankTransfers = bankTransfers;
        this.disputes = disputes;
        this.outbox = outbox;
        this.json = json;
        this.terms = terms;
    }

    /**
     * Step one: the intent, committed before anybody calls a provider.
     *
     * <p>The overdraft check and the insert are in this transaction together, under the pledge's row
     * lock ({@link PledgeRefunds#lock}). Two members of staff each issuing a full refund in the same
     * second would otherwise both read a zero, and the platform would return twice what it took.
     *
     * <p><strong>One refund reverses one charge (#171).</strong> A provider refunds a payment it
     * took, up to what that payment was, and a raised pledge was paid for in more than one payment.
     * So a refund is recorded as one part per charge it draws on, newest charge first, each for no
     * more than that charge has left: with no amount, every charge's whole remainder; with an amount,
     * up to what the pledge has left in all, split across its charges. The first part carries the
     * caller's idempotency key and the others keys derived from it ({@link #partKey}).
     *
     * <p>A charge that paid for a raise which could not be applied is drawn on <strong>last</strong>
     * (#174's review). It is owed back already, and the platform refunds it on its own; a staff refund
     * of an amount that took it first would leave the backer short by that much, because the
     * platform's refund would then find nothing left of it.
     *
     * <p><strong>Net of the provider's fee for a campaign's reasons, whoever issues it (#436).</strong> A
     * member of staff refunding under {@code CAMPAIGN_FAILED} or {@code CAMPAIGN_HALTED} keeps back the same
     * fee the platform's own refund would ({@link RefundTerms}), so what a backer gets back does not depend
     * on who pressed the button. The fee is kept back once per charge — on the first part that draws on it
     * — and what the pledge has left is counted without it, so a refund of "the rest" is the net rest and a
     * figure above it is refused. Every other reason returns the charge's whole remainder, as before.
     *
     * <p><strong>Not while the charge is in an open chargeback.</strong> The network may return that money
     * itself; a provider refund beside it pays the backer twice. Refused with {@code REFUND_CHARGE_DISPUTED},
     * as a bank transfer already is ({@link #settleByBankTransfer}).
     *
     * @return the parts, newest charge first; never empty
     * @throws NothingToRefundException when the pledge has no settled charge
     * @throws RefundExceedsCollectionException when this would return more than the pledge has left
     * @throws CurrencyMismatchException when {@code amount} is not in the pledge's currency
     * @throws BankRefundRefusedException {@code REFUND_CHARGE_DISPUTED} when a charge it draws on is disputed
     */
    @Transactional
    List<Refund> record(
            UUID staffId, UUID pledgeId, Money amount, RefundReason reason, String detail, String idempotencyKey) {

        pledges.lock(pledgeId);
        List<PaymentTransaction> charges = transactions.settledChargesOf(pledgeId);
        if (charges.isEmpty()) {
            throw new NothingToRefundException(pledgeId);
        }

        String currency = charges.getFirst().getAmount().currency();
        if (amount != null && !amount.currency().equals(currency)) {
            // Said in the pledge's terms: `expected` is the currency a refund of it must be in.
            throw new CurrencyMismatchException(currency, amount.currency());
        }
        List<Draw> draws = drawsOn(pledgeId, reason, charges);
        Money remaining = remainingFor(pledgeId, currency, draws);
        Money requested = amount == null ? remaining : amount;
        if (!requested.isPositive() || requested.isGreaterThan(remaining)) {
            throw new RefundExceedsCollectionException(pledgeId, requested, remaining);
        }
        // "Meant to be the whole thing" (V53): the rest of the pledge, on every part of it.
        boolean full = requested.equals(remaining);

        List<Refund> parts = new ArrayList<>();
        Money unassigned = requested;
        for (Draw draw : draws) {
            if (!unassigned.isPositive()) {
                break;
            }
            if (!draw.left().isPositive()) {
                continue;
            }
            PaymentTransaction charge = draw.charge();
            if (disputes.openOnCharge(charge.getId())) {
                throw new BankRefundRefusedException(Reason.REFUND_CHARGE_DISPUTED, pledgeId);
            }
            Money part = draw.left().min(unassigned);
            String key = parts.isEmpty() ? idempotencyKey : partKey(idempotencyKey, parts.size() + 1);
            Refund refund = refunds.save(Refund.requested(
                    pledgeId, charge.getProjectId(), charge.getId(), part, draw.withheld(), full, reason, detail, staffId, key));
            audit.record(
                    AuditAction.REFUND_ISSUED,
                    refund.id(),
                    AuditActor.moderator(staffId),
                    AuditOutcome.SUCCEEDED,
                    "pledge=%s; charge=%s; amount=%s; withheldFee=%s; reason=%s; full=%s"
                            .formatted(pledgeId, charge.getId(), part, draw.withheld(), reason, full));
            parts.add(refund);
            unassigned = unassigned.minus(part);
        }
        if (unassigned.isPositive()) {
            // The pledge's remainder is never more than its charges' remainders added up: every refund
            // counted against the pledge is counted against one of its charges too. Rolled back rather
            // than sent short.
            throw new IllegalStateException("Pledge " + pledgeId + " has " + remaining
                    + " left and its charges only " + requested.minus(unassigned));
        }
        return parts;
    }

    /**
     * What a refund of this pledge for this reason could return now, without recording anything — the
     * console's confirmation (#8 of the money console's audit): it names the pledge's currency and, for a
     * refund of "the rest", the figure, before anybody presses the button that sends it.
     *
     * <p>{@link #record}'s own arithmetic, so the two cannot disagree; read without the pledge's lock,
     * because it decides nothing — {@link #record} checks again under the lock.
     *
     * @throws NothingToRefundException when the pledge has no settled charge
     */
    @Transactional(readOnly = true)
    Refundable refundable(UUID pledgeId, RefundReason reason) {
        List<PaymentTransaction> charges = transactions.settledChargesOf(pledgeId);
        if (charges.isEmpty()) {
            throw new NothingToRefundException(pledgeId);
        }
        String currency = charges.getFirst().getAmount().currency();
        List<Draw> draws = drawsOn(pledgeId, reason, charges);
        Money withheld = Money.zero(currency);
        for (Draw draw : draws) {
            if (draw.left().isPositive()) {
                withheld = withheld.plus(draw.withheld());
            }
        }
        Money remaining = remainingFor(pledgeId, currency, draws).max(Money.zero(currency));
        return new Refundable(
                remaining, withheld, charges.getFirst().getProjectId(), pledges.backerOf(pledgeId).orElse(null));
    }

    /**
     * What a pledge could have refunded, and what a refund of all of it would keep back.
     *
     * @param remaining what would be sent, net of {@code withheldFee}
     * @param withheldFee the provider's fee a campaign's reason keeps back (#436); zero for any other
     * @param projectId the pledge's campaign, so the confirmation can name it
     * @param backerId whose money it is, so the confirmation can name them; null when the pledge has none
     */
    public record Refundable(Money remaining, Money withheldFee, UUID projectId, UUID backerId) {
    }

    /**
     * One charge a refund may draw on: what it has left to send, and the provider fee a refund of it keeps
     * back first (#436) — zero unless the reason is a campaign's and the charge was taken under the rule.
     */
    private record Draw(PaymentTransaction charge, Money left, Money withheld) {
    }

    /**
     * The pledge's charges in the order a refund draws on them, each with what it has left.
     *
     * <p>A charge that paid for a raise which could not be applied is drawn on <strong>last</strong> (#174's
     * review) — see {@link #record}. The fee a campaign's reason keeps back is the one posted with the charge,
     * less what a refund not failed has already kept back of it, and comes off what the charge has left.
     */
    private List<Draw> drawsOn(UUID pledgeId, RefundReason reason, List<PaymentTransaction> charges) {
        Set<String> owedBack = Set.copyOf(transactions.unappliedRaiseChargesOf(pledgeId));
        List<PaymentTransaction> ordered = new ArrayList<>(charges);
        // Stable: newest first within each group, the pledge's own money before money owed back.
        ordered.sort(Comparator.comparing(charge -> owedBack.contains(charge.getId().toString())));

        List<Draw> draws = new ArrayList<>();
        for (PaymentTransaction charge : ordered) {
            String currency = charge.getAmount().currency();
            Money onCharge = remainingOnCharge(charge);
            Money withheld = terms.withheldOn(charge, reason)
                    .minus(Money.of(refunds.withheldAgainstCharge(charge.getId()), currency))
                    .max(Money.zero(currency))
                    // Never more than the charge has left: a fee larger than the rest leaves nothing to send.
                    .min(onCharge.max(Money.zero(currency)));
            draws.add(new Draw(charge, onCharge.minus(withheld), withheld));
        }
        return draws;
    }

    /**
     * What the pledge has left to send for this reason: everything it was charged less every refund not
     * failed, less the fee a campaign's reason keeps back of each charge. For any other reason exactly what
     * {@link #remainingOn} says, as before #436 reached staff refunds.
     */
    private Money remainingFor(UUID pledgeId, String currency, List<Draw> draws) {
        Money remaining = remainingOn(pledgeId, currency);
        for (Draw draw : draws) {
            remaining = remaining.minus(draw.withheld());
        }
        return remaining;
    }

    /**
     * The idempotency key of the {@code n}th part of a refund, derived from the caller's key so a replay
     * finds every part.
     *
     * <p>A name-based UUID of the key and the part's number, not the key with a suffix (#174's review):
     * "key#2" is a key somebody else may have sent, and truncating a long key to fit V53's 200
     * characters made two different keys derive the same one. Of a fixed length, and different for
     * every key and part: the number is last, after a separator no number contains.
     */
    static String partKey(String idempotencyKey, int n) {
        byte[] name = (idempotencyKey + "|part|" + n).getBytes(StandardCharsets.UTF_8);
        return "refund-part-" + UUID.nameUUIDFromBytes(name);
    }

    /**
     * IDN-EXT-01 (#40): the platform refunds what one settled charge has left, because its campaign
     * failed or was halted, or because it paid for a raise that could not be applied (#171). No member
     * of staff asked, so there is no author and no capability check; the reason is the author, and the
     * audit row says the system acted.
     *
     * <p><strong>Per charge, since #171.</strong> A raised pledge was paid for twice or more, and each
     * payment is reversed on its own, against its own provider transaction and for no more than it has
     * left. Whether the pledge is refunded in full is not decided here: a requested refund may fail, so
     * {@link #settleSuccess} decides it from what has actually gone back.
     *
     * <p><strong>Net of the provider's fee, for a charge taken under that rule (#436).</strong> A failed
     * or halted campaign's refund of such a charge keeps back the fee posted with it ({@link RefundTerms})
     * — less any of it a refund not failed has already kept back — and records it as the refund's
     * {@code withheld_fee}; what is sent is the rest of what the charge has left. A charge refunded in
     * part by staff beforehand is refunded the rest less the fee, and nothing when the fee is more than
     * what is left. {@code RefundRepository#owedPlatformRefunds} offers a charge on the same arithmetic.
     *
     * @return empty when nothing of this charge remains to refund
     */
    @Transactional
    Optional<Refund> recordForCharge(UUID chargeId, RefundReason reason, String idempotencyKey) {
        Optional<PaymentTransaction> found = transactions.findById(chargeId);
        if (found.isEmpty()) {
            return Optional.empty();
        }
        PaymentTransaction charge = found.get();
        UUID pledgeId = charge.getPledgeId();
        // Locked before what is left is read, so a staff refund recorded at the same moment is either
        // counted here or counts this one.
        pledges.lock(pledgeId);
        String currency = charge.getAmount().currency();
        // #436: the part of the charge's provider fee no refund has kept back yet; zero unless the charge
        // was taken under the net rule and this is a campaign's outcome.
        Money withheld = terms.withheldOn(charge, reason)
                .minus(Money.of(refunds.withheldAgainstCharge(charge.getId()), currency))
                .max(Money.zero(currency));
        Money left = remainingOnCharge(charge).minus(withheld);
        if (!left.isPositive()) {
            return Optional.empty();
        }

        Refund refund = refunds.save(Refund.requested(
                pledgeId,
                charge.getProjectId(),
                charge.getId(),
                left,
                withheld,
                // A campaign refund is meant to return everything it owes (§9.7); a raise's, only the raise.
                reason != RefundReason.RAISE_NOT_APPLIED,
                reason,
                detailOf(reason, withheld),
                null,
                idempotencyKey));
        audit.record(
                AuditAction.REFUND_ISSUED,
                refund.id(),
                AuditActor.system(),
                AuditOutcome.SUCCEEDED,
                "pledge=%s; charge=%s; amount=%s; withheldFee=%s; reason=%s; full=%s"
                        .formatted(pledgeId, chargeId, left, withheld, reason, refund.fullRefund()));
        return Optional.of(refund);
    }

    /** The sentence on a refund the platform issued itself — the console's "why". */
    private static String detailOf(RefundReason reason, Money withheld) {
        String outcome = switch (reason) {
            case CAMPAIGN_FAILED -> "The campaign ended below its success threshold";
            case RAISE_NOT_APPLIED -> null;
            default -> "The campaign was suspended or cancelled";
        };
        if (outcome == null) {
            return "The backer paid to raise their pledge and the raise could not be applied.";
        }
        return withheld.isPositive()
                ? outcome + "; the backer is refunded less the payment provider's fee of " + withheld + "."
                : outcome + "; the backer is refunded in full.";
    }

    /** What a pledge has left to refund: everything it was charged, less every refund not failed. */
    private Money remainingOn(UUID pledgeId, String currency) {
        return Money.of(transactions.collectedOn(pledgeId), currency)
                .minus(Money.of(refunds.refundedAgainst(pledgeId), currency));
    }

    /** What one charge has left to refund. */
    private Money remainingOnCharge(PaymentTransaction charge) {
        return charge.getAmount().minus(Money.of(refunds.refundedAgainstCharge(charge.getId()), charge.getAmount().currency()));
    }

    /**
     * Step three: the transaction row, the ledger posting and the state, in one commit.
     *
     * <p>All three or none. A {@code transactions} row without its posting is money that
     * moved and does not appear in the books; a posting without the row is the reverse.
     *
     * <p><strong>Escrow is credited and {@code refunds} is debited, and the fees are not
     * reversed.</strong> The processor keeps its fee on a refunded charge, and whether the
     * platform keeps its own is a policy question §9.7 does not settle — inventing it here
     * would mean a payment adapter deciding the platform's revenue. What the ledger says
     * instead is true and narrow: this much went back to a backer.
     *
     * <p><strong>The pledge is refunded in full when this leaves nothing (#171)</strong>: under its
     * row lock, everything it was charged less every refund that has succeeded is zero. Decided here
     * and nowhere else, because only a settled refund has certainly returned money: a refund recorded
     * as "the last one" may fail, and a raise paid for after it was recorded would leave money behind.
     * The pledge then moves to {@code REFUNDED} and its whole total leaves the campaign's figures, in
     * this transaction.
     */
    @Transactional
    Refund settleSuccess(Refund refund, PaymentTransaction charge, RefundResult result) {
        pledges.lock(refund.pledgeId());
        Refund current = refunds.findById(refund.id()).orElseThrow();
        if (current.state() != RefundState.REQUESTED) {
            // Settled already: a reconciliation and a late answer both arriving. Nothing moves twice.
            return current;
        }
        // A reversal the provider gave no identifier of its own — Epoint's /reverse gives none — is
        // recorded without one rather than under the charge's. V41 allows one settled row per
        // provider transaction, and the charge already is that row; the refund reaches its charge
        // through refunds.charge_transaction_id instead (IDN-EXT-01, #40).
        RefundResult stored = result.providerTransactionId() != null
                        && result.providerTransactionId().equals(charge.getProviderTransactionId())
                ? new RefundResult(result.outcome(), null, result.failureCode(), result.failureMessage(), result.rawResponse())
                : result;
        return settle(current, charge.getProvider(), stored, refund.idempotencyKey(), Money.zero(refund.amount().currency()));
    }

    /**
     * What {@link #settleSuccess} and {@link #settleByBankTransfer} share: the transaction row, the ledger
     * posting, the state and the pledge, under the lock the caller took.
     */
    private Refund settle(Refund current, ProviderName provider, RefundResult stored, String transactionKey, Money bankFee) {
        Refund refund = current;
        PaymentTransaction recorded = transactions.save(PaymentTransaction.refund(
                refund.pledgeId(),
                refund.projectId(),
                refund.amount(),
                provider,
                stored,
                transactionKey));

        ledger.post(Posting.of(recorded.getId(), refund.projectId())
                .debit(LedgerAccount.REFUNDS, refund.amount())
                .credit(LedgerAccount.ESCROW, refund.amount())
                .debitIfAny(LedgerAccount.PLATFORM_EXPENSE, bankFee)
                .creditIfAny(LedgerAccount.ESCROW, bankFee)
                .build());

        current.succeeded(recorded.getId(), clock.instant().truncatedTo(ChronoUnit.MICROS));
        Refund settled = refunds.saveAndFlush(current);

        // IDN-EXT-01 (#40): a pledge refunded in full is REFUNDED and leaves its campaign's totals, in
        // this transaction; a partial refund leaves it standing. Since #171 "in full" is what has gone
        // back, read under the pledge's lock taken above, and not what this refund was meant to be.
        String currency = refund.amount().currency();
        Money collected = Money.of(transactions.collectedOn(refund.pledgeId()), currency);
        Money returned = Money.of(refunds.succeededAgainst(refund.pledgeId()), currency);
        if (collected.isPositive() && !collected.isGreaterThan(returned)) {
            pledges.recordRefunded(refund.pledgeId());
        }

        log.info("Refund {} of {} settled on pledge {}", refund.id(), refund.amount(), refund.pledgeId());
        return settled;
    }

    /**
     * The provider will not carry this refund out, so it waits for the backer's bank account — #399.
     *
     * <p>No provider call, no transaction and no posting: nothing has moved. The refund stays counted as
     * gone, so no path sends it again, and the backer is told to contact support — <strong>once per
     * pledge</strong>: a raised pledge's refund is one part per charge, and a backer asked three times for
     * one account would answer three times. Under the pledge's lock, so two parts routed at the same
     * moment cannot both find the other not yet routed.
     *
     * @param why what routed it, for the audit row and the log
     */
    @Transactional
    Refund awaitBankDetails(Refund refund, String why) {
        pledges.lock(refund.pledgeId());
        Refund attached = refunds.findById(refund.id()).orElseThrow();
        if (attached.state() != RefundState.REQUESTED) {
            return attached;
        }
        attached.awaitBankDetails();
        Refund saved = refunds.saveAndFlush(attached);
        announceBankTransfer(saved, AuditActor.system(), why);
        return saved;
    }

    /**
     * Staff route a refund the provider refused to a bank transfer — #399's fallback, for a refusal the
     * adapter could not recognise as "too old".
     *
     * <p>The refused row is terminal and stays as it is; what is owed is a new refund for what its charge
     * still has left, no more than the refused one was for, keyed {@code bank-refund:<refusedId>} so a
     * retried request finds it rather than recording a second.
     *
     * @throws BankRefundRefusedException {@code REFUND_NOT_FAILED} for a refund that was not refused
     * @throws NothingToRefundException when the charge has nothing left — refunded since, or charged back
     */
    @Transactional
    Refund bankRefundFor(UUID staffId, UUID refusedId) {
        Refund refused = refunds.findById(refusedId)
                .orElseThrow(() -> new BankRefundRefusedException(Reason.REFUND_NOT_FOUND, refusedId));
        String key = BANK_REFUND_KEY_PREFIX + refusedId;
        pledges.lock(refused.pledgeId());
        Optional<Refund> earlier = refunds.byIdempotencyKey(key);
        if (earlier.isPresent()) {
            return earlier.get();
        }
        if (refused.state() != RefundState.FAILED
                || "provider_unreachable".equals(refused.failureCode())
                || refused.chargeTransactionId() == null) {
            throw new BankRefundRefusedException(Reason.REFUND_NOT_FAILED, refusedId);
        }
        PaymentTransaction charge = transactions.findById(refused.chargeTransactionId())
                .orElseThrow(() -> new BankRefundRefusedException(Reason.REFUND_NOT_FAILED, refusedId));
        // #436: a campaign refund that kept the provider's fee back keeps it back by bank transfer too, so
        // the backer is owed the same net amount whichever way it goes.
        Money withheld = refused.withheldFee();
        Money left = remainingOnCharge(charge).minus(withheld).min(refused.amount());
        if (!left.isPositive()) {
            throw new NothingToRefundException(refused.pledgeId());
        }
        Refund owed = Refund.requested(
                refused.pledgeId(),
                refused.projectId(),
                charge.getId(),
                left,
                withheld,
                refused.fullRefund(),
                refused.reason(),
                "By bank transfer, after refund " + refusedId + " was refused (" + refused.failureCode() + ").",
                staffId,
                key);
        owed.awaitBankDetails();
        Refund saved = refunds.saveAndFlush(owed);
        audit.record(
                AuditAction.REFUND_ISSUED,
                saved.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "pledge=%s; charge=%s; amount=%s; reason=%s; full=%s; after=%s"
                        .formatted(saved.pledgeId(), charge.getId(), left, saved.reason(), saved.fullRefund(), refusedId));
        announceBankTransfer(saved, AuditActor.moderator(staffId), "refused by the provider as " + refused.failureCode());
        return saved;
    }

    /**
     * The refused refund this one was routed from by hand ({@link #bankRefundFor}), read off its key — so the
     * console can say so in its own words rather than show the sentence written into {@code detail}.
     */
    public static Optional<UUID> routedFrom(Refund refund) {
        return idAfter(refund.idempotencyKey(), BANK_REFUND_KEY_PREFIX);
    }

    /** The dispute a {@code CHARGEBACK} refund row records the loss of, read off its key (#175). */
    public static Optional<UUID> chargebackOf(Refund refund) {
        return refund.reason() == RefundReason.CHARGEBACK
                ? idAfter(refund.idempotencyKey(), CHARGEBACK_KEY_PREFIX)
                : Optional.empty();
    }

    private static Optional<UUID> idAfter(String key, String prefix) {
        if (key == null || !key.startsWith(prefix)) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(key.substring(prefix.length())));
        } catch (IllegalArgumentException notAnId) {
            return Optional.empty();
        }
    }

    /** The audit row, the log line and, once per pledge, the backer's notification. */
    private void announceBankTransfer(Refund refund, AuditActor actor, String why) {
        audit.record(
                AuditAction.REFUND_ROUTED_TO_BANK_TRANSFER,
                refund.id(),
                actor,
                AuditOutcome.SUCCEEDED,
                "pledge=%s; charge=%s; amount=%s; why=%s"
                        .formatted(refund.pledgeId(), refund.chargeTransactionId(), refund.amount(), why));
        log.info("Refund {} of {} on pledge {} waits for a bank transfer: {}", refund.id(), refund.amount(), refund.pledgeId(), why);
        if (refunds.otherAwaitsBankTransfer(refund.pledgeId(), refund.id())) {
            return;
        }
        Optional<UUID> backer = pledges.backerOf(refund.pledgeId());
        if (backer.isEmpty()) {
            log.error("Refund {} waits for a bank transfer and its pledge {} has no backer to ask.", refund.id(), refund.pledgeId());
            return;
        }
        outbox.record(
                RefundNeedsBankDetailsEvent.AGGREGATE_TYPE,
                refund.pledgeId(),
                RefundNeedsBankDetailsEvent.EVENT_TYPE,
                new RefundNeedsBankDetailsEvent(
                        refund.id(),
                        refund.pledgeId(),
                        refund.projectId(),
                        backer.get(),
                        clock.instant().truncatedTo(ChronoUnit.MICROS)));
    }

    /**
     * Finance made the bank transfer that pays this refund — #399.
     *
     * <p>{@link #settleSuccess}'s commit, for money that left from IdeyaNest's own account rather than
     * through a provider: a {@code REFUND} transaction under {@link ProviderName#BANK_TRANSFER} with no
     * provider identifier and the bank's reference in its response, keyed {@code <refund key>-bank}; the
     * same posting, debit {@code refunds} and credit {@code escrow}; and the pledge {@code REFUNDED} when
     * nothing is left on it. Escrow therefore spans two places the money sits, the provider's balance
     * and the bank account, and the ledger reconciliation still balances: it compares the ledger with
     * {@code transactions}, not with either.
     *
     * <p><strong>Idempotent.</strong> A refund already paid under the same reference answers itself; under
     * another reference it is refused, because that is a second transfer recorded against one refund.
     * Refused too, under the pledge's lock: while the charge is in an open chargeback (the network may
     * return the money itself), by the person who recorded the account, and with a bank reference already
     * recorded for another backer's refund.
     *
     * <p>What the bank charged for the transfer is the platform's cost (#401): it leaves escrow for
     * {@code platform_expense} in the same posting and never reduces what the backer gets back.
     */
    @Transactional
    Refund settleByBankTransfer(
            UUID staffId, UUID refundId, String bankReference, LocalDate transferredOn, BigDecimal bankFee) {
        Refund found = refunds.findById(refundId)
                .orElseThrow(() -> new BankRefundRefusedException(Reason.REFUND_NOT_FOUND, refundId));
        pledges.lock(found.pledgeId());
        Refund current = refunds.findById(refundId).orElseThrow();
        String reference = bankReference.trim();
        Optional<RefundBankTransfer> row = bankTransfers.findById(refundId);
        if (current.state() == RefundState.SUCCEEDED
                && row.map(RefundBankTransfer::bankReference).filter(reference::equals).isPresent()) {
            log.info("Bank transfer of refund {} replayed under the reference it was recorded with.", refundId);
            return current;
        }
        if (current.state() != RefundState.AWAITING_TRANSFER || row.isEmpty() || row.get().isTransferred()) {
            throw new BankRefundRefusedException(Reason.REFUND_NOT_AWAITING_TRANSFER, refundId);
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (transferredOn.isAfter(LocalDate.ofInstant(now, BANK_ZONE))) {
            throw new BankRefundRefusedException(Reason.TRANSFER_DATE_IN_FUTURE, refundId);
        }
        if (staffId.equals(row.get().detailsRecordedBy())) {
            throw new BankRefundRefusedException(Reason.REFUND_DUTIES_NOT_SEPARATE, refundId);
        }
        if (current.chargeTransactionId() != null && disputes.openOnCharge(current.chargeTransactionId())) {
            throw new BankRefundRefusedException(Reason.REFUND_CHARGE_DISPUTED, refundId);
        }
        if (bankTransfers.referenceTakenElsewhere(reference, current.pledgeId())) {
            throw new BankRefundRefusedException(Reason.BANK_REFERENCE_TAKEN, refundId);
        }

        Money fee = bankFee == null ? Money.zero(current.amount().currency()) : Money.of(bankFee, current.amount().currency());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("bankReference", reference);
        response.put("transferredOn", transferredOn.toString());
        Refund settled = settle(
                current,
                ProviderName.BANK_TRANSFER,
                new RefundResult(ProviderOutcome.APPROVED, null, null, null, json.writeValueAsString(response)),
                current.idempotencyKey() + "-bank",
                fee);
        RefundBankTransfer paid = row.get();
        paid.transferred(reference, transferredOn, staffId, now);
        bankTransfers.save(paid);
        audit.record(
                AuditAction.REFUND_BANK_TRANSFER_RECORDED,
                refundId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "pledge=%s; amount=%s; account=%s; reference=%s; transferredOn=%s; bankFee=%s"
                        .formatted(current.pledgeId(), current.amount(), paid.ibanHint(), reference, transferredOn, fee));
        announceTransferred(current, paid.ibanHint(), transferredOn, now);
        return settled;
    }

    /**
     * Tells the backer this part of their refund was sent — #418. Per part, because each part is a
     * transfer finance recorded with its own amount; the replay above returns before this line.
     */
    private void announceTransferred(Refund refund, String ibanHint, LocalDate transferredOn, Instant now) {
        Optional<UUID> backer = pledges.backerOf(refund.pledgeId());
        if (backer.isEmpty()) {
            log.error("Refund {} was paid by bank transfer and its pledge {} has no backer to tell.", refund.id(), refund.pledgeId());
            return;
        }
        outbox.record(
                RefundSentByBankEvent.AGGREGATE_TYPE,
                refund.pledgeId(),
                RefundSentByBankEvent.EVENT_TYPE,
                new RefundSentByBankEvent(
                        refund.id(),
                        refund.pledgeId(),
                        refund.projectId(),
                        backer.get(),
                        refund.amount(),
                        transferredOn,
                        ibanHint,
                        now));
    }

    /**
     * Leaves a refund whose outcome cannot be decided to a person — #174's review.
     *
     * <p>It stays {@code REQUESTED}, so it still counts as gone and nothing is sent twice, and the
     * reconciliation stops asking about it. Logged at {@code ERROR}: money may or may not have moved.
     */
    @Transactional
    Refund markForReview(Refund refund, String reason) {
        pledges.lock(refund.pledgeId());
        Refund attached = refunds.findById(refund.id()).orElseThrow();
        if (attached.state() != RefundState.REQUESTED) {
            return attached;
        }
        attached.needsReview(reason);
        log.error("Refund {} of {} on pledge {} needs a person: {}", refund.id(), refund.amount(), refund.pledgeId(), reason);
        return refunds.save(attached);
    }

    /**
     * The other outcome.
     *
     * <p>No {@code transactions} row and no posting, deliberately: nothing moved. The
     * provider's refusal is on the refund row, which is where somebody looking for it will
     * be — a {@code FAILED} transaction row for a refund would appear on the payment log
     * beside real charges and would have to be filtered out of every sum.
     */
    @Transactional
    Refund settleFailure(Refund refund, String failureCode, String failureMessage) {
        pledges.lock(refund.pledgeId());
        Refund attached = refunds.findById(refund.id()).orElseThrow();
        if (attached.state() != RefundState.REQUESTED) {
            return attached;
        }
        attached.failed(failureCode, failureMessage, clock.instant().truncatedTo(ChronoUnit.MICROS));

        log.warn("Refund {} failed on pledge {}: {}", refund.id(), refund.pledgeId(), failureCode);
        return refunds.save(attached);
    }
}
