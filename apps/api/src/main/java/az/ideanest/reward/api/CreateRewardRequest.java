package az.ideanest.reward.api;

import az.ideanest.reward.application.NewReward;
import az.ideanest.shared.money.Money;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * What a client sends to add a reward tier to a campaign.
 *
 * <p>A title and a price. Unlike the campaign's goal, which a draft may be without,
 * the price is required here: a tier with no price is not something a backer can
 * select, and it would have to be excluded from every list and every total the page
 * shows.
 *
 * @param price {@code {"amount": "19.99", "currency": "AZN"}} — the amount a string,
 *     §10.3. The currency has to be the campaign's, which the service checks
 * @param shippingType one of {@code NONE, DIGITAL, LOCAL_PICKUP, DOMESTIC,
 *     INTERNATIONAL}. Omitted means {@code NONE}: a creator who has not said how a
 *     reward is delivered has not promised to ship it
 * @param items the composition, which may be empty. A creator writes the tier and then
 *     builds the items in it
 * @param imageMediaId a ready image upload of the caller's, or null
 * @param videoMediaId a ready video upload of the caller's, at most five seconds long, or
 *     null. A longer one is a {@code 422 REWARD_VIDEO_TOO_LONG}
 */
public record CreateRewardRequest(
        @NotBlank(message = "A title is required") @Size(max = 80, message = "A title may not exceed 80 characters")
                String title,
        String description,
        @NotNull(message = "A price is required") Money price,
        LocalDate estimatedDelivery,
        Integer limitQuantity,
        String shippingType,
        Boolean isEarlyBird,
        Boolean isFeatured,
        Boolean isSecret,
        Boolean isAddon,
        Instant availableFrom,
        Instant availableUntil,
        @Size(max = 200) List<RewardItemBody> items,
        UUID imageMediaId,
        UUID videoMediaId) {

    public NewReward toDraft() {
        return new NewReward(
                title,
                description,
                price,
                estimatedDelivery,
                limitQuantity,
                ShippingTypes.parse(shippingType),
                Boolean.TRUE.equals(isEarlyBird),
                Boolean.TRUE.equals(isFeatured),
                Boolean.TRUE.equals(isSecret),
                Boolean.TRUE.equals(isAddon),
                availableFrom,
                availableUntil,
                RewardItemBody.contentsOf(items),
                imageMediaId,
                videoMediaId);
    }
}
