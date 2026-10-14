package az.ideanest.pledge.infrastructure;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeState;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Pledges, by the four questions that are actually asked of them.
 *
 * <p>Three are reservation's (#51) and the fourth is #52's read of one pledge by
 * the backer who made it. Everything else a pledge will be asked — a backer's list,
 * a creator's backer report, a receipt — belongs to the endpoints that answer those
 * questions and is not guessed at here. A derived method nobody calls is a query
 * nobody has looked at the plan for.
 */
public interface PledgeRepository extends JpaRepository<Pledge, UUID> {

    /**
     * This pledge, if it is this backer's.
     *
     * <p><strong>The owner is part of the query rather than a check afterwards.</strong>
     * Loading by identifier and comparing the backer in Java would work, and it would
     * work until the day somebody adds a second read that forgets to compare — which
     * is exactly the "insecure direct object reference" §17.3 lists. Asking the
     * question once, in the query, means there is no way to obtain a pledge without
     * having been entitled to it.
     *
     * <p>Empty covers both "no such pledge" and "not yours", which the caller answers
     * identically: see {@code PledgeNotFoundException} for why a 404 rather than a
     * 403 is the private answer.
     */
    @Query("SELECT p FROM Pledge p WHERE p.id = :pledgeId AND p.backerId = :backerId")
    Optional<Pledge> findOwned(@Param("pledgeId") UUID pledgeId, @Param("backerId") UUID backerId);

    /**
     * This backer's live pledge on this campaign, if they have one.
     *
     * <p>The read behind §7.2's "one pledge per backer per project". It exists so
     * that a second attempt can be refused with something a person can act on —
     * or, when the draft it finds has already lapsed, so that the caller can
     * release it and carry on rather than telling somebody they already have a
     * pledge that no longer exists.
     *
     * <p><strong>It is not the enforcement.</strong>
     * {@code pledges_project_backer_active_key} is, and it has to be: two
     * requests arriving together would both read no pledge and both insert one.
     * This read decides what to say; the index decides what is true.
     */
    @Query(
            """
            SELECT p FROM Pledge p
            WHERE p.projectId = :projectId AND p.backerId = :backerId AND p.state IN :states
            """)
    Optional<Pledge> findActive(
            @Param("projectId") UUID projectId,
            @Param("backerId") UUID backerId,
            @Param("states") Collection<PledgeState> states);

    /**
     * Every pledge on one campaign in any of these states — #103.
     *
     * <p>What a halted campaign's release walks. Entities rather than identifiers, unlike
     * the sweeps below, because the whole set is ended in one transaction: the listener
     * runs inside the outbox dispatch, and half a release is the one outcome nobody can
     * repair from the outside.
     *
     * <p>Unbounded, deliberately. It is bounded by the campaign — a campaign has as many
     * pledges as it has backers — and a batch here would mean a suspension that released
     * the first two hundred places and left the rest held on a campaign nobody can back.
     *
     * <p>Ordered by identifier, which is a UUID v7 and therefore the order the pledges
     * were made in: the reward tier's places come back in the order they were taken,
     * which is at least explicable to a creator watching the count move.
     */
    @Query("SELECT p FROM Pledge p WHERE p.projectId = :projectId AND p.state IN :states ORDER BY p.id")
    List<Pledge> findByProjectAndStates(
            @Param("projectId") UUID projectId, @Param("states") Collection<PledgeState> states);

    /**
     * The next batch of drafts whose reservation has run out.
     *
     * <p>§8.4's {@code reservation-cleaner}. Identifiers rather than entities,
     * for the reason {@code ReminderRepository#findPending} gives: the sweep
     * claims each row in its own transaction, and a batch of detached entities
     * read in one transaction and written in another is a set of decisions taken
     * against a state that has since moved.
     *
     * <p>Ordered by expiry, so the place that has been unavailable longest is the
     * first one given back. Bounded by the caller, so a backlog built up during an
     * outage is not attempted in one pass that overlaps its own next tick.
     */
    @Query(
            """
            SELECT p.id FROM Pledge p
            WHERE p.state = az.ideanest.pledge.domain.PledgeState.DRAFT
              AND p.reservationExpiresAt <= :now
            ORDER BY p.reservationExpiresAt
            """)
    List<UUID> findLapsedDrafts(@Param("now") Instant now, Pageable page);

