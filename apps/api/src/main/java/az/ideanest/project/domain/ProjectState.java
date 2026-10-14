package az.ideanest.project.domain;

/**
 * Where a campaign is in its life.
 *
 * <p>Exactly the seventeen states of {@code docs/architecture.md} §6.1, in the
 * order they are reached. The edges between them are
 * {@link ProjectStateMachine}, which is deliberately a separate type: the states
 * are a vocabulary and the transitions are a rule, and a rule that lives inside
 * the enum it constrains cannot be replaced or read on its own.
 *
 * <p>The names are also the values stored in {@code projects.state} and in
 * {@code project_state_transitions}, and both columns carry a check constraint
 * listing them. Renaming one is therefore a migration, which is the correct
 * amount of friction for renaming a state that appears in an audit trail.
 *
 * <p><strong>{@code COLLECTING} and {@code LATE_PLEDGE} are gone (#45).</strong> They were
 * the stored-card collection at close and the late-pledge window after it, both retired by
 * IDN-EXT-01. V106 moves any campaign still in one to {@code FULFILLING}, the only edge out
 * of either, and takes them out of {@code projects.state}'s check. They stay allowed in
 * {@code project_state_transitions}, whose rows are history; nothing in this service reads
 * that table's state columns back into this enum.
 */
public enum ProjectState {

    /** Being written. Visible to its creator, and to nobody else. */
    DRAFT,

    /**
     * A public teaser page collecting followers before the campaign exists in
     * any fundable form.
     *
     * <p><strong>Not reversible</strong>, contrary to what this comment said
     * before #39 built it. §6.1 has no {@code PRELAUNCH → DRAFT} edge and
     * {@link ProjectStateMachine} never had one; adding it would be a change to
     * the specification rather than an implementation detail, and it would mean a
     * page people have already followed can be withdrawn out from under them. A
     * creator who wants to stop is one submission or one cancellation away, and
     * both of those are recorded.
     */
    PRELAUNCH,

    /** Waiting in the moderation queue. The creator can no longer edit freely. */
    SUBMITTED,

    /**
     * Returned to the creator with a note. Distinct from {@link #REJECTED}
     * because it is an invitation to resubmit, and the creator's next action is
     * different in each case.
     */
    CHANGES_REQUESTED,

    /** Terminal. Refused by moderation; §5.4 lists most of the reasons. */
    REJECTED,

    /** Cleared by moderation, waiting for the creator to launch it. */
    APPROVED,

    /** Cleared, with a launch date set. A job launches it when that date passes. */
    SCHEDULED,

    /** Taking pledges. Almost everything about the campaign is frozen here. */
    LIVE,

    /**
     * IDN-EXT-01 (#32): the seven days after the first deadline. Still taking pledges and
     * badged "Closing soon"; the creator may extend at 50% or more and withdraw at 80% or
     * more. On D+8 it is decided. Nothing moves a campaign here until #33.
     */
    CLOSING_WINDOW,

    /**
     * IDN-EXT-01 (#32): the creator extended the deadline once, to no later than 60 days
     * after the first. Still taking pledges, with no ceiling on funding. Nothing moves a
     * campaign here until #34.
     */
    EXTENDED,

    /**
     * Terminal. Stopped by trust and safety, with pledges left uncollected.
     * Terminal by design: a suspension that could be lifted back into
     * {@link #LIVE} would restart a funding window whose deadline has moved on.
     */
    SUSPENDED,

    /** Terminal. Stopped by the creator before the deadline. Nothing is charged. */
    CANCELED,

    /**
     * Decided at or above the threshold (§5.1), and the creator has not withdrawn yet. Moves
     * to {@link #WITHDRAWN} when they do, or automatically 30 days after the end.
     */
    SUCCESSFUL,

    /** Terminal. The deadline passed below goal. Nothing is charged and no fee is due. */
    UNSUCCESSFUL,

    /**
     * IDN-EXT-01 (#32): the creator withdrew the money, which closes the campaign — no pledge
     * is accepted after it. Decided and successful, and owes every reward. Nothing moves a
     * campaign here until #41.
     */
    WITHDRAWN,

    /** Withdrawn, rewards being delivered. */
    FULFILLING,

    /** Terminal. Everything delivered. */
    COMPLETED;

    /**
     * Whether nothing follows this state.
     *
     * <p>Derived from the transition table rather than declared as a flag, so
     * that the two cannot disagree. A state listed as terminal while the table
     * still allowed an edge out of it would be a lie the compiler could not
     * catch.
     */
    public boolean isTerminal() {
        return ProjectStateMachine.allowedFrom(this).isEmpty();
    }
}
