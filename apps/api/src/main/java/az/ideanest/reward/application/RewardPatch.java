package az.ideanest.reward.application;

import az.ideanest.reward.domain.ShippingType;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * A partial edit of a reward tier, with JSON Merge-Patch semantics (RFC 7396).
 *
 * <p>Every field is a {@link Patched}, so a body carrying only the price leaves the
 * description, the limit, and the composition alone, and a body carrying
 * {@code "limitQuantity": null} makes the tier unlimited rather than being read as
 * "no change".
 *
 * <p>{@code items} is a whole composition or nothing. There is no add-one-item or
 * remove-one-item patch, because a composition is what a backer is promised and the
 * client always holds all of it — a per-line patch would let two tabs each remove a
 * different line and leave a tier containing neither, with no request that ever said
 * so.
 *
 * <p>{@code shippingType} is the tier's shipping scope. The per-country rates are
 * <em>not</em> here: they are replaced wholesale through
 * {@code PUT /v1/rewards/{id}/shipping-rules}, because a rate table is read as a
 * whole by whatever quotes from it.
 *
 * <p>{@code imageMediaId} and {@code videoMediaId} name uploads; null removes the tier's
 * picture or clip. Neither is locked at launch: a picture shows the reward, and changing
 * it does not change what a backer is owed.
 */
public record RewardPatch(
        Patched<String> title,
        Patched<String> description,
        Patched<Money> price,
        Patched<LocalDate> estimatedDelivery,
        Patched<Integer> limitQuantity,
        Patched<ShippingType> shippingType,
        Patched<Boolean> earlyBird,
        Patched<Boolean> featured,
        Patched<Boolean> secret,
        Patched<Boolean> addon,
        Patched<Instant> availableFrom,
        Patched<Instant> availableUntil,
        Patched<List<RewardContent>> items,
        Patched<UUID> imageMediaId,
        Patched<UUID> videoMediaId) {

    public RewardPatch {
        // Absence, not null, is the neutral value. See Patched.
        title = Patched.orAbsent(title);
        description = Patched.orAbsent(description);
        price = Patched.orAbsent(price);
        estimatedDelivery = Patched.orAbsent(estimatedDelivery);
        limitQuantity = Patched.orAbsent(limitQuantity);
        shippingType = Patched.orAbsent(shippingType);
        earlyBird = Patched.orAbsent(earlyBird);
        featured = Patched.orAbsent(featured);
        secret = Patched.orAbsent(secret);
        addon = Patched.orAbsent(addon);
        availableFrom = Patched.orAbsent(availableFrom);
        availableUntil = Patched.orAbsent(availableUntil);
        items = Patched.orAbsent(items);
        imageMediaId = Patched.orAbsent(imageMediaId);
        videoMediaId = Patched.orAbsent(videoMediaId);
    }

    /**
     * Whether the availability window moves, which is a change to two columns at
     * once.
     *
     * <p>The database refuses a window that closes before it opens, so a body that
     * moves one end has to be applied together with the stored value of the other.
     */
    public boolean changesAvailability() {
        return availableFrom.isPresent() || availableUntil.isPresent();
    }

    /** Whether it touches what a launched campaign holds for review: see {@code RewardWriting}. */
    public boolean changesWriting() {
        return title.isPresent() || description.isPresent() || imageMediaId.isPresent() || videoMediaId.isPresent();
    }
}
