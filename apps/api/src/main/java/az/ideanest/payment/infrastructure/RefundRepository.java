package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundState;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

/**
 * V53's refunds — issues #67 and #307.
 *
 * <p><strong>{@link #refundedAgainst} is the one that matters.</strong> It is the read
 * behind the invariant V53's header says cannot be a constraint: the refunds against a
 * pledge may not exceed what was collected on it. That is a statement about a set of rows
 * here joined against a set of rows in {@code transactions}, which no {@code CHECK} can
 * express — so it is enforced in {@code RefundService} under a lock, and this is the sum
 * it enforces it with.
 *
 * <p>{@code FAILED} refunds are excluded from that sum, and {@code REQUESTED} ones are
 * not. A requested refund has not left yet but is about to, and counting only the
 * succeeded ones would let two staff members each issue a full refund in the seconds
 * before the first one settles.
 *
 * <p><strong>Except a {@code FAILED} one whose provider could not be reached (#183).</strong> This
 * release never writes one — such a refund stays {@code REQUESTED} (#176) — but the release before it
 * did, and during a rolling deploy it still can after V85 has run. Whether that reversal happened is
 * unknown, so every sum here counts it as gone until {@link #reopenUnreachable} hands it to the
 * reconciliation; counted as failed, the next refund would send the same money again.
 */
public interface RefundRepository extends JpaRepository<Refund, UUID> {

    /**
     * How much has been or is about to be refunded against one pledge.
     *
     * <p>{@code COALESCE} so an untouched pledge answers zero rather than null — a null
     * here would be compared against an amount by whichever caller forgot, and the
     * comparison that silently succeeds is the one that lets a second full refund
     * through.
     */
    @Query(
            """
            SELECT COALESCE(SUM(r.amount), 0) FROM Refund r
            WHERE r.pledgeId = :pledgeId
              AND (r.state <> az.ideanest.payment.domain.RefundState.FAILED
                   OR r.failureCode = 'provider_unreachable')
            """)
    BigDecimal refundedAgainst(@Param("pledgeId") UUID pledgeId);

    /**
     * How much has been refunded, or is on its way back, against one charge — #171.
     *
     * <p>A raised pledge was paid for in more than one charge and a provider reverses each on its own,
     * so what one charge has left is asked of that charge. {@code FAILED} refunds excluded, for
     * {@link #refundedAgainst}'s reason.
     */
    @Query(
            """
            SELECT COALESCE(SUM(r.amount), 0) FROM Refund r
            WHERE r.chargeTransactionId = :chargeId
              AND (r.state <> az.ideanest.payment.domain.RefundState.FAILED
                   OR r.failureCode = 'provider_unreachable')
            """)
    BigDecimal refundedAgainstCharge(@Param("chargeId") UUID chargeId);

    /**
     * How much has actually gone back on one pledge: its {@code SUCCEEDED} refunds only — #171.
     *
     * <p>What decides that a pledge is refunded in full. Unlike {@link #refundedAgainst}, a refund
     * still in flight does not count: it may yet fail, and a pledge must not be taken out of its
     * campaign's figures for money that has not left.
     */
    @Query(
            """
            SELECT COALESCE(SUM(r.amount), 0) FROM Refund r
            WHERE r.pledgeId = :pledgeId
              AND r.state = az.ideanest.payment.domain.RefundState.SUCCEEDED
            """)
    BigDecimal succeededAgainst(@Param("pledgeId") UUID pledgeId);

    /** How many refunds, of any state, were ever recorded against one charge — for the next key. */
    @Query("SELECT COUNT(r) FROM Refund r WHERE r.chargeTransactionId = :chargeId")
    long countAgainstCharge(@Param("chargeId") UUID chargeId);

    /** A refund already recorded under this key, for the idempotent replay. */
    @Query("SELECT r FROM Refund r WHERE r.idempotencyKey = :key")
    Optional<Refund> byIdempotencyKey(@Param("key") String key);

    /**
     * The console's list, newest first.
     *
     * <p>Offset-paged rather than keyset, which is a departure from the rest of the
     * console and is deliberate. The audit trail and the payment log page over tables that
     * grow under the reader continuously, so an offset drifts them past rows. Refunds are
     * written a handful of times a day by the people reading this screen, and what those
     * readers want is to filter by state and jump — which keyset does not offer.
     */
    @Query("SELECT r FROM Refund r ORDER BY r.requestedAt DESC, r.id DESC")
    List<Refund> page(Pageable pageable);

