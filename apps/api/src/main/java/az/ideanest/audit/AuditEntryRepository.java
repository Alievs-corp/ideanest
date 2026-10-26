package az.ideanest.audit;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Audit rows.
 *
 * <p><strong>Read and insert, and the interface says so.</strong>
 * {@link JpaRepository} brings {@code delete}, {@code deleteAll} and
 * {@code deleteAllInBatch} with it, and every one of them is a statement V21's
 * trigger refuses — so calling one is a runtime failure rather than a compile
 * failure, which is the one thing about this file worth knowing. Narrowing to
 * {@code Repository} and declaring five methods by hand would fix that and cost the
 * paging, sorting and flushing the writing side actually uses; the enforcement that
 * matters is in the database, and it does not care which interface asked.
 *
 * <p>The two unpaged finders are the two questions §7.2 says this table exists to
 * answer. The paged ones below them are the same questions asked by AD-14's viewer
 * (#314), which cannot read an unbounded list into a browser; every one of the six
 * shapes is index-backed by V21, and {@link az.ideanest.audit.AuditTrailFilter} explains
 * why there are these and not an arbitrary combination.
 *
 * <h2>Ordered by {@code occurred_at}, and it used to be by the identifier</h2>
 *
 * <p>The old argument was that both columns say the same thing — the identifier is a UUID
 * v7 and carries the millisecond it was minted in (§7.3) — and that only one of them is
 * unique, so ordering by the primary key gave the same sequence with a cursor that was one
 * value. The two columns are written by two different clocks, and #404 is what that cost:
 * the identifier is minted in the application when the row is built, {@code occurred_at} is
 * {@code DEFAULT now()} and is taken when the insert lands, and the viewer displays the
 * second while the query ordered by the first. A page headed "newest first" opened on last
 * month.
 *
 * <p>So every query below orders by {@code (occurred_at DESC, id DESC)} — the column the
 * screen shows, with the key breaking the tie — and the keyset predicate is the row-value
 * comparison that pair implies, written out rather than as a tuple because JPQL has no
 * row constructor. Two rows written by one transaction share an instant often enough that
 * the tie is the normal case here rather than the edge one, which is why the cursor carries
 * both halves. {@link AuditCursor} holds the whole argument.
 *
 * <p>The cost is stated rather than hidden, as it was before: V21's indexes all end in
 * {@code occurred_at DESC}, so this is now the index's own order on the filtered reads and
 * the tiebreak applies to the handful of rows sharing one timestamp. The unfiltered read
 * walks {@code audit_logs_occurred_at_idx} instead of the primary key. Adding {@code id} to
 * each index would make the keyset exact rather than nearly exact, and is an index rebuild
 * on the one table that only ever grows — worth doing on the day the tie is measurably
 * expensive, and not before.
 */
public interface AuditEntryRepository extends JpaRepository<AuditEntry, UUID> {

    /** What has been done to one thing, most recent first. */
    List<AuditEntry> findByEntityTypeAndEntityIdOrderByOccurredAtDesc(String entityType, UUID entityId);

    /** What one account has done, most recent first. */
    List<AuditEntry> findByActorIdOrderByOccurredAtDesc(UUID actorId);

    /**
     * The newest row of one action about one thing, if there is one.
     *
     * <p>The one read outside the viewer: the editor asks when the clock last refused to open a
     * campaign (#589), and the trail is where that is already written. The entity half of V21's
     * index finds the rows and the action is filtered among them, which for one campaign is tens.
     */
    Optional<AuditEntry> findFirstByEntityTypeAndEntityIdAndActionOrderByOccurredAtDesc(
            String entityType, UUID entityId, String action);

    /*
     * The eight below are AD-14's viewer, and every one of them carries the same two extra
     * predicates since #404: `from` inclusive and `to` exclusive.
     *
     * Two parameters on eight queries rather than sixteen queries, which is the opposite of
     * the call `PaymentTransactionRepository` makes about its own status filter, and the
     * difference is where the column sits in the index. A status is not in any of V41's
     * indexes at all, so a filter on it either has its own query and its own index or it is a
     * scan — the plan genuinely differs. `occurred_at` is the *trailing* column of all four of
     * V21's indexes, so a bound on it is a narrower scan of the range the query had already
     * chosen, and the plan for a bounded read and an unbounded one is the same plan with
     * different endpoints. Doubling this file to express that would be sixteen methods
     * describing eight queries.
     *
     * **NEITHER BOUND IS EVER NULL, and that is not a style choice.** The obvious form is
     * `(:from IS NULL OR e.occurredAt >= :from)`, which is what `UserRepository.search` has
     * done with a String since #104. It does not work here: `:from IS NULL` gives Hibernate a
     * parameter with no type to infer from, and the whole of AD-14 answered 500 —
     * `AuditTrailOrderingApiTests` and every audit case in `ConsoleReadApiTests` went red
     * together, which is how this was found rather than shipped.
     *
     * So "no bound" is expressed as a bound that excludes nothing: `AuditTrailFilter.SINCE`
     * and `UNTIL` are the two ends of the column's useful range, and the caller substitutes
     * them for a null. The predicate is then a plain comparison against a typed path, the
     * planner sees an ordinary range scan over an index that is already ordered by this
     * column, and there is no untyped parameter anywhere in the file.
     *
     * `hidden` follows the same rule. It is the actions a reader asked to leave out — the
     * routine screen reads (`AuditAction.isRoutineRead`) — or, when they asked for nothing to
     * be left out, `AuditTrail.NOTHING_HIDDEN`, a one-element list no action is ever spelled
     * as. `NOT IN` an empty list is not valid SQL and an optional list is an untyped
     * parameter, so the list is never empty and never absent, and the clause is one more
     * filter on rows the index has already found rather than a different plan.
     *
     * The actor-and-kind pair (and the actor on one entity) arrived when the screen started
     * sending both: the filter used to drop the actor whenever a kind was set, so "what did
     * this person do to campaigns" quietly answered "what has anybody done to campaigns".
     * They read the actor index, which is the narrower of the two for any one person, and
     * filter the kind in the rows it returns.
     */

    /** The newest rows in the table. AD-14's default view: what has just happened. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newest(
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The page after the row at {@code (before, beforeId)}, for {@link #newest}. Keyset: a row written mid-read shifts nothing. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE (e.occurredAt < :before OR (e.occurredAt = :before AND e.id < :beforeId))
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestBefore(
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The newest rows about one kind of entity. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.entityType = :entityType
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfType(
            @Param("entityType") String entityType,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The page after the row at {@code (before, beforeId)}, for {@link #newestOfType}. Keyset: a row written mid-read shifts nothing. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.entityType = :entityType
              AND (e.occurredAt < :before OR (e.occurredAt = :before AND e.id < :beforeId))
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfTypeBefore(
            @Param("entityType") String entityType,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The newest rows about one entity. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.entityType = :entityType AND e.entityId = :entityId
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfEntity(
            @Param("entityType") String entityType,
            @Param("entityId") UUID entityId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The page after the row at {@code (before, beforeId)}, for {@link #newestOfEntity}. Keyset: a row written mid-read shifts nothing. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.entityType = :entityType AND e.entityId = :entityId
              AND (e.occurredAt < :before OR (e.occurredAt = :before AND e.id < :beforeId))
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfEntityBefore(
            @Param("entityType") String entityType,
            @Param("entityId") UUID entityId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The newest rows written by one actor. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.actorId = :actorId
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestByActor(
            @Param("actorId") UUID actorId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The page after the row at {@code (before, beforeId)}, for {@link #newestByActor}. Keyset: a row written mid-read shifts nothing. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.actorId = :actorId
              AND (e.occurredAt < :before OR (e.occurredAt = :before AND e.id < :beforeId))
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestByActorBefore(
            @Param("actorId") UUID actorId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** What one actor did to one kind of entity: "what did this person do to campaigns". */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.actorId = :actorId
              AND e.entityType = :entityType
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfTypeByActor(
            @Param("actorId") UUID actorId,
            @Param("entityType") String entityType,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The page after the row at {@code (before, beforeId)}, for {@link #newestOfTypeByActor}. Keyset: a row written mid-read shifts nothing. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.actorId = :actorId
              AND e.entityType = :entityType
              AND (e.occurredAt < :before OR (e.occurredAt = :before AND e.id < :beforeId))
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfTypeByActorBefore(
            @Param("actorId") UUID actorId,
            @Param("entityType") String entityType,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** What one actor did to one entity. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.actorId = :actorId
              AND e.entityType = :entityType AND e.entityId = :entityId
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfEntityByActor(
            @Param("actorId") UUID actorId,
            @Param("entityType") String entityType,
            @Param("entityId") UUID entityId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);

    /** The page after the row at {@code (before, beforeId)}, for {@link #newestOfEntityByActor}. Keyset: a row written mid-read shifts nothing. */
    @Query(
            """
            SELECT e FROM AuditEntry e
            WHERE e.actorId = :actorId
              AND e.entityType = :entityType AND e.entityId = :entityId
              AND (e.occurredAt < :before OR (e.occurredAt = :before AND e.id < :beforeId))
              AND e.occurredAt >= :from AND e.occurredAt < :to
              AND e.action NOT IN :hidden
            ORDER BY e.occurredAt DESC, e.id DESC
            """)
    List<AuditEntry> newestOfEntityByActorBefore(
            @Param("actorId") UUID actorId,
            @Param("entityType") String entityType,
            @Param("entityId") UUID entityId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("hidden") Collection<String> hidden,
            Pageable limit);
}
