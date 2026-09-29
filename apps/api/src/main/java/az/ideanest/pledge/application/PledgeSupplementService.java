package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeQuote;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.domain.PledgeSupplement;
import az.ideanest.pledge.domain.SupplementAddon;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.pledge.infrastructure.PledgeSupplementRepository;
import az.ideanest.pledge.infrastructure.SupplementAddonRepository;
import az.ideanest.project.application.PledgeAcceptance;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §4.8's PM-09, PM-10 and PM-16 (#76): what a backer buys after the campaign closed.
 *
 * <h2>Why this is not an edit</h2>
 *
 * <p>§4.5's PL-09 already lets a backer change what they are buying, and it re-quotes
 * the whole pledge. That is right while the campaign runs, because nothing has been
 * charged and the total is a promise about a future charge. After the deadline it is
 * wrong twice over, and V39 argues both at length: §5.1's decision was taken against
 * those numbers and V29 froze it, so moving {@code base_amount} afterwards changes
 * what a campaign is reported to have raised; and the money moves separately, which is
 * the issue's own requirement — an additional purchase is "charged as a separate
 * transaction".
 *
 * <p>So the two endpoints here are refused while the campaign is still taking pledges,
 * with a code that sends the client to the way that applies then: the edit for a draft or a
 * legacy confirmed pledge, and since #171 {@link PledgeRaiseService}'s raise for a paid one,
 * which re-quotes the pledge and charges the difference at once. One way to change a pledge at
 * a time, and the one that applies is decided by the campaign rather than by the client.
 *
 * <h2>What actually changes</h2>
 *
 * <ul>
 *   <li><strong>The pledge's reward tier moves</strong> on an upgrade, because that is
 *       what will be shipped, and its claimed place moves with it. Its
 *       {@code base_amount} does not.
 *   <li><strong>The purchase is recorded beside the pledge</strong> as a
 *       {@link PledgeSupplement}, with its own lines for add-ons. Nothing is written
 *       into {@code pledge_addons} — V39 says why a mixed line would be unpickable.
 *   <li><strong>Nothing is charged.</strong> PM-16 is the charge and it is epic #59's;
 *       {@code collected_at} is null on every row this platform holds. A stub that
 *       marked a supplement collected would tell a creator money had arrived.
 * </ul>
 *
 * <h2>What a fulfilment has to read</h2>
 *
 * <p>Both tables. What goes in a backer's box is {@code pledge_addons} plus every
 * {@code supplement_addons} row on their pledge, and a reader that took only the first
 * would pack the campaign's add-ons and leave out everything bought in the pledge
 * manager. It is stated here, in V39, and in §4.8, because it is the one cost of
 * keeping the two purchases apart.
 */
@Service
public class PledgeSupplementService {

    private static final Logger log = LoggerFactory.getLogger(PledgeSupplementService.class);

    /**
     * The pledge states a supplement may be bought against.
     *
     * <p>A backing that is still going somewhere. {@link PledgeState#DRAFT} is out
     * because a draft is a checkout in progress and the thing to do with it is finish
     * it; the cancellations, the expiry and {@link PledgeState#DROPPED} are out because
     * there is no reward to add to; {@link PledgeState#CHARGE_FAILED} is out because
     * selling more to somebody whose card has already been refused is how a small
     * problem becomes a large one; and {@link PledgeState#FULFILLED} is out because the
     * parcel has gone.
     */
    private static final List<PledgeState> SUPPLEMENTABLE =
            List.of(PledgeState.CONFIRMED, PledgeState.CHARGE_PENDING, PledgeState.COLLECTED);

    private final PledgeRepository pledges;
    private final PledgeSupplementRepository supplements;
    private final SupplementAddonRepository supplementLines;
    private final PledgeDetails details;
    private final ReservationService reservations;
    private final PledgeAcceptance acceptance;

    public PledgeSupplementService(
            PledgeRepository pledges,
            PledgeSupplementRepository supplements,
            SupplementAddonRepository supplementLines,
            PledgeDetails details,
            ReservationService reservations,
            PledgeAcceptance acceptance) {

        this.pledges = pledges;
        this.supplements = supplements;
        this.supplementLines = supplementLines;
        this.details = details;
        this.reservations = reservations;
        this.acceptance = acceptance;
    }