    /** The same, narrowed to one state. Two queries rather than a nullable parameter. */
    @Query("SELECT r FROM Refund r WHERE r.state = :state ORDER BY r.requestedAt DESC, r.id DESC")
    List<Refund> pageByState(@Param("state") RefundState state, Pageable pageable);

    /**
     * How much has been refunded across a whole campaign — #69.
     *
     * <p>Subtracted from a payout gross. {@code FAILED} refunds are excluded and
     * {@code REQUESTED} ones are not, for {@link #refundedAgainst}'s reason: a refund that
     * has not left yet is about to, and paying a creator money that is on its way back to
     * a backer is the one mistake a payout must not make.
     *
     * <p><strong>Not the refunds of a raise that could not be applied (#171).</strong> Its charge is
     * left out of the payout's gross ({@code PaymentTransactionRepository#settledChargesOfProject}),
     * because it is owed back and never the creator's; subtracting its refund as well would take it
     * out twice. Native for that join, which reads the pledge module's table.
     */
    @Query(
            value =
                    """
                    SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
                      LEFT JOIN transactions t ON t.id = r.charge_transaction_id
                      LEFT JOIN pledge_raises rs ON rs.charge_key = t.idempotency_key
                     WHERE r.project_id = :projectId
                       AND (r.state <> 'FAILED' OR r.failure_code = 'provider_unreachable')
                       AND rs.state IS DISTINCT FROM 'UNAPPLIED'
                    """,
            nativeQuery = true)
    BigDecimal refundedOnProject(@Param("projectId") UUID projectId);

    /**
     * The settled charges the platform owes back on its own, one row per charge — IDN-EXT-01 (#40)
     * and #171.
     *
     * <p>Two kinds of charge. Every charge of a campaign that ended below its threshold or was halted,
     * <strong>whatever its pledge's state</strong>: a raised pledge has more than one charge, each
     * reversed against its own provider transaction, and a pledge's state is not what says whether its
     * money went back — a charge whose refund failed after another charge of the same pledge was
     * refunded must still be offered. And a charge that paid for a raise which could not be applied,
     * whatever the campaign's state: it bought nothing.
     *
     * <p>A charge is offered while it has money left: its amount less every refund against it that has
     * not failed. A refund in flight counts as gone, so nothing is sent twice, and a charge refunded in
     * part — by a member of staff, say — is offered for the rest. One whose last refund failed more
     * recently than the retry interval waits. A pledge with a refund that names no charge — V53 allows
     * one, and nothing writes one — is left to staff rather than refunded again beside money that
     * cannot be placed. Rows of charge id, pledge id and the refund reason's
     * name, oldest charge first. Native because it reads four modules' tables in one statement;
     * nothing here names their classes.
     */
    @Query(
            value =
                    """
                    SELECT CAST(t.id AS text) AS charge_id,
                           CAST(t.pledge_id AS text) AS pledge_id,
                           CASE WHEN rs.state = 'UNAPPLIED' THEN 'RAISE_NOT_APPLIED'
                                WHEN p.state = 'UNSUCCESSFUL' THEN 'CAMPAIGN_FAILED'
                                ELSE 'CAMPAIGN_HALTED' END AS reason
                      FROM transactions t
                      JOIN projects p ON p.id = t.project_id
                      LEFT JOIN pledge_raises rs ON rs.charge_key = t.idempotency_key
                     WHERE t.type = 'CHARGE'
                       AND t.status = 'SUCCEEDED'
                       AND t.pledge_id IS NOT NULL
                       AND (rs.state = 'UNAPPLIED' OR p.state IN ('UNSUCCESSFUL', 'CANCELED', 'SUSPENDED'))
                       AND t.amount > (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
                                        WHERE r.charge_transaction_id = t.id
                                          AND (r.state <> 'FAILED' OR r.failure_code = 'provider_unreachable'))
                       AND NOT EXISTS (SELECT 1 FROM refunds r
                                        WHERE r.charge_transaction_id = t.id AND r.state = 'FAILED'
                                          AND r.settled_at > :retryBefore)
                       AND NOT EXISTS (SELECT 1 FROM refunds r
                                        WHERE r.pledge_id = t.pledge_id AND r.charge_transaction_id IS NULL
                                          AND (r.state <> 'FAILED' OR r.failure_code = 'provider_unreachable'))
                     ORDER BY t.created_at, t.id
                     LIMIT :limit
                    """,
            nativeQuery = true)
    List<Object[]> owedPlatformRefunds(@Param("retryBefore") java.time.Instant retryBefore, @Param("limit") int limit);

