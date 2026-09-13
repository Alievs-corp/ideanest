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
    @DisplayName("IDN-EXT-01: an unsuccessful campaign is public but not listed, and nothing else differs")
    void unsuccessfulIsPublicButNotListed() {
        // Hidden from the catalogue and search only: its page and rewards still resolve.
        assertThat(DiscoveryStatus.PUBLIC_STATES).contains("UNSUCCESSFUL");
        assertThat(DiscoveryStatus.LISTED_STATES).doesNotContain("UNSUCCESSFUL");
        Set<String> difference = new LinkedHashSet<>(DiscoveryStatus.PUBLIC_STATES);
        difference.removeAll(DiscoveryStatus.LISTED_STATES);
        assertThat(difference).containsExactly("UNSUCCESSFUL");
    }

    @Test
    @DisplayName("no status grouping can name a state the catalogue does not list")
    void groupingsStayInsideTheVisibleSet() {
        for (DiscoveryStatus status : DiscoveryStatus.values()) {
            assertThat(status.states())
                    .withFailMessage("%s covers a state outside LISTED_STATES: %s", status, status.states())
                    .allMatch(DiscoveryStatus.LISTED_STATES::contains);
        }
    }

    @Test
    @DisplayName("no status filter means every listed state")
    void anAbsentFilterIsTheWholeVisibleSet() {
        assertThat(DiscoveryStatus.statesFor(Set.of())).isEqualTo(DiscoveryStatus.LISTED_STATES);
    }

    @Test
    @DisplayName("IDN-EXT-01: the filter words are upcoming, live, extended and successful")
    void theFilterWords() {
        assertThat(DiscoveryStatus.wireValues()).containsExactly("upcoming", "live", "extended", "successful");
        assertThat(DiscoveryStatus.EXTENDED.states()).containsExactly("EXTENDED");
    }

    @Test
    @DisplayName("a status filter narrows the visible set and never widens it")
    void aFilterOnlyNarrows() {
        for (DiscoveryStatus status : DiscoveryStatus.values()) {
            assertThat(DiscoveryStatus.statesFor(Set.of(status))).isSubsetOf(DiscoveryStatus.LISTED_STATES);
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
    @DisplayName("IDN-EXT-01: a campaign left in LATE_PLEDGE badges as successful, and an extended one as live")
    void theBadgeIsTheNarrowestGrouping() {
        // Late pledges are switched off, so there is no late-pledge word left to badge with.
        assertThat(DiscoveryStatus.badgeFor("LATE_PLEDGE")).contains(DiscoveryStatus.SUCCESSFUL);
        // Extended is a filter and a label on the card, not the badge: it is still live.
        assertThat(DiscoveryStatus.badgeFor("EXTENDED")).contains(DiscoveryStatus.LIVE);
        assertThat(DiscoveryStatus.badgeFor("CLOSING_WINDOW")).contains(DiscoveryStatus.LIVE);
        assertThat(DiscoveryStatus.badgeFor("UNSUCCESSFUL")).isEmpty();
    }

    @Test
    @DisplayName("a cancelled campaign is visible and carries no badge")
    void cancelledIsVisibleAndUnlabelled() {
        // It launched and the public saw it, so hiding it here while its page still
        // resolves would answer one question two ways. §4.3 has no word for it, and
        // inventing one — or folding it into the unsuccessful campaigns — would tell a reader
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
