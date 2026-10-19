package az.ideanest.reward.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.EditLocks;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.domain.RewardTierItem;
import az.ideanest.reward.domain.ShippingRule;
import az.ideanest.reward.domain.ShippingType;
import az.ideanest.reward.domain.ShippingZoneRule;
import az.ideanest.reward.infrastructure.ItemRepository;
import az.ideanest.reward.infrastructure.RewardTierItemRepository;
import az.ideanest.reward.infrastructure.RewardTierRepository;
import az.ideanest.reward.infrastructure.ShippingRuleRepository;
import az.ideanest.reward.infrastructure.ShippingZoneRepository;
import az.ideanest.reward.infrastructure.ShippingZoneRuleRepository;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
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
 * Reward tiers: writing them, composing them from items, ordering them, pricing
 * their shipping, and copying them.
 *
 * <p><strong>Validation is here as well as in the database.</strong> Every rule below
 * is also a check constraint in {@code V7}, for the reason {@code ItemService} gives.
 * The cross-field rules are checked once against the finished tier rather than field
 * by field, because a single patch may legitimately fix two at the same time — a body
 * that clears {@code isSecret} and sets {@code isFeatured} is a valid edit, and a
 * per-field check would accept or refuse it depending on which field it happened to
 * read first.
 *
 * <p><strong>What is not here.</strong>
 *
 * <ul>
 *   <li><strong>Reservation.</strong> #51 owns it. Nothing in this class writes
 *       {@code claimed_quantity} or {@code reserved_quantity}; the entity does not
 *       expose them for writing and the columns are not insertable. What this
 *       migration and this service provide is the constraint that work will rely on.
 *   <li><strong>Which states freeze what.</strong> §5.3 makes a reward's price
 *       immutable once a campaign is live and permits a quantity to be raised but
 *       not lowered after that. <em>Whether</em> a campaign has reached that point is
 *       not decided here: it is one table, {@code ProjectEditLocks}, in the module
 *       that owns the campaign's state, and it arrives as {@code EditLocks} through
 *       {@link RewardAccess}. This service decides only what to do about the answer,
 *       which is a 409 naming the field. The floor a quantity may be lowered to
 *       <em>before</em> launch — claimed plus reserved — is a different rule and is
 *       still {@link #withinLimit}.
 * </ul>
 */
@Service
public class RewardService {

    /** §5.3: a campaign has between zero and a hundred tiers. */
    private static final int TIER_LIMIT = 100;

    /** Also {@code reward_tiers_title_length}. A tier title is a label, not a paragraph. */
    private static final int TITLE_MAX = 80;

    /**
     * The only currency the platform settles in.
     *
     * <p>Duplicated from {@code ProjectEditingService}, and deliberately not shared.
     * The real answer is the campaign's own {@code currency} column, which this
     * module cannot read — {@code projects} belongs to another module and
     * {@code ProjectAccess} returns a type this package may not name. When a second
     * currency exists, both constants are replaced by that comparison, and until then
     * refusing anything else is what stops a tier being priced in a currency the
     * campaign cannot collect.
     */
    private static final String SUPPORTED_CURRENCY = "AZN";

    /** Where a tier with no explicit position goes: after the last one. */
    private static final int FIRST_SORT_ORDER = 0;

    private final RewardTierRepository rewards;
    private final RewardTierItemRepository compositions;
    private final ShippingRuleRepository shippingRules;
    private final ShippingZoneRuleRepository shippingZoneRules;
    private final ShippingZoneRepository shippingZones;
    private final ItemRepository items;
    private final RewardAccess access;
    private final MediaLibrary media;

    public RewardService(
            RewardTierRepository rewards,
            RewardTierItemRepository compositions,
            ShippingRuleRepository shippingRules,
            ShippingZoneRuleRepository shippingZoneRules,
            ShippingZoneRepository shippingZones,
            ItemRepository items,
            RewardAccess access,
            MediaLibrary media) {
        this.rewards = rewards;
        this.compositions = compositions;
        this.shippingRules = shippingRules;
        this.shippingZoneRules = shippingZoneRules;
        this.shippingZones = shippingZones;
        this.items = items;
        this.access = access;
        this.media = media;
    }

    /**
     * The campaign's whole reward list, as its creator sees it.
     *
     * <p><strong>Secret tiers included.</strong> This is the creator's projection: a
     * tier they cannot see in their own editor is a tier they cannot edit or withdraw,
     * and the reason it is secret is that the <em>public</em> list omits it. That
     * public list is a different response, owned by the campaign page.
     */
    @Transactional(readOnly = true)
    public List<RewardDetail> list(UUID projectId, UUID accountId) {
        EditLocks locks = access.requireEditableProject(projectId, accountId);
        return detailsOf(rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId), locks);
    }

    @Transactional
    public RewardDetail create(UUID projectId, UUID accountId, NewReward draft) {
        EditLocks locks = access.requireEditableProject(projectId, accountId);
        requireRoomForAnotherTier(projectId);

        Money price = requirePrice(draft.price());
        RewardTier tier = RewardTier.of(
                projectId, requireTitle(draft.title()), price.amount(), price.currency(), nextSortOrder(projectId));

        tier.setDescription(blankAsNull(draft.description()));
        tier.setEstimatedDelivery(draft.estimatedDelivery());
        tier.setLimitQuantity(withinLimit(tier, draft.limitQuantity()));
        tier.setShippingType(draft.shippingType() == null ? ShippingType.NONE : draft.shippingType());
        tier.setEarlyBird(draft.earlyBird());
        tier.setFeatured(draft.featured());
        tier.setAddon(draft.addon());
        applyAvailability(tier, draft.availableFrom(), draft.availableUntil());
        if (draft.secret()) {
            tier.makeSecret();
        }
        tier.setImageMediaId(claimImage(accountId, draft.imageMediaId()));
        tier.setVideoMediaId(claimVideo(accountId, draft.videoMediaId()));

        requireConsistent(tier);
        RewardTier saved = rewards.save(tier);
        replaceComposition(saved, draft.items());

        return detailOf(saved, locks);
    }

    /**
     * Applies a partial edit.
     *
     * <p>{@code items} is the one field that is a collection: present means "this is
     * the composition now", so it is replaced wholesale rather than merged. Absent
     * leaves it alone, which is what makes autosaving the title safe.
     *
     * <p>§5.3's post-launch rules are checked before anything is applied, so a body
     * that renames a tier and reprices it changes neither. Half a save is worse than
     * none: the creator would have to work out which half.
     */
    @Transactional
    public RewardDetail edit(UUID rewardId, UUID accountId, RewardPatch patch) {
        RewardAccess.AuthorisedReward authorised = access.requireEditableReward(rewardId, accountId);
        RewardTier tier = authorised.tier();
        requireNothingLocked(tier, authorised.locks(), patch);

        patch.title().ifPresent(title -> tier.setTitle(requireTitle(title)));
        patch.description().ifPresent(description -> tier.setDescription(blankAsNull(description)));
        patch.price().ifPresent(price -> {
            Money accepted = requirePrice(price);
            tier.setPrice(accepted.amount(), accepted.currency());
        });
        patch.estimatedDelivery().ifPresent(tier::setEstimatedDelivery);
        patch.limitQuantity().ifPresent(limit -> tier.setLimitQuantity(withinLimit(tier, limit)));
        patch.shippingType()
                .ifPresent(type -> tier.setShippingType(type == null ? ShippingType.NONE : type));
        patch.earlyBird().ifPresent(early -> tier.setEarlyBird(requireBoolean("isEarlyBird", early)));
        patch.featured().ifPresent(featured -> tier.setFeatured(requireBoolean("isFeatured", featured)));
        patch.addon().ifPresent(addon -> tier.setAddon(requireBoolean("isAddon", addon)));
        patch.secret().ifPresent(secret -> {
            if (requireBoolean("isSecret", secret)) {
                tier.makeSecret();
            } else {
                tier.makePublic();
            }
        });
        // Released only once the tier is known to be consistent: the reference check is a
        // native query, which flushes the tier, and a flush before requireConsistent would
        // turn a 400 into a constraint violation.
        List<UUID> released = new ArrayList<>();
        patch.imageMediaId().ifPresent(mediaId -> released.add(replaceImage(tier, accountId, mediaId)));
        patch.videoMediaId().ifPresent(mediaId -> released.add(replaceVideo(tier, accountId, mediaId)));

        if (patch.changesAvailability()) {
            Instant from = patch.availableFrom().isPresent()
                    ? patch.availableFrom().value()
                    : tier.getAvailableFrom();
            Instant until = patch.availableUntil().isPresent()
                    ? patch.availableUntil().value()
                    : tier.getAvailableUntil();
            applyAvailability(tier, from, until);
        }

        requireConsistent(tier);
        released.forEach(mediaId -> release(tier, mediaId));

        if (patch.items().isPresent()) {
            List<RewardContent> contents =
                    patch.items().value() == null ? List.of() : patch.items().value();
            replaceComposition(tier, contents);
        }

        return detailOf(tier, authorised.locks());
    }

    /**
     * Removes a tier, unless somebody has claimed it. §5.3, without exception.
     *
     * <p>The composition and the shipping rates go with it, by cascade in the
     * database rather than by two more statements here: neither has any meaning
     * without the tier, and a cascade cannot be forgotten by a future caller.
     */
    @Transactional
    public void delete(UUID rewardId, UUID accountId) {
        RewardTier tier = access.requireEditableReward(rewardId, accountId).tier();
        if (tier.hasBackers()) {
            throw new RewardHasBackersException(rewardId, tier.getClaimedQuantity());
        }
        release(tier, tier.getImageMediaId());
        release(tier, tier.getVideoMediaId());
        rewards.delete(tier);
    }

    /**
     * Copies a tier, appended to the end of the list.
     *
     * <p>What is copied is what the creator wrote: the wording, the price, the
     * composition, and the shipping rates — the rates especially, because re-entering
     * a table of thirty countries is the reason a creator reaches for duplicate in the
     * first place.
     *
     * <p>What is not copied is what backers did. The claimed and reserved counts are
     * not insertable columns, so the copy takes the database's zeroes; that is
     * structural rather than a rule this method remembers to apply. See
     * {@link RewardTier#duplicateAt(int)} for why a secret tier gets a new token, and
     * why the copy starts without the original's image and video.
     */
    @Transactional
    public RewardDetail duplicate(UUID rewardId, UUID accountId) {
        RewardAccess.AuthorisedReward authorised = access.requireEditableReward(rewardId, accountId);
        RewardTier original = authorised.tier();
        requireRoomForAnotherTier(original.getProjectId());

        RewardTier copy = rewards.save(original.duplicateAt(nextSortOrder(original.getProjectId())));

        List<RewardTierItem> copiedContents = compositions.findByRewardTier(rewardId).stream()
                .map(content -> RewardTierItem.of(
                        copy.getProjectId(), copy.getId(), content.getItemId(), content.getQuantity()))
                .toList();
        compositions.saveAll(copiedContents);

        List<ShippingRule> copiedRules = shippingRules.findByRewardTier(rewardId).stream()
                .map(rule -> ShippingRule.of(
                        copy.getId(),
                        rule.getCountryCode(),
                        rule.getAmount(),
                        rule.getAdditionalItemAmount(),
                        rule.getPerKilogramAmount()))
                .toList();
        shippingRules.saveAll(copiedRules);

        // The zone rates are copied too, for the reason the country rates are: a
        // duplicated tier that priced nowhere would look like a tier the creator had
        // finished, and the first sign otherwise would be a backer unable to check
        // out. The zones themselves are the campaign's, so there is nothing to copy
        // on that side.
        List<ShippingZoneRule> copiedZoneRules = shippingZoneRules.findByRewardTier(rewardId).stream()
                .map(rule -> ShippingZoneRule.of(
                        copy.getId(),
                        rule.getZoneId(),
                        copy.getProjectId(),
                        rule.getAmount(),
                        rule.getAdditionalItemAmount(),
                        rule.getPerKilogramAmount()))
                .toList();
        shippingZoneRules.saveAll(copiedZoneRules);

        return new RewardDetail(copy, copiedContents, copiedRules, copiedZoneRules, authorised.locks(), null, null);
    }

    /**
     * Puts the campaign's tiers in the order given.
     *
     * <p><strong>Every tier, exactly once, or nothing.</strong> See
     * {@link RewardOrderIncompleteException}: a partial list leaves the tiers it omits
     * at the positions they already had, so they interleave with the ones that moved
     * and the creator gets an order nobody asked for.
     *
     * <p>Positions are rewritten from zero rather than adjusted. Renumbering the whole
     * list makes the stored order exactly the list the client sent, so two clients
     * that reorder concurrently produce one of the two orders rather than a blend of
     * both.
     */
    @Transactional
    public List<RewardDetail> reorder(UUID projectId, UUID accountId, List<UUID> rewardIds) {
        EditLocks locks = access.requireEditableProject(projectId, accountId);

        List<RewardTier> tiers = rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId);
        Map<UUID, RewardTier> byId = tiers.stream().collect(Collectors.toMap(RewardTier::getId, Function.identity()));

        List<UUID> requested = rewardIds == null ? List.of() : rewardIds;
        List<UUID> unexpected = new ArrayList<>();
        Set<UUID> seen = new LinkedHashSet<>();
        for (UUID rewardId : requested) {
            // A repeat is as wrong as a stranger: it would give one tier two
            // positions and leave another with none.
            if (rewardId == null || !byId.containsKey(rewardId) || !seen.add(rewardId)) {
                unexpected.add(rewardId);
            }
        }
        List<UUID> missing =
                tiers.stream().map(RewardTier::getId).filter(id -> !seen.contains(id)).toList();

        if (!missing.isEmpty() || !unexpected.isEmpty()) {
            throw new RewardOrderIncompleteException(missing, unexpected);
        }

        List<RewardTier> reordered = new ArrayList<>();
        int position = FIRST_SORT_ORDER;
        for (UUID rewardId : requested) {
            RewardTier tier = byId.get(rewardId);
            tier.setSortOrder(position++);
            reordered.add(tier);
        }

        return detailsOf(reordered, locks);
    }

    /**
     * Replaces a tier's shipping rates with the set given.
     *
     * <p>Wholesale, because a rate table is read as a whole by whatever quotes from
     * it: a country left out of the body is a country the creator has removed, and
     * merging instead would leave them shipping somewhere they believe they no longer
     * do. An empty set is therefore a legitimate request and clears the table.
     *
     * <p>A destination present in both the old and the new table keeps its row and is
     * repriced. Deleting and reinserting it would be the same result in one more
     * statement, and would have to be flushed between the halves — Hibernate orders
     * inserts before deletes.
     *
     * <p><strong>Both tables at once, since #77.</strong> A tier's rate table is now
     * per-country rows and per-zone rows, and they are replaced in one request
     * because they are one table as far as a quote is concerned: what a backer in
     * Germany is charged depends on the presence of a German row <em>and</em> on
     * whether a zone containing Germany is priced. Two endpoints would let a creator
     * commit half of a rate change, and the half they committed would be quoting to
     * backers while they went to find the other one.
     */
    @Transactional
    public RewardDetail replaceShippingRules(
            UUID rewardId, UUID accountId, List<ShippingRate> rates, List<ZoneRate> zoneRates) {

        RewardAccess.AuthorisedReward authorised = access.requireEditableReward(rewardId, accountId);
        RewardTier tier = authorised.tier();

        if (!tier.getShippingType().isShipped()) {
            // Rates for a tier that is not shipped are rates nothing will ever read,
            // and a creator who entered them believes shipping is priced. §7.2 puts
            // the scope on the tier; this is what keeps the two consistent.
            throw new RewardFieldRejectedException(
                    "shippingType",
                    "Only a tier shipped domestically or internationally has per-country rates."
                            + " Change the shipping scope first.");
        }

        Map<String, ShippingRule> existing = shippingRules.findByRewardTier(rewardId).stream()
                .collect(Collectors.toMap(ShippingRule::getCountryCode, Function.identity()));

        List<ShippingRule> result = new ArrayList<>();
        Set<String> requested = new LinkedHashSet<>();
        for (ShippingRate rate : rates == null ? List.<ShippingRate>of() : rates) {
            ShippingRule candidate = rule(rewardId, rate);
            if (!requested.add(candidate.getCountryCode())) {
                throw new RewardFieldRejectedException(
                        "rules", "Each destination appears once: " + candidate.getCountryCode() + " is listed twice.");
            }

            ShippingRule stored = existing.get(candidate.getCountryCode());
            if (stored == null) {
                result.add(shippingRules.save(candidate));
            } else {
                stored.reprice(
                        candidate.getAmount(),
                        candidate.getAdditionalItemAmount(),
                        candidate.getPerKilogramAmount());
                result.add(stored);
            }
        }

        existing.forEach((country, stored) -> {
            if (!requested.contains(country)) {
                shippingRules.delete(stored);
            }
        });

        return new RewardDetail(
                tier,
                compositions.findByRewardTier(rewardId),
                List.copyOf(result),
                replaceZoneRates(tier, zoneRates),
                authorised.locks(),
                imageOf(tier),
                videoOf(tier));
    }

    /**
     * The zone half of the same replacement — §4.8's PM-13 (#77).
     *
     * <p>The same diff the country half does, keyed by zone instead of by country
     * and for the same reason: a zone present in both tables keeps its row, so
     * repricing the EU does not delete and reinsert a row inside one flush.
     *
     * <p>Every zone named is checked against <em>this campaign</em> before anything
     * is written. The composite foreign key refuses another campaign's zone anyway,
     * which is what actually makes it impossible; this is what makes the refusal a
     * sentence naming the zone rather than a constraint violation.
     */
    private List<ShippingZoneRule> replaceZoneRates(RewardTier tier, List<ZoneRate> zoneRates) {
        Map<UUID, ShippingZoneRule> existing = shippingZoneRules.findByRewardTier(tier.getId()).stream()
                .collect(Collectors.toMap(ShippingZoneRule::getZoneId, Function.identity()));

        List<ShippingZoneRule> result = new ArrayList<>();
        Set<UUID> requested = new LinkedHashSet<>();
        for (ZoneRate rate : zoneRates == null ? List.<ZoneRate>of() : zoneRates) {
            if (rate == null || rate.zoneId() == null || rate.amount() == null) {
                throw new RewardFieldRejectedException("zoneRates", "Each zone rate names a zone and an amount.");
            }
            if (!requested.add(rate.zoneId())) {
                throw new RewardFieldRejectedException(
                        "zoneRates", "Each zone appears once: " + rate.zoneId() + " is listed twice.");
            }
            if (shippingZones
                    .findOnProject(tier.getProjectId(), rate.zoneId())
                    .isEmpty()) {
                throw new RewardFieldRejectedException(
                        "zoneRates", "This campaign has no shipping zone " + rate.zoneId() + ".");
            }

            ShippingZoneRule stored = existing.get(rate.zoneId());
            try {
                if (stored == null) {
                    result.add(shippingZoneRules.save(ShippingZoneRule.of(
                            tier.getId(),
                            rate.zoneId(),
                            tier.getProjectId(),
                            rate.amount(),
                            orZero(rate.additionalItemAmount()),
                            orZero(rate.perKilogramAmount()))));
                } else {
                    stored.reprice(
                            rate.amount(),
                            orZero(rate.additionalItemAmount()),
                            orZero(rate.perKilogramAmount()));
                    result.add(stored);
                }
            } catch (IllegalArgumentException rejected) {
                // The value object refuses a negative rate and a third decimal
                // place. Both are the client's mistake and both should name the
                // field the editor can highlight.
                throw new RewardFieldRejectedException("zoneRates", rejected.getMessage());
            }
        }

        existing.forEach((zoneId, stored) -> {
            if (!requested.contains(zoneId)) {
                shippingZoneRules.delete(stored);
            }
        });

        return List.copyOf(result);
    }

    /** An omitted rate is free rather than unspecified. See {@code ShippingRate}. */
    private static BigDecimal orZero(BigDecimal amount) {
        return amount == null ? BigDecimal.ZERO : amount;
    }

    // ------------------------------------------------------------------
    // Media
    // ------------------------------------------------------------------

    /**
     * Attaches, replaces or removes the tier's picture.
     *
     * <p>The one it replaces is deleted once this edit commits, unless something else still
     * shows it, as {@code ProjectEditingService} does for a campaign's video.
     *
     * @return the upload the tier no longer shows, for the caller to {@link #release}, or
     *     null
     */
    private UUID replaceImage(RewardTier tier, UUID accountId, UUID mediaId) {
        UUID previous = tier.getImageMediaId();
        if (Objects.equals(previous, mediaId)) {
            return null;
        }
        tier.setImageMediaId(claimImage(accountId, mediaId));
        return previous;
    }

    /** {@link #replaceImage}, for the clip. */
    private UUID replaceVideo(RewardTier tier, UUID accountId, UUID mediaId) {
        UUID previous = tier.getVideoMediaId();
        if (Objects.equals(previous, mediaId)) {
            return null;
        }
        tier.setVideoMediaId(claimVideo(accountId, mediaId));
        return previous;
    }

    /**
     * The caller's own ready image, or a refusal naming the field — a campaign cover's rules.
     *
     * <p>The caller rather than the campaign's creator: an upload belongs to whoever made it,
     * and a collaborator editing rewards attaches their own.
     */
    private UUID claimImage(UUID accountId, UUID mediaId) {
        if (mediaId != null && !media.claimForOwner(accountId, Set.of(mediaId)).contains(mediaId)) {
            throw new RewardFieldRejectedException(
                    "imageMediaId", "That image is not available. It may still be processing.");
        }
        return mediaId;
    }

    /**
     * The caller's own ready video, no longer than a reward's clip may be.
     *
     * <p>The length is checked here rather than by the transcoder, which accepts anything up
     * to a campaign video's minute: one upload path serves both slots, and only the slot
     * knows its limit. Measured by ffprobe, never reported by the client.
     */
    private UUID claimVideo(UUID accountId, UUID mediaId) {
        if (mediaId == null) {
            return null;
        }
        MediaLibrary.VideoView view = media.claimVideoForOwner(accountId, mediaId)
                ? media.videoViewOf(mediaId).orElse(null)
                : null;
        if (view == null) {
            throw new RewardFieldRejectedException(
                    "videoMediaId", "That video is not available. It may still be processing.");
        }
        if (!media.fitsAReward(view)) {
            throw new RewardVideoTooLongException(
                    view.durationMs(), media.rewardVideoMaxDuration().toMillis());
        }
        return mediaId;
    }

    /**
     * Deletes an upload this tier no longer shows, once the transaction commits, unless
     * another tier or a campaign still does.
     */
    private void release(RewardTier tier, UUID mediaId) {
        if (mediaId != null && !rewards.isMediaShownElsewhere(mediaId, tier.getId())) {
            media.discardAfterCommit(mediaId);
        }
    }

    private MediaLibrary.MediaView imageOf(RewardTier tier) {
        return tier.getImageMediaId() == null ? null : media.viewOf(tier.getImageMediaId()).orElse(null);
    }

    private MediaLibrary.VideoView videoOf(RewardTier tier) {
        return tier.getVideoMediaId() == null ? null : media.videoViewOf(tier.getVideoMediaId()).orElse(null);
    }

    // ------------------------------------------------------------------
    // Composition
    // ------------------------------------------------------------------

    /**
     * Makes the tier contain exactly these items, in these quantities.
     *
     * <p>A diff rather than a delete-and-reinsert. An item that stays keeps its row
     * and has its quantity changed, which leaves the composition's creation
     * timestamps meaning what they say and avoids the ordering problem that
     * delete-then-insert has inside one Hibernate flush.
     *
     * <p>Every identifier is checked against the campaign, so an item belonging to
     * somebody else's campaign is a 400 naming it. The composite foreign key refuses
     * the same row — that is what actually makes it impossible — and this is what
     * makes the refusal answerable.
     */
    private void replaceComposition(RewardTier tier, List<RewardContent> contents) {
        Map<UUID, Integer> desired = new LinkedHashMap<>();
        for (RewardContent content : contents) {
            if (content == null || content.itemId() == null) {
                throw new RewardFieldRejectedException("items", "Each line of a reward names an item.");
            }
            if (content.quantity() < 1) {
                throw new RewardFieldRejectedException(
                        "items", "A reward contains at least one of every item it lists.");
            }
            if (desired.put(content.itemId(), content.quantity()) != null) {
                // Two lines for one item would have to be summed to be read, and one
                // of the two would eventually be edited alone.
                throw new RewardFieldRejectedException(
                        "items", "Each item appears once, with the quantity as its count.");
            }
        }

        if (!desired.isEmpty()) {
            Set<UUID> belonging = items.findByProjectIdAndIdIn(tier.getProjectId(), desired.keySet()).stream()
                    .map(item -> item.getId())
                    .collect(Collectors.toCollection(HashSet::new));
            List<UUID> foreign =
                    desired.keySet().stream().filter(id -> !belonging.contains(id)).toList();
            if (!foreign.isEmpty()) {
                throw new RewardFieldRejectedException(
                        "items", "Those items are not part of this campaign: " + foreign + ".");
            }
        }

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

    // ------------------------------------------------------------------
    // Assembling the response
    // ------------------------------------------------------------------

    private RewardDetail detailOf(RewardTier tier, EditLocks locks) {
        return new RewardDetail(
                tier,
                compositions.findByRewardTier(tier.getId()),
                shippingRules.findByRewardTier(tier.getId()),
                shippingZoneRules.findByRewardTier(tier.getId()),
                locks,
                imageOf(tier),
                videoOf(tier));
    }

    /**
     * A whole reward list with its compositions, rates and media, in six queries.
     *
     * <p>Not one query per tier. A campaign with forty tiers is eighty extra round
     * trips on every load of the rewards tab, and an N+1 over a list this central is
     * only noticed once there are enough sessions for it to matter.
     */
    private List<RewardDetail> detailsOf(List<RewardTier> tiers, EditLocks locks) {
        if (tiers.isEmpty()) {
            return List.of();
        }

        List<UUID> ids = tiers.stream().map(RewardTier::getId).toList();
        Map<UUID, List<RewardTierItem>> contents = compositions.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(RewardTierItem::getRewardTierId));
        Map<UUID, List<ShippingRule>> rules = shippingRules.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(ShippingRule::getRewardTierId));
        Map<UUID, List<ShippingZoneRule>> zoneRules = shippingZoneRules.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(ShippingZoneRule::getRewardTierId));
        Map<UUID, MediaLibrary.MediaView> images = media.viewsOf(tiers.stream()
                .map(RewardTier::getImageMediaId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
        Map<UUID, MediaLibrary.VideoView> videos = media.videoViewsOf(tiers.stream()
                .map(RewardTier::getVideoMediaId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));

        return tiers.stream()
                .map(tier -> new RewardDetail(
                        tier,
                        contents.getOrDefault(tier.getId(), List.of()),
                        rules.getOrDefault(tier.getId(), List.of()),
                        zoneRules.getOrDefault(tier.getId(), List.of()),
                        locks,
                        tier.getImageMediaId() == null ? null : images.get(tier.getImageMediaId()),
                        tier.getVideoMediaId() == null ? null : videos.get(tier.getVideoMediaId())))
                .toList();
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    /**
     * §5.3 after launch, for a whole patch, before any of it is applied.
     *
     * <p><strong>The price: mentioning it is enough.</strong> A body carrying the
     * price a live tier already has is still refused. Merge-patch says a key that is
     * present is a write, and comparing the amounts instead would make the rule
     * depend on how a number was serialised — {@code "19.99"} and {@code "19.990"}
     * are the same money and different strings, and {@link BigDecimal#equals} says
     * they are different values. A client is told which fields are locked before it
     * sends anything, so this costs a well-behaved one nothing.
     *
     * <p><strong>The quantity: only the direction is refused.</strong> Raising a
     * limit after launch is explicitly permitted — a creator who found more stock
     * should be able to sell it — so what is checked is that the new limit is not
     * <em>below</em> the one the tier already advertises. Two cases follow from
     * reading "unlimited" as the largest limit there is:
     *
     * <ul>
     *   <li>clearing the limit on a live tier is permitted, because it can only ever
     *       add places;
     *   <li>putting a limit on a live tier that had none is refused, because it takes
     *       places away from a page that promised there were always more.
     * </ul>
     *
     * <p>Equal is not a decrease and is allowed, which keeps an autosave that echoes
     * the stored limit from being refused for changing nothing.
     */
    private static void requireNothingLocked(RewardTier tier, EditLocks locks, RewardPatch patch) {
        if (patch.price().isPresent() && locks.rewardPriceLocked()) {
            throw new RewardFieldLockedException(
                    "price",
                    locks.state(),
                    "This campaign is live, so its rewards can no longer be repriced."
                            + " Backers chose this tier at the price it shows.");
        }
        if (patch.limitQuantity().isPresent()
                && locks.rewardQuantityLoweringLocked()
                && lowersTheLimit(tier.getLimitQuantity(), patch.limitQuantity().value())) {
            throw new RewardFieldLockedException(
                    "limitQuantity",
                    locks.state(),
                    "A live campaign's reward quantity can be raised but not lowered. §5.3.");
        }
    }

    /** Whether the new limit offers fewer places than the stored one. Null is unlimited. */
    private static boolean lowersTheLimit(Integer stored, Integer requested) {
        if (requested == null) {
            // Unlimited is never fewer places than a limit.
            return false;
        }
        // A limit where there was none takes places away from a tier that advertised
        // an endless supply of them.
        return stored == null || requested < stored;
    }

    /**
     * The rules that involve more than one field, checked against the finished tier.
     *
     * <p>Each of these is also a check constraint. Reaching the database with one of
     * them violated would be a 500 for a mistake with a perfectly good 400.
     */
    private static void requireConsistent(RewardTier tier) {
        if (tier.isSecret() && tier.isFeatured()) {
            // Featured means shown first; secret means not shown at all. A tier
            // claiming both leaves the campaign page to guess.
            throw new RewardFieldRejectedException(
                    "isFeatured", "A secret reward is not shown on the page, so it cannot also be featured.");
        }
        if (tier.isEarlyBird() && tier.getAvailableUntil() == null && tier.getLimitQuantity() == null) {
            // An early bird is early because it runs out. Without an end or a cap it
            // is an ordinary tier with a label that hurries a backer for no reason.
            throw new RewardFieldRejectedException(
                    "isEarlyBird", "An early-bird reward needs either a closing date or a limited quantity.");
        }
    }

    private static String requireTitle(String title) {
        String trimmed = title == null ? "" : title.trim();
        if (trimmed.isEmpty()) {
            throw new RewardFieldRejectedException("title", "A reward needs a title.");
        }
        if (trimmed.length() > TITLE_MAX) {
            throw new RewardFieldRejectedException("title", "That is longer than " + TITLE_MAX + " characters.");
        }
        return trimmed;
    }

    /**
     * The price, which is an amount and a currency together.
     *
     * <p>Not clearable: a tier without a price is not something a backer can select.
     * {@link Money} has already refused a third decimal place by the time this runs —
     * silently rounding a creator's 19.995 is how a ledger stops reconciling.
     */
    private static Money requirePrice(Money price) {
        if (price == null) {
            throw new RewardFieldRejectedException("price", "A reward needs a price.");
        }
        if (price.amount().compareTo(BigDecimal.ZERO) <= 0) {
            // §5.3 puts the real floor at the smallest chargeable amount, which is
            // the payment provider's and belongs to configuration. Zero and below are
            // not prices at all, and that much can be said here.
            throw new RewardFieldRejectedException("price", "A reward price is more than zero.");
        }
        if (!SUPPORTED_CURRENCY.equals(price.currency())) {
            throw new RewardFieldRejectedException(
                    "price", "Campaigns are funded in " + SUPPORTED_CURRENCY + " for now.");
        }
        return price;
    }

    /**
     * The quantity limit, if it is not below what has already been taken.
     *
     * <p>§5.3: a quantity may be raised freely and lowered only above the number
     * already claimed. Reserved places count as taken — a reservation is somebody
     * entering their card details — which is why the floor is both counts and not just
     * the claimed one.
     */
    private static Integer withinLimit(RewardTier tier, Integer limit) {
        if (limit == null) {
            return null;
        }
        if (limit < 1) {
            throw new RewardFieldRejectedException(
                    "limitQuantity", "A limited reward offers at least one place. Clear the limit for unlimited.");
        }
        if (limit < tier.committedQuantity()) {
            throw new RewardFieldRejectedException(
                    "limitQuantity",
                    "That is below the " + tier.committedQuantity() + " places already taken. §5.3 permits lowering"
                            + " a quantity only above what is claimed.");
        }
        return limit;
    }

    private static void applyAvailability(RewardTier tier, Instant from, Instant until) {
        if (from != null && until != null && !until.isAfter(from)) {
            throw new RewardFieldRejectedException(
                    "availableUntil", "A reward closes after it opens, not before.");
        }
        tier.available(from, until);
    }

    private static ShippingRule rule(UUID rewardId, ShippingRate rate) {
        if (rate == null || rate.amount() == null) {
            throw new RewardFieldRejectedException("rules", "Each rate names a destination and an amount.");
        }
        try {
            // An omitted additional-item rate is free, not unspecified. See
            // ShippingRate. An omitted per-kilogram rate says the same thing about
            // weight: the tier is priced flat, which is what almost every tier is.
            BigDecimal additional =
                    rate.additionalItemAmount() == null ? BigDecimal.ZERO : rate.additionalItemAmount();
            BigDecimal perKilogram =
                    rate.perKilogramAmount() == null ? BigDecimal.ZERO : rate.perKilogramAmount();
            return ShippingRule.of(rewardId, rate.countryCode(), rate.amount(), additional, perKilogram);
        } catch (IllegalArgumentException e) {
            // The value object refuses a code that is not a country and a rate that is
            // negative. Both are the client's mistake, and both should name the field
            // the editor can highlight rather than arrive as a bare 400.
            throw new RewardFieldRejectedException("rules", e.getMessage());
        }
    }

    private void requireRoomForAnotherTier(UUID projectId) {
        if (rewards.countByProjectId(projectId) >= TIER_LIMIT) {
            throw new TooManyRewardsException(TIER_LIMIT);
        }
    }

    /** After the last tier. See {@code RewardTierRepository#findHighestSortOrder}. */
    private int nextSortOrder(UUID projectId) {
        return rewards.findHighestSortOrder(projectId).map(highest -> highest + 1).orElse(FIRST_SORT_ORDER);
    }

    /** A creator who empties a textarea sends {@code ""}. The database refuses a blank description. */
    private static String blankAsNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean requireBoolean(String field, Boolean value) {
        if (value == null) {
            throw new RewardFieldRejectedException(field, "That setting is either on or off.");
        }
        return value;
    }
}