    /**
     * Refunds whose outcome was never recorded, oldest first — IDN-EXT-01 (#40).
     *
     * <p>A member of staff's as well as the platform's since #174's review: a staff refund of a raised
     * pledge is sent as several parts, and a part whose answer was lost would otherwise stay
     * {@code REQUESTED} for ever, counted as gone and never paid. Rows already left for a person
     * ({@code review_reason}) are not asked about again.
     *
     * <p><strong>Least recently asked first, not oldest first (#183).</strong> A row the provider keeps
     * calling pending stays {@code REQUESTED}; ordered by age, a batch of those would be every pass and
     * nothing newer would be asked about. Never asked comes first, then the longest since {@link #checked}.
     */
    @Query(
            """
            SELECT r FROM Refund r
            WHERE r.state = az.ideanest.payment.domain.RefundState.REQUESTED
              AND r.reviewReason IS NULL
              AND r.requestedAt < :before
            ORDER BY r.lastCheckedAt ASC NULLS FIRST, r.requestedAt ASC
            """)
    List<Refund> unresolvedRefunds(@Param("before") java.time.Instant before, Pageable page);

    /** V87 (#183): the reconciliation asked about this refund, whatever it was told. */
    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "UPDATE refunds SET last_checked_at = :at WHERE id = :id", nativeQuery = true)
    int checked(@Param("id") UUID id, @Param("at") java.time.Instant at);

    /**
     * V85's reopening, for rows written after it ran — #183.
     *
     * <p>A node of the release before #176 still records an unreachable refund {@code FAILED} in the
     * minutes both releases run, after V85 has already reopened the rows it found. This is V85's UPDATE,
     * run at the start of every {@code campaign-refunds} pass, so such a row is back to
     * {@code REQUESTED} — and the provider asked before anything is sent — whatever release wrote it and
     * without anybody re-running the migration by hand. Until then the sums above count it as gone.
     * V85's header has the argument for each branch.
     *
     * @return how many rows were reopened; zero on every pass once no previous release is running
     */
    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE refunds r
                       SET state = 'REQUESTED',
                           settled_at = NULL,
                           failure_code = NULL,
                           failure_message = NULL,
                           review_reason = CASE
                               WHEN r.charge_transaction_id IS NULL THEN
                                   'Recorded failed as unreachable before #176 and names no charge: whether it'
                                   || ' happened needs the provider''s statement.'
                               WHEN EXISTS (SELECT 1 FROM refunds o
                                             WHERE o.charge_transaction_id = r.charge_transaction_id
                                               AND o.id <> r.id
                                               AND (o.state <> 'FAILED' OR o.failure_code = 'provider_unreachable')) THEN
                                   'Recorded failed as unreachable before #176, and another refund went against the'
                                   || ' same charge: the payment''s status cannot tell which happened, so it needs'
                                   || ' the provider''s statement.'
                           END
                     WHERE r.state = 'FAILED'
                       AND r.failure_code = 'provider_unreachable'
                    """,
            nativeQuery = true)
    int reopenUnreachable();

    /**
     * How many refunds against one pledge have no outcome yet — #174's review, for a dispute's retry.
     * A {@code FAILED} {@code provider_unreachable} row a previous release wrote is one of them (#183).
     */
    @Query(
            """
            SELECT COUNT(r) FROM Refund r
            WHERE r.pledgeId = :pledgeId
              AND (r.state = az.ideanest.payment.domain.RefundState.REQUESTED
                   OR (r.state = az.ideanest.payment.domain.RefundState.FAILED
                       AND r.failureCode = 'provider_unreachable'))
            """)
    long countRequestedAgainst(@Param("pledgeId") UUID pledgeId);

    /** Every refund against one pledge, for the detail a support conversation needs. */
    @Query("SELECT r FROM Refund r WHERE r.pledgeId = :pledgeId ORDER BY r.requestedAt DESC")
    List<Refund> forPledge(@Param("pledgeId") UUID pledgeId);
}
