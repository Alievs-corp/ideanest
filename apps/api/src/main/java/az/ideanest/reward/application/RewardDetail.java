package az.ideanest.reward.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.EditLocks;
import az.ideanest.project.application.RewardWriting;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.domain.RewardTierItem;
import az.ideanest.reward.domain.ShippingRule;
import az.ideanest.reward.domain.ShippingZoneRule;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

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
 * @param writing the title, description, picture and clip the creator is editing: the tier's
 *     own, or on a launched campaign what its open revision holds for the tier (#559), which
 *     the public does not see until a moderator approves it
 * @param image the picture {@code writing} names, or null when it has none or it is not servable
 * @param video the clip {@code writing} names, or null likewise
 */
public record RewardDetail(
        RewardTier tier,
        List<RewardTierItem> contents,
        List<ShippingRule> shippingRules,
        List<ShippingZoneRule> shippingZoneRules,
        EditLocks locks,
        RewardWriting writing,
        MediaLibrary.MediaView image,
        MediaLibrary.VideoView video) {

    public RewardDetail {
        contents = List.copyOf(contents);
        shippingRules = List.copyOf(shippingRules);
        shippingZoneRules = List.copyOf(shippingZoneRules);
    }

    /**
     * Which of {@code title}, {@code description}, {@code imageMediaId} and
     * {@code videoMediaId} the creator has changed and the public does not see yet. Empty
     * unless the campaign has launched and its revision changes this tier.
     */
    public List<String> revisionChangedFields() {
        List<String> changed = new ArrayList<>();
        if (!Objects.equals(writing.title(), tier.getTitle())) {
            changed.add("title");
        }
        if (!Objects.equals(writing.description(), tier.getDescription())) {
            changed.add("description");
        }
        if (!Objects.equals(writing.imageMediaId(), tier.getImageMediaId())) {
            changed.add("imageMediaId");
        }
        if (!Objects.equals(writing.videoMediaId(), tier.getVideoMediaId())) {
            changed.add("videoMediaId");
        }
        return List.copyOf(changed);
    }
}
