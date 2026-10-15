package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.infrastructure.PublicBackerRepository;
import az.ideanest.project.application.PublicProjects;
import java.util.Collection;
import java.util.Collections;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * How many people have backed this campaign, for a reader with no relationship to it.
 *
 * <p>§4.4 puts two of these on the project page: the backer count in the header, and a
 * backer count beside every tier on the Rewards tab. This is where both come from.
 *
 * <p><strong>Counts, and deliberately not a list of who.</strong> §4.4 makes backer
 * data public only in aggregate and never names an individual, so whether a campaign
 * should publish who backed it is a product and privacy decision nobody has taken —
 * it is #209, and it carries {@code status: needs-decision}. `CLAUDE.md` §5 says not
 * to implement around one of those, and a public endpoint publishing names is not
 * something to ship on the strength of a plausible default. {@link PublicBacker} is
 * what that decision will be built out of if it goes the other way; nothing here
 * consumes it yet, and that file says so.
 *
 * <p><strong>Why this is not a method on {@code PledgeService}.</strong> The same split
 * {@code PublicRewardCatalogue} makes against {@code RewardService}, for the same
 * reason. That service is the backer's own checkout: every entry point begins by
 * establishing who is calling, and {@code PledgeDetail} carries the amounts, the
 * shipping destination, the idempotency key, and the anonymity flag itself. This one
 * has no caller to establish — a visitor deciding whether to back a campaign has
 * usually not registered — and what stands in for authorisation is the campaign's
 * state. Folding a public read into a class whose every other method starts with an
 * ownership check is how a public read eventually inherits the wrong projection.
 *
 * <h2>Both counts come from one place</h2>
 *
 * <p>{@link PublicBacking} carries the campaign's total and the per-tier totals
 * together, because they are one question. Answering them separately is how they come
 * to disagree, and the specific way they disagree is that somebody derives the
 * campaign's number by summing the tiers — which silently omits §4.5's PL-02, the
 * pledges that took no reward at all.
 *
 * <p><strong>Not {@code projects.backers_count}</strong>, and that is worth stating
 * plainly. The denormalised counter exists (V6) and discovery reads it, but nothing on
 * the platform writes it yet, so today it is zero for every campaign. The count served
 * here is taken from {@code pledges}, which is the ledger and therefore the answer.
 * When something starts maintaining the counter, the two must be reconciled — and the
 * test that reconciles them belongs with whichever issue starts the writing.
 */
@Service
public class PublicBackers {

    /**
     * The states in which a pledge is a public backing of a campaign.
     *
     * <p><strong>Derived from {@link PledgeState#ACTIVE}, minus {@link
     * PledgeState#DRAFT}</strong>, rather than written out. The active set is §7.2's
     * "one pledge per backer per project" and it is the same six states
     * {@code pledges_project_backer_active_key} enforces; restating five of them here
     * would be a second list to keep in step with a state machine that still has
     * transitions to gain (#56, epic #59). Derivation means the only thing this class
     * can get wrong is the one deliberate difference, which is stated once, here.
     *
     * <p><strong>And the difference is DRAFT.</strong> A draft is a reservation with a
     * five-minute life (§4.5's PL-13), not a commitment. Counting one would make the
     * public backer count rise every time somebody opened a checkout and fall again
     * when they wandered off.
     */
    public static final Set<PledgeState> COUNTED = counted();

    private final PublicBackerRepository backings;
    private final PublicProjects projects;

    public PublicBackers(PublicBackerRepository backings, PublicProjects projects) {
        this.backings = backings;
        this.projects = projects;
    }

    /**
     * What this campaign publishes about the people who backed it.
     *
     * <p>Two queries. Both count over the same state set and neither looks at
     * {@code is_anonymous}, which is the whole of PL-12 as it applies to an aggregate:
     * anonymity hides who, never how many.
     *
     * @throws az.ideanest.project.application.ProjectNotFoundException for a campaign
     *     that does not exist and for one whose state is not public, identically. See
     *     {@link PublicProjects}
     */
    @Transactional(readOnly = true)
    public PublicBacking of(UUID projectId) {
        projects.requireVisible(projectId);

        return new PublicBacking(
                backings.countBackers(projectId, COUNTED), backings.countBackersByRewardTier(projectId, COUNTED));
    }

    /**
     * Which of these accounts asked to back this campaign anonymously — #255.
     *
     * <p>For the comment tab, which names a comment's author unless they did: PL-12 hides
     * who backed a campaign, and a name under a comment on it says exactly that. The
     * campaign's visibility is not checked here; the caller has already read the comments,
     * which it may do only for a campaign the reader may see.
     *
     * @return the subset of {@code accountIds} to show no name for
     */
    @Transactional(readOnly = true)
    public Set<UUID> anonymousBackersAmong(UUID projectId, Collection<UUID> accountIds) {
        if (accountIds.isEmpty()) {
            return Set.of();
        }
        return Collections.unmodifiableSet(new HashSet<>(backings.anonymousBackersAmong(projectId, accountIds)));
    }

    /** See {@link #COUNTED}. */
    private static Set<PledgeState> counted() {
        EnumSet<PledgeState> states = EnumSet.copyOf(PledgeState.ACTIVE);
        states.remove(PledgeState.DRAFT);
        return Collections.unmodifiableSet(states);
    }

    /**
     * What a campaign publishes about the people who backed it.
     *
     * @param backerCount every counted pledge on the campaign, anonymous ones included.
     *     PL-12 hides who, never how many
     * @param rewardTiers one entry per tier that has at least one backer, in tier order.
     *     These sum to at most {@code backerCount}; the difference is the pledges that
     *     named no tier, which is §4.5's PL-02, support with no reward. That is why the
     *     campaign's total is its own query rather than a sum of this list
     */
    public record PublicBacking(long backerCount, List<RewardTierBackers> rewardTiers) {

        public PublicBacking {
            rewardTiers = List.copyOf(rewardTiers);
        }
    }
}
