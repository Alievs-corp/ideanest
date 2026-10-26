package az.ideanest.pledge.api;

import az.ideanest.pledge.application.DraftPledge;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * What a backer is buying from the pledge manager's add-on store — §4.8's PM-10.
 *
 * <p><strong>These are new lines, not a new selection.</strong> The body says what to
 * add; it does not restate what the pledge already has, which is what {@code PATCH
 * /v1/pledges/{id}} does while the campaign is running. Sending the whole selection
 * here would make the two endpoints look interchangeable, and they are not: an edit
 * re-quotes a pledge that has not been charged, and this is a separate purchase.
 *
 * <p>Not empty. A purchase of nothing is a request the client should not have made,
 * and answering it with a supplement of zero would be a row a collection run has to
 * decide what to do with.
 */
public record BuyAddonsRequest(
        @NotEmpty(message = "A purchase names at least one add-on") @Size(max = 200) @Valid List<PledgeAddonBody> addons) {

    /** What the pledge manager takes. The same conversion the checkout uses. */
    public List<DraftPledge.AddonSelection> selections() {
        return PledgeAddonBody.selectionsOf(addons);
    }
}
