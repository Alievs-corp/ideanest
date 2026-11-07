package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.Campaigns;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The edges of every band, which is where a band filter is actually wrong.
 *
 * <p>Testing the middle of a band tests nothing: {@code 37%} lands in "25–50" under
 * any reading of the boundaries, including three wrong ones. What decides whether the
 * bands partition the feed or overlap it is the value that sits exactly on a
 * boundary — and a campaign counted in two bands is counted twice in the facet panel,
 * while one counted in none disappears from a filter that should have found it.
 *
 * <p>Every band in this module is <strong>closed below and open above</strong>. §4.3
 * writes "under 25%, 25–50%, 50–75%, 75–100%, over 100%", which leaves three boundary
 * values in two bands and the fourth in none; half-open intervals are the only
 * reading under which the five partition the line.
 *
 * <p><strong>Exactly 100% is "over 100".</strong> The question a backer is asking is
 * "did it make it", and a campaign standing exactly at its goal did. Filing it under
 * "75–100" would file a funded campaign under "nearly".
 */
class DiscoveryBandBoundaryTests extends DiscoveryTestSupport {

    private UUID creator;

    @BeforeEach
    void clearTheTable() {
        Campaigns.clear(dataSource);
        creator = Campaigns.creator(dataSource, "boundary-creator");
    }

    /** A live campaign with an exact goal and an exact amount raised. */
    private void campaign(String slug, String goal, String pledged) {
        Instant launched = Instant.now().minus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        Campaigns.seed(dataSource, creator, slug)
                .state("LIVE")
                .category("games")
                .goal(goal)
                .pledged(pledged)
                .launchedAt(launched)
                .deadline(launched.plus(30, ChronoUnit.DAYS))
                .insert();
    }

    @Test
    @DisplayName("a completion boundary belongs to the band above it, never to both")
    void completionBoundariesAreClosedBelow() {
        // A hundredth of a percent either side of each of the four boundaries, plus
        // the boundary itself. numeric(14,2) means these are exact amounts and the
        // comparison is exact arithmetic, not a float that happens to land right.
        campaign("just-under-25", "1000.00", "249.99");
        campaign("exactly-25", "1000.00", "250.00");
        campaign("just-under-50", "1000.00", "499.99");
        campaign("exactly-50", "1000.00", "500.00");
        campaign("just-under-75", "1000.00", "749.99");
        campaign("exactly-75", "1000.00", "750.00");
        campaign("just-under-100", "1000.00", "999.99");
        campaign("exactly-100", "1000.00", "1000.00");

        assertThat(slugs(feed("?limit=100&completion=under_25"))).containsExactly("just-under-25");
        assertThat(slugs(feed("?limit=100&completion=25_to_50")))
                .containsExactlyInAnyOrder("exactly-25", "just-under-50");
        assertThat(slugs(feed("?limit=100&completion=50_to_75")))
                .containsExactlyInAnyOrder("exactly-50", "just-under-75");
        assertThat(slugs(feed("?limit=100&completion=75_to_100")))
                .containsExactlyInAnyOrder("exactly-75", "just-under-100");
        // A campaign standing exactly at its goal made it.
        assertThat(slugs(feed("?limit=100&completion=over_100"))).containsExactly("exactly-100");
    }

    @Test
    @DisplayName("the five completion bands together are every campaign, and each exactly once")
    void theCompletionBandsPartition() {
        campaign("just-under-25", "1000.00", "249.99");
        campaign("exactly-25", "1000.00", "250.00");
        campaign("exactly-50", "1000.00", "500.00");
        campaign("exactly-75", "1000.00", "750.00");
        campaign("exactly-100", "1000.00", "1000.00");
        campaign("zero", "1000.00", "0.00");

        // Six campaigns, six results — not seven, which is what an overlapping
        // boundary would produce, and not five, which is what a gap would.
        assertThat(slugs(feed("?limit=100&completion=under_25,25_to_50,50_to_75,75_to_100,over_100")))
                .hasSize(6);
        assertThat(count(facets(""), "completion", "under_25")).isEqualTo(2);
    }