    /**
     * PM-09: moves the pledge to a better reward tier and records what it costs.
     *
     * <p><strong>Both tiers are priced now, and the difference is what is owed.</strong>
     * A tier's price cannot move after launch — §5.3 freezes it — so the old side of
     * the subtraction is the price the backer actually paid; what can have moved is the
     * postage, and a heavier tier posted to Berlin is exactly what an upgrade changes.
     * Pricing both sides at the same moment is what makes the difference a real
     * difference rather than one measured against a rate that no longer exists.
     *
     * <p><strong>A downgrade is refused rather than refunded.</strong> Money that has
     * been collected comes back through #67, which is a refund with a reason code and
     * an audit trail; recording a negative supplement here would put a payment into a
     * table a collection run reads and would pay somebody by accident.
     *
     * @throws PledgeNotFoundException for a pledge that is not this caller's, and for
     *     one that does not exist — deliberately the same answer
     * @throws PledgeNotSupplementableException when the pledge is in a state that
     *     cannot buy anything more
     * @throws CampaignStillTakingPledgesException while §4.5's PL-09 edit is the way to
     *     change this pledge
     * @throws SupplementNotAnIncreaseException when the chosen tier costs no more than
     *     the one the pledge already has
     */
    @Transactional
    public PledgeDetail upgrade(UUID pledgeId, UUID backerId, UUID rewardTierId) {
        Pledge pledge = supplementable(pledgeId, backerId);

        UUID currentTierId = pledge.getRewardTierId();
        if (rewardTierId.equals(currentTierId)) {
            throw new SupplementNotAnIncreaseException(pledgeId);
        }

        PledgeQuote wanted = reservations.priceOfTier(pledge.getProjectId(), rewardTierId, pledge.getShippingCountry());
        BigDecimal current = currentTierId == null
                // §4.5's PL-02: a pledge with no reward has nothing to subtract, and
                // taking one is the whole of what they now owe. Their bonus stays where
                // it is -- it was support, and it is not credit against a reward.
                ? BigDecimal.ZERO
                : reservations
                        .priceOfTier(pledge.getProjectId(), currentTierId, pledge.getShippingCountry())
                        .totalAmount();

        BigDecimal owed = wanted.totalAmount().subtract(current);
        if (owed.signum() <= 0) {
            throw new SupplementNotAnIncreaseException(pledgeId);
        }

        reservations.moveClaimedPlace(pledge, currentTierId, rewardTierId);
        pledge.upgradeTo(rewardTierId);
        supplements.save(PledgeSupplement.upgrade(
                pledgeId, pledge.getProjectId(), currentTierId, rewardTierId, owed, wanted.currency()));

        log.info("Pledge {} upgraded from tier {} to tier {}", pledgeId, currentTierId, rewardTierId);
        return details.of(pledges.saveAndFlush(pledge));
    }

    /**
     * PM-10: buys more things beside the reward and records what they cost.
     *
     * <p><strong>These are new lines, not a change to the old ones.</strong> A backer
     * who bought two mugs during the campaign and one after it has a
     * {@code pledge_addons} row of two and a {@code supplement_addons} row of one, and
     * V39 argues why merging them would make {@code pledges.addons_amount} unpickable.
     * The places are claimed either way, so the tier's stock is right whichever table
     * the quantity is in.
     *
     * @throws PledgeNotFoundException for a pledge that is not this caller's
     * @throws PledgeNotSupplementableException when the pledge cannot buy anything more
     * @throws CampaignStillTakingPledgesException while the edit is the way to do this
     * @throws UnknownRewardTierException when an add-on is not this campaign's
     * @throws RewardSoldOutException when an add-on has too few places left
     */
    @Transactional
    public PledgeDetail buyAddons(UUID pledgeId, UUID backerId, List<DraftPledge.AddonSelection> selections) {
        Pledge pledge = supplementable(pledgeId, backerId);

        // The same rule the checkout applies, from the same method: one line per tier,
        // because two lines for one add-on is a quantity expressed twice.
        DraftPledge.requireDistinctSelections(null, selections);

        PledgeQuote quote =
                reservations.priceOfAddons(pledge.getProjectId(), selections, pledge.getShippingCountry());
        if (quote.totalAmount().signum() <= 0) {
            // A purchase of nothing. Free add-ons are a real thing a creator may
            // offer, and a supplement for zero would be a row a collection run has to
            // decide what to do with -- V39's amount is positive by constraint.
            throw new SupplementNotAnIncreaseException(pledgeId);
        }

        reservations.claimPurchasedPlaces(pledge.getProjectId(), selections);

        PledgeSupplement supplement = supplements.save(PledgeSupplement.addons(
                pledgeId, pledge.getProjectId(), quote.totalAmount(), quote.currency()));
        supplementLines.saveAll(selections.stream()
                .map(selection -> SupplementAddon.of(
                        supplement.getId(), selection.rewardTierId(), selection.quantity()))
                .toList());

        log.info("Pledge {} bought {} add-on lines after the campaign", pledgeId, selections.size());
        return details.of(pledge);
    }

    /**
     * The pledge, if this account holds it and it can still buy something.
     *
     * <p>Three refusals in one order, and the order matters: whose it is, then whether
     * the campaign has moved on, then what state the pledge is in. A caller who does
     * not own the pledge learns nothing about the other two, which is the rule
     * {@code PledgeService} applies to every read.
     */
    private Pledge supplementable(UUID pledgeId, UUID backerId) {
        Pledge pledge =
                pledges.findOwned(pledgeId, backerId).orElseThrow(() -> new PledgeNotFoundException(pledgeId));

        if (acceptance.isAcceptingPledges(pledge.getProjectId())) {
            throw new CampaignStillTakingPledgesException(pledge.getProjectId(), pledge.getState());
        }
        if (!SUPPLEMENTABLE.contains(pledge.getState())) {
            throw new PledgeNotSupplementableException(pledgeId, pledge.getState());
        }
        return pledge;
    }

}
