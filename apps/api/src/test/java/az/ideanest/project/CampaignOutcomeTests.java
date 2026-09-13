package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.project.domain.CampaignOutcome;
import az.ideanest.project.domain.ProjectState;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * §5.1's threshold, checked without a database — IDN-EXT-01 (#31).
 *
 * <p>A plain unit test on purpose, for {@code ProjectStateMachineTests}' reason: the rule
 * that decides whether ten thousand people are refunded should be assertable by something
 * that starts nothing. {@code CampaignFinalisationTests} exercises the same rule through
 * the sweep, the lock and the transition — this is the arithmetic on its own, where a
 * failure names the arithmetic.
 */
class CampaignOutcomeTests {

    private static final BigDecimal EIGHTY_PER_CENT = new BigDecimal("0.80");

    @ParameterizedTest(name = "{0} raised against a goal of {1} is {2}")
    @CsvSource({
        // The boundary IDN-EXT-01 names — 79.99, 80 and 80.01 per cent. `>` instead of `>=`
        // fails only the middle row, and only for the creator who hit the number exactly.
        "7999.00, 10000.00, UNSUCCESSFUL",
        "8000.00, 10000.00, SUCCESSFUL",
        "8001.00, 10000.00, SUCCESSFUL",
        // One qapik under, which is the case a division-and-round would get wrong.
        "7999.99, 10000.00, UNSUCCESSFUL",
        // What used to be the only success, and still is one.
        "10000.00, 10000.00, SUCCESSFUL",
        // Between the old rule and the new one: failed under all-or-nothing, succeeds now.
        "9999.99, 10000.00, SUCCESSFUL",
        // A campaign nobody backed is a real outcome, not a missing one.
        "0.00, 10000.00, UNSUCCESSFUL",
        // Past the goal: IDN-EXT-01 puts no ceiling on funding.
        "42000.00, 10000.00, SUCCESSFUL",
        // The same amounts written with different scales. compareTo says equal; equals
        // does not, and these are the rows that would fail if somebody reached for it.
        "800.0, 1000.000, SUCCESSFUL",
        "799.9, 1000.000, UNSUCCESSFUL",
        // A goal of zero is not something §5.3 permits, and if one ever reached LIVE the
        // answer has to be "succeeded" rather than an exception inside a sweep.
        "0.00, 0.00, SUCCESSFUL",
    })
    void successIsEightyPerCentOfTheGoal(String pledged, String goal, CampaignOutcome expected) {
        assertThat(CampaignOutcome.of(new BigDecimal(pledged), new BigDecimal(goal), EIGHTY_PER_CENT))
                .isEqualTo(expected);
    }

    @Test
    @DisplayName("the threshold is the configured one, not a number inside the rule")
    void theThresholdIsAnInput() {
        BigDecimal pledged = new BigDecimal("9000.00");
        BigDecimal goal = new BigDecimal("10000.00");

        // Ninety per cent succeeds at eighty and fails at a hundred: the same campaign, two
        // answers, and the only difference is the setting.
        assertThat(CampaignOutcome.of(pledged, goal, EIGHTY_PER_CENT)).isEqualTo(CampaignOutcome.SUCCESSFUL);
        assertThat(CampaignOutcome.of(pledged, goal, BigDecimal.ONE)).isEqualTo(CampaignOutcome.UNSUCCESSFUL);
    }

    @ParameterizedTest(name = "a threshold of {0} is refused")
    @ValueSource(strings = {"0", "0.00", "-0.5", "1.01", "80"})
    @DisplayName("a threshold that cannot mean a share of the goal is refused")
    void anImpossibleThresholdIsRefused(String threshold) {
        // `80` is the likeliest real mistake: a percentage typed where a share belongs, which
        // would fail every campaign that did not raise eighty times its goal.
        assertThatThrownBy(() ->
                        CampaignOutcome.of(new BigDecimal("500.00"), new BigDecimal("1000.00"), new BigDecimal(threshold)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a decided campaign's outcome is read from its state, and nothing else is a decision")
    void theDecisionIsReadBackFromTheState() {
        assertThat(CampaignOutcome.decidedBy(ProjectState.SUCCESSFUL)).isEqualTo(CampaignOutcome.SUCCESSFUL);
        assertThat(CampaignOutcome.decidedBy(ProjectState.UNSUCCESSFUL)).isEqualTo(CampaignOutcome.UNSUCCESSFUL);
        assertThatThrownBy(() -> CampaignOutcome.decidedBy(ProjectState.LIVE))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("each outcome names the state §6.1 gives it")
    void eachOutcomeNamesItsState() {
        assertThat(CampaignOutcome.SUCCESSFUL.state()).isEqualTo(ProjectState.SUCCESSFUL);
        assertThat(CampaignOutcome.UNSUCCESSFUL.state()).isEqualTo(ProjectState.UNSUCCESSFUL);
    }

    /**
     * A campaign with no goal is a bug in whatever put it live, and closing it quietly as
     * unsuccessful would hide that bug behind somebody's failed campaign.
     */
    @Test
    @DisplayName("a live campaign without a goal cannot be decided")
    void aMissingGoalIsRefusedRatherThanTreatedAsZero() {
        assertThatThrownBy(() -> CampaignOutcome.of(new BigDecimal("500.00"), null, EIGHTY_PER_CENT))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> CampaignOutcome.of(null, new BigDecimal("500.00"), EIGHTY_PER_CENT))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> CampaignOutcome.of(new BigDecimal("500.00"), new BigDecimal("500.00"), null))
                .isInstanceOf(NullPointerException.class);
    }
}
