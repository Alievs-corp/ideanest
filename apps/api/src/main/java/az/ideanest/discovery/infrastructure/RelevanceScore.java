package az.ideanest.discovery.infrastructure;

import az.ideanest.discovery.application.RankingWeights;
import az.ideanest.discovery.domain.RankingTerm;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

/**
 * §11.2's composite, as one {@code numeric} expression.
 *
 * <h2>What "normalise" normalises against, and why it cannot be the result set</h2>
 *
 * <p>§11.2 says {@code normalise(…)} and does not say against what. There are two
 * readings and only one of them is implementable here.
 *
 * <p><strong>Against the current result set</strong> — divide each campaign's raw value
 * by the largest in the matching set, so the best campaign on the page scores 1 — is
 * the reading that gives well-spread scores. It is unavailable, and not for a reason of
 * effort. The feed is keyset-paged (D-04, {@code DiscoveryCursor}): page two is a
 * different {@code WHERE} clause over a different set of rows, so its maximum is a
 * different number, so every score is on a different scale from page one's, so the
 * cursor's key means nothing on the page it is replayed against. The scroll would
 * duplicate and drop cards at every boundary. It would also cost a second full pass to
 * find the maximum before the first row could be scored, which §20's 300ms does not
 * have.
 *
 * <p><strong>Against a fixed scale</strong> is therefore what this is. Every term is a
 * closed-form function of one row and nothing else, mapping into {@code [0, 1]} with
 * constants that live in this file. Two campaigns score the same whether they are
 * compared on page one, page nine, or in two different queries a week apart — which is
 * also what makes the moderator diagnostic worth reading, because a per-term
 * contribution that depended on who else matched would explain nothing.
 *
 * <p>The cost is stated rather than hidden: a fixed scale cannot adapt. If every
 * campaign on the platform sits at 4% of its goal, the completion term is near zero for
 * all of them and stops separating anything. That is a tuning problem — the weights are
 * data precisely so it can be answered by moving a number — and it is a far smaller
 * problem than a scroll that loses cards.
 *
 * <h2>Where the money boundary is</h2>
 *
 * <p>{@code pledged_amount} and {@code goal_amount} are {@code numeric} in the database
 * and {@code BigDecimal} in Java, and <strong>they never become a double anywhere in
 * here</strong>. The completion term is a ratio of two of them, and a ratio for ranking
 * is not money — nobody is paid it — so it would be permissible to compute it in double
 * precision. It is not computed that way, for a different reason: this expression is the
 * keyset cursor's sort key, and the keyset predicate compares it for <em>exact
 * equality</em>. Two evaluations of a float expression that rounded differently would
 * make a scroll skip a row, which is the same hazard, and the same fix, as
 * {@code PostgresSearchService.POPULARITY_SCORE}. Everything below is {@code numeric},
 * every term is rounded to six places, and the sum is rounded again.
 *
 * <p>The rule that follows from that, and the answer to "where is the boundary": the
 * amounts feeding a ratio must not round through a float <em>first</em>. They do not —
 * the ratio is formed inside PostgreSQL out of the stored {@code numeric} columns, and
 * the only thing that crosses into Java is the finished score.
 *
 * <h2>What this costs per row</h2>
 *
 * <p>Four multiplications, three divisions, one {@code floor}, one hashed set
 * membership, and one {@code ts_rank} when there is a query — no {@code power}, no
 * {@code exp}, no {@code ln}. That is deliberate and it is measured elsewhere:
 * {@code POPULARITY_SCORE} carries the note that {@code numeric_power} with a fractional
 * exponent cost 230ms of a 300ms budget at twenty thousand campaigns, because it goes
 * through {@code ln} and {@code exp} at full numeric precision. The obvious sigmoid —
 * the logistic {@code 1/(1+exp(-k(x-x₀)))} — is exactly that function, so it is not the
 * sigmoid used here. See {@link #completion()}.
 */
final class RelevanceScore {

