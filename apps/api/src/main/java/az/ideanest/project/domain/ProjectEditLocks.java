package az.ideanest.project.domain;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which fields a campaign in this state may no longer have changed. §5.3.
 *
 * <p><strong>A table, not a chain of conditionals</strong>, for the reason
 * {@link ProjectStateMachine} gives about the edges of §6.1. The rule is read in
 * one screen and asserted against the specification in a plain unit test. Written
 * as {@code if (project.getLaunchedAt() != null)} in the two services that enforce
 * it, the same rule becomes two rules — and the first time one of them is extended
 * and the other is not, a campaign's goal and its reward prices disagree about when
 * a campaign counts as launched.
 *
 * <p><strong>No Spring, no database, and not even an entity.</strong> The answer is
 * a function of one enum value. That is what lets the whole of §5.3's post-launch
 * half be checked without starting PostgreSQL, and it is what lets the campaign
 * module and the reward module ask the same question rather than two similar ones.
 *
 * <h2>What counts as launched</h2>
 *
 * <p><strong>The state, not {@code launched_at}.</strong> The two mostly agree —
 * the timestamp is stamped on the edge into {@link ProjectState#LIVE} and nothing
 * clears it — and the state was chosen for three reasons.
 *
 * <ol>
 *   <li>It is what the client can see. The editor response carries {@code state}
 *       beside {@code lockedFields}, so a creator asking why a field is disabled
 *       has the answer in the same body. {@code launchedAt} is in that body too,
 *       but the state is the thing every other refusal in this module is phrased
 *       in — a 409 already says "a project in SUBMITTED cannot move to LIVE".
 *   <li>It keeps the rule a pure function of an enum, which is what makes the
 *       table below a table and its test a unit test. A rule that reads a
 *       timestamp off an entity needs an entity to be checked.
 *   <li>The database has already written the same list down.
 *       {@code projects_public_states_are_fully_specified} in {@code V6} names
 *       exactly the nine states below and calls them the states "the public has
 *       seen and may have pledged to". Two statements of one rule that can be read
 *       side by side are better than one statement and one derivation.
 * </ol>
 *
 * <p>Where they could disagree is a row repaired by hand — a state moved without
 * its timestamp, or the reverse. The state is the column the audit trail records
 * and the check constraint reads, so it is the one to trust.
 *
 * <h2>What an ended campaign locks</h2>
 *
 * <p><strong>Exactly what a live one locks, and no more.</strong>
 * {@link ProjectState#SUSPENDED}, {@link ProjectState#CANCELED},
 * {@link ProjectState#UNSUCCESSFUL}, {@link ProjectState#SUCCESSFUL} and
 * everything after them are all reached from {@link ProjectState#LIVE}, so they
 * are launched and the table freezes the same five things forever. A cancelled
 * campaign is therefore not editable as though it were a draft: its goal, its
 * deadline, and its prices are the record of what backers were asked for, and
 * nothing about ending a campaign makes that safe to rewrite.
 *
 * <p>It deliberately does not lock <em>more</em>. The fields that stay editable —
 * the title, the summary, the story, the risks section, the cover — are the page a
 * backer reads after the money has moved, and §5.5 obliges a creator to keep them
 * informed of delays and to answer complaints. Freezing the story of a campaign
 * that has just ended would freeze the one place the creator can say so.
 *
 * <p>{@link ProjectState#REJECTED} locks nothing, and is the one terminal state
 * that does not. It never became public and nobody ever pledged to it, so there is
 * no promise to protect; that it is terminal already makes every edit to it inert,
 * which is a better reason to leave it alone than a rule.
 *
 * <p>This type answers the question and does not enforce it.
 * {@code ProjectEditingService} and {@code RewardService} are what refuse a write,
 * because a refusal is an HTTP status and a message written for a creator.
 */
public final class ProjectEditLocks {

    /**
     * §5.3, as data. Every state appears; a state mapped to an empty set is one in
     * which nothing has been promised yet.
     */
    private static final Map<ProjectState, Set<LockedField>> LOCKED = lockedFields();

    private ProjectEditLocks() {
    }

    private static Map<ProjectState, Set<LockedField>> lockedFields() {
        Map<ProjectState, Set<LockedField>> locked = new EnumMap<>(ProjectState.class);

        // Nothing here has been shown to anybody who could act on it. A draft is
        // confidential, a pre-launch page advertises no numbers, a submission is in
        // front of a moderator rather than a backer, and an approved or scheduled
        // campaign has not opened. Every one of these is a campaign whose creator is
        // still deciding what to ask for.
        locked.put(ProjectState.DRAFT, none());
        locked.put(ProjectState.PRELAUNCH, none());
        locked.put(ProjectState.SUBMITTED, none());
        locked.put(ProjectState.CHANGES_REQUESTED, none());
        locked.put(ProjectState.APPROVED, none());
        locked.put(ProjectState.SCHEDULED, none());

        // Terminal without ever having been public. See the class comment: there is
        // no promise to protect, and nothing follows REJECTED anyway.
        locked.put(ProjectState.REJECTED, none());

        // Taking money, or having taken it. Somebody has decided to back this
        // campaign on the strength of a goal, a deadline, and a price, and §5.1
        // resolves it by comparing the pledged total against that goal at that
        // deadline. Moving any of the three afterwards changes what a backer agreed
        // to without asking them.
        locked.put(ProjectState.LIVE, afterLaunch());
        // IDN-EXT-01 (#32). The deadline does move once, but only through the extension's own
        // edge (#34) — never through the editor — so the lock is the same as LIVE's.
        locked.put(ProjectState.CLOSING_WINDOW, afterLaunch());
        locked.put(ProjectState.EXTENDED, afterLaunch());
        locked.put(ProjectState.WITHDRAWN, afterLaunch());
        locked.put(ProjectState.SUSPENDED, afterLaunch());
        locked.put(ProjectState.CANCELED, afterLaunch());
        locked.put(ProjectState.SUCCESSFUL, afterLaunch());
        locked.put(ProjectState.UNSUCCESSFUL, afterLaunch());
        locked.put(ProjectState.COLLECTING, afterLaunch());
        locked.put(ProjectState.LATE_PLEDGE, afterLaunch());
        locked.put(ProjectState.FULFILLING, afterLaunch());
        locked.put(ProjectState.COMPLETED, afterLaunch());

        return Collections.unmodifiableMap(locked);
    }

    private static Set<LockedField> none() {
        return EnumSet.noneOf(LockedField.class);
    }

    /**
     * Everything §5.3 freezes at launch, which today is every rule this vocabulary
     * has.
     *
     * <p>Written as "all of them" rather than as a list, because a
     * {@link LockedField} that some launched state did not lock would be a rule with
     * no home: §5.3 freezes each of them at the same moment and for the same reason.
     * A future rule that binds earlier — a submission whose goal is frozen while a
     * moderator reads it — is a new entry in the table above, not an exception here.
     */
    private static Set<LockedField> afterLaunch() {
        return EnumSet.allOf(LockedField.class);
    }

    /**
     * What may no longer be changed in this state.
     *
     * <p>Immutable. A caller that could add to the returned set would be editing the
     * rule for every campaign in the process.
     */
    public static Set<LockedField> lockedIn(ProjectState state) {
        Set<LockedField> fields = LOCKED.get(state);
        return fields == null ? Set.of() : Collections.unmodifiableSet(fields);
    }

    /** Whether §5.3 refuses this particular change in this state. */
    public static boolean locks(ProjectState state, LockedField field) {
        return lockedIn(state).contains(field);
    }

    /**
     * The names a client reads out of {@code lockedFields}, for one request body.
     *
     * <p>Filtered by resource because the names are keys in a {@code PATCH} body and
     * a campaign's body has no {@code price} in it. A response that listed one would
     * be telling the editor to disable an input that does not exist on that screen,
     * and the first client to trust the list literally would show the creator a
     * locked field they never had.
     *
     * <p>In declaration order, so the list is stable between requests and a client
     * comparing two responses is comparing the rule rather than an iteration order.
     */
    public static List<String> lockedFieldNamesIn(ProjectState state, LockedField.Resource resource) {
        return lockedIn(state).stream()
                .filter(field -> field.resource() == resource)
                .map(LockedField::wireName)
                .toList();
    }
}
