package az.ideanest.project.api;

import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A reward tier a revision creates, deletes, moves or changes (#559, #569), as the public sees
 * it and as the creator proposes it.
 *
 * @param id the reward tier
 * @param changes {@code created}, {@code deleted}, or one or both of {@code changed} and
 *     {@code reordered}. A tier is reordered when its place among the approved tiers that stay
 *     is not the place it has now
 * @param livePosition its place in the list the public sees, from zero, or null for a created
 *     tier
 * @param proposedPosition its place in the list as proposed, from zero, or null for a deleted
 *     tier
 * @param price what the tier costs. A revision never changes it, but a created tier's is new
 * @param changedFields for a changed tier, the fields that differ, named as the creator's
 *     reward response names them
 * @param live null for a created tier
 * @param proposed null for a deleted tier
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RevisionRewardBody(
        UUID id,
        List<String> changes,
        Integer livePosition,
        Integer proposedPosition,
        Money price,
        List<String> changedFields,
        RevisionRewardWriting live,
        RevisionRewardWriting proposed) {

    /**
     * @param description null when the tier has none
     * @param image null when the tier has no picture, or it is not servable
     * @param video null when the tier has no clip, or it is not servable
     * @param limitQuantity null is unlimited
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record RevisionRewardWriting(
            String title,
            String description,
            RevisionRewardImage image,
            CampaignVideoBody video,
            LocalDate estimatedDelivery,
            Integer limitQuantity,
            String shippingType,
            boolean isEarlyBird,
            boolean isFeatured,
            boolean isSecret,
            boolean isAddon,
            Instant availableFrom,
            Instant availableUntil,
            List<RevisionRewardItem> items,
            List<RevisionShippingRule> shippingRules,
            List<RevisionShippingZoneRate> shippingZoneRates) {}

    public record RevisionRewardImage(UUID mediaId, String url, int width, int height, String blurDataUrl) {}

    /** @param name the item's name now, or null when it has been deleted since */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record RevisionRewardItem(UUID itemId, String name, int quantity) {}

    public record RevisionShippingRule(
            String countryCode,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal amount,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal additionalItemAmount,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal perKilogramAmount) {}

    /** @param zoneName the zone's name now, or null when it has been deleted since */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record RevisionShippingZoneRate(
            UUID zoneId,
            String zoneName,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal amount,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal additionalItemAmount,
            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal perKilogramAmount) {}
}
