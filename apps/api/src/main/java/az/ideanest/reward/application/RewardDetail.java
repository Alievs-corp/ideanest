package az.ideanest.reward.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.EditLocks;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.domain.RewardTierItem;
import az.ideanest.reward.domain.ShippingRule;
import az.ideanest.reward.domain.ShippingZoneRule;
import java.util.List;
import java.util.Locale;

/**
 * A reward tier with everything that hangs off it.
 *
 * <p>Composition and shipping rates are separate tables and separate entities —
 * see {@code RewardTier} for why they are not mapped as associations — so something
 * has to carry them together from the service to the response. This does, and it is
 * assembled with one query per collection for a whole reward list rather than one
 * per tier.
 *
 * <p><strong>Two rate tables since #77</strong>, and both are carried: the
 * per-country rates V7 has always had, and the per-zone rates V37 added. They are
 * separate collections rather than one merged list because they are edited as two —
 * a creator removes Germany from the named list without touching what the EU zone
 * charges — and because merging them would have to decide the precedence in the
 * response, which is {@code ShippingRates}' decision and belongs where a quote is
 * built rather than where an editor is rendered.
 *
 * <p>Every endpoint in this module that returns a tier returns this, so a client
 * applies the same update to its state after a create, a patch, a duplicate, and a
 * shipping-rate replacement. An endpoint that answered with a thinner shape would
 * make a client's state depend on which request it happened to make last.
 *
 * @param locks what §5.3 has frozen on the campaign this tier belongs to, as
 *     {@link RewardAccess} already had to establish in order to authorise the
 *     request. It is carried through to the response rather than recomputed there,
 *     because the answer that reaches the client must be the one the service used —
 *     see {@code RewardResponse.pricingLocked} for what a client does with it, and
 *     #183 for what happened when there was nothing to do it with
 * @param tier the tier as its creator is editing it: the row, or on a launched campaign a copy
 *     of it with what the campaign's open revision proposes for it (#559, #569), which the public
 *     does not see until a moderator approves it. Never to be saved
 * @param contents the same: the rows, or what the revision proposes
 * @param shippingRules likewise
 * @param shippingZoneRules likewise
 * @param image the picture the tier shows, or null when it has none or it is not servable
 * @param video the clip, or null likewise
 * @param sortOrder its place in the list as its creator is editing it
 * @param pending what waits for a moderator: the tier was created, changed or deleted since
 *     the public saw it, or null for nothing
 * @param revisionChangedFields for a changed tier, which fields differ from what the public
 *     sees, as {@link az.ideanest.project.application.RewardWriting#changedFrom} names them
 */
public record RewardDetail(
        RewardTier tier,
        List<RewardTierItem> contents,
        List<ShippingRule> shippingRules,
        List<ShippingZoneRule> shippingZoneRules,
        EditLocks locks,
        MediaLibrary.MediaView image,
        MediaLibrary.VideoView video,
        int sortOrder,
        Pending pending,
        List<String> revisionChangedFields) {

    /** What waits for a moderator about a tier on a launched campaign (#569). */
    public enum Pending {
        CREATED,
        CHANGED,
        DELETED;

        public String wireName() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    public RewardDetail {
        contents = List.copyOf(contents);
        shippingRules = List.copyOf(shippingRules);
        shippingZoneRules = List.copyOf(shippingZoneRules);
        revisionChangedFields = List.copyOf(revisionChangedFields);
    }
}
