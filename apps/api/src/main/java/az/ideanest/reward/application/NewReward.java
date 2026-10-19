package az.ideanest.reward.application;

import az.ideanest.reward.domain.ShippingType;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A reward tier as the creator first describes it.
 *
 * <p>Plain values, for the reason {@link NewItem} gives: creation has nothing to
 * leave alone.
 *
 * @param price required. Unlike the campaign's goal, which a draft may be without,
 *     a tier with no price is not something a backer can select — it would have to
 *     be excluded from every list and every total, which is a state worth not having
 * @param shippingType null means {@link ShippingType#NONE}. A creator who has not
 *     said how a reward is delivered has not promised to ship it anywhere, and
 *     defaulting to shipping would ask a backer for an address nobody intended to use
 * @param items the composition. Empty is legal and common at this point: a creator
 *     writes the tier, then builds the items it contains
 * @param imageMediaId a ready image upload of the caller's, or null
 * @param videoMediaId a ready video upload of the caller's, short enough for a reward, or
 *     null
 */
public record NewReward(
        String title,
        String description,
        Money price,
        LocalDate estimatedDelivery,
        Integer limitQuantity,
        ShippingType shippingType,
        boolean earlyBird,
        boolean featured,
        boolean secret,
        boolean addon,
        Instant availableFrom,
        Instant availableUntil,
        List<RewardContent> items,
        UUID imageMediaId,
        UUID videoMediaId) {

    public NewReward {
        items = items == null ? List.of() : List.copyOf(items);
    }
}
