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
        List<UUID> rewardOrder) {

    public static final String TITLE = "title";
    public static final String BLURB = "blurb";
    public static final String CATEGORY = "category";
    public static final String STORY = "story";
    public static final String RISKS = "risks";
    public static final String COVER_IMAGE = "coverImage";
    public static final String VIDEO = "videoMediaId";
    public static final String COUNTRIES = "countries";
    public static final String REWARDS = "rewards";

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
    }

    /** The content a campaign shows now, with every approved tier. */
    public static RevisionContent of(Project project, JsonNode story, Map<UUID, Reward> rewards) {
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
                null);
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
                order);
    }

    /** This campaign's writing, with what {@code other} holds about the tiers. */
    public RevisionContent withRewardsOf(RevisionContent other) {
        return withRewardChanges(other.rewards, other.deletedRewards, other.createdRewards, other.rewardOrder);
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
        return withRewardChanges(held, deletedRewardsFrom(live), createdRewards, order);
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
        return List.copyOf(changed);
    }
}