    @Test
    @DisplayName("a completion percentage is rounded down, so it never over-reports")
    void completionIsTruncatedNotRounded() {
        campaign("just-under-100", "1000.00", "999.99");

        Map<String, Object> card = items(feed("?limit=100")).getFirst();

        // 99.999% exactly. Rounded to the nearest hundredth it is "100.00", which
        // beside a progress bar and a "back this project" button says the campaign
        // made it. Truncation is the only rounding mode that cannot say that.
        assertThat(card.get("completionPercent")).isEqualTo("99.99");
    }

    @Test
    @DisplayName("a money boundary belongs to the band above it, never to both")
    void moneyBandBoundariesAreClosedBelow() {
        campaign("goal-999", "999.99", "0.00");
        campaign("goal-1000", "1000.00", "0.00");
        campaign("goal-4999", "4999.99", "0.00");
        campaign("goal-5000", "5000.00", "0.00");
        campaign("goal-19999", "19999.99", "0.00");
        campaign("goal-20000", "20000.00", "0.00");
        campaign("goal-49999", "49999.99", "0.00");
        campaign("goal-50000", "50000.00", "0.00");

        assertThat(slugs(feed("?limit=100&goalBand=under_1000"))).containsExactly("goal-999");
        assertThat(slugs(feed("?limit=100&goalBand=1000_to_5000")))
                .containsExactlyInAnyOrder("goal-1000", "goal-4999");
        assertThat(slugs(feed("?limit=100&goalBand=5000_to_20000")))
                .containsExactlyInAnyOrder("goal-5000", "goal-19999");
        assertThat(slugs(feed("?limit=100&goalBand=20000_to_50000")))
                .containsExactlyInAnyOrder("goal-20000", "goal-49999");
        assertThat(slugs(feed("?limit=100&goalBand=over_50000"))).containsExactly("goal-50000");
    }

    @Test
    @DisplayName("the amount-raised bands use the same boundaries as the goal bands")
    void raisedBandsShareTheBoundaries() {
        campaign("raised-999", "100000.00", "999.99");
        campaign("raised-1000", "100000.00", "1000.00");

        assertThat(slugs(feed("?limit=100&raisedBand=under_1000"))).containsExactly("raised-999");
        assertThat(slugs(feed("?limit=100&raisedBand=1000_to_5000"))).containsExactly("raised-1000");
    }

    @Test
    @DisplayName("a custom range includes both of the numbers somebody typed")
    void theCustomRangeIsInclusiveAtBothEnds() {
        // Unlike the bands, which have to be half-open to partition. A person typing
        // "from 1000 to 5000" into two boxes means 1000 and 5000 to be included, and
        // the case for consistency is much weaker than the case for the filter
        // meaning what it says.
        campaign("goal-999", "999.99", "0.00");
        campaign("goal-1000", "1000.00", "0.00");
        campaign("goal-5000", "5000.00", "0.00");
        campaign("goal-5001", "5000.01", "0.00");

        assertThat(slugs(feed("?limit=100&goalMin=1000&goalMax=5000")))
                .containsExactlyInAnyOrder("goal-1000", "goal-5000");
    }

    @Test
    @DisplayName("a band and a custom range on the same dimension both apply")
    void aBandAndARangeNarrowTogether() {
        campaign("goal-1000", "1000.00", "0.00");
        campaign("goal-3000", "3000.00", "0.00");
        campaign("goal-4999", "4999.99", "0.00");

        // In practice a client sends one or the other. The rule exists so that the
        // answer to sending both is stated rather than discovered.
        assertThat(slugs(feed("?limit=100&goalBand=1000_to_5000&goalMax=3000")))
                .containsExactlyInAnyOrder("goal-1000", "goal-3000");
    }

    @Test
    @DisplayName("a pre-launch teaser with no goal is in no band, because it is not listed at all")
    void aCampaignWithoutAGoalIsInNoBand() {
        // The only campaign with no goal is a pre-launch teaser, and nobody has reviewed
        // one, so the catalogue does not list it. Were it listed, treating "no goal" as
        // zero would file it under "under 25%" and "under 1000", the busiest facets.
        Campaigns.seed(dataSource, creator, "teaser")
                .state("PRELAUNCH")
                .category("games")
                .insert();

        assertThat(slugs(feed("?limit=100"))).isEmpty();
        assertThat(slugs(feed("?limit=100&completion=under_25"))).isEmpty();
        assertThat(slugs(feed("?limit=100&goalBand=under_1000"))).isEmpty();
        assertThat(slugs(feed("?limit=100&raisedBand=under_1000"))).isEmpty();
    }
}
