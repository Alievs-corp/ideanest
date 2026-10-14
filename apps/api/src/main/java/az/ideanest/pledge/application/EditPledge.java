package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * What a backer changed about a pledge they already have. §4.5's PL-09.
 *
 * <p>The application-layer form of {@code PATCH /v1/pledges/{id}}'s body, with the
 * caller established and the header validated. The fields are
 * {@link DraftPledge}'s minus {@code projectId}: a pledge backs the campaign it was
 * made for, and an edit that could move it to another one would be a different
 * pledge wearing this one's identifier — and a row V17's composite foreign key
 * refuses in any case.
 *
 * <p><strong>Every field is a {@link Patched}, and that is load-bearing here in a
 * way it is not on most patches.</strong> The two fields that are legitimately
 * nullable are the two the checkout most cares about: {@code rewardTierId} null is
 * §4.5's PL-02, a backer giving up their reward and supporting the campaign anyway,
 * and {@code shippingCountry} null is a pledge that no longer has anything to post.
 * Bound to an ordinary record, "make this support-only" and "leave the reward
 * alone" would arrive identically, and a client editing only the contribution would
 * silently strip the reward off the pledge.
 *
 * <p><strong>{@code addons} is the whole set or nothing.</strong> There is no
 * add-one-line or remove-one-line patch, for {@code RewardPatch}'s reason applied to
 * a backer instead of a creator: the client always holds the whole selection, and a
 * per-line patch would let two tabs each drop a different add-on and leave a pledge
 * containing neither, with no request that ever said so. {@code "addons": null} is
 * an empty selection — the backer removed all of them — which is a real edit and not
 * an absent field.
 *
 * <p><strong>{@code contribution} is what the backer chose to give</strong>, exactly
 * as on the draft: the tier's price plus PL-03's bonus, or the whole of a
 * support-only pledge. Add-ons, shipping and tax are added on top and are not part
 * of it. Left absent, it is reconstructed from the stored pledge — see
 * {@code ReservationService#edit}, which explains why base plus bonus is the right
 * reconstruction and what it means when the tier changes underneath it.
 *
 * <p><strong>The idempotency key is not here</strong>, unlike {@link DraftPledge}'s.
 * That one is recorded on the row it creates, because V17's partial unique index is
 * a second line under the guarantee for the mutation that inserts a pledge. An edit
 * inserts nothing, so there is no new row to stamp, and overwriting the key that
 * made the pledge would destroy the record of which request did. The guarantee for
 * this mutation is {@code idempotency_keys} alone, which is what that table was
 * added for.
 */
public record EditPledge(
        UUID pledgeId,
        UUID backerId,
        Patched<UUID> rewardTierId,
        Patched<List<DraftPledge.AddonSelection>> addons,
        Patched<Money> contribution,
        Patched<String> shippingCountry,
        Patched<Boolean> anonymous) {

    public EditPledge {
        Objects.requireNonNull(pledgeId, "An edit names the pledge it changes");
        Objects.requireNonNull(backerId, "An edit is made by somebody");

        // Absence, not null, is the neutral value. See Patched: Jackson's absent hook
        // already does this, and this is the belt to its braces.
        rewardTierId = Patched.orAbsent(rewardTierId);
        addons = Patched.orAbsent(addons);
        contribution = Patched.orAbsent(contribution);
        shippingCountry = Patched.orAbsent(shippingCountry);
        anonymous = Patched.orAbsent(anonymous);

        // **Two fields cannot be cleared, because there is nothing for them to mean
        // when empty.** A pledge is an amount somebody chose to give, so
        // `"contribution": null` is not "no contribution" but a request with no
        // answer; and a pledge is anonymous or it is not. Both are refused rather
        // than read as false or as zero, either of which would change what somebody
        // is charged or who can see them on the strength of a client's null.
        //
        // `rewardTierId`, `shippingCountry` and `addons` are deliberately not in this
        // list: clearing each of them is a real edit — giving up the reward, having
        // nothing left to post, and removing every extra.
        if (contribution.isPresent() && contribution.value() == null) {
            throw new IllegalArgumentException("A pledge is an amount somebody chose to give");
        }
        if (anonymous.isPresent() && anonymous.value() == null) {
            throw new IllegalArgumentException("A pledge is either anonymous or it is not");
        }
    }
}
