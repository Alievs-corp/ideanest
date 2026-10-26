package az.ideanest.project.api;

import az.ideanest.project.application.CampaignDashboard;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * §4.7's CD-01 on the wire — what {@code GET /v1/projects/{id}/dashboard} answers.
 *
 * <p>Money is a {@link Money}, so §10.3's rule applies without this file restating it: an
 * amount crosses as a string inside {@code {"amount", "currency"}} and never as a JSON
 * number. {@code ProjectAnalyticsResponse} says the same thing about the same reason —
 * a figure that became a double on the way to a progress bar would round somebody's
 * pledge, and this is the screen that number is read off.
 *
 * <p><strong>{@link #percentFunded()} is a JSON number, and that is deliberate rather
 * than an oversight.</strong> {@code ReferrerReportResponse.share} made this call first
 * and the argument is the same: a percentage at two decimal places is not money, nobody
 * charges it, and two places of percent survive a double exactly. What must not become a
 * double is the amount it was computed from, and {@link #raised()} and {@link #goal()}
 * are {@link Money} for that reason. A client that wants exactness recomputes the ratio
 * from those two; this field is for the progress bar.
 *
 * @param serverTime when this was computed. <strong>Returned on purpose, and the
 *     countdown depends on it</strong>: a client subtracts it from its own clock once to
 *     learn the offset, then counts down against the deadline. A precomputed
 *     {@code secondsRemaining} would be wrong the moment it was sent — see
 *     {@link CampaignDashboard}
 * @param goalReached whether the goal has been met, which is deliberately not derivable
 *     from {@link #state()}. A campaign can be at 130% and still {@code LIVE}, and it is
 *     the difference between an interface saying "act now" and one saying "you did it".
 *     CLAUDE.md §2 is emphatic that those are different colours and mean opposite things
 * @param outcome null until the deadline has been decided
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record DashboardResponse(
        UUID projectId,
        String slug,
        String title,
        String state,
        String currency,
        Money goal,
        Money raised,
        int backersCount,
        BigDecimal percentFunded,
        boolean goalReached,
        Instant launchedAt,
        Instant deadline,
        Instant serverTime,
        Outcome outcome,
        Instant opensAt) {

    public static DashboardResponse of(CampaignDashboard dashboard) {
        return new DashboardResponse(
                dashboard.projectId(),
                dashboard.slug(),
                dashboard.title(),
                dashboard.state(),
                dashboard.currency(),
                dashboard.goal(),
                dashboard.raised(),
                dashboard.backersCount(),
                dashboard.percentFunded(),
                dashboard.goalReached(),
                dashboard.launchedAt(),
                dashboard.deadline(),
                dashboard.serverTime(),
                Outcome.of(dashboard.outcome()),
                dashboard.opensAt());
    }

    /**
     * §5.1's decision, frozen at the deadline.
     *
     * @param pledged what the campaign raised, as it stood then — not what was
     *     eventually collected. #63's rule is that a later collection failure reduces the
     *     payout and never the outcome
     */
    public record Outcome(Money goal, Money pledged, int backersCount, Instant finalisedAt) {

        static Outcome of(CampaignDashboard.Outcome outcome) {
            return outcome == null
                    ? null
                    : new Outcome(
                            outcome.goal(), outcome.pledged(), outcome.backersCount(), outcome.finalisedAt());
        }
    }
}
