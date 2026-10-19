package az.ideanest.reward.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.PublicProjects;
import az.ideanest.reward.domain.Item;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.domain.RewardTierItem;
import az.ideanest.reward.domain.ShippingRule;
import az.ideanest.reward.infrastructure.ItemRepository;
import az.ideanest.reward.infrastructure.RewardTierItemRepository;
import az.ideanest.reward.infrastructure.RewardTierRepository;
import az.ideanest.reward.infrastructure.ShippingRuleRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
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
 * The reward tiers a backer may choose from, with what is left of each.
 *
 * <p>§4.5 opens the pledge flow with "available tiers with stock", and PL-01 calls it
 * a live stock check. This is that read.
 *
 * <p><strong>Why this is not a method on {@link RewardService}.</strong> The two
 * answer different questions for different people, and almost nothing they do is
 * shared. That service is the creator's editor: every entry point begins by asking
 * {@link RewardAccess} who the caller is, it returns every tier including the secret
 * ones, and it exists to change them. This one has no caller identity to ask about —
 * a visitor deciding whether to back a campaign has usually not registered — and what
 * stands in for authorisation is the campaign's state. Folding a public read into a
 * class whose every other method starts with an authorisation check is how a public
 * read eventually inherits the wrong projection: {@code RewardDetail} carries the
 * reservation counts and the secret token, and the only thing keeping them off a
 * campaign page is that a different type is built here.
 *
 * <p><strong>What is filtered out, and what deliberately is not.</strong>
 *
 * <ul>
 *   <li><strong>Secret tiers</strong> (PL-15). Absent unless the request presented the
 *       tier's own token. This is the other half of the sentence in
 *       {@code RewardController#list}: what makes a tier secret is that the public
 *       list leaves it out.
 *   <li><strong>Tiers outside their availability window.</strong> Against the injected
 *       {@link Clock}, never {@code Instant.now()}. §5.3 also expresses "withdraw a
 *       tier from sale" as an {@code available_until} in the past — a tier with
 *       backers may not be deleted — so this filter is what actually withdraws it.
 *   <li><strong>Sold-out tiers stay.</strong> A tier with no places left is returned
 *       with {@code remainingQuantity: 0}, because a backer looking at a campaign
 *       page needs to see that the early bird existed and has gone. Hiding it would
 *       make the page silently shorter every time a tier filled, and PL-01's job is
 *       to refuse the pledge, not to conceal the tier.
 * </ul>
 *
 * <p><strong>Three queries for a whole list</strong>, as {@code RewardService} does:
 * the tiers, their compositions, and their rates. A campaign page is the most-read
 * surface on the platform, and one query per tier is an N+1 that is only noticed when
 * there is enough traffic for it to matter.
 */
@Service
public class PublicRewardCatalogue {

    private final RewardTierRepository rewards;
    private final RewardTierItemRepository compositions;
    private final ShippingRuleRepository shippingRules;
    private final ItemRepository items;
    private final PublicProjects projects;
    private final MediaLibrary media;
    private final Clock clock;

    public PublicRewardCatalogue(
            RewardTierRepository rewards,
            RewardTierItemRepository compositions,
            ShippingRuleRepository shippingRules,
            ItemRepository items,
            PublicProjects projects,
            MediaLibrary media,
            Clock clock) {

        this.rewards = rewards;
        this.compositions = compositions;
        this.shippingRules = shippingRules;
        this.items = items;
        this.projects = projects;
        this.media = media;
        this.clock = clock;
    }

    /**
     * What this campaign is offering right now, split into selectable tiers and
     * add-ons.
     *
     * <p>The split is {@code is_addon} and it is two arrays rather than one with a
     * flag on each element, because they are two lists in every interface that shows
     * them: PL-04 makes an add-on something a backer adds <em>to</em> a tier with a
     * quantity, and a client that had to partition the list itself would be repeating
     * this decision in three places.
     *
     * @param secretTokens the tokens the request presented, in whatever order. A
     *     backer holds the link to at most one secret tier as a rule, but a creator
     *     may run several and there is no reason a client cannot present two
     * @throws az.ideanest.project.application.ProjectNotFoundException for a campaign
     *     that does not exist and for one whose state is not public. The same answer
     *     for both — see {@link PublicProjects}
     */
    @Transactional(readOnly = true)
    public PublicCatalogue of(UUID projectId, Collection<String> secretTokens) {
        PublicProjects.PublicCampaign campaign = projects.requireVisible(projectId);

        Instant now = clock.instant();
        Set<String> presented = presentedTokens(secretTokens);
        List<RewardTier> offered = rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId).stream()
                .filter(tier -> isOffered(tier, now, presented))
                .toList();

        List<PublicReward> tiers = new ArrayList<>();
        List<PublicReward> addons = new ArrayList<>();
        for (PublicReward reward : detailsOf(projectId, offered)) {
            (reward.tier().isAddon() ? addons : tiers).add(reward);
        }

        return new PublicCatalogue(campaign.currency(), List.copyOf(tiers), List.copyOf(addons));
    }

    /**
     * Whether a stranger holding this campaign's URL may be shown this tier.
     *
     * <p>Two rules, and they are independent: a secret tier is also subject to its
     * window, so a closed early bird that happens to be secret stays closed for the
     * person holding its link.
     */
    private static boolean isOffered(RewardTier tier, Instant now, Set<String> presented) {
        if (tier.isSecret() && !unlockedBy(tier, presented)) {
            return false;
        }
        return isWithinWindow(tier, now);
    }

    /**
     * The availability window, as a half-open interval {@code [from, until)}.
     *
     * <p>Open at exactly {@code available_from} and closed at exactly
     * {@code available_until}. Half-open rather than closed at both ends because a
     * creator who runs an early bird until midnight and a standard tier from midnight
     * means one to replace the other, and two closed intervals would offer both for
     * the instant they share. It is also the reading {@code available_until} already
     * has in §5.3, where a timestamp in the past is how a tier is withdrawn from sale.
     *
     * <p>Both ends are nullable and null is "no bound", which is the common case: most
     * tiers are open for the whole campaign.
     */
    private static boolean isWithinWindow(RewardTier tier, Instant now) {
        Instant from = tier.getAvailableFrom();
        Instant until = tier.getAvailableUntil();
        return (from == null || !now.isBefore(from)) && (until == null || now.isBefore(until));
    }

    /**
     * Whether one of the tokens the request carried is this tier's.
     *
     * <p><strong>Compared in constant time.</strong> The token is stored in the clear
     * and is a capability rather than a credential — §7.2 explains why — so the
     * comparison itself is not protecting a hash, and the practical attack on a
     * 256-bit URL-safe token is not timing but guessing, which it is far too large
     * for. {@link MessageDigest#isEqual} is used anyway because it costs one method
     * call: the alternative is leaving a secret comparison whose safety depends on an
     * argument about network jitter, and an argument like that has to be made again by
     * every reader. What it cannot hide is the <em>length</em> of the stored token,
     * which is a constant here and therefore reveals nothing.
     *
     * <p>Every candidate is compared rather than short-circuiting on the first match,
     * so the work does not depend on which token was presented either.
     */
    private static boolean unlockedBy(RewardTier tier, Set<String> presented) {
        String secret = tier.getSecretToken();
        if (secret == null) {
            // The database refuses a secret tier without a token, so this is a row
            // no migration can produce. Treated as locked rather than as an error:
            // a public read is not the place to discover a broken invariant, and
            // failing closed leaves the tier hidden, which is what "secret" means.
            return false;
        }
        byte[] expected = secret.getBytes(StandardCharsets.UTF_8);
        boolean unlocked = false;
        for (String candidate : presented) {
            unlocked |= MessageDigest.isEqual(expected, candidate.getBytes(StandardCharsets.UTF_8));
        }
        return unlocked;
    }

    /** The tokens worth comparing: no nulls, no blanks, each one once. */
    private static Set<String> presentedTokens(Collection<String> secretTokens) {
        if (secretTokens == null || secretTokens.isEmpty()) {
            return Set.of();
        }
        return secretTokens.stream()
                .filter(token -> token != null && !token.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    /**
     * The tiers with their contents, their rates and their media, in four further
     * queries.
     *
     * <p>The items are read by campaign rather than by identifier, because a
     * campaign's item catalogue is tens of rows and the alternative is a second
     * {@code IN} list assembled from the compositions — the same rows, one more
     * collection to build, and a query whose plan changes with the size of the list.
     */
    private List<PublicReward> detailsOf(UUID projectId, List<RewardTier> tiers) {
        if (tiers.isEmpty()) {
            return List.of();
        }

        List<UUID> ids = tiers.stream().map(RewardTier::getId).toList();
        Map<UUID, List<RewardTierItem>> contents = compositions.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(RewardTierItem::getRewardTierId));
        Map<UUID, List<ShippingRule>> rates = shippingRules.findByRewardTiers(ids).stream()
                .collect(Collectors.groupingBy(ShippingRule::getRewardTierId));
        Map<UUID, Item> catalogue = items.findByProjectIdOrderByCreatedAtAsc(projectId).stream()
                .collect(Collectors.toMap(Item::getId, Function.identity()));
        Map<UUID, MediaLibrary.MediaView> images = media.viewsOf(tiers.stream()
                .map(RewardTier::getImageMediaId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
        Map<UUID, MediaLibrary.VideoView> videos = media.videoViewsOf(tiers.stream()
                .map(RewardTier::getVideoMediaId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));

        return tiers.stream()
                .map(tier -> new PublicReward(
                        tier,
                        publicContentsOf(catalogue, contents.getOrDefault(tier.getId(), List.of())),
                        rates.getOrDefault(tier.getId(), List.of()),
                        tier.getImageMediaId() == null ? null : images.get(tier.getImageMediaId()),
                        tier.getVideoMediaId() == null ? null : videos.get(tier.getVideoMediaId())))
                .toList();
    }

    /**
     * A tier's contents, described rather than referenced.
     *
     * <p>The creator's projection carries {@code itemId}, because the editor already
     * holds the campaign's item list and embedding the same mug in four tiers would
     * invite a client to edit one copy of it. A backer holds no such list and has no
     * use for the identifier: what they are asking is what is in the box. So the name
     * and whether it is a file travel with the line, and the identifier does not —
     * which also keeps the response from being a way to enumerate a campaign's
     * internal catalogue.
     *
     * <p>In the order the composition query returns, which is by item identifier and
     * therefore the same between two reads of unchanged data. A list that reshuffled
     * would change this response's {@code ETag} without anything having changed.
     */
    private static List<PublicRewardItem> publicContentsOf(
            Map<UUID, Item> catalogue, List<RewardTierItem> contents) {

        List<PublicRewardItem> lines = new ArrayList<>();
        for (RewardTierItem content : contents) {
            Item item = catalogue.get(content.getItemId());
            if (item == null) {
                // The composite foreign key makes a line pointing outside the
                // campaign impossible, so this is unreachable. Skipped rather than
                // thrown, because the worst outcome of a row that should not exist
                // is a campaign page that will not render at all.
                continue;
            }
            lines.add(new PublicRewardItem(item.getName(), content.getQuantity(), item.isDigital()));
        }
        return List.copyOf(lines);
    }

    /**
     * A campaign's public offer: what may be chosen, and what may be added to it.
     *
     * @param currency the campaign's, stated once. Every price below is denominated
     *     in it — the tier carries the same value in its own column — and repeating
     *     it on every line would be one more thing that can come to disagree
     */
    public record PublicCatalogue(String currency, List<PublicReward> rewards, List<PublicReward> addons) {

        public PublicCatalogue {
            rewards = List.copyOf(rewards);
            addons = List.copyOf(addons);
        }
    }

    /**
     * One tier as a backer sees it: the row, what is in it, and what it costs to send.
     *
     * <p>The entity rather than a flattened projection, exactly as {@link RewardDetail}
     * carries it: the mapping to JSON is an API concern and belongs beside the
     * response record. What this type decides is <em>which</em> tiers and which of
     * their satellites a stranger may be shown; which of a tier's own columns reach
     * the wire is {@code PublicRewardResponse}, and that is deliberately one file with
     * one list of fields in it.
     *
     * @param shippingRates the rate table, which is what PL-05 needs: the destination
     *     drives the charge, and a client that cannot see the rates cannot show a
     *     total before checkout. Empty for a tier that is not shipped
     * @param image the tier's picture, or null when it has none or it is not servable
     * @param video the tier's clip, or null likewise
     */
    public record PublicReward(
            RewardTier tier,
            List<PublicRewardItem> items,
            List<ShippingRule> shippingRates,
            MediaLibrary.MediaView image,
            MediaLibrary.VideoView video) {

        public PublicReward {
            items = List.copyOf(items);
            shippingRates = List.copyOf(shippingRates);
        }
    }

    /** One line of what a tier contains, as a backer reads it. */
    public record PublicRewardItem(String name, int quantity, boolean digital) {
    }
}
