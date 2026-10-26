package az.ideanest.ledger.application;

import az.ideanest.ledger.domain.LedgerEntry;
import az.ideanest.ledger.infrastructure.LedgerEntryRepository;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §4.11's AD-05 ledger explorer, read — #305.
 *
 * <p>{@link Ledger} writes and this reads, and the split is the same one {@link
 * az.ideanest.audit.AuditLog} and {@code AuditTrail} make: the writing side is called by
 * every collection run and has one method that must be impossible to misuse, and the
 * reading side is called by one screen and pages. Putting the page query on {@code Ledger}
 * would mean the class that must refuse an unbalanced posting also carries a cursor.
 *
 * <p><strong>Two queries per page, and the second one is the point.</strong> The first
 * pages over postings; the second loads every entry of the postings it named, including
 * the entries the filter did not match. A ledger that showed you the escrow side of a
 * posting because you filtered on escrow would be showing half a double entry — see
 * {@link LedgerScope}.
 *
 * <p><strong>No authorisation and no audit row here</strong>, for {@code PaymentLog}'s
 * reason: the module that owns the table publishes the read, and
 * {@code admin.application.LedgerService} decides who may take it and records that they
 * did.
 */
@Service
public class LedgerReader {

    private final LedgerEntryRepository entries;

    public LedgerReader(LedgerEntryRepository entries) {
        this.entries = entries;
    }

    /**
     * One page of postings, newest first, with the standing balances behind them.
     *
     * @param scope the account and campaign filters, either or both absent
     * @param before the previous page's {@code nextCursor}, or null for the first page
     * @param limit how many <strong>postings</strong>, already clamped by the caller. Not
     *     how many entries: the page is a page of postings, and a posting is at least two
     *     rows and occasionally five
     */
    @Transactional(readOnly = true)
    public LedgerView page(LedgerScope scope, Long before, int limit) {
        List<PostingHead> heads = headsFor(scope, before, limit);
        List<LedgerPosting> postings = heads.isEmpty() ? List.of() : postingsOf(heads);

        // The cursor comes from the heads, which are what the query walked. Every filter is
        // applied in SQL, so each head is a posting on the page and a full page of heads is
        // a full page of postings.
        Long nextCursor = heads.size() < limit ? null : heads.get(heads.size() - 1).lastEntryId();
        return new LedgerView(scope, postings, nextCursor, balancesFor(scope));
    }

    /**
     * Every account's position on one campaign — issue #99.
     *
     * <p>The same rows {@link #page} puts under the explorer, without the postings above them.
     * §4.7's CD-16 shows a creator what came in and what came off it, and publishing the
     * balances beside those figures is what makes them checkable rather than asserted: a
     * summary a creator cannot reconcile against anything is a number they have to take on
     * trust, and this is the one screen where that is not good enough.
     *
     * <p>Grouped by currency and never summed across it, for §21.2's reason — so a campaign
     * that somehow held two would answer with two rows for one account rather than with a
     * total that means nothing.
     */
    @Transactional(readOnly = true)
    public List<LedgerBalance> balancesOf(UUID projectId) {
        return entries.balancesOfProject(projectId).stream().map(LedgerBalance::of).toList();
    }

    /**
     * Every account's position across the platform — §8.4's {@code ledger-reconciliation},
     * issue #70.
     *
     * <p>One aggregate over the whole table, which is what makes a daily check affordable as
     * that table grows. §22.1's regulatory position is argued from the escrow figure this
     * returns, and {@code LedgerReconciliation} is what checks the rest of it adds up.
     *
     * <p>Grouped by currency and never summed across it, for §21.2's reason.
     */
    @Transactional(readOnly = true)
    public List<LedgerBalance> balances() {
        return entries.balances().stream().map(LedgerBalance::of).toList();
    }

