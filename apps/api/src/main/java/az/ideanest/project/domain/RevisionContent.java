package az.ideanest.project.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * The writing on a campaign that a creator may change after launch, as one document.
 *
 * <p>A revision holds all of it rather than the fields that changed: the editor shows a
 * whole campaign, a moderator compares a whole campaign, and approval copies a whole
 * campaign across. Nothing else writes these fields while a revision is open, so there is
 * no later state for a diff to be replayed against.
 *
 * <p>The goal, duration, launch time and reward prices are not here. They are frozen at
 * launch ({@link ProjectEditLocks}) and never need a reviewer.
 *
 * <p><strong>Items and shipping regions are held the way tiers are (#587).</strong> An item's
 * name, picture and weight are what a backer reads in a tier and what a quote charges for, and
 * a region's destinations decide who may pledge and at what shipping price, so on a launched
 * campaign they wait here too: the items a revision changes, and the regions as a whole set.
 *
 * <p><strong>The reward tiers are the exception to "all of it" (#559, #569).</strong> A
 * revision holds what the creator changed about the campaign's tiers and nothing about the
 * others: the whole proposed state of each tier it changes, the tiers it deletes, the tiers it
 * creates, and their order. A created tier is a row the public does not see (V118), so the
 * revision names it rather than holding it. The live content holds every approved tier, in
 * display order. A tier that has gone since is ignored.
 *
 * @param story the story document, or null
 * @param rewards the reward tiers, by tier: in a revision, the proposed state of the tiers it
 *     changes; in the live content, every approved tier, in display order. Absent from
 *     revisions written before #559, and holding only the writing in those written before #569
 * @param deletedRewards the approved tiers the revision deletes. Empty in the live content
 * @param createdRewards the tiers created while the revision was open, which wait for it.
 *     Empty in the live content
 * @param rewardOrder the order the creator gave the tiers, created ones included, or null
 *     when they have not reordered them
 * @param items the campaign's items, by item (#587): in a revision, the proposed state of the
 *     items it changes; in the live content, every item an approved tier contains, which is
 *     every item the public can see. Absent from revisions written before #587
 * @param shippingZones the campaign's shipping regions as a whole (#587): in a revision, the
 *     proposed set, or null when it leaves them as they are; in the live content, the set
 *     the campaign has
 */
public record RevisionContent(
        String title,
        String blurb,
        UUID categoryId,
        UUID subcategoryId,
        JsonNode story,
        String risks,
        CoverImage coverImage,
        UUID videoMediaId,
        List<String> countries,
        Map<UUID, Reward> rewards,
        List<UUID> deletedRewards,
        List<UUID> createdRewards,
        List<UUID> rewardOrder,
        Map<UUID, Item> items,
        List<Zone> shippingZones) {

    public static final String TITLE = "title";
    public static final String BLURB = "blurb";
    public static final String CATEGORY = "category";
    public static final String STORY = "story";
    public static final String RISKS = "risks";
    public static final String COVER_IMAGE = "coverImage";
    public static final String VIDEO = "videoMediaId";
    public static final String COUNTRIES = "countries";
    public static final String REWARDS = "rewards";
    public static final String ITEMS = "items";
    public static final String SHIPPING_ZONES = "shippingZones";

    /**
     * What a backer is shown and charged for about an item (#587): its writing, and the two
     * facts a shipping quote reads, whether it ships at all and what it weighs. Not its stock
     * code, which is the creator's own bookkeeping and nobody else reads.
     */
    public record Item(String name, String description, String imageUrl, boolean digital, Integer weightGrams) {}

    /**
     * One shipping region (#587): the identifier a tier's rates name it by, its name, and the
     * destinations it covers, sorted so that two sets of the same regions compare equal.
     *
     * @param id the region's row, or the identifier a region proposed in a revision will be
     *     created with when it is approved
     */
    public record Zone(UUID id, String name, List<String> countries) {

        public Zone {
            countries = countries == null ? List.of() : countries.stream().sorted().toList();
        }
    }

    /**
     * What a backer reads and is promised on a reward tier: its writing, and since #569 the
     * rest of what the creator may change about it. Its price and stock are not here.
     *
     * @param terms everything but the writing, or null in a revision written before #569, where
     *     it means "as the tier shows it"
     */
    public record Reward(String title, String description, UUID imageMediaId, UUID videoMediaId, Terms terms) {

        /** This entry, with what the tier shows standing in for terms written before #569. */
        public Reward over(Reward live) {
            return terms != null || live == null ? this : new Reward(title, description, imageMediaId, videoMediaId, live.terms);
        }
    }

    /**
     * A tier's delivery, stock limit, shipping, flags, window, composition and rates.
     *
     * @param shippingType the reward module's {@code ShippingType}, by name
     * @param secretToken the link that reaches a secret tier, or null for a public one
     */
    public record Terms(
            LocalDate estimatedDelivery,
            Integer limitQuantity,
            String shippingType,
            boolean earlyBird,
            boolean featured,
            boolean addon,
            String secretToken,
            Instant availableFrom,
            Instant availableUntil,
            List<Line> items,
            List<CountryRate> shippingRules,
            List<ZoneRate> zoneRates) {

        public record Line(UUID itemId, int quantity) {}

        public record CountryRate(
                String countryCode, BigDecimal amount, BigDecimal additionalItemAmount, BigDecimal perKilogramAmount) {}

        public record ZoneRate(
                UUID zoneId, BigDecimal amount, BigDecimal additionalItemAmount, BigDecimal perKilogramAmount) {}

        public Terms {
            items = items == null ? List.of() : List.copyOf(items);
            shippingRules = shippingRules == null ? List.of() : List.copyOf(shippingRules);
            zoneRates = zoneRates == null ? List.of() : List.copyOf(zoneRates);
        }
    }

    public RevisionContent {
        countries = List.copyOf(countries);
        rewards = rewards == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(rewards));
        deletedRewards = deletedRewards == null ? List.of() : List.copyOf(deletedRewards);
        createdRewards = createdRewards == null ? List.of() : List.copyOf(createdRewards);
        rewardOrder = rewardOrder == null ? null : List.copyOf(rewardOrder);
        items = items == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(items));
        shippingZones = shippingZones == null
                ? null
                : shippingZones.stream().sorted(Comparator.comparing(zone -> zone.id().toString())).toList();
    }

    /** The content as it was before #587 held items and shipping regions: neither of them. */
    public RevisionContent(
            String title,
            String blurb,
            UUID categoryId,
            UUID subcategoryId,
            JsonNode story,
            String risks,
            CoverImage coverImage,
            UUID videoMediaId,
            List<String> countries,
            Map<UUID, Reward> rewards,
            List<UUID> deletedRewards,
            List<UUID> createdRewards,
            List<UUID> rewardOrder) {
        this(
                title,
                blurb,
                categoryId,
                subcategoryId,
                story,
                risks,
                coverImage,
                videoMediaId,
                countries,
                rewards,
                deletedRewards,
                createdRewards,
                rewardOrder,
                null,
                null);
    }

    /** The content a campaign shows now, with every approved tier, public item and region. */
    public static RevisionContent of(
            Project project, JsonNode story, Map<UUID, Reward> rewards, Map<UUID, Item> items, List<Zone> zones) {
        return new RevisionContent(
                project.getTitle(),
                project.getBlurb(),
                project.getCategoryId(),
                project.getSubcategoryId(),
                story,
                project.getRisks(),
                project.getCoverImage(),
                project.getVideoMediaId(),
                project.getCountries(),
                rewards,
                null,
                null,
                null,
                items,
                zones);
    }

    /** This content with one tier's proposed state replaced. */
    public RevisionContent withReward(UUID rewardId, Reward reward) {
        Map<UUID, Reward> changed = new LinkedHashMap<>(rewards);
        changed.put(rewardId, reward);
        return withRewardChanges(changed, deletedRewards, createdRewards, rewardOrder);
    }

    /** This content with everything it holds about the tiers replaced. */
    public RevisionContent withRewardChanges(
            Map<UUID, Reward> rewards, List<UUID> deleted, List<UUID> created, List<UUID> order) {
        return new RevisionContent(
                title,
                blurb,
                categoryId,
                subcategoryId,
                story,
                risks,
                coverImage,
                videoMediaId,
                countries,
                rewards,
                deleted,
                created,
                order,
                items,
                shippingZones);
    }

    /**
     * This campaign's writing, with what {@code other} holds about the tiers, the items and the
     * shipping regions.
     */
    public RevisionContent withRewardsOf(RevisionContent other) {
        return withRewardChanges(other.rewards, other.deletedRewards, other.createdRewards, other.rewardOrder)
                .withCatalogue(other.items, other.shippingZones);
    }

    /** This content with one item's proposed state replaced (#587). */
    public RevisionContent withItem(UUID itemId, Item item) {
        Map<UUID, Item> changed = new LinkedHashMap<>(items);
        changed.put(itemId, item);
        return withCatalogue(changed, shippingZones);
    }

    /** This content proposing these shipping regions, or none when {@code zones} is null (#587). */
    public RevisionContent withShippingZones(List<Zone> zones) {
        return withCatalogue(items, zones);
    }

    private RevisionContent withCatalogue(Map<UUID, Item> items, List<Zone> zones) {
        return new RevisionContent(
                title,
                blurb,
                categoryId,
                subcategoryId,
                story,
                risks,
                coverImage,
                videoMediaId,
                countries,
                rewards,
                deletedRewards,
                createdRewards,
                rewardOrder,
                items,
                zones);
    }

    /** This content naming these as the tiers created while it was open. */
    public RevisionContent withCreatedRewards(List<UUID> created) {
        return withRewardChanges(rewards, deletedRewards, created, rewardOrder);
    }

    /**
     * This content keeping only what would change {@code live} about the tiers: the proposed
     * state of a tier that has been deleted, is to be deleted, or is what it shows already is
     * dropped, an entry written before #569 is completed from the tier, a deletion of a tier
     * that has gone is dropped, and an order is kept only while it moves something.
     */
    public RevisionContent heldAgainst(RevisionContent live) {
        Map<UUID, Reward> held = new LinkedHashMap<>();
        for (UUID rewardId : changedRewardsFrom(live)) {
            held.put(rewardId, rewards.get(rewardId).over(live.rewards.get(rewardId)));
        }
        List<UUID> order = !createdRewards.isEmpty() || reordersFrom(live) ? rewardOrder : null;
        Map<UUID, Item> heldItems = new LinkedHashMap<>();
        for (UUID itemId : changedItemsFrom(live)) {
            heldItems.put(itemId, items.get(itemId));
        }
        return withRewardChanges(held, deletedRewardsFrom(live), createdRewards, order)
                .withCatalogue(heldItems, changesZonesFrom(live) ? shippingZones : null);
    }

    /**
     * The items, among those {@code live} shows, whose proposed state this content changes, in
     * {@code live}'s order (#587). An item the public no longer sees, because no approved tier
     * contains it any more or it was deleted, is not among them.
     */
    public List<UUID> changedItemsFrom(RevisionContent live) {
        return live.items.entrySet().stream()
                .filter(entry -> items.containsKey(entry.getKey())
                        && !items.get(entry.getKey()).equals(entry.getValue()))
                .map(Map.Entry::getKey)
                .toList();
    }

    /** Whether this content proposes shipping regions other than {@code live}'s (#587). */
    public boolean changesZonesFrom(RevisionContent live) {
        List<Zone> shown = live.shippingZones == null ? List.of() : live.shippingZones;
        return shippingZones != null && !shippingZones.equals(shown);
    }

    /**
     * The tiers, among those {@code live} has, whose proposed state this content changes, in
     * {@code live}'s order. A tier it deletes is not among them.
     */
    public List<UUID> changedRewardsFrom(RevisionContent live) {
        return live.rewards.entrySet().stream()
                .filter(entry -> rewards.containsKey(entry.getKey())
                        && !deletedRewards.contains(entry.getKey())
                        && !rewards.get(entry.getKey()).over(entry.getValue()).equals(entry.getValue()))
                .map(Map.Entry::getKey)
                .toList();
    }

    /** The tiers, among those {@code live} has, that this content deletes, in {@code live}'s order. */
    public List<UUID> deletedRewardsFrom(RevisionContent live) {
        return live.rewards.keySet().stream().filter(deletedRewards::contains).toList();
    }

    /**
     * Every tier this content keeps or creates, in the order it proposes: the approved tiers it
     * does not delete in {@code live}'s order and then the created ones, rearranged by
     * {@link #rewardOrder} when there is one. A tier the order does not name keeps its place
     * after the ones it does.
     */
    public List<UUID> proposedRewardOrder(RevisionContent live) {
        List<UUID> tiers = new ArrayList<>();
        live.rewards.keySet().stream().filter(id -> !deletedRewards.contains(id)).forEach(tiers::add);
        createdRewards.stream().filter(id -> !tiers.contains(id)).forEach(tiers::add);
        if (rewardOrder == null) {
            return List.copyOf(tiers);
        }
        return tiers.stream()
                .sorted(Comparator.comparingInt(id -> {
                    int position = rewardOrder.indexOf(id);
                    return position < 0 ? Integer.MAX_VALUE : position;
                }))
                .toList();
    }

    /** Whether this content moves the approved tiers it keeps relative to one another. */
    public boolean reordersFrom(RevisionContent live) {
        if (rewardOrder == null) {
            return false;
        }
        List<UUID> kept = live.rewards.keySet().stream()
                .filter(id -> !deletedRewards.contains(id))
                .toList();
        List<UUID> proposed = proposedRewardOrder(live).stream().filter(kept::contains).toList();
        return !proposed.equals(kept);
    }

    /**
     * Writes this content onto the campaign's fields, and nothing else.
     *
     * <p>Plain assignment: the checks happened when the creator saved, and the side effects
     * of a change (a story version, releasing a replaced video) belong to the caller, which
     * knows whether the instance it holds is the campaign or a copy of it.
     */
    public void copyOnto(Project project) {
        project.setTitle(title);
        project.setBlurb(blurb);
        project.file(categoryId, subcategoryId);
        project.setStory(story == null || story.isNull() ? null : story.toString());
        project.setRisks(risks);
        project.setCoverImage(coverImage);
        project.setVideoMediaId(videoMediaId);
        project.setCountries(countries);
    }

    /**
     * The names of the fields in which this content differs from {@code other}, in a stable order.
     * {@code rewards} compares as {@link #heldAgainst} does, so {@code other} is the live content:
     * a tier changed, deleted, created or moved is a change to the rewards.
     */
    public List<String> changedFrom(RevisionContent other) {
        List<String> changed = new ArrayList<>();
        if (!Objects.equals(title, other.title)) {
            changed.add(TITLE);
        }
        if (!Objects.equals(blurb, other.blurb)) {
            changed.add(BLURB);
        }
        if (!Objects.equals(categoryId, other.categoryId) || !Objects.equals(subcategoryId, other.subcategoryId)) {
            changed.add(CATEGORY);
        }
        if (!StoryDocuments.isSameDocument(story, other.story)) {
            changed.add(STORY);
        }
        if (!Objects.equals(risks, other.risks)) {
            changed.add(RISKS);
        }
        if (!Objects.equals(coverImage, other.coverImage)) {
            changed.add(COVER_IMAGE);
        }
        if (!Objects.equals(videoMediaId, other.videoMediaId)) {
            changed.add(VIDEO);
        }
        if (!countries.equals(other.countries)) {
            changed.add(COUNTRIES);
        }
        if (!changedRewardsFrom(other).isEmpty()
                || !deletedRewardsFrom(other).isEmpty()
                || !createdRewards.isEmpty()
                || reordersFrom(other)) {
            changed.add(REWARDS);
        }
        if (!changedItemsFrom(other).isEmpty()) {
            changed.add(ITEMS);
        }
        if (changesZonesFrom(other)) {
            changed.add(SHIPPING_ZONES);
        }
        return List.copyOf(changed);
    }
}
