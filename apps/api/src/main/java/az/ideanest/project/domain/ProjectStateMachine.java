package az.ideanest.project.domain;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Which state a campaign may move to from the one it is in.
 *
 * <p><strong>A table, not a chain of conditionals.</strong> The edges of §6.1
 * are data here, so the whole rule can be read in one screen and asserted
 * against the specification in a unit test. Written as {@code if (state ==
 * SUBMITTED && ...)} spread across the services that perform each transition,
 * the same rule becomes a thing nobody can enumerate, and the question "can a
 * suspended campaign go live again" acquires as many answers as there are call
 * sites.
 *
 * <p><strong>No Spring and no database.</strong> Nothing here is injected,
 * loaded, or persisted, which is what makes {@code ProjectStateMachineTests}
 * a plain unit test that starts no container. The rule that decides whether a
 * campaign may start taking money should not need PostgreSQL to be checked.
 *
 * <p>This type answers the question and does not perform the move.
 * {@code ProjectTransitionService} is the only thing that performs it, because a
 * transition is not complete until it has been recorded.
 */
public final class ProjectStateMachine {

    /**
     * §6.1, verbatim. A state absent from a value set is terminal, and
     * {@link ProjectState#isTerminal()} reads exactly that rather than keeping a
     * second list that could disagree.
     */
    private static final Map<ProjectState, Set<ProjectState>> ALLOWED = allowedEdges();

    private ProjectStateMachine() {
    }

    private static Map<ProjectState, Set<ProjectState>> allowedEdges() {
        Map<ProjectState, Set<ProjectState>> edges = new EnumMap<>(ProjectState.class);

        // A draft either opens a pre-launch page first or goes straight to
        // review. Both are the creator's choice and neither is a prerequisite
        // for the other.
        edges.put(ProjectState.DRAFT, EnumSet.of(ProjectState.PRELAUNCH, ProjectState.SUBMITTED));
        edges.put(ProjectState.PRELAUNCH, EnumSet.of(ProjectState.SUBMITTED));

        // The three moderation outcomes. CHANGES_REQUESTED is the only one the
        // creator can act on, and the loop back to SUBMITTED is what makes it
        // worth having as a state of its own rather than a flag on a rejection.
        edges.put(
                ProjectState.SUBMITTED,
                EnumSet.of(ProjectState.CHANGES_REQUESTED, ProjectState.REJECTED, ProjectState.APPROVED));
        edges.put(ProjectState.CHANGES_REQUESTED, EnumSet.of(ProjectState.SUBMITTED));

        // An approved campaign launches now or on a date. SCHEDULED exists
        // because a launch time is a marketing decision, and the creator is
        // frequently asleep when it arrives.
        edges.put(ProjectState.APPROVED, EnumSet.of(ProjectState.SCHEDULED, ProjectState.LIVE));
        edges.put(ProjectState.SCHEDULED, EnumSet.of(ProjectState.LIVE));

        // What can happen to a campaign that is taking money: staff stop it,
        // the creator stops it, or the deadline arrives and §5.1 decides which
        // of the two outcomes applies.
        edges.put(
                ProjectState.LIVE,
                EnumSet.of(
                        ProjectState.SUSPENDED,
                        ProjectState.CANCELED,
                        ProjectState.SUCCESSFUL,
                        ProjectState.UNSUCCESSFUL,
                        // IDN-EXT-01 (#32). The direct edges above stay until #33 moves the
                        // decision to D+8; these are the ones that replace them.
                        ProjectState.CLOSING_WINDOW,
                        ProjectState.EXTENDED,
                        ProjectState.WITHDRAWN));

        // Collection, then delivery. LATE_PLEDGE sits beside FULFILLING rather
        // than before it because a project may skip it entirely.
        // The seven days after the first deadline: extend, withdraw, or be decided on D+8.
        edges.put(
                ProjectState.CLOSING_WINDOW,
                EnumSet.of(
                        ProjectState.EXTENDED,
                        ProjectState.WITHDRAWN,
                        ProjectState.SUCCESSFUL,
                        ProjectState.UNSUCCESSFUL,
                        ProjectState.SUSPENDED,
                        ProjectState.CANCELED));
        // Extended once: withdraw, or be decided when the extension ends. No second EXTENDED.
        edges.put(
                ProjectState.EXTENDED,
                EnumSet.of(
                        ProjectState.WITHDRAWN,
                        ProjectState.SUCCESSFUL,
                        ProjectState.UNSUCCESSFUL,
                        ProjectState.SUSPENDED,
                        ProjectState.CANCELED));
        // COLLECTING stays until stage 2 retires collection at close (#39) and stage 4
        // removes it (#45); WITHDRAWN is where a successful campaign goes under IDN-EXT-01.
        edges.put(ProjectState.SUCCESSFUL, EnumSet.of(ProjectState.COLLECTING, ProjectState.WITHDRAWN));
        edges.put(ProjectState.WITHDRAWN, EnumSet.of(ProjectState.FULFILLING));
        edges.put(ProjectState.COLLECTING, EnumSet.of(ProjectState.LATE_PLEDGE, ProjectState.FULFILLING));
        edges.put(ProjectState.LATE_PLEDGE, EnumSet.of(ProjectState.FULFILLING));
        edges.put(ProjectState.FULFILLING, EnumSet.of(ProjectState.COMPLETED));

        // REJECTED, SUSPENDED, CANCELED, UNSUCCESSFUL, and COMPLETED are absent
        // on purpose: nothing follows them. Money has either been refused or
        // been settled, and a campaign that could leave one of these states
        // would reopen a decision backers were already told about.

        return Collections.unmodifiableMap(edges);
    }

    /** The state every campaign starts in. There is no way into the graph other than this. */
    public static ProjectState initial() {
        return ProjectState.DRAFT;
    }

    /**
     * Every state reachable in one step, which is empty for a terminal state.
     *
     * <p>Immutable. A caller that could add an edge to the returned set would be
     * editing the rule for the whole process.
     */
    public static Set<ProjectState> allowedFrom(ProjectState from) {
        Set<ProjectState> targets = ALLOWED.get(from);
        return targets == null ? Set.of() : Collections.unmodifiableSet(targets);
    }

    /**
     * Whether the move is one §6.1 permits.
     *
     * <p>A state to itself is refused. Re-submitting an already submitted
     * campaign is not a no-op to be tolerated quietly: it would append an audit
     * row saying a change happened when none did, and the database refuses that
     * row anyway.
     */
    public static boolean isAllowed(ProjectState from, ProjectState to) {
        return allowedFrom(from).contains(to);
    }
}