    /**
     * The campaigns on which these accounts, summed, are below zero — #587's per-campaign escrow check.
     *
     * <p>Grouped by campaign and currency, and never summed across currencies, for §21.2's reason.
     */
    @Transactional(readOnly = true)
    public List<ProjectTotal> projectsBelowZero(Collection<LedgerAccount> accounts) {
        return entries.projectsBelowZero(accounts.stream().map(LedgerAccount::name).toList());
    }

    private List<PostingHead> headsFor(LedgerScope scope, Long before, int limit) {
        PageRequest page = PageRequest.ofSize(limit);
        if (scope.account() != null && scope.projectId() != null) {
            String account = scope.account().name();
            return before == null
                    ? entries.newestPostingsOfAccountOnProject(account, scope.projectId(), page)
                    : entries.newestPostingsOfAccountOnProjectBefore(account, scope.projectId(), before, page);
        }
        if (scope.account() != null) {
            String account = scope.account().name();
            return before == null
                    ? entries.newestPostingsOfAccount(account, page)
                    : entries.newestPostingsOfAccountBefore(account, before, page);
        }
        if (scope.projectId() != null) {
            return before == null
                    ? entries.newestPostingsOfProject(scope.projectId(), page)
                    : entries.newestPostingsOfProjectBefore(scope.projectId(), before, page);
        }
        return before == null ? entries.newestPostings(page) : entries.newestPostingsBefore(before, page);
    }

    /**
     * The postings behind these heads, whole.
     *
     * <p>Grouped in Java rather than ordered by the database into runs, because the entries
     * come back in one flat list and a posting is defined by its transaction rather than by
     * its position in that list. A {@link LinkedHashMap} keeps the order the heads
     * established, which is the order the screen renders in — a {@code HashMap} here would
     * shuffle the page on every request.
     */
    private List<LedgerPosting> postingsOf(List<PostingHead> heads) {
        List<UUID> transactionIds = heads.stream().map(PostingHead::transactionId).toList();

        Map<UUID, List<LedgerEntry>> byTransaction = new LinkedHashMap<>();
        for (UUID transactionId : transactionIds) {
            byTransaction.put(transactionId, new java.util.ArrayList<>());
        }
        for (LedgerEntry entry : entries.entriesOf(transactionIds)) {
            byTransaction.get(entry.getTransactionId()).add(entry);
        }

        return byTransaction.values().stream()
                .filter(lines -> !lines.isEmpty())
                .map(LedgerReader::postingOf)
                .toList();
    }

    private static LedgerPosting postingOf(List<LedgerEntry> lines) {
        LedgerEntry first = lines.getFirst();
        List<LedgerPosting.Line> sides = lines.stream()
                .map(entry -> new LedgerPosting.Line(
                        entry.getAccount().name(), entry.getDirection(), entry.getAmount()))
                .toList();

        return new LedgerPosting(
                first.getTransactionId(), first.getProjectId(), first.getCreatedAt(), sides, balances(lines));
    }

    /**
     * Whether the debits equal the credits, computed rather than assumed.
     *
     * <p>V41's deferred constraint trigger already refuses a posting that does not balance,
     * so this can only ever be true — which is exactly why it is worth computing. The one
     * way a false could reach a screen is a row that arrived past the application and past
     * the trigger, and that is the day somebody needs to see it rather than be reassured.
     *
     * <p>Summed per currency, because a posting mixing two of them would balance in neither
     * and §21.2 has no rate at which they add up.
     */
    private static boolean balances(List<LedgerEntry> lines) {
        Map<String, BigDecimal> nets = new LinkedHashMap<>();
        for (LedgerEntry entry : lines) {
            Money signed = entry.getSignedAmount();
            nets.merge(signed.currency(), signed.amount(), BigDecimal::add);
        }
        return nets.values().stream().allMatch(net -> net.signum() == 0);
    }

    private List<LedgerBalance> balancesFor(LedgerScope scope) {
        List<AccountTotal> totals =
                scope.projectId() == null ? entries.balances() : entries.balancesOfProject(scope.projectId());
        return totals.stream().map(LedgerBalance::of).toList();
    }
}
