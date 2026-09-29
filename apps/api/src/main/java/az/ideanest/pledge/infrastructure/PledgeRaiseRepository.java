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
}
