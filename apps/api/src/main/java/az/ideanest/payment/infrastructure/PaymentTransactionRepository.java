package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.TransactionStatus;
import az.ideanest.payment.domain.TransactionType;
import java.util.Collection;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Provider calls, appended and read back.
 *
 * <p>No update and no delete: V41 refuses both in PostgreSQL, and an interface that
 * does not offer them is how a developer finds that out before the trigger tells them.
 * {@code JpaRepository} brings {@code delete} along regardless — Spring Data's
 * interface is fixed — and calling it produces a {@code restrict_violation} at the
 * statement, which is the correct outcome even if it is a later one.
 */
public interface PaymentTransactionRepository extends JpaRepository<PaymentTransaction, UUID> {

    /**
     * Whether an attempt with this key has already been recorded.
     *
     * <p><strong>The guard in front of a second {@code PENDING} row.</strong> V41's
     * unique index is partial over the settled states, so it does not refuse two
     * {@code PENDING} rows for one key — deliberately, because a {@code PENDING} row and
     * the row that later settles it share a key and neither can be updated into the
     * other. What stops the {@code PENDING} rows accumulating on every re-poll is this
     * read plus the fact that every charge on a pledge is serialised by a lock on the
     * pledge row, which makes a read-then-write correct here in a way it usually is not.
     */
    boolean existsByIdempotencyKey(String idempotencyKey);

    /** IDN-EXT-01 (#39): the charge a payment page opened, by the provider's name for it. */
    Optional<PaymentTransaction> findFirstByProviderAndProviderTransactionIdAndTypeAndStatus(
            ProviderName provider, String providerTransactionId, TransactionType type, TransactionStatus status);

    /** Whether a provider transaction already has its final row — the settled index's question. */
    boolean existsByProviderAndProviderTransactionIdAndStatusIn(
            ProviderName provider, String providerTransactionId, Collection<TransactionStatus> statuses);

    /** An attempt by its key, for the re-poll that finds the provider has since decided. */
    Optional<PaymentTransaction> findByIdempotencyKey(String idempotencyKey);

    /**
     * Everything that happened to one pledge, newest first.
     *
     * <p>The support read — "why was this card refused four times" — and the only place
     * the decline codes live.
     */
    List<PaymentTransaction> findByPledgeIdOrderByCreatedAtDesc(UUID pledgeId);

    /** How many calls of one status a campaign has produced. For the collection's progress. */
    long countByProjectIdAndStatus(UUID projectId, TransactionStatus status);

    /*
     * The twelve below are AD-05's log -- #304, with #404's outcome filter and #412's
     * ordering. Three filter shapes, each with and without an outcome, each with a first page
     * and a keyset page; PaymentLogScope has the argument for why there are three shapes and
     * PaymentLogCursor has the one for why the keyset carries two values.
     *
     * ORDERED BY `created_at`, AND IT USED TO BE BY THE IDENTIFIER.
     *
     * The old argument was AuditEntryRepository's, made here for the same reason and wrong
     * here in the same way: both columns say the same thing -- the identifier is a UUID v7 and
     * carries the millisecond it was minted in (§7.3) -- and only one of them is unique, so
     * ordering by the primary key gave the same sequence with a cursor that was one value.
     *
     * The two columns are written by two different clocks. The identifier is minted in the
     * application when `PaymentTransaction` builds the row; `created_at` is `DEFAULT now()`
     * (V41) and is taken when the insert lands. A charge that mints its key before a provider
     * call and commits after it, two instances whose clocks differ, and anything migrated in
     * with a key from elsewhere all put the two orders out of step -- and `PaymentLogView`
     * renders the timestamp while the query ordered by the key.
     *
     * #404 found that on `audit_logs`, where the cost was an investigator scrolling. #412 is
     * the same defect on the one console surface that is entirely money, where the rows are
     * retry attempts against somebody's card and the order IS the evidence: §9.6 permits four
     * collection attempts, and "declined, declined, collected" read in the wrong order is a
     * different story about the same pledge.
     *
     * So every query below orders by `(created_at DESC, id DESC)` -- the column the screen
     * shows, with the key breaking the tie -- and each keyset predicate is the row-value
     * comparison that pair implies, written out rather than as a tuple because JPQL has no row
     * constructor. Four attempts on one pledge inside one second make the tie the ordinary
     * case here rather than the edge one, which is why the cursor carries both halves.
     *
     * WHAT IT COSTS, STATED RATHER THAN DISCOVERED LATER. V41's `transactions_pledge_idx` and
     * `transactions_project_idx` both end in `created_at DESC`, so the six scoped reads are
     * now the index's own order instead of a sort -- they got cheaper, not dearer. The other
     * two shapes had no index for this order at all, and V64 is that: it replaces V63's
     * `(status, id DESC)` with `(status, created_at DESC, id DESC)` and adds
     * `(created_at DESC, id DESC)` for the unfiltered read, which previously walked the
     * primary key. Both carry the identifier, so the keyset is exact rather than nearly
     * exact -- affordable here because they are new indexes, where adding `id` to V21's four
     * would have been a rebuild on a table that only grows.
     */

