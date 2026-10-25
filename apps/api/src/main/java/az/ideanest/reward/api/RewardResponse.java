package az.ideanest.reward.api;

import az.ideanest.reward.application.RewardDetail;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A reward tier as its creator's editor sees it.
 *
 * <p>The response of every endpoint in this module that touches a tier — create,
 * patch, duplicate, reorder, shipping rates, and the list. One shape rather than one
 * per action, so a client applies the same update to its state whichever call it made,
 * and so that an endpoint cannot quietly start returning a field the others do not.
 *
 * <p>This is the <strong>creator's</strong> projection. It carries the secret token
 * and the reservation counts, neither of which belongs in a public response; the
 * campaign page's reward list is a different response owned by a different issue, and
 * it omits secret tiers altogether.
 *
 * <p><strong>Nulls are written out</strong>, for the reason {@code ProjectEdit} gives:
 * the editor binds a form to every field, and an absent key cannot be told from a
 * field that is genuinely unset.
 *
 * <p><strong>On a launched campaign it is the creator's draft (#559, #569).</strong> Every
 * change to a tier waits in the campaign's open revision until a moderator approves it, and
 * this is the tier as that revision would leave it: a created tier is listed, a changed one
 * shows its proposed values, and a deleted one is still listed so that the deletion can be
 * seen and undone. {@code pending} says which, and {@code revisionChangedFields} names what a
 * changed tier changes. The public sees none of it until approval.
 *
 * @param price amount and currency, the amount a string on the wire. §10.3, and
 *     {@link Money} for why
 * @param estimatedDelivery an ISO date. A month is what a creator can honestly
 *     promise, and the column is a date so that "which tiers are overdue" is a
 *     comparison
 * @param limitQuantity null means unlimited
 * @param claimedQuantity how many places are taken by confirmed pledges. Always zero
 *     until epic #50 writes it; read-only here in any case
 * @param reservedQuantity how many are held by a checkout in progress. #51 writes it
 * @param remainingQuantity {@code limitQuantity} minus what is claimed and reserved,
 *     or null when unlimited. Derived rather than stored, so it cannot disagree with
 *     the three numbers it comes from
 * @param secretToken the link that reaches a secret tier, or null. Present only in the
 *     creator's projection, because handing it out is the creator's decision
 * @param version the optimistic-locking counter. No endpoint takes it yet — see
 *     {@code RewardExceptionHandler} on {@code REWARD_MODIFIED} — and it is here so
 *     that a client which wants to send {@code If-Match} later does not need a second
 *     read to learn it
 * @param pricingLocked whether §5.3 has frozen this tier's {@code price}, which it
 *     does once the campaign is live. <strong>Here rather than in the campaign's
 *     {@code lockedFields}</strong>, which is filtered to
 *     {@code LockedField.Resource.PROJECT} and so can never name a field of this
 *     body — #183 is what happened when an editor tried to read it from there and
 *     silently never matched. A client uses it to stop offering an edit that is
 *     known to be refused; the refusal itself is still {@code REWARD_FIELD_LOCKED},
 *     because a client may be old, may be out of date, or may not be ours.
 *     <p>There is deliberately no counterpart for {@code limitQuantity}. §5.3
 *     permits raising it at any time, so no boolean describes it honestly: a lock
 *     the client could read as "not editable" would disable a control that works
 * @param image the tier's picture, or null
 * @param video the tier's clip, or null. Null as well while an attached upload is not
 *     servable, which a ready one always is
 * @param sortOrder its place in the list; on a launched campaign, in the order the creator
 *     gave it, which the public sees only on approval
 * @param revisionChangedFields for a tier the revision changes, which fields wait with a value
 *     the public does not see yet: any of {@code title}, {@code description},
 *     {@code imageMediaId}, {@code videoMediaId}, {@code estimatedDelivery},
 *     {@code limitQuantity}, {@code shippingType}, {@code isEarlyBird}, {@code isFeatured},
 *     {@code isSecret}, {@code isAddon}, {@code availableFrom}, {@code availableUntil},
 *     {@code items}, {@code shippingRules} and {@code shippingZoneRates}. Empty before launch,
 *     for a created tier, and when nothing waits
 * @param pending what waits for a moderator about this tier on a launched campaign:
 *     {@code created} (the public does not see it yet), {@code changed} (the public sees the
 *     approved values) or {@code deleted} (the public still sees it). Null when nothing waits
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RewardResponse(
        UUID id,
        UUID projectId,
        String title,
        String description,
        Money price,
        LocalDate estimatedDelivery,
        Integer limitQuantity,
        int claimedQuantity,
        int reservedQuantity,
        Integer remainingQuantity,
        String shippingType,
        boolean isEarlyBird,
        boolean isFeatured,
        boolean isSecret,
        String secretToken,
        boolean isAddon,
        int sortOrder,
        Instant availableFrom,
        Instant availableUntil,
        List<RewardItemBody> items,
        List<ShippingRuleBody> shippingRules,
        List<ShippingZoneRateBody> shippingZoneRates,
        long version,
        boolean pricingLocked,
        RewardImageBody image,
        RewardVideoBody video,
        List<String> revisionChangedFields,
        String pending,
        Instant createdAt,
        Instant updatedAt) {

    /** The one place a tier becomes a response. A field added here appears in every endpoint. */
    public static RewardResponse of(RewardDetail detail) {
        RewardTier tier = detail.tier();
        return new RewardResponse(
                tier.getId(),
                tier.getProjectId(),
                tier.getTitle(),
                tier.getDescription(),
                Money.of(tier.getAmount(), tier.getCurrency()),
                tier.getEstimatedDelivery(),
                tier.getLimitQuantity(),
                tier.getClaimedQuantity(),
                tier.getReservedQuantity(),
                tier.getRemainingQuantity(),
                tier.getShippingType().name(),
                tier.isEarlyBird(),
                tier.isFeatured(),
                tier.isSecret(),
                tier.getSecretToken(),
                tier.isAddon(),
                detail.sortOrder(),
                tier.getAvailableFrom(),
                tier.getAvailableUntil(),
                detail.contents().stream().map(RewardItemBody::of).toList(),
                detail.shippingRules().stream().map(ShippingRuleBody::of).toList(),
                detail.shippingZoneRules().stream()
                        .map(ShippingZoneRateBody::of)
                        .toList(),
                tier.getVersion(),
                detail.locks().rewardPriceLocked(),
                RewardImageBody.of(detail.image()),
                RewardVideoBody.of(detail.video()),
                detail.revisionChangedFields(),
                detail.pending() == null ? null : detail.pending().wireName(),
                tier.getCreatedAt(),
                tier.getUpdatedAt());
    }
}
