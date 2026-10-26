package az.ideanest.project.infrastructure;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of the moderation submission queue, as the query answers it.
 *
 * <p>A Spring Data interface projection, which is the only shape that fits: the query
 * behind it is native, because the thing it needs — the most recent transition
 * <em>into</em> a campaign's current state, one row per campaign — is a
 * {@code LATERAL} join and JPQL has no way to spell one. The alternatives were both
 * worse. Loading each campaign's whole transition history and taking the last matching
 * row is a query per campaign on a screen whose whole purpose is a list. A correlated
 * {@code MAX(created_at)} subquery is expressible, and picks two rows when a campaign
 * was resubmitted twice inside one millisecond.
 *
 * <p><strong>The creator is an identifier and nothing else.</strong> The name and the
 * profile path belong to {@code users}, which is the user module's table, and this
 * query does not join it — the boundary this codebase keeps is not only about Java
 * imports. {@code CampaignSubmissionQueue} resolves them in one call through
 * {@code UserAccounts}, which is the contract that module publishes for exactly this.
 *
 * <p><strong>{@link #getCursor()} is the transition's identifier, not the
 * campaign's.</strong> Both are UUIDv7 and therefore sortable, and they sort by
 * different things: a campaign's identifier is stamped when it was <em>created</em>,
 * and the queue is ordered by when it was <em>submitted</em>. A campaign drafted in
 * January and submitted in June belongs behind one drafted and submitted in May, and
 * paging on the campaign's identifier would put it in front — which on a queue worked
 * oldest-first means the oldest waiting campaign is the one that gets skipped.
 */
public interface SubmissionQueueRow {

    /** The keyset cursor: the identifier of the transition that put it in this state. */
    UUID getCursor();

    /** When it entered the state it is in — the moment the creator submitted it. */
    Instant getEnteredAt();

    /** The note on that transition, or null. */
    String getNote();

    UUID getProjectId();

    String getTitle();

    String getSlug();

    String getState();

    /**
     * The funding target, or null.
     *
     * <p>§5.3 refuses a submission without one, so every row in the {@code SUBMITTED}
     * queue has it. The other states this endpoint serves are history, and a campaign
     * rejected before a rule existed is exactly the row that would otherwise throw
     * here.
     */
    BigDecimal getGoalAmount();

    String getCurrency();

    /** The launch time its creator set, or null. An approval waits for it (#595). */
    Instant getScheduledLaunchAt();

    UUID getCreatorId();
}