    /**
     * Where the recency term halves. Seven days, in hours.
     *
     * <p>The curve is {@code h₀ / (h₀ + age)}: one at the moment of launch, one half at
     * seven days, 0.19 at a month, and asymptotically zero — a hyperbola rather than an
     * exponential, again because an exponential needs {@code exp}. It never reaches
     * zero, which is the property that matters: a two-year-old campaign is worth less
     * than a new one and is not worth <em>nothing</em>, and a decay that bottomed out
     * would make every old campaign tie and fall back on the id tiebreaker.
     *
     * <p><strong>Seven days rather than 48 hours or a month.</strong> §5.3 puts a
     * campaign's duration between thirty and sixty days and the common case is thirty, so
     * the half-life has to be inside a campaign's own lifetime or the term is just
     * "launched recently" with extra steps. A week is one full cycle of the weekly
     * rhythm every crowdfunding platform runs on, and it leaves a thirty-day campaign
     * scoring 0.19 on its last day rather than 0.03 — still ranked, still findable,
     * which is what a backer looking for something to fund needs.
     *
     * <p>The age is floored to whole hours, exactly as {@code POPULARITY_SCORE} floors
     * it, so the score moves hourly rather than continuously — the right granularity for
     * something called decay, and one less reason for two requests inside one cache
     * window to differ.
     */
    private static final String RECENCY_HALF_LIFE_HOURS = "168";

    /**
     * How the age in whole hours is written, once.
     *
     * <p>{@code greatest(…, 0)} because a campaign can be launched in the future
     * relative to a pinned {@code asOf} — the cursor pins the instant of the first page,
     * and a campaign that launched during the scroll would otherwise have a negative age
     * and a recency term above one.
     */
    private static final String AGE_HOURS =
            "floor(greatest(extract(epoch FROM (:asOf - p.launched_at))::numeric, 0) / 3600)";

    private RelevanceScore() {
    }

    /**
     * The whole composite, or {@code 0::numeric} when no term is active.
     *
     * <p>Only the active terms appear in the SQL at all. An inactive term therefore
     * contributes <em>exactly</em> nothing rather than contributing zero — there is no
     * addend, so there is nothing for a rounding step to do and nothing for the planner
     * to evaluate. A weight of zero is different and is emitted: it multiplies its term
     * to nothing, which is what "measured and currently counts for nothing" means.
     *
     * @param weights the snapshot this request is scored against, pinned by the cursor
     * @param textTerm the text term's expression, from {@link #text}
     * @param params bound weights are added here
     */
    static String of(RankingWeights weights, String textTerm, MapSqlParameterSource params) {
        List<String> addends = new ArrayList<>();
        for (Map.Entry<RankingTerm, String> entry : expressions(textTerm).entrySet()) {
            RankingTerm term = entry.getKey();
            if (!weights.isActive(term)) {
                continue;
            }
            String name = "rw" + term.name();
            params.addValue(name, weights.weightOf(term));
            String sign = term.sign() == RankingTerm.Sign.SUBTRACTS ? "- " : "+ ";
            addends.add(sign + "(:" + name + "::numeric * (" + entry.getValue() + "))");
        }
        if (addends.isEmpty()) {
            // Every term switched off is a legitimate configuration — it is how somebody
            // isolates one term while tuning — and it means every campaign scores the
            // same. The order does not become non-total: every sort in this module ends
            // `, id ASC`, so the feed falls back on the tiebreaker and the cursor is
            // still exact.
            return "0::numeric";
        }
        // The leading sign of the first addend is dropped only when it is a plus; a
        // composite whose only active term is `spam` is genuinely negative.
        String sum = String.join(" ", addends);
        if (sum.startsWith("+ ")) {
            sum = sum.substring(2);
        }
        return "round(" + sum + ", 6)";
    }

