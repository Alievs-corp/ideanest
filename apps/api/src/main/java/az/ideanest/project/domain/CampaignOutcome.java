package az.ideanest.project.domain;

import java.math.BigDecimal;
import java.util.Objects;

/**
 * §5.1's funding threshold, as a value — IDN-EXT-01 (#31).
 *
 * <p><strong>Success is a share of the goal, and the share is configuration.</strong> It
 * was {@code pledged >= goal}: all-or-nothing, a hundred per cent. IDN-EXT-01 decides a
 * campaign succeeds at eighty per cent, and the number is a setting rather than a literal
 * here for the reason §5.2's rates are — it is a product decision that has already moved
 * once, and the next move should not need a deployment. {@code
 * ProjectProperties.Finalisation#successThreshold} is where it lives, and nothing in this
 * type has an opinion about its value beyond refusing one that cannot mean anything.
 *
 * <p><strong>A comparison, in one place, with no clock and no database.</strong> The
 * rule is four lines of English in §5.1 and one line of arithmetic here, and putting it
 * in the domain rather than inside the sweep that applies it is the same argument
 * {@link ProjectStateMachine} makes about the edges: the rule that decides whether ten
 * thousand people are charged should be checkable by a unit test that starts nothing.
 *
 * <p><strong>What is deliberately not part of the decision.</strong>
 *
 * <ul>
 *   <li><strong>The deadline.</strong> §5.1 has two conditions and this type answers
 *       only the second. Whether the campaign has reached its deadline is
 *       {@code CampaignFinalizer}'s question, because it is the one the sweep's query
 *       already asked and the one a lock has to be held to answer safely.
 *   <li><strong>Fees.</strong> §5.2 charges a platform fee on the amount raised by a
 *       successful campaign, and none at all on an unsuccessful one. That is arithmetic
 *       on the outcome, not an input to it: a campaign does not fail because of what it
 *       would have cost.
 *   <li><strong>Whether anything was collected.</strong> Nothing has been collected at
 *       this point and nothing needs to have been. The outcome is decided on what was
 *       pledged, and V29 says at length why a later collection failure must not be able
 *       to revisit it.
 * </ul>
 */
public enum CampaignOutcome {

    /** §5.1: the total reached the success threshold — eighty per cent of the goal by default. */
    SUCCESSFUL(ProjectState.SUCCESSFUL),

    /**
     * §5.1: the total did not reach the success threshold. Under IDN-EXT-01 every backer is
     * refunded in full and no fee of any kind is charged (#40); until stage 2 lands, the old
     * behaviour — nothing collected, stored cards purged — is what the platform does.
     */
    UNSUCCESSFUL(ProjectState.UNSUCCESSFUL);

    private final ProjectState state;

    CampaignOutcome(ProjectState state) {
        this.state = state;
    }

    /**
     * Which of §5.1's two branches this campaign falls into.
     *
     * <p><strong>{@code pledged >= goal × threshold}, and the boundary is the whole
     * point.</strong> A campaign that raised exactly eighty per cent succeeded. Written as
     * {@code >} it would fail, and it would fail for the one creator who hit the number
     * exactly — the case nobody tests by hand and everybody notices.
     *
     * <p><strong>Multiplied, never divided, and never rounded.</strong> {@code goal ×
     * threshold} of a two-place amount by a two-place share is exact at four places, so the
     * comparison is between the real numbers. Dividing {@code pledged} by {@code goal}
     * instead would need a scale and a rounding mode, and a campaign at 79.995% rounded up
     * to 80.00% would succeed on an artefact of the arithmetic rather than on the rule.
     *
     * <p><strong>{@link BigDecimal#compareTo} rather than {@link BigDecimal#equals}</strong>,
     * which is the standing rule for money on this platform: {@code 1000.00} and
     * {@code 1000.000} are the same amount and are not equal objects. Nothing here would
     * read differently with {@code equals}, because nothing here calls it — which is
     * precisely why it is worth saying, since the next person to touch this file might.
     *
     * @param pledged what the campaign raised, which is never null: {@code projects
     *     .pledged_amount} is {@code NOT NULL DEFAULT 0} since V6, so a campaign nobody
     *     backed compares zero against its goal and fails, as it should
     * @param goal what it had to raise. Not null by the time a campaign is live —
     *     {@code ProjectTransitionService.requireLaunchable} refuses the edge without one
     *     — so a null here is a campaign that reached {@code LIVE} by some path that is
     *     not the service, and answering it as "unsuccessful" would silently close
     *     somebody's campaign over a bug in ours
     * @param threshold the share of the goal that succeeds, in {@code (0, 1]} — {@code 0.80}
     *     under IDN-EXT-01. Required rather than defaulted here: a default in this method
     *     would be a second place the number lives, and the one a configuration change
     *     would silently fail to reach
     * @throws IllegalArgumentException for a threshold outside {@code (0, 1]}. Zero would
     *     make a campaign nobody backed a success, and above one would make a campaign
     *     that raised its whole goal a failure — both are configuration mistakes, and
     *     closing ten thousand campaigns on one is worse than refusing to close any
     */
    public static CampaignOutcome of(BigDecimal pledged, BigDecimal goal, BigDecimal threshold) {
        Objects.requireNonNull(pledged, "A campaign's pledged total is never null");
        Objects.requireNonNull(goal, "A live campaign has a goal; §5.1 cannot be applied without one");
        requireThreshold(threshold);

        return pledged.compareTo(goal.multiply(threshold)) >= 0 ? SUCCESSFUL : UNSUCCESSFUL;
    }

    /**
     * Refuses a success threshold that cannot mean anything.
     *
     * <p>Public so that {@code ProjectProperties} refuses the same values at start-up, with
     * the same words, rather than keeping a second copy of the bounds.
     */
    public static BigDecimal requireThreshold(BigDecimal threshold) {
        Objects.requireNonNull(threshold, "A success threshold is a share of the goal");
        if (threshold.signum() <= 0 || threshold.compareTo(BigDecimal.ONE) > 0) {
            throw new IllegalArgumentException(
                    "A success threshold is a share of the goal above zero and at most one, and "
                            + threshold.toPlainString() + " is not");
        }
        return threshold;
    }

    /**
     * The outcome a campaign <em>was</em> decided as, read from the state it was moved to.
     *
     * <p><strong>Not a second application of the rule.</strong> Once a campaign has been
     * finalised, what it was decided as is on the row, and anything that needs the answer
     * afterwards — the event announcing it — reads it from there. Recomputing it with
     * {@link #of} would be a second decision, taken against a threshold that is
     * configuration and may have changed since the first; the two could disagree, and the
     * announcement would then contradict the state it announces.
     *
     * @throws IllegalStateException for any state that is not a decision
     */
    public static CampaignOutcome decidedBy(ProjectState state) {
        for (CampaignOutcome outcome : values()) {
            if (outcome.state == state) {
                return outcome;
            }
        }
        throw new IllegalStateException("A campaign in " + state + " has not been decided");
    }

    /** The state §6.1 gives this outcome. */
    public ProjectState state() {
        return state;
    }
}