    /** The newest calls the platform has made, whatever they were about. V64's index. */
    @Query("SELECT t FROM PaymentTransaction t ORDER BY t.createdAt DESC, t.id DESC")
    List<PaymentTransaction> newest(Pageable limit);

    /** The page after the row at {@code (before, beforeId)}. */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.createdAt < :before OR (t.createdAt = :before AND t.id < :beforeId)
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestBefore(
            @Param("before") Instant before, @Param("beforeId") UUID beforeId, Pageable limit);

    /** Everything that moved on one campaign, newest first. V41's index, in its own order. */
    @Query("SELECT t FROM PaymentTransaction t WHERE t.projectId = :projectId ORDER BY t.createdAt DESC, t.id DESC")
    List<PaymentTransaction> newestOfProject(@Param("projectId") UUID projectId, Pageable limit);

    /** The page after that row, within one campaign. */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.projectId = :projectId
              AND (t.createdAt < :before OR (t.createdAt = :before AND t.id < :beforeId))
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestOfProjectBefore(
            @Param("projectId") UUID projectId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable limit);

    /**
     * One pledge's whole attempt history, newest first.
     *
     * <p>The same rows as {@link #findByPledgeIdOrderByCreatedAtDesc}, paged. That one stays
     * because the collection run reads it whole and wants no {@link Pageable}; this one exists
     * because a screen cannot. Since #412 the two also agree on the order, which they did not
     * before — the unpaged one has always ordered by {@code created_at}.
     */
    @Query("SELECT t FROM PaymentTransaction t WHERE t.pledgeId = :pledgeId ORDER BY t.createdAt DESC, t.id DESC")
    List<PaymentTransaction> newestOfPledge(@Param("pledgeId") UUID pledgeId, Pageable limit);

    /** The page after that row, within one pledge. */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.pledgeId = :pledgeId
              AND (t.createdAt < :before OR (t.createdAt = :before AND t.id < :beforeId))
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestOfPledgeBefore(
            @Param("pledgeId") UUID pledgeId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable limit);

    /*
     * The six below are the same six narrowed to one outcome -- #404's status filter.
     *
     * Six more methods rather than one nullable parameter on each of the six above, which is
     * the choice ProjectRepository makes for the same reason: a `:status IS NULL OR
     * t.status = :status` predicate is one query whose plan has to serve two very different
     * reads, and the read that matters here is the filtered one over the largest table the
     * platform holds. Spelled out, each of these is exactly the index it uses -- V64's
     * (status, created_at DESC, id DESC) for the unscoped one, V41's pledge and project indexes
     * with the status as a filter step for the other two -- and the six above are untouched, so
     * nothing that already worked can regress on the way in.
     */

    /** The newest calls of one outcome, whatever they were about. V64's index. */
    @Query("SELECT t FROM PaymentTransaction t WHERE t.status = :status ORDER BY t.createdAt DESC, t.id DESC")
    List<PaymentTransaction> newestWithStatus(@Param("status") TransactionStatus status, Pageable limit);

    /** The page after that row, within one outcome. */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.status = :status
              AND (t.createdAt < :before OR (t.createdAt = :before AND t.id < :beforeId))
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestWithStatusBefore(
            @Param("status") TransactionStatus status,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable limit);

    /** One campaign's calls of one outcome — "what did this collection run leave behind". */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.projectId = :projectId AND t.status = :status
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestOfProjectWithStatus(
            @Param("projectId") UUID projectId, @Param("status") TransactionStatus status, Pageable limit);

    /** The page after that row, within one campaign and one outcome. */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.projectId = :projectId AND t.status = :status
              AND (t.createdAt < :before OR (t.createdAt = :before AND t.id < :beforeId))
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestOfProjectWithStatusBefore(
            @Param("projectId") UUID projectId,
            @Param("status") TransactionStatus status,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable limit);

