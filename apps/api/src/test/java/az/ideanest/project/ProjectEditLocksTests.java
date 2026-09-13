package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.project.domain.LockedField;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectState;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The lock table, checked against the specification rather than against itself.
 *
 * <p>{@link #SPECIFICATION} is transcribed from {@code docs/architecture.md} §5.3
 * and §6.1 by hand, for the reason {@link ProjectStateMachineTests} gives: a test
 * that read the table out of {@link ProjectEditLocks} and compared it with itself
 * would pass for any table at all, including one that lets a live campaign move its
 * goal. Two independent statements of one rule are what makes a disagreement
 * between them visible.
 *
 * <p>Because the specification lists every state and every rule, the comparison
 * covers what is <em>not</em> locked as well — all eighty pairs — rather than a
 * sample somebody chose. Nine of those pairs are what stops a creator repricing a
 * reward somebody has already bought.
 *
 * <p>A plain unit test. Which fields are frozen is a function of one enum value,
 * which is why it was written as a table in the first place; asserting it needs no
 * Spring context, no database, and no campaign.
 */
class ProjectEditLocksTests {

    /**
     * §5.3, transcribed. Every state appears on the left; a state with nothing on
     * the right is one in which everything is still editable.
     *
     * <p>The right-hand side is the same for every launched state, and it is written
     * out per state anyway. A specification that said "and the same for the other
     * eight" would stop being a second opinion the moment somebody decided one of
     * the eight was different.
     */
    private static final String SPECIFICATION =
            """
            DRAFT             ->
            PRELAUNCH         ->
            SUBMITTED         ->
            CHANGES_REQUESTED ->
            REJECTED          ->
            APPROVED          ->
            SCHEDULED         ->
            LIVE              -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            CLOSING_WINDOW    -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            EXTENDED          -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            SUSPENDED         -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            CANCELED          -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            SUCCESSFUL        -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            UNSUCCESSFUL      -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            WITHDRAWN         -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            COLLECTING        -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            LATE_PLEDGE       -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            FULFILLING        -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            COMPLETED         -> GOAL, DURATION_DAYS, SCHEDULED_LAUNCH_AT, REWARD_PRICE, REWARD_QUANTITY_DECREASE
            """;

    /**
     * The nine states {@code projects_public_states_are_fully_specified} names in
     * {@code V6}, transcribed from the migration.
     *
     * <p>The database calls these "a campaign the public has seen and may have
     * pledged to" and refuses a row in one of them without a goal, a duration, a
     * launch, and a deadline. That is the same set this table calls launched, and
     * asserting the two agree is what keeps the definition of "launched" from
     * quietly becoming two definitions — one in Java and one in SQL.
     */
    private static final Set<ProjectState> PUBLIC_STATES = EnumSet.of(
            ProjectState.LIVE,
            ProjectState.SUSPENDED,
            ProjectState.CANCELED,
            ProjectState.SUCCESSFUL,
            ProjectState.UNSUCCESSFUL,
            ProjectState.COLLECTING,
            ProjectState.LATE_PLEDGE,
            ProjectState.FULFILLING,
            ProjectState.COMPLETED,
            // IDN-EXT-01 (#32), added to V12's, V13's and V16's predicates by V74.
            ProjectState.CLOSING_WINDOW,
            ProjectState.EXTENDED,
            ProjectState.WITHDRAWN);

    private static Map<ProjectState, Set<LockedField>> specification() {
        Map<ProjectState, Set<LockedField>> locked = new EnumMap<>(ProjectState.class);
        for (String line : SPECIFICATION.lines().filter(line -> !line.isBlank()).toList()) {
            String[] halves = line.split("->", -1);
            ProjectState state = ProjectState.valueOf(halves[0].trim());
            Set<LockedField> fields = EnumSet.noneOf(LockedField.class);
            for (String field : halves[1].split(",")) {
                if (!field.isBlank()) {
                    fields.add(LockedField.valueOf(field.trim()));
                }
            }
            locked.put(state, fields);
        }
        return locked;
    }

    @Test
    @DisplayName("the table names every state, and no state is missing from it")
    void theTableCoversEveryState() {
        // A state absent from the table would fall through to "nothing is locked",
        // which is the wrong default for a state nobody thought about.
        assertThat(specification().keySet()).containsExactlyInAnyOrder(ProjectState.values());
    }

    @Test
    @DisplayName("every field §5.3 freezes is frozen, and nothing else is")
    void theTableIsTheSpecification() {
        Map<ProjectState, Set<LockedField>> expected = specification();

        for (ProjectState state : ProjectState.values()) {
            Set<LockedField> locked = expected.get(state);
            for (LockedField field : LockedField.values()) {
                boolean shouldBeLocked = locked.contains(field);
                assertThat(ProjectEditLocks.locks(state, field))
                        .withFailMessage(
                                "§5.3 %s %s in %s, and the table %s",
                                shouldBeLocked ? "freezes" : "does not freeze",
                                field,
                                state,
                                shouldBeLocked ? "allows the edit" : "refuses it")
                        .isEqualTo(shouldBeLocked);
            }
        }
    }

    @Test
    @DisplayName("what is locked is exactly what the database calls a public state")
    void launchedMeansTheSameThingInJavaAndInSql() {
        for (ProjectState state : ProjectState.values()) {
            boolean isPublic = PUBLIC_STATES.contains(state);

            // The definition of "launched", asserted against the other place it is
            // written down. If a state is added to one list and not the other, this
            // is where that is noticed rather than in a support ticket about a
            // campaign whose goal moved after it took money.
            assertThat(ProjectEditLocks.lockedIn(state).isEmpty())
                    .withFailMessage(
                            "%s is %sa public state in V6, so it should %slock the fields §5.3 freezes",
                            state, isPublic ? "" : "not ", isPublic ? "" : "not ")
                    .isEqualTo(!isPublic);
        }
    }

    @Test
    @DisplayName("nothing is locked before launch, in any of the seven states before it")
    void everythingIsEditableBeforeLaunch() {
        Set<ProjectState> beforeLaunch = EnumSet.of(
                ProjectState.DRAFT,
                ProjectState.PRELAUNCH,
                ProjectState.SUBMITTED,
                ProjectState.CHANGES_REQUESTED,
                ProjectState.APPROVED,
                ProjectState.SCHEDULED);

        for (ProjectState state : beforeLaunch) {
            // Nothing here has been shown to anybody who could pledge on the strength
            // of it. A campaign in front of a moderator is still a campaign whose
            // creator is deciding what to ask for.
            assertThat(ProjectEditLocks.lockedIn(state)).isEmpty();
        }
    }

    @Test
    @DisplayName("an ended campaign locks what a live one locks, and a rejected one locks nothing")
    void endedCampaignsStayFrozen() {
        Set<ProjectState> endedAfterLaunching = EnumSet.of(
                ProjectState.SUSPENDED,
                ProjectState.CANCELED,
                ProjectState.UNSUCCESSFUL,
                ProjectState.COMPLETED);

        for (ProjectState state : endedAfterLaunching) {
            // The deliberate decision, asserted so that it cannot be reversed by
            // accident: a campaign nobody can pledge to is not editable as though it
            // were a draft. Its goal, its deadline, and its prices are the record of
            // what backers were asked for.
            assertThat(ProjectEditLocks.lockedIn(state))
                    .containsExactlyInAnyOrder(LockedField.values());
        }

        // The one terminal state that never became public. Nothing was promised, and
        // nothing follows REJECTED anyway, so every edit to it is already inert.
        assertThat(ProjectEditLocks.lockedIn(ProjectState.REJECTED)).isEmpty();
    }

    @Test
    @DisplayName("the names are the keys of the PATCH body a client sends")
    void theNamesAreTheOnesAClientCanMatch() {
        // Not the column, not the Java field. A client cannot disable an input it has
        // no name for, and it must not have to translate one.
        assertThat(LockedField.GOAL.wireName()).isEqualTo("goal");
        assertThat(LockedField.DURATION_DAYS.wireName()).isEqualTo("durationDays");
        assertThat(LockedField.SCHEDULED_LAUNCH_AT.wireName()).isEqualTo("scheduledLaunchAt");
        assertThat(LockedField.REWARD_PRICE.wireName()).isEqualTo("price");
        assertThat(LockedField.REWARD_QUANTITY_DECREASE.wireName()).isEqualTo("limitQuantity");
    }

    @Test
    @DisplayName("a response lists only the fields its own body has")
    void lockedFieldNamesAreScopedToOneResource() {
        assertThat(ProjectEditLocks.lockedFieldNamesIn(ProjectState.DRAFT, LockedField.Resource.PROJECT))
                .isEmpty();

        // What the editor reads out of lockedFields, in a stable order.
        assertThat(ProjectEditLocks.lockedFieldNamesIn(ProjectState.LIVE, LockedField.Resource.PROJECT))
                .containsExactly("goal", "durationDays", "scheduledLaunchAt");

        // A campaign's PATCH body has no price in it. Listing one would tell the
        // editor to disable an input that is not on that screen.
        assertThat(ProjectEditLocks.lockedFieldNamesIn(ProjectState.LIVE, LockedField.Resource.REWARD))
                .containsExactly("price", "limitQuantity");
    }

    @Test
    @DisplayName("the locked set cannot be edited by a caller")
    void theTableIsImmutable() {
        Set<LockedField> locked = ProjectEditLocks.lockedIn(ProjectState.LIVE);

        // A mutable set here would let one caller change §5.3 for every campaign in
        // the process, and the next request would be refused for no visible reason.
        assertThatThrownBy(() -> locked.add(LockedField.GOAL)).isInstanceOf(UnsupportedOperationException.class);

        Set<LockedField> draft = ProjectEditLocks.lockedIn(ProjectState.DRAFT);
        assertThatThrownBy(() -> draft.add(LockedField.GOAL)).isInstanceOf(UnsupportedOperationException.class);

        List<String> names = ProjectEditLocks.lockedFieldNamesIn(ProjectState.LIVE, LockedField.Resource.PROJECT);
        assertThatThrownBy(() -> names.add("title")).isInstanceOf(UnsupportedOperationException.class);
    }
}
