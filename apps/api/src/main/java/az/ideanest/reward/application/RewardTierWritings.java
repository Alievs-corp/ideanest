package az.ideanest.reward.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.HeldRewards;
import az.ideanest.project.application.RewardWriting;
import az.ideanest.project.application.RewardWritings;
import az.ideanest.reward.domain.Item;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.domain.RewardTierItem;
import az.ideanest.reward.domain.ShippingRule;
import az.ideanest.reward.domain.ShippingType;
import az.ideanest.reward.domain.ShippingZone;
import az.ideanest.reward.domain.ShippingZoneRule;
import az.ideanest.reward.infrastructure.ItemRepository;
import az.ideanest.reward.infrastructure.RewardTierItemRepository;
import az.ideanest.reward.infrastructure.RewardTierRepository;
import az.ideanest.reward.infrastructure.ShippingRuleRepository;
import az.ideanest.reward.infrastructure.ShippingZoneRepository;
import az.ideanest.reward.infrastructure.ShippingZoneRuleRepository;
import az.ideanest.shared.money.Money;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The reward module's answer to {@link RewardWritings}: a launched campaign's tiers, read for
 * its revision and written when a moderator approves or refuses it (#559, #569).
 *
 * <p>Also where a tier's composition and rates are written as a whole, by
 * {@link RewardService} when a creator saves them and here when a moderator approves them:
 * one diff, so the two cannot come to write the same table differently.
 */
@Service
public class RewardTierWritings implements RewardWritings {

    private final RewardTierRepository rewards;
    private final RewardTierItemRepository compositions;
    private final ShippingRuleRepository shippingRules;
    private final ShippingZoneRuleRepository shippingZoneRules;
    private final ShippingZoneRepository shippingZones;
    private final ItemRepository items;
    private final MediaLibrary media;

    public RewardTierWritings(
            RewardTierRepository rewards,
            RewardTierItemRepository compositions,
            ShippingRuleRepository shippingRules,
            ShippingZoneRuleRepository shippingZoneRules,
            ShippingZoneRepository shippingZones,
            ItemRepository items,
            MediaLibrary media) {
        this.rewards = rewards;
        this.compositions = compositions;
        this.shippingRules = shippingRules;
        this.shippingZoneRules = shippingZoneRules;
        this.shippingZones = shippingZones;
        this.items = items;
        this.media = media;
    }

    @Override
    @Transactional(readOnly = true)
    public List<Tier> liveTiersOf(UUID projectId) {
        return tiersOf(rewards.findByProjectIdAndApprovedTrueOrderBySortOrderAscCreatedAtAsc(projectId));
    }

    @Override
    @Transactional(readOnly = true)
    public List<Tier> createdTiersOf(UUID projectId) {
        return tiersOf(rewards.findByProjectIdAndApprovedFalseOrderBySortOrderAscCreatedAtAsc(projectId));
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, String> namesOf(UUID projectId) {
        Map<UUID, String> names = new HashMap<>();
        items.findByProjectIdOrderByCreatedAtAsc(projectId).forEach(item -> names.put(item.getId(), item.getName()));
        shippingZones.findByProject(projectId).forEach(zone -> names.put(zone.getId(), zone.getName()));
        return names;
    }

    /**
     * Every tier first and the releases after, so that two tiers trading pictures in one
     * approval each still find the other showing theirs.
     *
     * <p>An item or a zone deleted since the creator proposed a line for it is left out, as the
     * creator's editor already leaves it out. A tier is deleted only while nobody holds a place
     * on it and no pledge or survey names it: §5.3 forbids deleting a tier with backers, one
     * somebody is checking out of is a pledge about to have them, and a row that names it would
     * refuse the delete and with it the whole approval.
     */
    @Override
    @Transactional
    public List<UUID> publish(UUID projectId, HeldRewards approved) {
        Map<UUID, RewardTier> tiers = new LinkedHashMap<>();
        rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId).forEach(tier -> tiers.put(tier.getId(), tier));

        for (UUID created : approved.created()) {
            RewardTier tier = tiers.get(created);
            if (tier != null && !tier.isApproved()) {
                tier.approve();
            }
        }

        Set<UUID> catalogue = idsOf(items.findByProjectIdOrderByCreatedAtAsc(projectId), Item::getId);
        Set<UUID> zones = idsOf(shippingZones.findByProject(projectId), ShippingZone::getId);
        Map<UUID, Set<UUID>> replaced = new LinkedHashMap<>();
        approved.changed().forEach((rewardId, proposed) -> {
            RewardTier tier = tiers.get(rewardId);
            if (tier == null) {
                return;
            }
            RewardWriting writing = withoutGone(proposed, catalogue, zones);
            Set<UUID> previous = new LinkedHashSet<>();
            if (!Objects.equals(tier.getImageMediaId(), writing.imageMediaId())) {
                previous.add(tier.getImageMediaId());
            }
            if (!Objects.equals(tier.getVideoMediaId(), writing.videoMediaId())) {
                previous.add(tier.getVideoMediaId());
            }
            applyTo(tier, writing);
            writeComposition(tier, quantitiesOf(writing.items()));
            writeCountryRates(tier.getId(), countryRulesOf(tier, writing));
            writeZoneRates(tier.getId(), zoneRulesOf(tier, writing));
            replaced.put(tier.getId(), previous);
        });

        List<UUID> kept = new ArrayList<>();
        for (UUID deleted : approved.deleted()) {
            RewardTier tier = tiers.get(deleted);
            if (tier == null) {
                continue;
            }
            if (tier.committedQuantity() > 0 || rewards.isReferencedByPledgesOrSurveys(tier.getId())) {
                kept.add(deleted);
                continue;
            }
            replaced.put(tier.getId(), mediaOf(tier));
            rewards.delete(tier);
            tiers.remove(deleted);
        }

        if (approved.order() != null) {
            List<RewardTier> placed = new ArrayList<>();
            approved.order().stream().map(tiers::get).filter(Objects::nonNull).forEach(placed::add);
            tiers.values().stream().filter(tier -> !placed.contains(tier)).forEach(placed::add);
            int position = 0;
            for (RewardTier tier : placed) {
                tier.setSortOrder(position++);
            }
        }

        replaced.forEach(this::release);
        return List.copyOf(kept);
    }

    /**
     * {@inheritDoc}
     *
     * <p>Nobody can pledge to such a tier, but a survey question can name one; a tier named
     * like that stays, still unapproved, rather than make refusing the revision impossible.
     */
    @Override
    @Transactional
    public void discardCreated(UUID projectId) {
        for (RewardTier tier : rewards.findByProjectIdAndApprovedFalseOrderBySortOrderAscCreatedAtAsc(projectId)) {
            if (rewards.isReferencedByPledgesOrSurveys(tier.getId())) {
                continue;
            }
            release(tier.getId(), mediaOf(tier));
            rewards.delete(tier);
        }
    }

    // ------------------------------------------------------------------
    // A tier as a writing, and a writing as a tier
    // ------------------------------------------------------------------

    /** What a tier, its composition and its rates are now. */
    static RewardWriting writingOfRows(
            RewardTier tier,
            List<RewardTierItem> contents,
            List<ShippingRule> countryRates,
            List<ShippingZoneRule> zoneRates) {
        return writingOf(
                tier,
                contents.stream()
                        .map(content -> new RewardWriting.Line(content.getItemId(), content.getQuantity()))
                        .toList(),
                countryRates.stream()
                        .map(rule -> new RewardWriting.CountryRate(
                                rule.getCountryCode(),
                                rule.getAmount(),
                                rule.getAdditionalItemAmount(),
                                rule.getPerKilogramAmount()))
                        .toList(),
                zoneRates.stream()
                        .map(rule -> new RewardWriting.ZoneRate(
                                rule.getZoneId(),
                                rule.getAmount(),
                                rule.getAdditionalItemAmount(),
                                rule.getPerKilogramAmount()))
                        .toList());
    }

    /** What a tier is, with this composition and these rates. */
    static RewardWriting writingOf(
            RewardTier tier,
            List<RewardWriting.Line> lines,
            List<RewardWriting.CountryRate> countryRates,
            List<RewardWriting.ZoneRate> zoneRates) {
        return new RewardWriting(
                tier.getTitle(),
                tier.getDescription(),
                tier.getImageMediaId(),
                tier.getVideoMediaId(),
                tier.getEstimatedDelivery(),
                tier.getLimitQuantity(),
                tier.getShippingType().name(),
                tier.isEarlyBird(),
                tier.isFeatured(),
                tier.isAddon(),
                tier.getSecretToken(),
                tier.getAvailableFrom(),
                tier.getAvailableUntil(),
                lines,
                countryRates,
                zoneRates);
    }

    /** The tier as {@code writing} proposes it: a copy, never the row. See {@link RewardTier#draftCopy}. */
    static RewardTier draftOf(RewardTier tier, RewardWriting writing) {
        RewardTier draft = tier.draftCopy();
        applyTo(draft, writing);
        return draft;
    }

    /** The proposed composition as rows that are not saved, for the creator's draft. */
    static List<RewardTierItem> contentsOf(RewardTier tier, RewardWriting writing) {
        return writing.items().stream()
                .map(line -> RewardTierItem.of(tier.getProjectId(), tier.getId(), line.itemId(), line.quantity()))
                .toList();
    }

    /** The proposed country rates as rows that are not saved. */
    static List<ShippingRule> countryRulesOf(RewardTier tier, RewardWriting writing) {
        return writing.shippingRules().stream()
                .map(rate -> ShippingRule.of(
                        tier.getId(),
                        rate.countryCode(),
                        rate.amount(),
                        rate.additionalItemAmount(),
                        rate.perKilogramAmount()))
                .toList();
    }

    /** The proposed zone rates as rows that are not saved. */
    static List<ShippingZoneRule> zoneRulesOf(RewardTier tier, RewardWriting writing) {
        return writing.zoneRates().stream()
                .map(rate -> ShippingZoneRule.of(
                        tier.getId(),
                        rate.zoneId(),
                        tier.getProjectId(),
                        rate.amount(),
                        rate.additionalItemAmount(),
                        rate.perKilogramAmount()))
                .toList();
    }

    /** This writing without lines for items or zones the campaign no longer has. */
    static RewardWriting withoutGone(RewardWriting writing, Set<UUID> catalogue, Set<UUID> zones) {
        return new RewardWriting(
                writing.title(),
                writing.description(),
                writing.imageMediaId(),
                writing.videoMediaId(),
                writing.estimatedDelivery(),
                writing.limitQuantity(),
                writing.shippingType(),
                writing.earlyBird(),
                writing.featured(),
                writing.addon(),
                writing.secretToken(),
                writing.availableFrom(),
                writing.availableUntil(),
                writing.items().stream().filter(line -> catalogue.contains(line.itemId())).toList(),
                writing.shippingRules(),
                writing.zoneRates().stream().filter(rate -> zones.contains(rate.zoneId())).toList());
    }

    /**
     * Plain assignment of everything but the composition and the rates: the checks happened
     * when the creator saved. The limit cannot fall below what is taken, because a launched
     * tier's may only be raised.
     */
    private static void applyTo(RewardTier tier, RewardWriting writing) {
        tier.setTitle(writing.title());
        tier.setDescription(writing.description());
        tier.setImageMediaId(writing.imageMediaId());
        tier.setVideoMediaId(writing.videoMediaId());
        tier.setEstimatedDelivery(writing.estimatedDelivery());
        tier.setLimitQuantity(writing.limitQuantity());
        tier.setShippingType(ShippingType.valueOf(writing.shippingType()));
        tier.setEarlyBird(writing.earlyBird());
        tier.setFeatured(writing.featured());
        tier.setAddon(writing.addon());
        tier.keepSecretBehind(writing.secretToken());
        tier.available(writing.availableFrom(), writing.availableUntil());
    }

    // ------------------------------------------------------------------
    // Writing a composition and a rate table as a whole
    // ------------------------------------------------------------------

    /**
     * Makes the tier contain exactly these items, in these quantities.
     *
     * <p>A diff rather than a delete-and-reinsert. An item that stays keeps its row and has its
     * quantity changed, which leaves the composition's creation timestamps meaning what they say
     * and avoids the ordering problem that delete-then-insert has inside one Hibernate flush.
     */
    void writeComposition(RewardTier tier, Map<UUID, Integer> desired) {
        Map<UUID, RewardTierItem> existing = compositions.findByRewardTier(tier.getId()).stream()
                .collect(Collectors.toMap(RewardTierItem::getItemId, Function.identity()));

        desired.forEach((itemId, quantity) -> {
            RewardTierItem stored = existing.get(itemId);
            if (stored == null) {
                compositions.save(RewardTierItem.of(tier.getProjectId(), tier.getId(), itemId, quantity));
            } else {
                stored.changeQuantityTo(quantity);
            }
        });

        existing.forEach((itemId, stored) -> {
            if (!desired.containsKey(itemId)) {
                compositions.delete(stored);
            }
        });
    }

    /**
     * Makes the tier's country rates exactly these. A destination present in both the old and
     * the new table keeps its row and is repriced: deleting and reinserting it would have to be
     * flushed between the halves, because Hibernate orders inserts before deletes.
     */
    void writeCountryRates(UUID tierId, List<ShippingRule> wanted) {
        Map<String, ShippingRule> existing = shippingRules.findByRewardTier(tierId).stream()
                .collect(Collectors.toMap(ShippingRule::getCountryCode, Function.identity()));
        Set<String> requested = new HashSet<>();
        for (ShippingRule candidate : wanted) {
            requested.add(candidate.getCountryCode());
            ShippingRule stored = existing.get(candidate.getCountryCode());
            if (stored == null) {
                shippingRules.save(candidate);
            } else {
                stored.reprice(
                        candidate.getAmount(), candidate.getAdditionalItemAmount(), candidate.getPerKilogramAmount());
            }
        }
        existing.forEach((country, stored) -> {
            if (!requested.contains(country)) {
                shippingRules.delete(stored);
            }
        });
    }

    /** {@link #writeCountryRates}, keyed by zone. */
    void writeZoneRates(UUID tierId, List<ShippingZoneRule> wanted) {
        Map<UUID, ShippingZoneRule> existing = shippingZoneRules.findByRewardTier(tierId).stream()
                .collect(Collectors.toMap(ShippingZoneRule::getZoneId, Function.identity()));
        Set<UUID> requested = new HashSet<>();
        for (ShippingZoneRule candidate : wanted) {
            requested.add(candidate.getZoneId());
            ShippingZoneRule stored = existing.get(candidate.getZoneId());
            if (stored == null) {
                shippingZoneRules.save(candidate);
            } else {
                stored.reprice(
                        candidate.getAmount(), candidate.getAdditionalItemAmount(), candidate.getPerKilogramAmount());
            }
        }
        existing.forEach((zoneId, stored) -> {
            if (!requested.contains(zoneId)) {
                shippingZoneRules.delete(stored);
            }
        });
    }

    // ------------------------------------------------------------------

    private List<Tier> tiersOf(List<RewardTier> tiers) {
        if (tiers.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = tiers.stream().map(RewardTier::getId).toList();
        Map<UUID, List<RewardTierItem>> contents = compositions.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(RewardTierItem::getRewardTierId));
        Map<UUID, List<ShippingRule>> countryRates = shippingRules.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(ShippingRule::getRewardTierId));
        Map<UUID, List<ShippingZoneRule>> zoneRates = shippingZoneRules.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(ShippingZoneRule::getRewardTierId));
        return tiers.stream()
                .map(tier -> new Tier(
                        tier.getId(),
                        Money.of(tier.getAmount(), tier.getCurrency()),
                        writingOfRows(
                                tier,
                                contents.getOrDefault(tier.getId(), List.of()),
                                countryRates.getOrDefault(tier.getId(), List.of()),
                                zoneRates.getOrDefault(tier.getId(), List.of()))))
                .toList();
    }

    private void release(UUID tierId, Set<UUID> previous) {
        previous.stream()
                .filter(Objects::nonNull)
                .filter(mediaId -> !rewards.isMediaShownElsewhere(mediaId, tierId))
                .forEach(media::discardAfterCommit);
    }

    private static Set<UUID> mediaOf(RewardTier tier) {
        Set<UUID> shown = new LinkedHashSet<>();
        shown.add(tier.getImageMediaId());
        shown.add(tier.getVideoMediaId());
        return shown;
    }

    private static Map<UUID, Integer> quantitiesOf(List<RewardWriting.Line> lines) {
        Map<UUID, Integer> quantities = new LinkedHashMap<>();
        lines.forEach(line -> quantities.put(line.itemId(), line.quantity()));
        return quantities;
    }

    private static <T> Set<UUID> idsOf(List<T> rows, Function<T, UUID> id) {
        return rows.stream().map(id).collect(Collectors.toSet());
    }
}
