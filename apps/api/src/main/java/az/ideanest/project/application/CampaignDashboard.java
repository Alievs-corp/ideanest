package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.UUID;

/**
 * §4.7's CD-01: what a campaign has raised, from whom, and how long it has left.
 *
 * <p>The creator's counterpart of {@link PublicProjectPage}, and deliberately not a
 * variant of it. That projection carries the story, the cover image and the taxonomy,
 * because it renders a page for a stranger; this carries four numbers and two instants,
 * because it renders a header that refreshes. Folding them together would give the
 * dashboard a story document it never displays and give the public page an authorisation
 * check it does not need.
 *
 * <h2>The clock is two instants, not a countdown</h2>
 *
 * <p><strong>There is no {@code secondsRemaining}, and that is the one decision in this
 * record worth arguing.</strong> Computing the remainder here and sending a number means
 * the number is wrong the moment it is sent and grows more wrong for as long as the page
 * stays open — and a creator watching the last hour of their campaign is the reader most
 * likely to leave it open.
 *
 * <p>So the deadline goes out as an instant, and {@link #serverTime()} goes with it. A
 * client subtracts the two once to learn how far its own clock is off, and then counts
 * down against its own. That also fixes the case a countdown cannot: a reader whose
 * machine is a day out is told the truth rather than being told it twice.
 *
 * @param state one of §6.1's sixteen, by name — every consumer is outside the module that
 *     owns the enum
 * @param goal null before launch. §5.3 requires one by submission, so a draft has none
 * @param raised {@code projects.pledged_amount}, which is never null
 * @param percentFunded {@code raised / goal}, as a percentage, or null when there is no
 *     goal to be a percentage of. <strong>Rounded down, and not capped.</strong> Down,
 *     because a campaign at 99.99% has not reached its goal and a dashboard that rounded
 *     it to 100 would say it had — the one number on this screen a creator acts on.
 *     Uncapped, because a campaign at 240% should say so
 * @param serverTime when this answer was computed. See above
 * @param outcome null until the deadline has been decided, and V29's frozen figures after
 *     — the same fields, and the same reason, as {@code PublicProjectPage.Outcome}: a
 *     later collection failure reduces the payout and never the outcome, so a dashboard
 *     reporting only the live total would contradict the word beside it
 * @param opensAt the launch time an approved campaign waits for (#595), and null in every
 *     other state
 * @param extendedUntil where an extended campaign now ends (§5.1), and null until it is
 *     extended (#618). Beside {@link #deadline()} rather than in place of it: the deadline
 *     stays the first one, because the extension window and its sixty-day limit are measured
 *     from it, and the clock counts to this instead while the campaign is {@code EXTENDED}
 */
public record CampaignDashboard(
        UUID projectId,
        String slug,
        String title,
        String state,
        String currency,
        Money goal,
        Money raised,
        int backersCount,
        BigDecimal percentFunded,
        Instant launchedAt,
        Instant deadline,
        Instant serverTime,
        Outcome outcome,
        Instant opensAt,
        Instant extendedUntil) {

    /**
     * How precisely progress is reported.
     *
     * <p>Two places, which is finer than any progress bar renders and coarse enough that
     * the number reads as a measurement rather than as noise. It matters at all because
     * the alternative — reporting whole percent — makes the last 1% of a campaign, which
     * is the part a creator watches minute by minute, a number that does not move.
     */
    private static final int PERCENT_SCALE = 2;

    private static final BigDecimal PER_CENT = BigDecimal.valueOf(100);

    /** The dashboard for this campaign, as of {@code at}. */
    public static CampaignDashboard of(Project project, Instant at) {
        Money goal = Money.orNull(project.getGoalAmount(), project.getCurrency());
        Money raised = Money.of(project.getPledgedAmount(), project.getCurrency());

        return new CampaignDashboard(
                project.getId(),
                project.getSlug(),
                project.getTitle(),
                project.getState().name(),
                project.getCurrency(),
                goal,
                raised,
                project.getBackersCount(),
                percentFunded(project.getPledgedAmount(), project.getGoalAmount()),
                project.getLaunchedAt(),
                project.getDeadline(),
                at,
                Outcome.of(project),
                opensAt(project),
                project.getExtendedUntil());
    }

    /**
     * When an approved campaign opens on its own (#595), or null. The countdown has no deadline
     * to count to until then, and its creator is owed the moment it starts.
     */
    private static Instant opensAt(Project project) {
        ProjectState state = project.getState();
        boolean waiting = state == ProjectState.APPROVED || state == ProjectState.SCHEDULED;
        return waiting ? project.getScheduledLaunchAt() : null;
    }

    /**
     * What share of the goal has been raised, or null when the question does not apply.
     *
     * <p>Null rather than zero for a campaign with no goal: zero would render as a
     * progress bar at the far left, which says "this campaign has raised nothing" about a
     * draft that has not asked for anything yet.
     *
     * <p><strong>{@code BigDecimal} throughout.</strong> The obvious version of this line
     * divides two doubles, and on a funding platform the two numbers being divided are
     * somebody's money — CLAUDE.md §3 is explicit, and it does not stop applying because
     * the result happens to be a percentage.
     */
    private static BigDecimal percentFunded(BigDecimal raised, BigDecimal goal) {
        if (goal == null || goal.signum() <= 0) {
            return null;
        }
        return raised.multiply(PER_CENT).divide(goal, PERCENT_SCALE, RoundingMode.DOWN);
    }

    /** Whether the goal has been met — which is a different question from the state. */
    public boolean goalReached() {
        return goal != null && raised.amount().compareTo(goal.amount()) >= 0;
    }

    /**
     * §5.1's decision, frozen.
     *
     * <p>Identical to {@code PublicProjectPage.Outcome} and deliberately a second
     * declaration rather than a shared one: they are two projections' fields, and sharing
     * a record between them would make either one's shape the other's constraint. Both
     * read the same four columns, and V29 is where the argument for those columns lives.
     */
    public record Outcome(Money goal, Money pledged, int backersCount, Instant finalisedAt) {

        static Outcome of(Project project) {
            if (project.getFinalizedAt() == null) {
                return null;
            }
            // projects_outcome_frozen_together makes these four whole or absent, so
            // reaching here means all of them are set.
            return new Outcome(
                    Money.of(project.getOutcomeGoalAmount(), project.getCurrency()),
                    Money.of(project.getOutcomePledgedAmount(), project.getCurrency()),
                    project.getOutcomeBackersCount(),
                    project.getFinalizedAt());
        }
    }
}
