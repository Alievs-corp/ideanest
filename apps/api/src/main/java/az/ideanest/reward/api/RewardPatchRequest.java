package az.ideanest.reward.api;

import az.ideanest.reward.application.RewardContent;
import az.ideanest.reward.application.RewardPatch;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A partial edit of a reward tier, with JSON Merge-Patch semantics (RFC 7396).
 *
 * <p>Every field is a {@link Patched}, so a body carrying only the price leaves the
 * description and the composition alone, and a body carrying
 * {@code "limitQuantity": null} makes the tier unlimited rather than being ignored.
 * The rewards tab autosaves one input at a time, which is what makes that distinction
 * load-bearing rather than pedantic.
 *
 * <p>Bean validation annotations are absent for the reason
 * {@code ProjectPatchRequest} gives: they cannot see inside a {@code Patched}, and a
 * rule enforced both here and in the service would be two rules that can disagree.
 *
 * <p>{@code items} replaces the whole composition when present. There is no
 * add-one-line patch, because a composition is what a backer is promised and the client
 * always holds all of it — a per-line patch would let two tabs each remove a different
 * item and leave a tier containing neither, with no request that ever said so.
 *
 * <p>The per-country rates are deliberately not here. They are replaced through
 * {@code PUT /v1/rewards/{id}/shipping-rules}, because a rate table is read as a whole
 * by whatever quotes from it.
 *
 * <p>{@code imageMediaId} and {@code videoMediaId} name an upload, or are null to remove
 * the tier's picture or clip. Editable after launch.
 */
public record RewardPatchRequest(
        Patched<String> title,
        Patched<String> description,
        Patched<Money> price,
        Patched<LocalDate> estimatedDelivery,
        Patched<Integer> limitQuantity,
        Patched<String> shippingType,
        Patched<Boolean> isEarlyBird,
        Patched<Boolean> isFeatured,
        Patched<Boolean> isSecret,
        Patched<Boolean> isAddon,
        Patched<Instant> availableFrom,
        Patched<Instant> availableUntil,
        Patched<@Size(max = 200) List<RewardItemBody>> items,
        Patched<UUID> imageMediaId,
        Patched<UUID> videoMediaId) {

    public RewardPatchRequest {
        // Absence is the neutral value. See Patched: Jackson's absent hook already does
        // this, and this is the belt to its braces.
        title = Patched.orAbsent(title);
        description = Patched.orAbsent(description);
        price = Patched.orAbsent(price);
        estimatedDelivery = Patched.orAbsent(estimatedDelivery);
        limitQuantity = Patched.orAbsent(limitQuantity);
        shippingType = Patched.orAbsent(shippingType);
        isEarlyBird = Patched.orAbsent(isEarlyBird);
        isFeatured = Patched.orAbsent(isFeatured);
        isSecret = Patched.orAbsent(isSecret);
        isAddon = Patched.orAbsent(isAddon);
        availableFrom = Patched.orAbsent(availableFrom);
        availableUntil = Patched.orAbsent(availableUntil);
        items = Patched.orAbsent(items);
        imageMediaId = Patched.orAbsent(imageMediaId);
        videoMediaId = Patched.orAbsent(videoMediaId);
    }

    /**
     * The same edit, in the shape the application layer works in.
     *
     * <p>Two conversions happen here and nowhere else: the shipping scope becomes the
     * enum, and the composition becomes the application's own line type. Both preserve
     * the difference between absent and explicitly null, which is what
     * {@link Patched#map} exists for — mapping must never turn "clear this" into "leave
     * it alone", because the caller would then see a save that reported success and
     * changed nothing.
     */
    public RewardPatch toPatch() {
        return new RewardPatch(
                title,
                description,
                price,
                estimatedDelivery,
                limitQuantity,
                shippingType.map(ShippingTypes::parse),
                isEarlyBird,
                isFeatured,
                isSecret,
                isAddon,
                availableFrom,
                availableUntil,
                items.map(RewardPatchRequest::contents),
                imageMediaId,
                videoMediaId);
    }

    /** {@code "items": null} is an empty composition, not an absent field. */
    private static List<RewardContent> contents(List<RewardItemBody> bodies) {
        return RewardItemBody.contentsOf(bodies);
    }
}
