package az.ideanest.pledge.application;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * "Which pledges are a backing, and whose are they" — the pledge module's answer to
 * the pledge manager.
 *
 * <p>The fourth published contract of {@code ModuleBoundaryTests}' shape, after
 * {@code ProjectCapability}, {@code ProjectAudiences} and {@code ProjectSummaries},
 * and it exists for the reason all three do. §4.8 is entirely about pledges — a
 * survey goes to the backers of a campaign, an address belongs to one pledge, and
 * what a backer is asked depends on the tier they chose — and the pledge manager may
 * not read {@code pledges}. The wrong answers were the usual two: reach into
 * {@code pledge.domain}, which the boundary test fails the build over, or copy the
 * rows, which is a second set of pledge states free to disagree with the first.
 *
 * <p><strong>Declared here rather than in {@code shared}</strong>, unlike
 * {@code ProjectAudiences}. That one is published in {@code shared} because two
 * modules answer it and a third asks; this has one answerer and one asker, both
 * named, and putting it in {@code shared} would mean {@code shared} acquiring a
 * vocabulary about pledge states — which is a feature, and {@code shared} does not
 * get features. {@code RewardStock} is declared in the reward module for the same
 * reason and read by the pledge module.
 *
 * <p><strong>It answers about backings, never about drafts.</strong> A draft is a
 * checkout in progress; it holds stock and it may expire in twenty minutes. Surveying
 * one, or accepting an address for one, would be asking somebody to fill in a form
 * about a purchase they have not made.
 */
public interface BackedPledges {

    /**
     * One pledge, if it is a backing.
     *
     * <p>Empty for a pledge that does not exist and for one in a state that is not a
     * backing — a draft, an expired reservation, a cancellation. Deliberately the
     * same answer: a caller in the pledge manager has no business distinguishing
     * them, and a 404 either way is the honest response.
     */
    Optional<BackedPledge> pledge(UUID pledgeId);

    /**
     * Every backing on a campaign, bounded.
     *
     * <p>What a survey is sent to. Bounded for {@code ProjectAudiences}' reason: the
     * platform's audience ceiling is a real number and a campaign above it must be
     * told that it was truncated rather than quietly reaching the first several
     * thousand.
     *
     * @param limit at most this many, oldest pledge first — so that a truncated send
     *     reaches the campaign's earliest backers rather than an arbitrary set, which
     *     is at least explicable
     */
    List<BackedPledge> onProject(UUID projectId, int limit);

    /**
     * Every backing one account holds, across every campaign.
     *
     * <p>What {@code GET /v1/me/surveys} is built from. Unbounded by a limit
     * parameter because it is bounded by reality: a pledge is a payment somebody
     * made, and nobody has thousands.
     */
    List<BackedPledge> ofBacker(UUID backerId);

    /**
     * Whether this account holds a backing on this campaign — #137's {@code backed}, asked by
     * the campaign page through the community module.
     *
     * <p>The same five states as every other answer here, and so false for a draft: somebody
     * half-way through a checkout has not backed anything yet, and a page that told them they
     * had would hide the button that finishes it. False again once the pledge ends without
     * money changing hands for good — expired, cancelled, dropped, refunded or charged back.
     */
    boolean isBacking(UUID projectId, UUID backerId);

    /**
     * A pledge, in the terms the pledge manager needs it.
     *
     * <p>Plain values rather than the entity, for {@code RewardStock.SelectableTier}'s
     * reason: {@code Pledge} is this module's and the boundary keeps it here.
     *
     * @param rewardTierId which tier was chosen, or null for §4.5's PL-02 — support
     *     with no reward. Null is what makes a survey question conditional on a tier
     *     (PM-02) skip this backer, and it is also why a pledge with no reward is
     *     never asked for a postal address
     * @param shippingCountry ISO 3166-1 alpha-2, or null when the pledge names no
     *     destination. Kept outside the encrypted address envelope deliberately —
     *     V36 says why
     */
    record BackedPledge(
            UUID pledgeId, UUID projectId, UUID backerId, UUID rewardTierId, String shippingCountry) {
    }
}