    /**
     * Each term's own value, in {@code [0, 1]}, before its weight is applied.
     *
     * <p>The map is what both the score and the moderator diagnostic are built from, so
     * a campaign's explanation cannot drift from its position in the feed: they are the
     * same expressions.
     *
     * <p>The five inert terms are absent rather than present as {@code 0::numeric}.
     * V15's {@code ranking_weights_inert_terms_are_not_active} makes them unreachable
     * here anyway; leaving them out is the second half of that, so that adding one is a
     * line in this map and a line in that CHECK rather than a silent zero somebody has
     * to notice.
     */
    static Map<RankingTerm, String> expressions(String textTerm) {
        Map<RankingTerm, String> terms = new LinkedHashMap<>();
        terms.put(RankingTerm.TEXT_MATCH, textTerm);
        terms.put(RankingTerm.COMPLETION, completion());
        terms.put(RankingTerm.EDITORIAL, editorial());
        terms.put(RankingTerm.RECENCY, recency());
        return terms;
    }

    /**
     * The text term: {@link #textTermFor} clamped into {@code [0, 1]}.
     *
     * <p>{@code ts_rank} is not bounded above by one — it rises with the number of
     * matching lexemes — and a term that can reach 3 while every other term stops at 1
     * is not a weighted sum, it is a text search with three decorations. Clamped rather
     * than divided by the observed maximum, for the reason at the top of this class: the
     * observed maximum is a property of the result set.
     *
     * @param textScore {@code PostgresSearchService.textScore}, already rounded to six
     *     places, or null when the caller sent no query
     */
    static String textTermFor(String textScore) {
        // Zero for everybody rather than absent, so that `sort=relevance` means the same
        // arithmetic on a browsing feed as on a searched one — one expression, one
        // diagnostic, and a term the reader can see is contributing nothing.
        return textScore == null ? "0::numeric" : "least(" + textScore + ", 1)";
    }

    /**
     * §11.2's {@code w3}: the completion sigmoid, saturating at the goal.
     *
     * <p>The curve is the Hill function {@code c^k / (c^k + m^k)} with {@code m = 1} —
     * the midpoint at <strong>exactly the goal</strong>, which is what §11.2's
     * "saturating at the goal" asks for — and {@code k = 2}. Written over the raw
     * amounts, {@code c = pledged / goal} cancels and it becomes
     * {@code pledged² / (pledged² + goal²)}: <strong>no division by the goal at
     * all</strong>, which is also why the zero-goal case below is a guard rather than an
     * arithmetic accident waiting to happen. There is no constant to change — the
     * exponent is a squaring and the midpoint is the goal itself — so a different curve
     * is a different expression, which is the honest amount of ceremony for a change
     * that moves every campaign on the platform.
     *
     * <p><strong>Why this shape rather than the logistic.</strong> It is a sigmoid by
     * every property that matters here — monotone, bounded in {@code [0, 1)}, half at
     * the midpoint, saturating above it — and it is two multiplications, an addition and
     * a division of {@code numeric}s, exact and cheap. The logistic
     * {@code 1/(1+exp(-k(x-x₀)))} needs {@code exp}, which is the function
     * {@code POPULARITY_SCORE} measured at sixteen microseconds a row and removed.
     *
     * <p><strong>Why {@code k = 2}.</strong> Read off the curve rather than preferred:
     *
     * <table>
     *   <caption>the completion term at each exponent</caption>
     *   <tr><th>funded</th><th>k=1</th><th>k=2</th><th>k=4</th></tr>
     *   <tr><td>10%</td><td>0.09</td><td>0.010</td><td>0.0001</td></tr>
     *   <tr><td>25%</td><td>0.20</td><td>0.059</td><td>0.004</td></tr>
     *   <tr><td>50%</td><td>0.33</td><td>0.200</td><td>0.059</td></tr>
     *   <tr><td>75%</td><td>0.43</td><td>0.360</td><td>0.240</td></tr>
     *   <tr><td>100%</td><td>0.50</td><td>0.500</td><td>0.500</td></tr>
     *   <tr><td>200%</td><td>0.67</td><td>0.800</td><td>0.941</td></tr>
     *   <tr><td>500%</td><td>0.83</td><td>0.962</td><td>0.998</td></tr>
     * </table>
     *
     * <p>{@code k = 1} barely saturates — a campaign at five times its goal still gains
     * from every further pledge, which is the runaway §4.3 avoids by not defaulting to
     * an amount sort. {@code k = 4} throws away the range discovery is actually for:
     * everything under half funded scores below 0.06 and is indistinguishable from
     * nothing, so the term stops separating exactly the campaigns that most need
     * circulating. {@code k = 2} keeps the below-goal range readable and still flattens
     * hard above it.
     *
     * <p><strong>The three arithmetic edges, none of which can divide by zero or produce
     * a NaN.</strong> A campaign in {@code PRELAUNCH} has no goal, and a campaign that
     * has not asked for anything has not got 100% of the way to it, so a null goal is
     * zero rather than one. A goal of zero is impossible —
     * {@code projects_goal_is_positive} — and is guarded anyway, because a guard that
     * depends on a constraint in another migration is a guard that stops working when
     * that migration is edited. And a campaign at zero pledged short-circuits to zero,
     * which the formula would give anyway; it is written out so that the {@code 0/0}
     * case is visibly impossible rather than merely unreachable.
     *
     * <p>There is no upper guard, and there deliberately is not one: a campaign at 400%
     * of its goal scores 0.941 and a campaign at 4000% scores 0.9994, because the curve
     * saturates. That is the whole reason §11.2 asks for a sigmoid rather than a ratio —
     * an unbounded {@code pledged / goal} would put one runaway campaign permanently at
     * the top of every feed on the platform.
     */
    static String completion() {
        return """
               CASE WHEN p.goal_amount IS NULL OR p.goal_amount <= 0 OR p.pledged_amount <= 0
                    THEN 0::numeric
                    ELSE round(
                        (p.pledged_amount * p.pledged_amount)
                        / (p.pledged_amount * p.pledged_amount + p.goal_amount * p.goal_amount), 6)
               END
               """;
    }

