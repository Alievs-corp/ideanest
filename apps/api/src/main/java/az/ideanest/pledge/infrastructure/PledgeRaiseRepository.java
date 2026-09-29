package az.ideanest.pledge.infrastructure;

import az.ideanest.pledge.domain.PledgeRaise;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Attempts to raise a paid pledge — #171, V83. */
public interface PledgeRaiseRepository extends JpaRepository<PledgeRaise, UUID> {

    /**
     * The pledge a charge's raise belongs to, by the charge's idempotency key.
     *
     * <p>Only the identifier, unlocked: the caller reads it to learn which pledge to lock, and then
     * locks the raise behind the pledge with {@link #findByChargeKeyForUpdate}: the pledge first and
     * the raise second,
     * which is the order every writer of a raise takes, so two of them never wait on each other.
     */
    @Query("SELECT r.pledgeId FROM PledgeRaise r WHERE r.chargeKey = :chargeKey")
    Optional<UUID> findPledgeIdByChargeKey(@Param("chargeKey") String chargeKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM PledgeRaise r WHERE r.chargeKey = :chargeKey")
    Optional<PledgeRaise> findByChargeKeyForUpdate(@Param("chargeKey") String chargeKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM PledgeRaise r WHERE r.id = :id")
    Optional<PledgeRaise> findByIdForUpdate(@Param("id") UUID id);

    /** The raise in flight on a pledge, if there is one. V83 allows at most one. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            SELECT r FROM PledgeRaise r
            WHERE r.pledgeId = :pledgeId
              AND r.state = az.ideanest.pledge.domain.PledgeRaiseState.PENDING
            """)
    Optional<PledgeRaise> findPendingForUpdate(@Param("pledgeId") UUID pledgeId);

    /** The most recent attempt on a pledge — what the pledge screen reports. */
    @Query("SELECT r FROM PledgeRaise r WHERE r.pledgeId = :pledgeId ORDER BY r.createdAt DESC, r.id DESC")
    List<PledgeRaise> findLatest(@Param("pledgeId") UUID pledgeId, Pageable page);

    /** Whether a raise was started on this pledge after the given one — which supersedes it. */
    @Query(
            """
            SELECT COUNT(r) > 0 FROM PledgeRaise r
            WHERE r.pledgeId = :pledgeId
              AND r.id <> :raiseId
              AND r.createdAt >= :createdAt
            """)
    boolean existsNewer(
            @Param("pledgeId") UUID pledgeId, @Param("raiseId") UUID raiseId, @Param("createdAt") Instant createdAt);

    /**
     * Pending raises whose hold has run out, oldest first — the reservation cleaner's second walk.
     *
     * <p>Identifiers and no lock, for {@code PledgeRepository#findLapsedDrafts}' reason: each is
     * released in its own transaction, which takes the locks.
     */
    @Query(
            """
            SELECT r.pledgeId FROM PledgeRaise r
            WHERE r.state = az.ideanest.pledge.domain.PledgeRaiseState.PENDING
              AND r.holdExpiresAt <= :now
            ORDER BY r.holdExpiresAt
            """)
    List<UUID> findPledgesWithLapsedRaises(@Param("now") Instant now, Pageable page);

    /**
     * Whether any of the pledge's own money has gone back or is on its way — #171.
     *
     * <p>A refund that has not failed, against the pledge. A raise is neither started nor applied on
     * a pledge whose money is being returned: the pledge's refunded-in-full decision is made from what
     * was charged and what went back, and a raise landing between a refund being decided and being
     * settled would leave part of the pledge refunded and the rest standing at a total the backer no
     * longer paid. Refunds of a raise that was paid for and could not be applied are not the pledge's
     * money and do not count.
     *
     * <p>Native, because refunds and charges are the payment module's tables and this module may not
     * name their classes.
     */
    @Query(
            value =
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM refunds r
                          LEFT JOIN transactions t ON t.id = r.charge_transaction_id
                          LEFT JOIN pledge_raises rs ON rs.charge_key = t.idempotency_key
                         WHERE r.pledge_id = :pledgeId
                           AND (r.state <> 'FAILED' OR r.failure_code = 'provider_unreachable')
                           AND rs.state IS DISTINCT FROM 'UNAPPLIED')
                    """,
            nativeQuery = true)
    boolean hasRefundOfPledgeMoney(@Param("pledgeId") UUID pledgeId);

    /**
     * The charge keys of raises that were paid for and never settled — #171.
     *
     * <p>A {@code SUCCEEDED} charge whose raise is neither {@code SUCCEEDED} nor {@code UNAPPLIED}:
     * money taken that nothing applied and nothing will refund. The webhook settles the charge and the
     * raise in one transaction, so a committed charge beside an unsettled raise was recorded by
     * something that did not settle it — a node of the release before raises existed, during a rolling
     * deployment. Oldest charge first. Native for {@link #hasRefundOfPledgeMoney}'s reason.
     */
    @Query(
            value =
                    """
                    SELECT rs.charge_key
                      FROM pledge_raises rs
                      JOIN transactions t ON t.idempotency_key = rs.charge_key
                     WHERE rs.state IN ('PENDING', 'EXPIRED', 'FAILED', 'ABANDONED')
                       AND t.type = 'CHARGE'
                       AND t.status = 'SUCCEEDED'
                     ORDER BY t.created_at, rs.charge_key
                     LIMIT :limit
                    """,
            nativeQuery = true)
    List<String> findPaidUnsettledChargeKeys(@Param("limit") int limit);
}
