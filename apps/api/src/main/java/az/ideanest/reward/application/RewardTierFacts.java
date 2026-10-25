package az.ideanest.reward.application;

import az.ideanest.project.application.RewardFacts;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.infrastructure.RewardTierItemRepository;
import az.ideanest.reward.infrastructure.RewardTierRepository;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * This module's answer to the questions other modules ask about reward tiers.
 *
 * <p>Two interfaces, pointing opposite ways, and both for the same reason — the
 * one that keeps the modules acyclic. {@link RewardFacts} is the project module's
 * completeness checklist, declared there and implemented here because the
 * alternative would be a cycle; see that interface. {@link RewardStock} is the
 * pledge module's reservation (#51), declared <em>here</em> because that module
 * already depends on this one and the alternative would again be a cycle.
 *
 * <p><strong>The stock methods are one statement each</strong>, and the statements
 * are in {@link RewardTierRepository} rather than here. That is deliberate: what
 * makes a reservation correct is a conditional {@code UPDATE} whose condition is
 * part of the statement, so there is nothing left for this class to decide and
 * nothing a caller could get wrong by calling it in the wrong order. §7.2 says the
 * stock columns are "written by the pledge module and by reservation, never by the
 * campaign editor" — written by, not owned by, which is why the writes are here,
 * where the table's constraints and its entity live.
 *
 * <p><strong>Secret and withdrawn tiers are counted.</strong> §5.3's two rules are
 * about what the campaign <em>offers</em>, not about what a visitor can see: a
 * secret tier is one somebody will be charged for through a private link, and a
 * tier whose availability window has closed can be reopened by editing one field.
 * Both are priced, both are the campaign's, and excluding either would let a
 * campaign pass the price floor by hiding the tier that fails it. A tier created on a
 * launched campaign that waits for a moderator (#569) is not counted, priced or sold: the
 * campaign does not offer it until it is approved.
 *
 * <p>No authorisation here. Every caller of this has already been through
 * {@code ProjectAccess} — the checklist endpoint and the submission both load the
 * campaign before they ask — and a second check would be a second answer to a
 * question {@code ProjectAccess} exists to answer once.
 */
@Service
public class RewardTierFacts implements RewardFacts, RewardStock, RewardTitles {

    private final RewardTierRepository rewards;
    private final RewardTierItemRepository contents;
    private final ShippingRates shippingRates;

    public RewardTierFacts(
            RewardTierRepository rewards, RewardTierItemRepository contents, ShippingRates shippingRates) {

        this.rewards = rewards;
        this.contents = contents;
        this.shippingRates = shippingRates;
    }

    @Override
    @Transactional(readOnly = true)
    public List<BigDecimal> pricesOf(UUID projectId) {
        return rewards.findByProjectIdAndApprovedTrueOrderBySortOrderAscCreatedAtAsc(projectId).stream()
                .map(RewardTier::getAmount)
                .toList();
    }

    /**
     * {@inheritDoc}
     *
     * <p>The same query {@link #pricesOf} runs, projected differently. Two callers asking
     * the campaign's tiers two questions is one read each rather than a shared cache: a
     * cache here would be a second answer to "what is this tier called" with its own
     * staleness, and the campaign editor renames tiers.
     */
    @Override
    @Transactional(readOnly = true)
    public Map<UUID, RewardTitle> titlesOf(UUID projectId) {
        Map<UUID, RewardTitle> titles = new HashMap<>();
        for (RewardTier tier : rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId)) {
            titles.put(
                    tier.getId(),
                    new RewardTitle(tier.getId(), tier.getTitle(), Money.of(tier.getAmount(), tier.getCurrency())));
        }
        return Map.copyOf(titles);
    }

    /**
     * {@inheritDoc}
     *
     * <p>{@code findAllById} rather than a query per identifier, and rather than the
     * campaign-shaped read above: a page of a backer's own pledges names one tier on each of
     * twenty different campaigns, so {@link #titlesOf} would fetch twenty campaigns' worth
     * of tiers to read twenty titles.
     *
     * <p>Deduplicated before the read, so a caller holding the same tier twice cannot make
     * the answer carry it twice — which a {@code Map} would collapse anyway, silently, and
     * silently is how a caller comes to believe the result is positional.
     */
    @Override
    @Transactional(readOnly = true)
    public Map<UUID, RewardTitle> titlesOfTiers(Collection<UUID> rewardTierIds) {
        if (rewardTierIds == null || rewardTierIds.isEmpty()) {
            // No statement at all rather than one that can match nothing. A pledge without a
            // reward is §4.5's PL-02 and is ordinary, so a page of them asks about no tiers.
            return Map.of();
        }

        Map<UUID, RewardTitle> titles = new HashMap<>();
        for (RewardTier tier : rewards.findAllById(Set.copyOf(rewardTierIds))) {
            titles.put(
                    tier.getId(),
                    new RewardTitle(tier.getId(), tier.getTitle(), Money.of(tier.getAmount(), tier.getCurrency())));
        }
        return Map.copyOf(titles);
    }

    /**
     * {@inheritDoc}
     *
     * <p>The campaign is checked here rather than by the caller because a tier
     * belongs to one, and a pledge naming a tier from a different campaign is a row
     * V17's composite foreign key refuses anyway. Doing it in this order means the
     * client is told which mistake it made instead of being handed a constraint
     * violation.
     *
     * <p>Secret, withdrawn, and out-of-window tiers are all priced. Whether a
     * particular backer may select one is a question about a secret link and about
     * the campaign's state, and it is answered by the endpoint that already loaded
     * the campaign to render it (#52) — not by the method that hands out a price.
     *
     * <p>A tier waiting for a moderator (#569) is not priced: nobody may pledge to a tier the
     * public cannot see, and the answer is the one for a tier that does not exist.
     */
    @Override
    @Transactional(readOnly = true)
    public Optional<RewardTierPrice> priceOf(UUID projectId, UUID rewardTierId) {
        return rewards.findById(rewardTierId)
                .filter(tier -> tier.getProjectId().equals(projectId))
                .filter(RewardTier::isApproved)
                .map(tier -> new RewardTierPrice(tier.getId(), tier.getAmount(), tier.getCurrency()));
    }

    /**
     * {@inheritDoc}
     *
     * <p>No transaction of its own beyond the one the caller is in, deliberately.
     * Taking the place and recording who took it are one unit of work — that is the
     * whole argument in V17 for keeping the reservation in the database — so this
     * must join the caller's transaction and not commit ahead of it. {@code REQUIRED}
     * is what does that, and it is the default.
     */
    @Override
    @Transactional
    public boolean reservePlaces(UUID rewardTierId, int places) {
        return rewards.reservePlaces(rewardTierId, requirePlaces(places)) == 1;
    }

    /** {@inheritDoc} */
    @Override
    @Transactional
    public boolean releasePlaces(UUID rewardTierId, int places) {
        return rewards.releasePlaces(rewardTierId, requirePlaces(places)) == 1;
    }

    /**
     * {@inheritDoc}
     *
     * <p>{@code REQUIRED}, like the two above and for the same reason: moving a
     * place from held to claimed and moving the pledge from DRAFT to CONFIRMED are
     * one unit of work, and this committing ahead of the caller would leave a tier
     * with a claim against a pledge that never confirmed.
     */
    @Override
    @Transactional
    public boolean commitPlaces(UUID rewardTierId, int places) {
        return rewards.commitPlaces(rewardTierId, requirePlaces(places)) == 1;
    }

    /**
     * {@inheritDoc}
     *
     * <p>{@code REQUIRED}, like the others: taking the new place, giving the old one
     * back, and re-quoting the pledge are one unit of work, and this committing ahead
     * of the caller would leave a tier holding a claim for an edit that failed.
     */
    @Override
    @Transactional
    public boolean claimPlaces(UUID rewardTierId, int places) {
        return rewards.claimPlaces(rewardTierId, requirePlaces(places)) == 1;
    }

    /** {@inheritDoc} */
    @Override
    @Transactional
    public boolean releaseClaimedPlaces(UUID rewardTierId, int places) {
        return rewards.releaseClaimedPlaces(rewardTierId, requirePlaces(places)) == 1;
    }

    /**
     * Refuses a move of no places, or of a negative number of them.
     *
     * <p><strong>An exception rather than a {@code false}</strong>, and the difference
     * matters: every caller of the five above reads {@code false} as "the tier has not
     * got them", which for a zero would be a lie the caller then reports to a backer
     * as {@code REWARD_SOLD_OUT}. A move of nothing is a bug in whoever computed the
     * quantity — {@code pledge_addons_quantity_is_positive} refuses the row it would
     * have come from — and a bug that answers 409 is a bug nobody finds.
     *
     * <p>It is checked here rather than in the statements because the statements would
     * not notice. A zero satisfies both guards and both limits, updates one row,
     * returns 1, and moves nothing at all; a negative release would <em>add</em>
     * places to a tier, which is the one direction no constraint in V7 bounds.
     */
    private static int requirePlaces(int places) {
        if (places < 1) {
            throw new IllegalArgumentException("A stock movement is of at least one place, not " + places);
        }
        return places;
    }

    /**
     * {@inheritDoc}
     *
     * <p>Two queries however many lines were selected: the tiers, and then every
     * shipping rule for those tiers in one read. Resolving the rate per tier would
     * be a query per add-on on the request a backer is waiting on.
     */
    @Override
    @Transactional(readOnly = true)
    public List<SelectableTier> selectionOf(
            UUID projectId, Collection<UUID> rewardTierIds, String destinationCountry) {

        if (rewardTierIds.isEmpty()) {
            // Not merely an optimisation: `IN ()` is not valid SQL, and a pledge with
            // no reward and no add-ons is §4.5's PL-02 rather than a mistake.
            return List.of();
        }

        List<RewardTier> tiers = rewards.findSelected(projectId, rewardTierIds);
        List<UUID> tierIds = tiers.stream().map(RewardTier::getId).toList();
        Map<UUID, ShippingRate> rates = shippingRates.ratesTo(projectId, tierIds, destinationCountry);
        Map<UUID, Long> weights = weightsOf(tierIds);

        return tiers.stream()
                .map(tier -> new SelectableTier(
                        tier.getId(),
                        tier.getAmount(),
                        tier.getCurrency(),
                        tier.getShippingType().isShipped(),
                        rates.get(tier.getId()),
                        weights.getOrDefault(tier.getId(), 0L)))
                .toList();
    }

    /**
     * What each of these tiers weighs, for #77's per-kilogram rates.
     *
     * <p>One query however many tiers were selected, and it is skipped entirely when
     * nothing was: {@code IN ()} is not valid SQL, and a pledge with no reward and no
     * add-ons is §4.5's PL-02 rather than a mistake.
     *
     * <p>A tier absent from the result weighs zero — it has no items, or none of its
     * items has a recorded weight — and both mean the same thing to a quote. See
     * {@code ShippingRate.costFor} for why that is not an error.
     */
    private Map<UUID, Long> weightsOf(Collection<UUID> rewardTierIds) {
        if (rewardTierIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Long> weights = new HashMap<>();
        for (Object[] row : contents.weighTiers(rewardTierIds)) {
            weights.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return weights;
    }

    /** {@inheritDoc} */
    @Override
    @Transactional(readOnly = true)
    public List<UUID> alternativesTo(UUID projectId, UUID rewardTierId, Instant at) {
        return rewards.findAvailableAlternatives(projectId, rewardTierId, at);
    }

}
