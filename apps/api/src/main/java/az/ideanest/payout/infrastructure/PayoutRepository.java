package az.ideanest.payout.infrastructure;

import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutState;
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

/**
 * V55's payouts — issues #69 and #306.
 *
 * <p><strong>{@link #findAndLock} is what makes the send safe.</strong> Two members of
 * staff pressing "send" on one payout, or a retry racing the original, would both read
 * {@code APPROVED} and both instruct the provider. The row lock serialises them, and the
 * idempotency key is the second lock — belt and braces, deliberately, because this is the
 * one operation on the platform whose duplicate is a creator paid twice.
 */
public interface PayoutRepository extends JpaRepository<Payout, UUID> {

    /** The row, locked, so that a decision about it cannot be taken twice at once. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Payout p WHERE p.id = :id")
    Optional<Payout> findAndLock(@Param("id") UUID id);

    /**
     * The payout in flight for a campaign, if there is one.
     *
     * <p>V55's partial unique index permits at most one, so this cannot return two — and
     * that index is the thing stopping a second calculation from paying the same
     * collections again.
     */
    @Query(
            """
            SELECT p FROM Payout p
            WHERE p.projectId = :projectId
              AND p.state IN (
                  az.ideanest.payout.domain.PayoutState.CALCULATED,
                  az.ideanest.payout.domain.PayoutState.PENDING_APPROVAL,
                  az.ideanest.payout.domain.PayoutState.APPROVED)
            """)
    Optional<Payout> inFlightFor(@Param("projectId") UUID projectId);

    /**
     * Every payout a campaign has ever had, newest first — issue #99.
     *
     * <p><strong>Every state, including {@code CANCELLED} and {@code FAILED}.</strong> The
     * creator's financial summary answers "where is my money", and a payout that was
     * calculated and then cancelled is part of that answer rather than noise: a creator who
     * saw one and then saw nothing would have no way to tell a cancellation from a screen
     * that had stopped working. What was paid is the {@code PAID} rows; what is on its way is
     * {@link #inFlightFor}; the rest is history, and the summary says which is which.
     */
    @Query("SELECT p FROM Payout p WHERE p.projectId = :projectId ORDER BY p.calculatedAt DESC")
    List<Payout> historyOf(@Param("projectId") UUID projectId);

    /**
     * The queue: everything still on its way somewhere, oldest first.
     *
     * <p>Includes payouts whose hold has not expired, because the screen's job is to show
     * what is owed and when it becomes payable — hiding them would make a creator's
     * question unanswerable for the length of the hold. The response says which are
     * payable now.
     */
    @Query(
            """
            SELECT p FROM Payout p
            WHERE p.state IN (
                az.ideanest.payout.domain.PayoutState.CALCULATED,
                az.ideanest.payout.domain.PayoutState.PENDING_APPROVAL,
                az.ideanest.payout.domain.PayoutState.APPROVED)
            ORDER BY p.payableAt ASC, p.calculatedAt ASC
            """)
    List<Payout> queue(Pageable pageable);

    /** Everything, newest first. */
    @Query("SELECT p FROM Payout p ORDER BY p.calculatedAt DESC")
    List<Payout> page(Pageable pageable);

    /** The same, narrowed to one state. Two queries rather than a nullable parameter. */
    @Query("SELECT p FROM Payout p WHERE p.state = :state ORDER BY p.calculatedAt DESC")
    List<Payout> pageByState(@Param("state") PayoutState state, Pageable pageable);

    /**
     * Payouts whose hold has expired and which are still marked {@code CALCULATED}.
     *
     * <p>Read by the queue so that it can move them to {@code PENDING_APPROVAL} as it
     * lists them — {@code Payout.payable} has the argument for why this is not a scheduled
     * job.
     */
    @Query(
            """
            SELECT p FROM Payout p
            WHERE p.state = az.ideanest.payout.domain.PayoutState.CALCULATED
              AND p.payableAt <= :now
            """)
    List<Payout> nowPayable(@Param("now") Instant now);

    /** IDN-EXT-01 (#41): payouts still in flight whose hold is over, oldest first. */
    @Query(
            """
            SELECT p FROM Payout p
            WHERE p.state IN (
                  az.ideanest.payout.domain.PayoutState.CALCULATED,
                  az.ideanest.payout.domain.PayoutState.PENDING_APPROVAL,
                  az.ideanest.payout.domain.PayoutState.APPROVED)
              AND p.payableAt <= :now
            ORDER BY p.payableAt ASC
            """)
    java.util.List<Payout> inFlightPastHold(@Param("now") java.time.Instant now, org.springframework.data.domain.Pageable page);
}
