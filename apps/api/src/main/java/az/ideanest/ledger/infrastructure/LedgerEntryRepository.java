package az.ideanest.ledger.infrastructure;

import az.ideanest.ledger.application.AccountTotal;
import az.ideanest.ledger.application.PostingHead;
import az.ideanest.ledger.application.ProjectTotal;
import az.ideanest.ledger.domain.LedgerEntry;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads and one write: append.
 *
 * <p>There is deliberately no delete, no update, and no {@code saveAndFlush} wrapper
 * that could be mistaken for either. V41 refuses both in PostgreSQL; what this
 * interface adds is that a developer looking for the method does not find one.
 */
public interface LedgerEntryRepository extends JpaRepository<LedgerEntry, Long> {

    /** Every entry of one posting, in the order they were written. */
    List<LedgerEntry> findByTransactionIdOrderByIdAsc(UUID transactionId);

    /**
     * The balance of one account on one campaign, in one currency.
     *
     * <p><strong>A sum over the signed amount, computed by PostgreSQL.</strong> Reading
     * the entries and adding them up in Java would be correct and would also mean
     * loading every collection a campaign ever took in order to answer what a creator
     * is owed — a number a payout screen asks for on every view.
     *
     * <p>Positive means debits exceed credits. For {@link az.ideanest.ledger.application.LedgerAccount#ESCROW}
     * that is money the platform is holding; for a creator's account it is money the
     * platform has already paid out beyond what was earned, which should never be
     * positive and is worth alerting on when it is.
     *
     * <p>{@code COALESCE} rather than a nullable return, because an account with no
     * entries has a balance of nothing rather than no balance — and a null here would
     * be unwrapped into a {@code Money} by the caller, which is where the
     * {@code NullPointerException} would surface instead.
     *
     * @return the net as a plain {@link BigDecimal}; the caller pairs it with the
     *     currency it asked for. See {@code MoneyAmountConverter} for why money crosses
     *     this boundary as two values
     */
    @Query(
            """
            SELECT COALESCE(SUM(CASE WHEN e.direction = az.ideanest.ledger.application.EntryDirection.DEBIT
                                     THEN e.amount ELSE -e.amount END), 0)
            FROM LedgerEntry e
            WHERE e.account = :account AND e.projectId = :projectId AND e.currency = :currency
            """)
    BigDecimal balanceOf(
            @Param("account") String account,
            @Param("projectId") UUID projectId,
            @Param("currency") String currency);

    /**
     * The same, across every campaign: what the account holds in total.
     *
     * <p>The platform-wide read, which is what §8.4's {@code ledger-reconciliation}
     * (#70) compares against a provider's settlement report and what §22.1's regulatory
     * position is argued from. Per currency, because §21.2 has no rate at which two of
     * them add up.
     */
    @Query(
            """
            SELECT COALESCE(SUM(CASE WHEN e.direction = az.ideanest.ledger.application.EntryDirection.DEBIT
                                     THEN e.amount ELSE -e.amount END), 0)
            FROM LedgerEntry e
            WHERE e.account = :account AND e.currency = :currency
            """)
    BigDecimal balanceOf(@Param("account") String account, @Param("currency") String currency);

    /**
     * Whether anything has been posted against this transaction.
     *
     * <p>The guard that makes {@code Ledger#post} refuse a second posting for one
     * transaction. It is not the only guard — {@code transactions.idempotency_key} is
     * unique, so the transaction row itself cannot be written twice — but it is the one
     * that catches a caller reusing a transaction identifier it already used, which the
     * unique key cannot see.
     */
    boolean existsByTransactionId(UUID transactionId);

    /*
     * The eleven below are AD-05's ledger explorer -- #305.
     *
     * The screen shows both sides of every entry together, which is what makes the paging
     * two queries rather than one: the first pages over postings, the second loads every
     * entry of the postings that page named. PostingHead has the argument in full, and the
     * short version is that a page of entries cuts the last posting in half.
     *
     * The second query is also what makes the account filter honest. Narrowing to escrow
     * and rendering only the escrow entries would be showing one side of a double entry
     * and calling it a ledger; the filter decides which postings are interesting and never
     * which half of one is shown.
     */

    /** The newest postings, whatever they were about. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            GROUP BY e.transactionId
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostings(Pageable limit);

    /** The page after {@code before}. Keyset over the posting's own last entry. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            GROUP BY e.transactionId
            HAVING MAX(e.id) < :before
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsBefore(@Param("before") Long before, Pageable limit);

    /** The newest postings that touched one campaign. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            WHERE e.projectId = :projectId
            GROUP BY e.transactionId
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsOfProject(@Param("projectId") UUID projectId, Pageable limit);

    /** The page after {@code before}, within one campaign. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            WHERE e.projectId = :projectId
            GROUP BY e.transactionId
            HAVING MAX(e.id) < :before
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsOfProjectBefore(
            @Param("projectId") UUID projectId, @Param("before") Long before, Pageable limit);

    /**
     * The newest postings that touched one account.
     *
     * <p>Backed by {@code ledger_entries_account_idx}, which leads on {@code account}. One
     * account on one campaign is the pair below, not this one narrowed afterwards.
     */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            WHERE e.account = :account
            GROUP BY e.transactionId
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsOfAccount(@Param("account") String account, Pageable limit);

