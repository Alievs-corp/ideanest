package az.ideanest.admin.api;

import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditTrailPage;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * AD-14's trail on the wire — #314.
 *
 * <p>Every field of {@code audit_logs} is here except the primary key's neighbours that
 * mean nothing outside the database. That is the opposite of the choice
 * {@code LoggedTransaction} makes about a provider's raw response, and the difference is
 * what the two tables are for: a payment row is evidence about a person's money and is read
 * for one fact at a time, and an audit row <em>is</em> the disclosure — withholding half of
 * it would leave an investigator reading the database directly, which is the outcome this
 * screen exists to avoid.
 *
 * <p>{@code sourceAddress} and {@code userAgent} are on the wire, and §17.4's redaction has
 * already been applied to them on the way in — see the audit package's own note. An address
 * that reached the column is one the platform decided to keep, and a viewer that hid it
 * would be hiding it from the only people entitled to see it.
 *
 * <p><strong>{@code TrailPage} rather than {@code Page} since #404, and the rename is a
 * correctness fix.</strong> {@code PaymentLogResponses} had a nested record of the same name,
 * springdoc names a schema by its simple name, and the two collided: {@code #/components/
 * schemas/Page} held the payment log's shape, and {@code GET /v1/admin/audit} pointed at it.
 * The published contract said this endpoint returned {@code pledgeId} and {@code projectId}
 * and said nothing about {@code entries}. Harmless while both were merely wrong; adding a
 * field to one of them makes the other wrong in a new way, which is how a contract nobody
 * can trust gets built one honest change at a time. Nothing consumed the generated alias.
 *
 * <p><strong>{@code TrailEntry} rather than {@code Entry}, for the same reason.</strong> A survey
 * response also had a nested {@code Entry}, and {@code TrailPage.entries} was published pointing
 * at the survey's shape.
 */
final class AuditTrailResponses {

    private AuditTrailResponses() {
    }

    static TrailPage of(AuditTrailPage page) {
        return new TrailPage(
                page.filter().entityType(),
                page.filter().entityId(),
                page.filter().actorId(),
                page.filter().from(),
                page.filter().to(),
                page.filter().hideReads(),
                page.entries().stream().map(AuditTrailResponses::entry).toList(),
                page.nextCursor() == null ? null : page.nextCursor().encode());
    }

    private static TrailEntry entry(AuditEntry row) {
        return new TrailEntry(
                row.getId(),
                row.getOccurredAt(),
                row.getActorType().name(),
                row.getActorId(),
                row.getOnBehalfOfId(),
                row.getAction(),
                row.getEntityType(),
                row.getEntityId(),
                row.getOutcome().name(),
                row.getSourceAddress(),
                row.getUserAgent(),
                row.getRequestId(),
                row.getTraceId(),
                row.getDetail());
    }

    /**
     * One page of the trail, newest first.
     *
     * @param entityType which kind of thing was asked about, echoed and absent when the
     *     request asked about every kind. Echoed rather than assumed because the service
     *     normalises a filter it has no index for — see {@code AuditTrailFilter} — and a
     *     client has no other way to learn that the question it asked was narrowed
     * @param entityId which thing, echoed for the same reason
     * @param actorId which account's actions, echoed for the same reason
     * @param from the earliest instant included, echoed and absent when unbounded — #404
     * @param to the first instant excluded, echoed and absent when unbounded. Echoed like the
     *     three above, and here it is doing slightly different work: the range survives every
     *     branch of the normalisation, so seeing it come back unchanged beside an entity
     *     filter that was narrowed is how a client learns the two are independent
     * @param hideReads whether the routine screen reads were left out, echoed
     * @param entries the matching rows, newest first
     * @param nextCursor what to send as {@code after} for the next page, or absent when
     *     this was the last one. An opaque string since #404 rather than an identifier: the
     *     trail is ordered by {@code occurred_at}, which is not unique, so the cursor
     *     carries the instant and the identifier that breaks its tie. Encoded rather than
     *     published as two fields so that no client comes to depend on which columns the
     *     ordering uses — {@code AuditCursor} makes the argument. There is no total either:
     *     counting a table nothing is ever deleted from is a scan for a number that is
     *     stale before it renders. Present only when another row exists: the service reads one
     *     row past the page to know, so a full last page no longer sends the reader to a request
     *     that comes back empty
     */
    record TrailPage(
            String entityType,
            UUID entityId,
            UUID actorId,
            Instant from,
            Instant to,
            boolean hideReads,
            List<TrailEntry> entries,
            String nextCursor) {
    }

    /**
     * One privileged action.
     *
     * @param id the row, which is a UUID v7 and therefore its own position in the trail
     * @param occurredAt from the database's clock, not the application's
     * @param actorType {@code USER}, {@code MODERATOR} or {@code SYSTEM} — what the actor
     *     was acting as, which is not the same question as who they were
     * @param actorId the account, or absent when the actor was the platform itself
     * @param onBehalfOfId whom the action was taken for, when it was taken by somebody
     *     else. Absent on almost every row, and the reason the column exists is AD-04's
     *     impersonation (#299), which is unbuilt and blocked on a policy question
     * @param action the spelling from {@code AuditAction}, which is a closed set on the
     *     writing side and open text in the column — so a client filtering on
     *     {@code project.approved} is not silently missing rows spelled another way
     * @param entityType what kind of thing was acted upon
     * @param entityId which one
     * @param outcome {@code SUCCEEDED} or {@code REFUSED}. A refusal is a row: the attempt
     *     is what happened, and a trail holding only the successes is a trail that cannot
     *     show somebody trying
     * @param sourceAddress where the request came from, redacted on the way in
     * @param userAgent what made it, redacted on the way in
     * @param requestId the correlation identifier this row shares with §18.1's log lines
     * @param traceId the same, for the tracing backend
     * @param detail what the action recorded about itself, in the vocabulary of whatever
     *     wrote it. Prose, and only ever rendered as text
     */
    record TrailEntry(
            UUID id,
            Instant occurredAt,
            String actorType,
            UUID actorId,
            UUID onBehalfOfId,
            String action,
            String entityType,
            UUID entityId,
            String outcome,
            String sourceAddress,
            String userAgent,
            String requestId,
            String traceId,
            String detail) {
    }
}