    /**
     * §11.2's {@code w4}, from #48's view. One or zero.
     *
     * <p><strong>Binary rather than a count.</strong> {@code project_editorial_badges}
     * carries one row per badge, so counting is available and is not used: a campaign in
     * two staff selections has not been endorsed twice as hard, it has been put in two
     * lists — and a term that rewarded list membership per list would make "add it to
     * another collection" a ranking lever with no editorial meaning. #48 left the choice
     * open and said so; this is the choice.
     *
     * <p><strong>Uncorrelated {@code IN} rather than a correlated {@code EXISTS}.</strong>
     * They give the same answer and not the same plan. An {@code EXISTS} referencing
     * {@code p.id} is evaluated once per candidate row — twelve thousand nested-loop
     * probes on a feed that size. The uncorrelated form is a hashed {@code SubPlan}: the
     * badge set is built once and every row is a hash probe. The set is small by
     * construction, because it is the campaigns in published, in-window, badge-granting
     * collections and there are a handful of those.
     *
     * <p>The publication and window predicates are inside the view, so this term cannot
     * disagree with {@code showOnly=featured} about which campaigns are featured, and a
     * badge cannot outlive the collection that grants it without something here having
     * to know that rule.
     */
    static String editorial() {
        return "CASE WHEN p.id IN (SELECT project_id FROM project_editorial_badges)"
                + " THEN 1::numeric ELSE 0::numeric END";
    }

    /**
     * §11.2's {@code w7}. See {@link #RECENCY_HALF_LIFE_HOURS}.
     *
     * <p>A campaign that has never launched scores zero rather than null — an unlaunched
     * teaser is not the most recent thing on the platform, which is the same judgement
     * {@link az.ideanest.discovery.domain.DiscoverySort#NEWEST} makes when it sorts
     * nulls last — so the composite has no null branch and no {@code NULLS} clause to
     * get wrong.
     *
     * <p>The instant is {@code :asOf}, which is pinned by the cursor. That is what stops
     * this term from moving between page one and page nine; see
     * {@code PostgresSearchService.asOf}.
     */
    static String recency() {
        return "CASE WHEN p.launched_at IS NULL THEN 0::numeric ELSE round("
                + RECENCY_HALF_LIFE_HOURS + "::numeric / (" + RECENCY_HALF_LIFE_HOURS + " + " + AGE_HOURS + "), 6)"
                + " END";
    }
}