    /**
     * Claims one lapsed draft, if nobody has claimed it already.
     *
     * <p>A conditional update rather than a read followed by a write, exactly as
     * {@code ReminderRepository#claim}: every replica runs its own timer (§8.4,
     * until #134), so two sweeps arriving together would both see an expired draft
     * and both release its place — and the tier would end up with one fewer
     * reservation than it has drafts. Only the database can decide which caller
     * wins, and only if the condition is part of the statement.
     *
     * <p>The expiry is re-checked here and not only in the query above. Between
     * the sweep's read and this call the backer may have confirmed — the
     * {@code state = 'DRAFT'} half is what refuses to expire a pledge that has
     * been paid for.
     *
     * <p><strong>Native, and the version increment is the reason.</strong> A bulk
     * JPQL update does not touch {@code @Version}, and HQL refuses to let one
     * assign it. Leaving it alone would be a real lost update rather than a
     * cosmetic one: confirmation (#52) loads a draft, this sweep expires it and
     * releases its place, and the confirming transaction then flushes an entity
     * still carrying the version it read — which would match, and would take the
     * pledge to CONFIRMED against a tier that has already given the place away.
     * Incrementing here is what turns that into the optimistic-lock failure it is.
     *
     * @param at the instant the reservation is judged against and stamped with,
     *     from the injected {@code Clock}
     * @return 1 when this call is the one that expired it, 0 when somebody else
     *     did or the backer confirmed first
     */
    // The persistence context is cleared afterwards because the row this statement
    // changed may also be loaded as an entity in the same transaction; without it
    // the caller's next read comes from the first-level cache and still describes a
    // live draft.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE pledges
                       SET state = 'EXPIRED',
                           canceled_at = :at,
                           version = version + 1
                     WHERE id = :id
                       AND state = 'DRAFT'
                       AND reservation_expires_at <= :at
                    """,
            nativeQuery = true)
    int expireLapsedDraft(@Param("id") UUID id, @Param("at") Instant at);

    // ------------------------------------------------------------------
    // §9.6's collection (#64, #65)
    // ------------------------------------------------------------------

    /** One pledge, locked, for the transaction that pays, raises or refunds it. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Pledge p WHERE p.id = :id")
    Optional<Pledge> findByIdForUpdate(@Param("id") UUID id);

    /**
     * What of this pledge's refund waits to be paid by bank transfer, or null when nothing does — #400.
     *
     * <p>Both waiting states: the backer's account is not on file yet, or it is and finance has not
     * recorded the transfer. To the backer the two are one thing — the money has not arrived and
     * support is who to talk to. In the pledge's currency, because a refund is refused in any other.
     *
     * <p>Native, because refunds are the payment module's table and this module may not name its
     * classes ({@code PledgeRaiseRepository.hasRefundOfPledgeMoney} reads it the same way).
     */
    @Query(
            value =
                    """
                    SELECT SUM(r.amount) FROM refunds r
                     WHERE r.pledge_id = :pledgeId
                       AND r.state IN ('AWAITING_BANK_DETAILS', 'AWAITING_TRANSFER')
                    """,
            nativeQuery = true)
    BigDecimal refundAwaitingBankTransfer(@Param("pledgeId") UUID pledgeId);

    /**
     * What of this pledge has gone back to the backer: its settled refunds, as sent — net of any
     * provider fee a refund kept back (#436) — or null when nothing has. Native, for
     * {@link #refundAwaitingBankTransfer}'s reason.
     */
    @Query(
            value = "SELECT SUM(r.amount) FROM refunds r WHERE r.pledge_id = :pledgeId AND r.state = 'SUCCEEDED'",
            nativeQuery = true)
    BigDecimal refunded(@Param("pledgeId") UUID pledgeId);

    /**
     * The payment provider's fee this pledge's refund keeps back — #436: a failed, suspended or cancelled
     * campaign refunds a charge taken under that rule less the fee posted with it. Every refund that has
     * not failed, so a refund still on its way says so too; null when none keeps anything back.
     */
    @Query(
            value =
                    """
                    SELECT SUM(r.withheld_fee) FROM refunds r
                     WHERE r.pledge_id = :pledgeId
                       AND r.withheld_fee > 0
                       AND (r.state <> 'FAILED' OR r.failure_code = 'provider_unreachable')
                    """,
            nativeQuery = true)
    BigDecimal refundWithheldFee(@Param("pledgeId") UUID pledgeId);
}