    /** One pledge's attempts of one outcome — "every time this card was refused". */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.pledgeId = :pledgeId AND t.status = :status
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestOfPledgeWithStatus(
            @Param("pledgeId") UUID pledgeId, @Param("status") TransactionStatus status, Pageable limit);

    /** The page after that row, within one pledge and one outcome. */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.pledgeId = :pledgeId AND t.status = :status
              AND (t.createdAt < :before OR (t.createdAt = :before AND t.id < :beforeId))
            ORDER BY t.createdAt DESC, t.id DESC
            """)
    List<PaymentTransaction> newestOfPledgeWithStatusBefore(
            @Param("pledgeId") UUID pledgeId,
            @Param("status") TransactionStatus status,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable limit);

    /**
     * The settled charge on a pledge, newest first — #67.
     *
     * <p>A refund is submitted against the original authorisation, so this is what finds
     * the {@code providerTransactionId} to send. Newest first because §9.6 permits up to
     * four collection attempts and only the successful one has an identifier worth
     * reversing; earlier rows are declines.
     *
     * <p>{@code SUCCEEDED} only, and {@code PENDING} deliberately excluded: refunding a
     * charge the provider has accepted but not settled is an instruction most providers
     * refuse, and the ones that accept it produce a refund and a charge that race.
     */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.pledgeId = :pledgeId
              AND t.type = az.ideanest.payment.domain.TransactionType.CHARGE
              AND t.status = az.ideanest.payment.domain.TransactionStatus.SUCCEEDED
            ORDER BY t.createdAt DESC
            """)
    List<PaymentTransaction> settledChargesOf(@Param("pledgeId") UUID pledgeId);

    /**
     * How much was actually collected on a pledge — #67's overdraft check.
     *
     * <p>The sum of its settled charges. Read from this table rather than from
     * {@code pledges.amount} because what may be refunded is what was taken, and those
     * differ whenever a collection was partial or a supplement was added after the fact.
     * It also keeps the payment module out of the pledge module's table.
     */
    @Query(
            """
            SELECT COALESCE(SUM(t.amount), 0) FROM PaymentTransaction t
            WHERE t.pledgeId = :pledgeId
              AND t.type = az.ideanest.payment.domain.TransactionType.CHARGE
              AND t.status = az.ideanest.payment.domain.TransactionStatus.SUCCEEDED
            """)
    java.math.BigDecimal collectedOn(@Param("pledgeId") UUID pledgeId);

    /**
     * What has actually moved, per kind and per currency — §8.4's
     * {@code ledger-reconciliation}, issue #70.
     *
     * <p>An aggregate rather than a scan, because this runs daily over every transaction the
     * platform has ever recorded and the point of it is to be cheap enough to keep running as
     * that number grows. Grouped by currency and never summed across it, for §21.2's reason.
     *
     * <p><strong>{@code SUCCEEDED} only.</strong> A declined charge moved nothing and has no
     * ledger posting; counting it would make every failed collection look like an imbalance.
     * {@code PENDING} is excluded for the same reason and a sharper one — money the provider
     * has accepted and not settled is money in neither place yet, and a reconciliation that
     * counted it would fire every night between the two.
     */
    @Query(
            """
            SELECT new az.ideanest.payment.application.SettledTotal(t.type, t.currency, COALESCE(SUM(t.amount), 0))
            FROM PaymentTransaction t
            WHERE t.status = az.ideanest.payment.domain.TransactionStatus.SUCCEEDED
            GROUP BY t.type, t.currency
            ORDER BY t.currency, t.type
            """)
    List<az.ideanest.payment.application.SettledTotal> settledTotals();

    /**
     * Every settled charge on a campaign — #69's payout calculation.
     *
     * <p>The gross a payout is computed from. Ordered so that a payout's own record of
     * which rows it covered is reproducible.
     */
    @Query(
            """
            SELECT t FROM PaymentTransaction t
            WHERE t.projectId = :projectId
              AND t.type = az.ideanest.payment.domain.TransactionType.CHARGE
              AND t.status = az.ideanest.payment.domain.TransactionStatus.SUCCEEDED
            ORDER BY t.createdAt ASC
            """)
    List<PaymentTransaction> settledChargesOfProject(@Param("projectId") UUID projectId);
}