    /** The page after {@code before}, within one account. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            WHERE e.account = :account
            GROUP BY e.transactionId
            HAVING MAX(e.id) < :before
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsOfAccountBefore(
            @Param("account") String account, @Param("before") Long before, Pageable limit);

    /**
     * The newest postings that touched one account on one campaign.
     *
     * <p>Both filters in SQL. This used to be the account query with the campaign applied
     * in Java to the page it returned, which made a page a page of the account's postings
     * with the other campaigns' removed afterwards: a page could come back short, or empty
     * with a cursor, and the screen read the empty one as "nothing matches" while the
     * campaign's postings sat further down the account.
     */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            WHERE e.account = :account AND e.projectId = :projectId
            GROUP BY e.transactionId
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsOfAccountOnProject(
            @Param("account") String account, @Param("projectId") UUID projectId, Pageable limit);

    /** The page after {@code before}, within one account on one campaign. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.PostingHead(e.transactionId, MAX(e.id))
            FROM LedgerEntry e
            WHERE e.account = :account AND e.projectId = :projectId
            GROUP BY e.transactionId
            HAVING MAX(e.id) < :before
            ORDER BY MAX(e.id) DESC
            """)
    List<PostingHead> newestPostingsOfAccountOnProjectBefore(
            @Param("account") String account,
            @Param("projectId") UUID projectId,
            @Param("before") Long before,
            Pageable limit);

    /**
     * Every entry of these postings, oldest first.
     *
     * <p>One query for the whole page rather than one per posting, which is the argument
     * {@code countOpenByTarget} makes on the report queue: a read whose cost grows with the
     * size of the page is a screen that stops working when there is a lot on it.
     *
     * <p>Callers pass a non-empty list; an empty {@code IN} is not valid SQL, and a caller
     * with no postings already knows the page was empty.
     */
    @Query("SELECT e FROM LedgerEntry e WHERE e.transactionId IN :transactionIds ORDER BY e.id ASC")
    List<LedgerEntry> entriesOf(@Param("transactionIds") List<UUID> transactionIds);

    /**
     * What every account holds, per currency, across the whole platform.
     *
     * <p>The same arithmetic as {@link #balanceOf(String, String)} -- debits positive,
     * credits negative -- asked for every account at once rather than one at a time. The
     * explorer draws six accounts and the platform has at least one currency; twelve round
     * trips for a page header is the version of this that gets written by accident.
     *
     * <p>Grouped by currency and never summed across it, for §21.2's reason: there is no
     * rate at which manat and dollars add up, so a single total would be a number with no
     * meaning that somebody would eventually reconcile against.
     */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.AccountTotal(
                e.account,
                e.currency,
                COALESCE(SUM(CASE WHEN e.direction = az.ideanest.ledger.application.EntryDirection.DEBIT
                                  THEN e.amount ELSE -e.amount END), 0))
            FROM LedgerEntry e
            GROUP BY e.account, e.currency
            ORDER BY e.account, e.currency
            """)
    List<AccountTotal> balances();

    /** The same, for one campaign. */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.AccountTotal(
                e.account,
                e.currency,
                COALESCE(SUM(CASE WHEN e.direction = az.ideanest.ledger.application.EntryDirection.DEBIT
                                  THEN e.amount ELSE -e.amount END), 0))
            FROM LedgerEntry e
            WHERE e.projectId = :projectId
            GROUP BY e.account, e.currency
            ORDER BY e.account, e.currency
            """)
    List<AccountTotal> balancesOfProject(@Param("projectId") UUID projectId);

    /**
     * #587: the campaigns on which these accounts, summed, hold less than nothing — per currency.
     *
     * <p>{@link #balances()} answers for the whole platform, where escrow is one pool and one
     * campaign's shortfall hides behind every other campaign's money. Asked per campaign it
     * shows the campaign that returned or paid out more than it took. Only the negative rows,
     * because the healthy ones are every campaign the platform has ever had and nobody reads them.
     */
    @Query(
            """
            SELECT new az.ideanest.ledger.application.ProjectTotal(
                e.projectId,
                e.currency,
                SUM(CASE WHEN e.direction = az.ideanest.ledger.application.EntryDirection.DEBIT
                         THEN e.amount ELSE -e.amount END))
            FROM LedgerEntry e
            WHERE e.account IN :accounts AND e.projectId IS NOT NULL
            GROUP BY e.projectId, e.currency
            HAVING SUM(CASE WHEN e.direction = az.ideanest.ledger.application.EntryDirection.DEBIT
                            THEN e.amount ELSE -e.amount END) < 0
            ORDER BY e.projectId, e.currency
            """)
    List<ProjectTotal> projectsBelowZero(@Param("accounts") Collection<String> accounts);
}
