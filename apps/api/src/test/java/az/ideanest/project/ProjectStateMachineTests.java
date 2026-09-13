package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.project.application.ProjectTransitionService;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.ProjectStateMachine;
import az.ideanest.support.ProductionClasses;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The transition table, checked against the specification rather than against
 * itself.
 *
 * <p>{@link #SPECIFICATION} is transcribed from {@code docs/architecture.md} §6.1
 * by hand. That is the point: a test that read the edges out of
 * {@link ProjectStateMachine} and compared them with themselves would pass for any
 * table at all, including one where a suspended campaign can go live again. Two
 * independent statements of the same rule are what makes a disagreement between
 * them visible.
 *
 * <p>Because the specification lists every state, the comparison also covers every
 * transition that is <em>not</em> allowed — all two hundred and fifty-six ordered
 * pairs — rather than a sample somebody chose.
 *
 * <p>A plain unit test. The state machine needs no Spring and no database, which is
 * why it was written as a table in the first place.
 */
class ProjectStateMachineTests {

    /**
     * §6.1, transcribed. Every state appears on the left; a state with nothing on
     * the right is terminal.
     */
    private static final String SPECIFICATION =
            """
            DRAFT             -> PRELAUNCH, SUBMITTED
            PRELAUNCH         -> SUBMITTED
            SUBMITTED         -> CHANGES_REQUESTED, REJECTED, APPROVED
            CHANGES_REQUESTED -> SUBMITTED
            REJECTED          ->
            APPROVED          -> SCHEDULED, LIVE
            SCHEDULED         -> LIVE
            LIVE              -> SUSPENDED, CANCELED, CLOSING_WINDOW, EXTENDED, WITHDRAWN
            CLOSING_WINDOW    -> EXTENDED, WITHDRAWN, SUCCESSFUL, UNSUCCESSFUL, SUSPENDED, CANCELED
            EXTENDED          -> WITHDRAWN, SUCCESSFUL, UNSUCCESSFUL, SUSPENDED, CANCELED
            SUSPENDED         ->
            CANCELED          ->
            SUCCESSFUL        -> COLLECTING, WITHDRAWN
            UNSUCCESSFUL      ->
            WITHDRAWN         -> FULFILLING
            COLLECTING        -> LATE_PLEDGE, FULFILLING
            LATE_PLEDGE       -> FULFILLING
            FULFILLING        -> COMPLETED
            COMPLETED         ->
            """;

    /** The five states §6.1 draws to {@code [*]}. */
    private static final Set<ProjectState> TERMINAL = EnumSet.of(
            ProjectState.REJECTED,
            ProjectState.CANCELED,
            ProjectState.UNSUCCESSFUL,
            ProjectState.SUSPENDED,
            ProjectState.COMPLETED);

    private static Map<ProjectState, Set<ProjectState>> specification() {
        Map<ProjectState, Set<ProjectState>> edges = new EnumMap<>(ProjectState.class);
        for (String line : SPECIFICATION.lines().filter(line -> !line.isBlank()).toList()) {
            String[] halves = line.split("->", -1);
            ProjectState from = ProjectState.valueOf(halves[0].trim());
            Set<ProjectState> targets = EnumSet.noneOf(ProjectState.class);
            for (String target : halves[1].split(",")) {
                if (!target.isBlank()) {
                    targets.add(ProjectState.valueOf(target.trim()));
                }
            }
            edges.put(from, targets);
        }
        return edges;
    }

    @Test
    @DisplayName("§6.1 names every state, and the enum has no extra one")
    void theStatesAreExactlyTheSpecifiedOnes() {
        // An extra state in the enum would be a state no transition can reach and
        // the database's check constraint would refuse, discovered at run time.
        assertThat(specification().keySet()).containsExactlyInAnyOrder(ProjectState.values());
    }

    @Test
    @DisplayName("every allowed edge is allowed, and every other pair is refused")
    void theTableIsTheSpecification() {
        Map<ProjectState, Set<ProjectState>> expected = specification();

        for (ProjectState from : ProjectState.values()) {
            Set<ProjectState> allowed = expected.get(from);
            for (ProjectState to : ProjectState.values()) {
                boolean shouldBeAllowed = allowed.contains(to);
                assertThat(ProjectStateMachine.isAllowed(from, to))
                        .withFailMessage(
                                "§6.1 %s %s -> %s, and the state machine %s",
                                shouldBeAllowed ? "allows" : "does not allow",
                                from,
                                to,
                                shouldBeAllowed ? "refuses it" : "allows it")
                        .isEqualTo(shouldBeAllowed);
            }
        }
    }

    @Test
    @DisplayName("a state never transitions to itself")
    void selfTransitionsAreRefused() {
        for (ProjectState state : ProjectState.values()) {
            // Not merely pointless: it would append an audit row claiming a change
            // that did not happen, and the database refuses that row.
            assertThat(ProjectStateMachine.isAllowed(state, state)).isFalse();
        }
    }

    @Test
    @DisplayName("nothing follows a terminal state")
    void terminalStatesHaveNoWayOut() {
        for (ProjectState state : ProjectState.values()) {
            boolean terminal = TERMINAL.contains(state);

            assertThat(ProjectStateMachine.allowedFrom(state).isEmpty())
                    .withFailMessage("%s should %sbe terminal", state, terminal ? "" : "not ")
                    .isEqualTo(terminal);
            // isTerminal() is derived from the table rather than declared, so this
            // asserts that the derivation agrees with §6.1's [*] arrows.
            assertThat(state.isTerminal()).isEqualTo(terminal);
        }
    }

    @Test
    @DisplayName("a terminal campaign cannot be reopened by any route")
    void terminalCampaignsStayTerminal() {
        for (ProjectState terminal : TERMINAL) {
            for (ProjectState target : ProjectState.values()) {
                // The case that matters commercially: a suspended or cancelled
                // campaign going live again would restart a funding window whose
                // deadline has moved on, against backers who were told it stopped.
                assertThat(ProjectStateMachine.isAllowed(terminal, target))
                        .withFailMessage("%s is terminal and must not reach %s", terminal, target)
                        .isFalse();
            }
        }
    }

    @Test
    @DisplayName("every campaign starts in DRAFT")
    void theInitialStateIsDraft() {
        assertThat(ProjectStateMachine.initial()).isEqualTo(ProjectState.DRAFT);
    }

    @Test
    @DisplayName("the allowed set cannot be edited by a caller")
    void theTableIsImmutable() {
        Set<ProjectState> allowed = ProjectStateMachine.allowedFrom(ProjectState.DRAFT);

        // A mutable set here would let one caller change the rule for the whole
        // process, and the next request would be refused for no visible reason.
        assertThatThrownBy(() -> allowed.add(ProjectState.LIVE))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    // -----------------------------------------------------------------------
    // The entity refuses what the table refuses
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the entity refuses a transition the table does not allow")
    void theEntityRefusesAnImpossibleMove() {
        Project project = Project.open(UUID.randomUUID(), "A campaign", "a-campaign", "AZN");

        // The service checks first and answers 409. This is the second refusal, and
        // it is what makes the invariant a property of the object rather than of
        // one service method.
        assertThatThrownBy(() -> project.applyTransition(ProjectState.LIVE, Instant.now()))
                .isInstanceOf(IllegalStateException.class);
        assertThat(project.getState()).isEqualTo(ProjectState.DRAFT);
    }

    @Test
    @DisplayName("going live stamps the launch and computes the deadline from the duration")
    void goingLiveComputesTheDeadline() {
        Project project = Project.open(UUID.randomUUID(), "A campaign", "a-campaign", "AZN");
        project.setDurationDays(30);
        project.applyTransition(ProjectState.SUBMITTED, Instant.now());
        project.applyTransition(ProjectState.APPROVED, Instant.now());

        Instant launchedAt = Instant.parse("2026-03-01T09:00:00Z");
        project.applyTransition(ProjectState.LIVE, launchedAt);

        assertThat(project.getLaunchedAt()).isEqualTo(launchedAt);
        // Stored rather than derived: §5.3 freezes the deadline at launch, and a
        // value recomputed later would move if the duration were ever edited.
        assertThat(project.getDeadline()).isEqualTo(Instant.parse("2026-03-31T09:00:00Z"));
    }

    @Test
    @DisplayName("going live without a duration is refused rather than left without a deadline")
    void goingLiveNeedsADuration() {
        Project project = Project.open(UUID.randomUUID(), "A campaign", "a-campaign", "AZN");
        project.applyTransition(ProjectState.SUBMITTED, Instant.now());
        project.applyTransition(ProjectState.APPROVED, Instant.now());

        // §5.1 resolves a campaign by comparing its total against its goal at its
        // deadline. A live campaign with no deadline cannot be resolved at all.
        assertThatThrownBy(() -> project.applyTransition(ProjectState.LIVE, Instant.now()))
                .isInstanceOf(IllegalStateException.class);
    }

    // -----------------------------------------------------------------------
    // One path, enforced
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("only the transition service moves a project's state")
    void stateChangesGoThroughOneService() {
        // Shared with every other ArchUnit suite -- see ProductionClasses on why five identical
        // imports in one test worker is a memory bound rather than a tidiness question.
        JavaClasses production = ProductionClasses.get();

        List<String> callers = new ArrayList<>();
        for (JavaClass source : production) {
            for (JavaMethodCall call : source.getMethodCallsFromSelf()) {
                if (call.getTargetOwner().isEquivalentTo(Project.class)
                        && "applyTransition".equals(call.getName())) {
                    callers.add(source.getName());
                }
            }
        }

        // The invariant the whole module is built around: a state change and its
        // audit row are one write. A controller, a scheduled job, or a second
        // service calling this directly would be a state change with no history,
        // and nothing would fail at the time.
        assertThat(callers)
                .withFailMessage(
                        "Project.applyTransition is called from %s. Only ProjectTransitionService may call it:"
                                + " it is what writes the audit row in the same transaction.",
                        callers)
                .containsOnly(ProjectTransitionService.class.getName());
    }
}
