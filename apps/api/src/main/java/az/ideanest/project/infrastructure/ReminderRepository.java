package az.ideanest.project.infrastructure;

import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.Reminder;
import az.ideanest.shared.EmailAddress;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Launch reminders, by the five questions actually asked of them.
 *
 * <p><strong>There is no {@code save}-shaped registration.</strong> Registering is
 * {@link #insertIfAbsent}, a native {@code INSERT ... ON CONFLICT DO NOTHING},
 * because idempotency is the whole feature and a read-then-write check in Java
 * loses the race between two clicks: both would see no row, both would insert,
 * and the campaign would owe that person two emails. The unique indexes in
 * {@code V10} are the check, and this statement is how they get to be it.
 *
 * <p><strong>And no {@code deleteBy...} beyond the two below.</strong> Withdrawal
 * removes the row rather than stamping it — see the header of {@code V10} for why
 * that is a deliberate departure from §7.3's soft delete.
 */
public interface ReminderRepository extends JpaRepository<Reminder, UUID> {

    /**
     * Records a reminder, or does nothing because it is already recorded.
     *
     * <p>Native because JPQL has no {@code ON CONFLICT}, and the conflict is the
     * point: the database decides whether this call created the row, and both
     * outcomes are success as far as the caller is concerned. Exactly one of
     * {@code userId} and {@code email} is non-null; {@code reminders_one_identity}
     * refuses the rest.
     *
     * <p>The cast on {@code email} is required rather than cosmetic. A JDBC
     * parameter binds as {@code varchar}, and PostgreSQL will not choose the
     * {@code citext} unique index for a {@code varchar} comparison — so without
     * it, {@code ON CONFLICT} would not match the index it is meant to match and
     * the statement would fail to compile against the table.
     *
     * <p>{@code DO NOTHING} rather than {@code DO UPDATE}: a repeat registration
     * must not write to the row at all. The alternative would have been to rotate
     * the unsubscribe token on every call, and the row of somebody who has already
     * asked is not something an unauthenticated caller who knows their address
     * should be able to change.
     *
     * @return 1 when this call created the row, 0 when it already existed. Both are
     *     success; the caller uses it only to decide what to log
     */
    @Modifying
    @Query(
            value =
                    """
                    INSERT INTO reminders (id, project_id, user_id, email)
                    VALUES (:id, :projectId, :userId, CAST(:email AS citext))
                    ON CONFLICT DO NOTHING
                    """,
            nativeQuery = true)
    int insertIfAbsent(
            @Param("id") UUID id,
            @Param("projectId") UUID projectId,
            @Param("userId") UUID userId,
            @Param("email") String email);

    /** This account's reminder on this campaign, if it has one. */
    Optional<Reminder> findByProjectIdAndUserId(UUID projectId, UUID userId);

    /** Whether this account has a reminder on this campaign, which the campaign page asks per view. */
    boolean existsByProjectIdAndUserId(UUID projectId, UUID userId);

    /** The reminder registered for a bare address on this campaign, if there is one. */
    Optional<Reminder> findByProjectIdAndEmail(UUID projectId, EmailAddress email);

    /** The row an unsubscribe link belongs to, found by its hash. */
    Optional<Reminder> findByUnsubscribeTokenHash(byte[] unsubscribeTokenHash);

    /**
     * How many people are waiting for this campaign.
     *
     * <p>Counted rather than denormalised onto {@code projects}. §7.3 permits
     * selective denormalisation for read performance, and this is not one of the
     * places that needs it: the count is read on a pre-launch page view and on the
     * creator's pre-launch tab, both of which are rare next to a project page, and
     * a cached counter is one more number that can be wrong in a way nobody
     * notices until a creator asks why it disagrees with their email list.
     */
    long countByProjectId(UUID projectId);

    /**
     * Removes an account's reminder. Idempotent by construction — nothing to
     * remove is the state the caller asked for.
     *
     * @return how many rows went, so the endpoint can log a withdrawal that
     *     actually withdrew something
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Reminder r WHERE r.projectId = :projectId AND r.userId = :userId")
    int deleteForAccount(@Param("projectId") UUID projectId, @Param("userId") UUID userId);

    /** Removes whichever row an unsubscribe link identifies. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Reminder r WHERE r.unsubscribeTokenHash = :tokenHash")
    int deleteByToken(@Param("tokenHash") byte[] tokenHash);

    /**
     * Removes the anonymous reminder an account has just superseded by
     * registering while signed in.
     *
     * <p>The one case where an address row and an account row are provably the
     * same person: the address came from the account's own {@code users} row,
     * which registration verified. Without this, that person is on the list twice
     * and gets the launch notice twice — the XOR shape of the table cannot see
     * that the two identities are one, and this is where that is closed.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Reminder r WHERE r.projectId = :projectId AND r.email = :email")
    int deleteForEmail(@Param("projectId") UUID projectId, @Param("email") EmailAddress email);

    /**
     * The next page of people on this campaign who have not been told yet.
     *
     * <p>Identifiers rather than entities, because the sweep loads and claims each
     * row in its own transaction: a batch of detached entities read in one
     * transaction and written in another would be a set of decisions taken against
     * a state that has since moved.
     *
     * <p>Ordered by identifier, which is a UUID v7 and therefore in creation order
     * (§7.3) — so a sweep interrupted halfway resumes in the order people signed
     * up rather than in whatever order the planner felt like.
     */
    @Query(
            """
            SELECT r.id FROM Reminder r
            WHERE r.projectId = :projectId AND r.notifiedAt IS NULL
            ORDER BY r.id
            """)
    List<UUID> findPending(@Param("projectId") UUID projectId, Pageable page);

    /**
     * Campaigns that are live and still owe somebody a launch notice.
     *
     * <p>What the scheduled sweep asks, and the reason the sweep is the authority
     * rather than the event: this question is answered from the state of the
     * world, so a launch whose after-commit event was lost to a crash — or one
     * performed by a future {@code campaign-launcher} job that does not publish
     * the event at all — is still found here a minute later.
     */
    @Query(
            """
            SELECT DISTINCT r.projectId FROM Reminder r
            WHERE r.notifiedAt IS NULL
              AND r.projectId IN (SELECT p.id FROM Project p WHERE p.state = :state)
            """)
    List<UUID> findProjectsOwedNotices(@Param("state") ProjectState state, Pageable page);

    /**
     * Claims one reminder for sending, if nobody has claimed it already.
     *
     * <p>A conditional update rather than a read followed by a write, for the
     * reason {@code CollaboratorRepository#claim} gives: two sweeps arriving
     * together would both see an unnotified row and both send, and only the
     * database can decide which one wins — but only if the condition is part of
     * the statement.
     *
     * <p>It also mints the unsubscribe token, in the same statement, because the
     * link that goes into the message and the stamp that says the message was
     * produced are one fact — {@code reminders_notice_carries_its_way_out} refuses
     * a row that has one without the other.
     *
     * @return 1 when this call is the one that claimed it, 0 when somebody else did
     */
    // The persistence context is cleared afterwards because the row this
    // statement changed may also be loaded as an entity in the same transaction;
    // without it the caller's next read would come from the first-level cache and
    // would still describe an unnotified reminder.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            """
            UPDATE Reminder r
            SET r.notifiedAt = :at, r.unsubscribeTokenHash = :tokenHash
            WHERE r.id = :id AND r.notifiedAt IS NULL
            """)
    int claim(@Param("id") UUID id, @Param("at") Instant at, @Param("tokenHash") byte[] tokenHash);
}
