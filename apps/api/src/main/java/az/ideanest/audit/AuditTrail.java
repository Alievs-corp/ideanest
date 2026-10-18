package az.ideanest.audit;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The reading side of the trail — AD-14, #314.
 *
 * <p>{@link AuditLog} writes and this reads, and they are two classes because they have
 * two different callers and two different rules. Every module in the service writes; one
 * screen reads. Putting the read on {@code AuditLog} would put a paged query in front of
 * every caller whose only business here is one {@code record} call, and the first
 * consequence of that is somebody reading the trail inside the transaction that is
 * writing to it.
 *
 * <p><strong>There is no authorisation here, and that is deliberate.</strong> This class
 * is inside the cross-cutting package everything may depend on, and a staff check in it
 * would either duplicate {@code shared.access.PlatformStaff} or make the audit package
 * depend on a module. The refusal lives one layer out, in
 * {@code admin.application.AuditTrailService}, which is also where reading the trail is
 * itself recorded — the two belong in the same place, for the reason
 * {@code UserAdministrationService} gives about a search.
 *
 * <p><strong>Read-only, and it could not be otherwise.</strong> V21 puts a trigger on the
 * table that raises on UPDATE, DELETE and TRUNCATE. Nothing here could edit a row if it
 * tried, which is the property that makes the trail worth reading at all.
 */
@Service
public class AuditTrail {

    /**
     * What {@code NOT IN :hidden} is given when nothing is hidden: one spelling no action has.
     *
     * <p>An empty list would be {@code NOT IN ()}, which is not SQL. Actions are lower-case
     * {@code entity.verb}, so a value with spaces and capitals cannot collide with one.
     */
    static final List<String> NOTHING_HIDDEN = List.of("NO ACTION IS SPELLED THIS WAY");

    /** The routine screen reads, which {@link AuditTrailFilter#hideReads} leaves out. */
    static final List<String> ROUTINE_READS = AuditAction.routineReads();

    private final AuditEntryRepository entries;

    public AuditTrail(AuditEntryRepository entries) {
        this.entries = entries;
    }

    /**
     * One page of the trail, newest first.
     *
     * @param filter one of the shapes {@link AuditTrailFilter} allows. Normalised
     *     first, so the page and the echoed filter describe the same query
     * @param before the last row on the previous page, or null for the first page. A
     *     position rather than a row that has to exist: it names an instant and an
     *     identifier, and every row below that pair is still a correct answer even if the
     *     row it was taken from has been detached with its partition
     * @param limit already clamped by the caller, which is where a request's shape is
     *     decided
     */
    @Transactional(readOnly = true)
    public AuditTrailPage page(AuditTrailFilter filter, AuditCursor before, int limit) {
        AuditTrailFilter asked = filter.normalised();
        // One row more than the page, so "is there more" is a fact rather than a guess. A cursor
        // on every full page sent the reader to a last request that came back empty - on the one
        // screen where an empty page reads as "nothing else happened".
        List<AuditEntry> fetched = rowsFor(asked, before, PageRequest.ofSize(limit + 1));
        boolean more = fetched.size() > limit;
        List<AuditEntry> rows = more ? fetched.subList(0, limit) : fetched;

        AuditCursor nextCursor = more ? cursorTo(rows.get(rows.size() - 1)) : null;
        return new AuditTrailPage(asked, rows, nextCursor);
    }

    /**
     * Where the page just served ends.
     *
     * <p>Both halves, because the trail is ordered by a column that is not unique — see
     * {@link AuditCursor}, which is where the whole of #404's ordering argument lives.
     */
    private static AuditCursor cursorTo(AuditEntry last) {
        return new AuditCursor(last.getOccurredAt(), last.getId());
    }

    /**
     * What has happened to one thing, most recent first and unpaged.
     *
     * <p>The detail read: a screen showing one campaign, one report or one account asks
     * for its history and gets all of it. Unpaged because the history of a single entity
     * is bounded by how many times somebody acted on it, which is tens rather than
     * thousands — unlike the trail as a whole, which is bounded by nothing.
     */
    @Transactional(readOnly = true)
    public List<AuditEntry> historyOf(String entityType, UUID entityId) {
        return entries.findByEntityTypeAndEntityIdOrderByOccurredAtDesc(entityType, entityId);
    }

    /**
     * The rows, from whichever of the twelve queries this filter names.
     *
     * <p>The date range is not a branch — it is two parameters every one of them takes, and the
     * hidden actions are a third ({@link #NOTHING_HIDDEN} when nothing is).
     * {@code occurred_at} is the trailing column of all four of V21's indexes, so a bound on
     * it narrows whichever scan the shape above already chose; {@code AuditEntryRepository}
     * carries the argument for why that makes it a parameter here and a separate query on the
     * payment log, and for why neither bound is ever null.
     */
    private List<AuditEntry> rowsFor(AuditTrailFilter filter, AuditCursor before, PageRequest page) {
        // The effective bounds, never null: `AuditTrailFilter.SINCE` and `UNTIL` stand in for
        // an absent one, because a nullable instant in the predicate is a parameter Hibernate
        // cannot type. The filter still echoes the nulls, so the response says "unbounded".
        Instant from = filter.effectiveFrom();
        Instant to = filter.effectiveTo();
        List<String> hidden = filter.hideReads() ? ROUTINE_READS : NOTHING_HIDDEN;
        UUID actor = filter.actorId();
        String type = filter.entityType();

        if (filter.isSingleEntity()) {
            UUID entity = filter.entityId();
            if (actor != null) {
                return before == null
                        ? entries.newestOfEntityByActor(actor, type, entity, from, to, hidden, page)
                        : entries.newestOfEntityByActorBefore(
                                actor, type, entity, before.at(), before.id(), from, to, hidden, page);
            }
            return before == null
                    ? entries.newestOfEntity(type, entity, from, to, hidden, page)
                    : entries.newestOfEntityBefore(type, entity, before.at(), before.id(), from, to, hidden, page);
        }
        if (type != null) {
            if (actor != null) {
                return before == null
                        ? entries.newestOfTypeByActor(actor, type, from, to, hidden, page)
                        : entries.newestOfTypeByActorBefore(
                                actor, type, before.at(), before.id(), from, to, hidden, page);
            }
            return before == null
                    ? entries.newestOfType(type, from, to, hidden, page)
                    : entries.newestOfTypeBefore(type, before.at(), before.id(), from, to, hidden, page);
        }
        if (actor != null) {
            return before == null
                    ? entries.newestByActor(actor, from, to, hidden, page)
                    : entries.newestByActorBefore(actor, before.at(), before.id(), from, to, hidden, page);
        }
        return before == null
                ? entries.newest(from, to, hidden, page)
                : entries.newestBefore(before.at(), before.id(), from, to, hidden, page);
    }
}
