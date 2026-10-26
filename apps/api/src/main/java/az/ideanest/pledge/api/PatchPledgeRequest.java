package az.ideanest.pledge.api;

import az.ideanest.pledge.application.EditPledge;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.Patched;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * What a client sends to {@code PATCH /v1/pledges/{id}}, with JSON Merge-Patch
 * semantics (RFC 7396).
 *
 * <p>{@link DraftPledgeRequest}'s fields minus {@code projectId} and minus
 * {@code referrerCode}. A pledge backs the campaign it was made for, so moving it is
 * not an edit; and a referrer is a record of which link brought the backer, which is
 * a fact about how they arrived and not a preference they can revise.
 *
 * <p><strong>Absent and null are different, and on this endpoint the difference is
 * money.</strong> {@code "rewardTierId": null} gives up the reward and makes the
 * pledge support-only (PL-02); leaving it out keeps the reward. Bound to an ordinary
 * record the two arrive identically, and a client raising its contribution would
 * silently strip the reward off the pledge. {@link Patched} is what keeps them
 * apart, and {@code EditPledge} carries the same note for the application layer.
 *
 * <p>Bean validation annotations are absent for {@code RewardPatchRequest}'s reason:
 * they cannot see inside a {@link Patched}, and a rule enforced both here and in the
 * service would be two rules that can disagree. What is checked here is only what
 * this type can check alone — the shape of a country code — and the rest is the
 * value objects' and the service's.
 */
public record PatchPledgeRequest(
        Patched<UUID> rewardTierId,
        Patched<@Size(max = 200) List<PledgeAddonBody>> addons,
        Patched<Money> contribution,
        Patched<String> shippingCountry,
        Patched<Boolean> isAnonymous) {

    /** The same shape {@code shipping_rules.country_code} and {@code pledges.shipping_country} hold. */
    private static final Pattern COUNTRY = Pattern.compile("^[A-Z]{2}$");

    public PatchPledgeRequest {
        // Absence is the neutral value. See Patched: Jackson's absent hook already
        // does this, and this is the belt to its braces.
        rewardTierId = Patched.orAbsent(rewardTierId);
        addons = Patched.orAbsent(addons);
        contribution = Patched.orAbsent(contribution);
        isAnonymous = Patched.orAbsent(isAnonymous);

        // Through map, which preserves an explicit null rather than collapsing it to
        // absence — a backer whose new selection has nothing to post clears the
        // destination, and reading that as "leave it alone" would go on charging them
        // postage for a download.
        shippingCountry = Patched.orAbsent(shippingCountry).map(PatchPledgeRequest::normaliseCountry);
    }

    /** The edit, with the caller the body does not carry. */
    public EditPledge toCommand(UUID pledgeId, UUID backerId) {
        return new EditPledge(
                pledgeId,
                backerId,
                rewardTierId,
                addons.map(PledgeAddonBody::selectionsOf),
                contribution,
                shippingCountry,
                isAnonymous);
    }

    /**
     * A destination, in the one spelling everything else uses.
     *
     * <p>Normalised here rather than deeper in for {@link DraftPledgeRequest}'s
     * reason: the value is used to look up the rates, to quote against, and to store
     * on the row, and normalising it at each of those would be three chances for one
     * of them to disagree. An empty string is a client sending the absence of a
     * destination, which is the same edit as sending null.
     */
    private static String normaliseCountry(String country) {
        if (country.isBlank()) {
            return null;
        }
        String normalised = country.trim().toUpperCase(Locale.ROOT);
        if (!COUNTRY.matcher(normalised).matches()) {
            throw new IllegalArgumentException("A destination is a two-letter ISO 3166-1 country code");
        }
        return normalised;
    }
}
