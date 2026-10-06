package az.ideanest.notification.infrastructure;

import az.ideanest.notification.domain.Notification;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Notification rows, by the questions anything asks of them. */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /**
     * One recipient and one channel with held notifications due to be combined.
     *
     * <p><strong>Two queries rather than one, and this is the first.</strong> A digest is a
     * grouping, so the claim cannot be a single {@code FOR UPDATE SKIP LOCKED} statement the
     * way {@link #claimNext} is: an aggregate and a row lock do not compose — PostgreSQL
     * refuses {@code FOR UPDATE} with {@code GROUP BY} — so what is asked here is which group
     * to do next, and {@link #claimHeld} locks it. The window between the two is what
     * {@code JobLease} closes; {@code DigestAssembly} says so at length.
     *
     * <p>Ordered by the oldest thing waiting, so that the person who has been waiting longest
     * is served first and nothing starves behind a busier recipient.
     *
     * <p>{@code notifications_held_idx} is
     * {@code (recipient_id, channel, occurred_at) WHERE state = 'HELD'} — written by V26 for
     * exactly this query, before there was one.
     *
     * @param cutoff the end of the most recently closed digest period. A row from after it
     *     belongs to the period in progress — {@code DigestWindow} argues the bound
     * @param now the instant eligibility is judged against, which excludes a group whose
     *     rows are backing off from a refused digest
     */
    @Query(
            """
            SELECT new az.ideanest.notification.infrastructure.HeldGroup(n.recipientId, n.channel)
              FROM Notification n
             WHERE n.state = az.ideanest.notification.domain.NotificationState.HELD
               AND n.occurredAt < :cutoff
               AND n.nextAttemptAt <= :now
             GROUP BY n.recipientId, n.channel
             ORDER BY min(n.occurredAt), n.recipientId, n.channel
            """)
    List<HeldGroup> heldGroups(@Param("cutoff") Instant cutoff, @Param("now") Instant now, Pageable page);

    /**
     * The held notifications of one group, locked so that no other pass can take them.
     *
     * <p>{@code SKIP LOCKED} rather than a wait, as everywhere else in this service. Unlike
     * {@link #claimNext} it is not what makes the claim correct — a partial group would
     * produce a digest missing some of its members — and what makes it correct is the job's
     * lease. It is here so that a pass which somehow overlaps another returns a short digest
     * and leaves the rest {@code HELD} for the next one, rather than blocking on a row until
     * its own lease expires.
     *
     * <p>Oldest first, so a rendered digest reads in the order the things happened.
     *
     * @param limit the bound on one message. A digest of ten thousand items is not a message —
     *     {@code NotificationProperties.Digest} argues the number and what happens to the
     *     remainder
     */
    @Query(
            value =
                    """
                    SELECT n.* FROM notifications n
                     WHERE n.state = 'HELD'
                       AND n.recipient_id = :recipientId
                       AND n.channel = :channel
                       AND n.occurred_at < :cutoff
                       AND n.next_attempt_at <= :now
                     ORDER BY n.occurred_at, n.id
                     LIMIT :limit
                     FOR UPDATE OF n SKIP LOCKED
                    """,
            nativeQuery = true)
    List<Notification> claimHeld(
            @Param("recipientId") UUID recipientId,
            @Param("channel") String channel,
            @Param("cutoff") Instant cutoff,
            @Param("now") Instant now,
            @Param("limit") int limit);

    /**
     * Has this outbox event already been fanned out?
     *
     * <p><strong>The whole of the redelivery guarantee's fast path.</strong>
     * {@code OutboxMessage}'s contract is at-least-once, in those words, so the same
     * event arrives again whenever a relay crashes between the transport accepting a
     * message and the relay committing. The fan-out asks this first and does nothing
     * when the answer is yes.
     *
     * <p>One question for the whole event rather than one per (recipient, channel),
     * and that is correct because the fan-out is atomic: every row for one event is
     * written by one transaction, so either all of them exist or none do. The
     * {@code notifications_event_recipient_channel_key} index is what makes the answer
     * true under concurrency rather than merely usually right — two relays that both
     * got past this check meet on the unique index, and the second one fails.
     */
    boolean existsByEventId(UUID eventId);

    /**
     * The next notification this sender may take, locked so that no other sender can.
     *
     * <p>{@code OutboxEventRepository#claimNext} makes the argument in full and every
     * word of it applies here: the claim <em>is</em> the lock, because a read followed
     * by an update cannot be made correct — two senders read the same row, both conclude
     * it is theirs, and both send, and the second message is a duplicate nobody can see.
     * {@code SKIP LOCKED} rather than a wait, so several replicas divide the queue
     * between them instead of meeting on a row.
     *
     * <p><strong>No ordering clause, unlike the outbox.</strong> The relay refuses to
     * publish an event while an earlier pending one for the same aggregate exists,
     * because a consumer that saw {@code pledge.collected} before
     * {@code pledge.confirmed} would build a state that never existed. A notification is
     * not a state transition — it is a message to a person — and two of them arriving
     * out of order is a mild annoyance rather than a corruption, so the queue is ordered
     * by eligibility and nothing blocks behind anything.
     *
     * <p><strong>{@code HELD} is not a candidate, and that is still right now that something
     * drains it.</strong> The point of the state is that a digest is not sent one row at a
     * time; {@link #heldGroups} and {@link #claimHeld} are the pair {@code notification-digest}
     * claims by, and the two queues never contend for a row because a row is in exactly one
     * state.
     *
     * <p>Native rather than JPQL because JPQL cannot express {@code SKIP LOCKED} at all.
     */
    @Query(
            value =
                    """
                    SELECT n.* FROM notifications n
                     WHERE n.state = 'PENDING'
                       AND n.next_attempt_at <= :now
                     ORDER BY n.next_attempt_at, n.id
                     LIMIT 1
                     FOR UPDATE OF n SKIP LOCKED
                    """,
            nativeQuery = true)
    Optional<Notification> claimNext(@Param("now") Instant now);

    /**
     * The first page of somebody's in-app inbox, newest first.
     *
     * <p>Keyset paging, like every other paged read in the service: an offset re-reads and
     * re-skips everything before it, and it also skips a row when something is inserted
     * between two requests — which for an inbox means a notification the reader never sees.
     *
     * <p>Ordered by {@code occurredAt} and then by the identifier. The identifier is a
     * UUID v7 and therefore time-ordered, which is what breaks a tie between two
     * notifications produced from one event in the same instant.
     *
     * <h2>Two methods rather than one with a null-tolerant cursor</h2>
     *
     * <p><strong>This was one query and the one query did not work.</strong> #85 wrote it as a
     * single method whose predicate began {@code :before IS NULL OR …}, which reads well and
     * fails at run time the moment it is called with no cursor: PostgreSQL cannot infer a type
     * for a parameter that appears only as the operand of {@code IS NULL}, and answers
     * {@code could not determine data type of parameter $2}. Nothing noticed, because until
     * #246 there was no endpoint and therefore no caller — a query with no caller is a query
     * nobody has run.
     *
     * <p>So the cursor and the absence of one are two statements. The cost is a duplicated
     * {@code WHERE} clause; the alternative is a cast in the JPQL, which would be one
     * expression that has to stay in step with the column's type and would still leave the
     * planner a parameter it cannot use for the index. These two are each exactly what
     * {@code notifications_inbox_idx} answers.
     */
    @Query(
            """
            SELECT n FROM Notification n
             WHERE n.recipientId = :recipientId
               AND n.channel = az.ideanest.notification.domain.NotificationChannel.IN_APP
               AND n.state = az.ideanest.notification.domain.NotificationState.SENT
             ORDER BY n.occurredAt DESC, n.id DESC
            """)
    List<Notification> inbox(@Param("recipientId") UUID recipientId, Pageable page);

    /**
     * The page below a cursor, newest first.
     *
     * @param before the {@code occurredAt} of the last row of the previous page
     * @param beforeId the identifier of that same row, which is what makes the cursor total
     *     rather than merely usually distinct
     */
    @Query(
            """
            SELECT n FROM Notification n
             WHERE n.recipientId = :recipientId
               AND n.channel = az.ideanest.notification.domain.NotificationChannel.IN_APP
               AND n.state = az.ideanest.notification.domain.NotificationState.SENT
               AND (n.occurredAt < :before
                    OR (n.occurredAt = :before AND n.id < :beforeId))
             ORDER BY n.occurredAt DESC, n.id DESC
            """)
    List<Notification> inboxBefore(
            @Param("recipientId") UUID recipientId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable page);

    /** The one number an inbox badge is made of. */
    @Query(
            """
            SELECT count(n) FROM Notification n
             WHERE n.recipientId = :recipientId
               AND n.channel = az.ideanest.notification.domain.NotificationChannel.IN_APP
               AND n.state = az.ideanest.notification.domain.NotificationState.SENT
               AND n.readAt IS NULL
            """)
    long countUnread(@Param("recipientId") UUID recipientId);

    /**
     * One notification, if it is this person's.
     *
     * <p>The recipient is part of the query rather than checked after the read, so that
     * "not yours" and "does not exist" are the same answer and neither confirms the
     * existence of somebody else's row.
     */
    Optional<Notification> findByIdAndRecipientId(UUID id, UUID recipientId);

    /**
     * The inbox row written by the same event, for the same person, as another channel's row.
     *
     * <p>What a push carries as {@code notificationId} so that tapping it can mark the inbox
     * row read (#160). Empty when the event wrote none — in-app switched off for the
     * category, or a type with no in-app column. Any state: the two rows were written
     * together, and the push may be sent a moment before the inbox row is stamped.
     *
     * <p>{@code notifications_event_recipient_channel_key} makes the answer unique and is the
     * index it is read through.
     */
    @Query(
            """
            SELECT inbox.id FROM Notification inbox, Notification other
             WHERE other.id = :id
               AND inbox.eventId = other.eventId
               AND inbox.recipientId = other.recipientId
               AND inbox.channel = az.ideanest.notification.domain.NotificationChannel.IN_APP
            """)
    Optional<UUID> inboxIdOf(@Param("id") UUID id);
}
