package az.ideanest.pledge.infrastructure;

import az.ideanest.pledge.application.RewardTierBackers;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeState;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * The two questions a campaign page asks about its backers, and no others.
 *
 * <p><strong>Its own interface rather than two more methods on
 * {@link PledgeRepository}.</strong> That one is the checkout's — a pledge by its
 * owner, a backer's live pledge, the sweep's batch — and every query on it is scoped
 * to one person or to one job. These three are scoped to a campaign and answer a
 * stranger. Keeping them apart is the same split {@code PublicRewardCatalogue} makes
 * against {@code RewardService}, and it has the same payoff: nothing here can
 * accidentally be handed a query that was written to be safe only because a backer
 * identifier was part of it.
 *
 * <p><strong>{@link Repository}, not {@link org.springframework.data.jpa.repository.JpaRepository}.</strong>
 * The marker interface publishes exactly the methods declared below.
 * {@code JpaRepository} would additionally publish {@code save}, {@code delete},
 * {@code deleteAll}, and {@code findAll} on a type whose whole purpose is a public
 * read — writes on the public path that nobody intended and a full-table scan a
 * campaign page could reach by autocomplete.
 *
 * <p>Every query takes the counted states as a parameter rather than naming them.
 * Which states are a public backing is a decision, it is made once in
 * {@link az.ideanest.pledge.application.PublicBackers#COUNTED}, and a copy of it
 * inlined in each JPQL string is one more copy to keep in step with a state machine
 * that is still being built.
 */
public interface PublicBackerRepository extends Repository<Pledge, UUID> {

    /**
     * How many people have backed this campaign, publicly counted.
     *
     * <p><strong>Anonymous pledges are counted.</strong> There is no
     * {@code is_anonymous} clause here and there must never be one: PL-12 hides who,
     * not how many, and a count that excluded the people who asked not to be named
     * would understate the campaign to everybody — the visitor deciding whether to
     * join, and the creator reading their own page.
     *
     * <p>One row per pledge is one row per person, because
     * {@code pledges_project_backer_active_key} already refuses a second active pledge
     * from the same backer on the same campaign. A {@code count(distinct p.backerId)}
     * would say the same thing more slowly and would quietly hide it if that index
     * were ever relaxed.
     */
    @Query("SELECT count(p) FROM Pledge p WHERE p.projectId = :projectId AND p.state IN :states")
    long countBackers(@Param("projectId") UUID projectId, @Param("states") Collection<PledgeState> states);

    /**
     * How many backers each reward tier has — §4.4's Rewards tab, which shows a backer
     * count beside every tier.
     *
     * <p>Grouped in the database rather than counted from the list above it, which is
     * the point of it being here at all: a caller that derived per-tier counts by
     * filtering a page of backers would get the page's tally rather than the campaign's,
     * and would get it wrong in exactly the way that looks right on a small campaign.
     *
     * <p>Pledges with no tier are excluded, because they belong to none — §4.5's PL-02,
     * support with no reward. The consequence is stated where it is served: these
     * counts sum to at most {@link #countBackers}, and the difference is the people who
     * backed without taking anything.
     *
     * <p>Ordered by tier identifier so that two reads of unchanged data produce the
     * same body, and therefore the same {@code ETag}. A group-by has no order of its
     * own, and one that reshuffled would break a conditional request for no reason.
     */
    @Query(
            """
            SELECT new az.ideanest.pledge.application.RewardTierBackers(p.rewardTierId, count(p))
              FROM Pledge p
             WHERE p.projectId = :projectId
               AND p.state IN :states
               AND p.rewardTierId IS NOT NULL
             GROUP BY p.rewardTierId
             ORDER BY p.rewardTierId
            """)
    List<RewardTierBackers> countBackersByRewardTier(
            @Param("projectId") UUID projectId, @Param("states") Collection<PledgeState> states);

    /**
     * Which of these accounts asked not to be named on this campaign — #255.
     *
     * <p>The comment tab names a comment's author unless they asked §4.5's PL-12 for
     * anonymity here: the people who comment on a campaign are, by §3.1, its backers, so a
     * name under a comment says "this person backed it" as plainly as a backer list would.
     *
     * <p><strong>Any pledge, in any state.</strong> No state filter, unlike the counts
     * above: a backer who asked for anonymity and then cancelled, or whose charge is still
     * being retried, asked all the same, and the cost of honouring a request that has
     * lapsed is one comment without a name.
     *
     * <p>It answers only about identifiers the caller already holds, and only which of them
     * to withhold a name for. It is not a list of backers.
     */
    @Query(
            """
            SELECT DISTINCT p.backerId
              FROM Pledge p
             WHERE p.projectId = :projectId
               AND p.backerId IN :accounts
               AND p.anonymous = true
            """)
    List<UUID> anonymousBackersAmong(
            @Param("projectId") UUID projectId, @Param("accounts") Collection<UUID> accounts);

    // There is deliberately no query here that returns the pledges themselves.
    // Whether a campaign publishes who backed it is #209, which carries
    // `status: needs-decision`; until it is answered, a read that could hand a caller
    // a list of backers is a read nobody has agreed should exist. Adding one is the
    // first thing that issue does, and PublicBacker is the shape it puts them in.
}
