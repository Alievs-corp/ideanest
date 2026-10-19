package az.ideanest.reward.api;

import az.ideanest.reward.application.PublicRewardCatalogue;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A reward tier as a backer sees it.
 *
 * <p>The public counterpart of {@link RewardResponse}, and a separate type because
 * the difference between them is the feature. What is <strong>absent</strong> here
 * carries as much of the design as what is present:
 *
 * <ul>
 *   <li><strong>{@code secretToken}.</strong> The link is the creator's to hand out.
 *       A public list that echoed it back would make every secret tier reachable by
 *       anyone who read one response, which is the whole of PL-15 undone.
 *   <li><strong>{@code claimedQuantity} and {@code reservedQuantity}.</strong> How
 *       many people are in a campaign's checkout right now is a commercial fact about
 *       the creator, and a backer needs only the number this tier can still sell.
 *       {@code remainingQuantity} is that number and is derived from all three.
 *   <li><strong>{@code isSecret}.</strong> A secret tier the caller has unlocked is
 *       returned as an ordinary one. A flag would tell whoever received the link
 *       nothing they did not know, and its <em>absence</em> from the unfiltered list
 *       is what keeps a client from rendering "1 hidden reward".
 *   <li><strong>{@code version}, {@code pricingLocked}, {@code sortOrder}, the
 *       timestamps, and the availability window.</strong> Editor machinery. The order
 *       is expressed by the order of the array, and a tier outside its window is not
 *       in the array at all, so nothing here has to be re-derived by a client.
 * </ul>
 *
 * <p><strong>Nulls are written out</strong>, for a stronger reason than
 * {@link RewardResponse}'s. {@code limitQuantity} and {@code remainingQuantity} are
 * null exactly when the tier is unlimited — the application's Jackson omits nulls by
 * default, and a client that could not tell "unlimited" from "the server did not say"
 * would have to guess, on the one field that decides whether a backer is shown "3
 * left".
 *
 * @param price the tier's own, with the campaign's currency on it. §10.3: the amount
 *     is a string on the wire
 * @param estimatedDelivery a date, or null. A month is what a creator can honestly
 *     promise; see {@code RewardTier}
 * @param limitQuantity null means unlimited
 * @param remainingQuantity {@code limitQuantity} minus what is claimed and reserved,
 *     or null when unlimited. PL-01's live stock check reads this, and it is
 *     {@code RewardTier#getRemainingQuantity()} rather than arithmetic repeated here:
 *     a second implementation of one subtraction is a second chance to oversell
 * @param items what is in the tier, described. No identifiers — see
 *     {@code PublicRewardCatalogue}
 * @param shippingRates per destination, so a client can quote PL-05's shipping charge
 *     before the backer reaches checkout. Empty when the tier is not shipped
 * @param image the tier's picture, or null
 * @param video the tier's clip of at most five seconds, or null
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PublicRewardResponse(
        UUID id,
        String title,
        String description,
        Money price,
        LocalDate estimatedDelivery,
        String shippingType,
        Integer limitQuantity,
        Integer remainingQuantity,
        boolean isEarlyBird,
        boolean isFeatured,
        List<ItemBody> items,
        List<ShippingRuleBody> shippingRates,
        RewardImageBody image,
        RewardVideoBody video) {

    /** The one place a tier becomes a public response. */
    public static PublicRewardResponse of(PublicRewardCatalogue.PublicReward reward) {
        RewardTier tier = reward.tier();
        return new PublicRewardResponse(
                tier.getId(),
                tier.getTitle(),
                tier.getDescription(),
                Money.of(tier.getAmount(), tier.getCurrency()),
                tier.getEstimatedDelivery(),
                tier.getShippingType().name(),
                tier.getLimitQuantity(),
                tier.getRemainingQuantity(),
                tier.isEarlyBird(),
                tier.isFeatured(),
                reward.items().stream().map(ItemBody::of).toList(),
                // Reused rather than redefined: a rate is a country and two amounts
                // in both directions, and a second record for it would be a second
                // place for the wire format of money to drift.
                reward.shippingRates().stream().map(ShippingRuleBody::of).toList(),
                RewardImageBody.of(reward.image()),
                RewardVideoBody.of(reward.video()));
    }

    /**
     * One line of what the tier contains.
     *
     * <p>{@code isDigital} is here because it changes what the backer is agreeing to:
     * a file arrives by download and needs no address, and a tier made only of files
     * is one nobody should be asked to give a destination for.
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ItemBody(String name, int quantity, boolean isDigital) {

        static ItemBody of(PublicRewardCatalogue.PublicRewardItem item) {
            return new ItemBody(item.name(), item.quantity(), item.digital());
        }
    }
}
