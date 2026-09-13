package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.project.domain.ProjectState;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The bridge between §4.3's five words and §6.1's sixteen states.
 *
 * <p><strong>This test is the reason the module may use strings.</strong>
 * {@code ModuleBoundaryTests} forbids {@code discovery} from importing
 * {@code project.domain}, so {@link DiscoveryStatus} names states as text. A test
 * class is not a module and may import both, so the agreement between the two is
 * checked here rather than assumed — a state renamed in {@link ProjectState} and not
 * here would otherwise be a filter that silently stops matching anything, and a state
 * <em>added</em> there and not here would be a campaign that is neither shown nor
 * hidden on purpose.
 *
 * <p>A plain unit test: it reads two enums and needs no database.
 */
class DiscoveryStatusTests {

    private static final Set<String> ALL_STATES =
            Arrays.stream(ProjectState.values()).map(Enum::name).collect(Collectors.toCollection(LinkedHashSet::new));

    @Test
    @DisplayName("every state of §6.1 is either publicly visible or hidden, and never both")
    void theSixteenStatesArePartitioned() {
        Set<String> union = new LinkedHashSet<>(DiscoveryStatus.PUBLIC_STATES);
        union.addAll(DiscoveryStatus.HIDDEN_STATES);

        // Nothing missing: a state in neither set is a state nobody decided about,
        // and whichever way the query happened to treat it would be an accident.
        assertThat(union).containsExactlyInAnyOrderElementsOf(ALL_STATES);
        // And nothing in both, or the two statements would not be a partition and
        // one of them would be decorative.
        assertThat(DiscoveryStatus.PUBLIC_STATES).doesNotContainAnyElementsOf(DiscoveryStatus.HIDDEN_STATES);
        // Nineteen since IDN-EXT-01 (#32) added CLOSING_WINDOW, EXTENDED and WITHDRAWN.
        assertThat(ALL_STATES).hasSize(19);
    }

    @Test
    @DisplayName("the seven states a campaign may never be listed in are exactly these")
    void theHiddenStatesAreNamedOutLoud() {
        // Written as a literal rather than derived, so that moving a state from one
        // side to the other has to be done here, deliberately, by somebody who read
        // this list. Every one of these is somebody's unpublished work or a
        // moderation outcome; SUSPENDED in a public feed is the worst failure this
        // endpoint has.
        assertThat(DiscoveryStatus.HIDDEN_STATES)
                .containsExactlyInAnyOrder(
                        "DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "SCHEDULED", "SUSPENDED");
    }

    @Test
    @DisplayName("no status grouping can name a state the public may not see")
    void groupingsStayInsideTheVisibleSet() {
        for (DiscoveryStatus status : DiscoveryStatus.values()) {
            assertThat(status.states())
                    .withFailMessage("%s covers a state outside PUBLIC_STATES: %s", status, status.states())
                    .allMatch(DiscoveryStatus.PUBLIC_STATES::contains);
        }
    }

    @Test
    @DisplayName("no status filter means every publicly visible state")
    void anAbsentFilterIsTheWholeVisibleSet() {
        assertThat(DiscoveryStatus.statesFor(Set.of())).isEqualTo(DiscoveryStatus.PUBLIC_STATES);
    }

    @Test
    @DisplayName("a status filter narrows the visible set and never widens it")
    void aFilterOnlyNarrows() {
        for (DiscoveryStatus status : DiscoveryStatus.values()) {
            assertThat(DiscoveryStatus.statesFor(Set.of(status))).isSubsetOf(DiscoveryStatus.PUBLIC_STATES);
        }
        // IDN-EXT-01 (#32): a campaign in its seven-day window or its extension is still taking
        // pledges, and "live" is the filter a backer looking for something to back uses.
        assertThat(DiscoveryStatus.statesFor(Set.of(DiscoveryStatus.LIVE)))
                .containsExactlyInAnyOrder("LIVE", "CLOSING_WINDOW", "EXTENDED");
    }

    @Test
    @DisplayName("a campaign that reached its goal is successful however far past it has got")
    void successfulCoversEverythingAfterTheGoal() {
        // A backer filtering for successful campaigns wants what this platform has
        // funded, not the newest tenth of it.
        assertThat(DiscoveryStatus.SUCCESSFUL.states())
                .containsExactlyInAnyOrder(
                        "SUCCESSFUL", "COLLECTING", "LATE_PLEDGE", "WITHDRAWN", "FULFILLING", "COMPLETED");
    }

    @Test
    @DisplayName("a late-pledge campaign badges as late pledge, not as successful")
    void theBadgeIsTheNarrowestGrouping() {
        // It is in both groupings on purpose. The badge is the one that tells a
        // reader what they can still do about it.
        assertThat(DiscoveryStatus.badgeFor("LATE_PLEDGE")).contains(DiscoveryStatus.LATE_PLEDGE);
        assertThat(DiscoveryStatus.SUCCESSFUL.states()).contains("LATE_PLEDGE");
    }

    @Test
    @DisplayName("a cancelled campaign is visible and carries no badge")
    void cancelledIsVisibleAndUnlabelled() {
        // It launched and the public saw it, so hiding it here while its page still
        // resolves would answer one question two ways. §4.3 has no word for it, and
        // inventing one — or folding it into "unsuccessful" — would tell a reader
        // that a withdrawn campaign failed to find backers.
        assertThat(DiscoveryStatus.PUBLIC_STATES).contains("CANCELED");
        assertThat(DiscoveryStatus.badgeFor("CANCELED")).isEmpty();
        for (DiscoveryStatus status : DiscoveryStatus.values()) {
            assertThat(status.states()).doesNotContain("CANCELED");
        }
    }

    @Test
    @DisplayName("a hidden state has no badge, so one can never be rendered")
    void hiddenStatesHaveNoBadge() {
        for (String state : DiscoveryStatus.HIDDEN_STATES) {
            assertThat(DiscoveryStatus.badgeFor(state)).isEmpty();
        }
    }
}
