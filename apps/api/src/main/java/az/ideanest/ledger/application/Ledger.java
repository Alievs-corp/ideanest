package az.ideanest.ledger.application;

import az.ideanest.ledger.domain.LedgerEntry;
import az.ideanest.ledger.infrastructure.LedgerEntryRepository;
import az.ideanest.shared.money.Money;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * §7.2's double entry, as the one door into it (#62).
 *
 * <p><strong>Every movement of money on the platform is written here, and only
 * here.</strong> §9.5's diagram has five destinations and four more issues to come —
 * refunds, chargebacks, payouts, tax — and the value of this class is that each of
 * them arrives as a {@link Posting} that has already been proved to balance rather
 * than as a pair of inserts somebody hopes agree.
 *
 * <h2>{@code MANDATORY}, and why that is the whole design</h2>
 *
 * <p>{@link Propagation#MANDATORY} means this method refuses to run outside a
 * transaction somebody else started, which is the same choice {@code Outbox#record}
 * and the audit writer make, for a reason that is sharper here than for either.
 *
 * <p>A ledger posting is never the whole of what happened. It always accompanies
 * something else — a {@code transactions} row, a pledge moving to
 * {@code COLLECTED}, a payout being marked paid — and the two must be one commit.
 * A posting that committed on its own would be money moved against a charge nobody
 * recorded; a charge that committed on its own would be a collection that never
 * reached the creator's balance. Starting a transaction here, or joining whatever
 * happened to be open, would let either through quietly. Refusing says the
 * requirement out loud, at the first call site that forgets it, in a test rather
 * than in production.
 *
 * <h2>What this does not do</h2>
 *
 * <p><strong>It does not decide anything.</strong> It does not know what a fee is,
 * which account a collection credits, or what a refund reverses. Those are the
 * business decisions of the modules that own them — {@code CollectionPosting} makes
 * §9.5's split — and a ledger that also decided them would be a ledger nobody could
 * change the fee schedule without editing.
 *
 * <p><strong>It does not reverse anything.</strong> There is no {@code void} and no
 * {@code correct}. A correction is a new posting with the directions swapped, made by
 * whoever decided the correction was needed, and it is a separate transaction row
 * because it is a separate fact.
 */
@Service
public class Ledger {

    private static final Logger log = LoggerFactory.getLogger(Ledger.class);

    private final LedgerEntryRepository entries;

    public Ledger(LedgerEntryRepository entries) {
        this.entries = entries;
    }

    /**
     * Writes a posting, in the caller's transaction.
     *
     * <p>Flushed rather than merely queued, for {@code Outbox#record}'s reason and one
     * of its own: V41's balance trigger is deferred to commit, so an unbalanced posting
     * would otherwise fail at a commit whose stack names nothing the author wrote.
     * {@link Posting} has already refused an imbalance in Java — this flush is what
     * makes the database's other refusals, the account pattern and the positive-amount
     * check, land at the line that caused them too.
     *
     * @param posting a balanced set of lines. It cannot be anything else: the type
     *     refuses to be constructed otherwise
     * @return the entries as written, in the posting's own order, so that a caller can
     *     log what it recorded without reading it back
     * @throws DuplicatePostingException when something has already been posted against
     *     this transaction
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<LedgerEntry> post(Posting posting) {
        // Not merely defensive. `transactions.idempotency_key` stops the same *provider
        // call* being recorded twice; nothing else stops a caller posting twice against
        // one transaction row it is already holding, and the result would be a campaign
        // whose escrow is double what was collected -- balanced, and wrong.
        if (entries.existsByTransactionId(posting.transactionId())) {
            throw new DuplicatePostingException(posting.transactionId());
        }

        List<LedgerEntry> written = entries.saveAllAndFlush(LedgerEntry.allOf(posting));

        // The transaction and the line count, and deliberately no amounts. §18.1 keeps
        // money out of the log stream: what a campaign collected belongs in the ledger,
        // which is queryable and access-controlled, rather than in a log aggregator that
        // is neither.
        log.debug(
                "Posted {} ledger entries against transaction {} on campaign {}.",
                written.size(),
                posting.transactionId(),
                posting.projectId());
        return written;
    }

    /**
     * What one account holds on one campaign.
     *
     * <p>Read-only and outside any particular transaction, because it is a report. The
     * payout run does <em>not</em> use this to decide what to pay: it reads the same
     * numbers under a lock inside the transaction that pays, because a balance read
     * before a decision is a balance that can move before the decision lands.
     *
     * @param currency the campaign's currency. Required rather than inferred, because
     *     §21.2 has no rate at which two currencies add up and an account holding both
     *     has two balances rather than one
     */
    @Transactional(readOnly = true)
    public Money balanceOf(LedgerAccount account, UUID projectId, String currency) {
        return Money.of(entries.balanceOf(account.name(), projectId, currency), currency);
    }

    /**
     * What one account holds across the platform, in one currency.
     *
     * <p>§8.4's {@code ledger-reconciliation} (#70) is what will compare this against a
     * provider's settlement report, and §22.1's regulatory position is argued from the
     * escrow figure. Nothing reads it yet.
     */
    @Transactional(readOnly = true)
    public Money balanceOf(LedgerAccount account, String currency) {
        return Money.of(entries.balanceOf(account.name(), currency), currency);
    }

    /**
     * What one posting debited to one account, in one currency; zero when it has no such line.
     *
     * <p>#436: a failed campaign's refund keeps back the provider's fee that the charge's own posting
     * debited to {@code psp_fee} (#427), the figure in the books rather than a rate applied again.
     */
    @Transactional(readOnly = true)
    public Money debitedTo(UUID transactionId, LedgerAccount account, String currency) {
        Money debited = Money.zero(currency);
        for (LedgerEntry entry : entries.findByTransactionIdOrderByIdAsc(transactionId)) {
            if (entry.getAccount().equals(account)
                    && entry.getDirection() == EntryDirection.DEBIT
                    && entry.getAmount().currency().equals(currency)) {
                debited = debited.plus(entry.getAmount());
            }
        }
        return debited;
    }

    /** Every entry of one posting, in the order they were written. For support and for tests. */
    @Transactional(readOnly = true)
    public List<LedgerEntry> entriesOf(UUID transactionId) {
        return entries.findByTransactionIdOrderByIdAsc(transactionId);
    }
}
