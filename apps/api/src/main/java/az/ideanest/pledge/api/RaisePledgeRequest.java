package az.ideanest.pledge.api;

import az.ideanest.pledge.application.RaisePledge;
import az.ideanest.shared.Patched;
import az.ideanest.shared.money.Money;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * {@code POST /v1/pledges/{id}/raise}'s body — #171.
 *
 * <p>The selection is {@link PatchPledgeRequest}'s, field for field and with its Merge-Patch
 * meaning: an absent field keeps what the pledge has, and {@code "rewardTierId": null} gives up the
 * reward. The rest is {@link PayPledgeRequest}'s — the page's language and where the provider sends
 * the backer back — and one field neither has:
 *
 * @param expectedAmount the difference the backer was shown and agreed to pay. Required. The raise
 *     is refused with {@code RAISE_AMOUNT_CHANGED} rather than charged at any other figure
 */
public record RaisePledgeRequest(
        Patched<UUID> rewardTierId,
        Patched<List<PledgeAddonBody>> addons,
        Patched<Money> contribution,
        Patched<String> shippingCountry,
        Money expectedAmount,
        String language,
        URI successUrl,
        URI errorUrl) {

    /** The same shape {@code pledges.shipping_country} holds. */
    private static final Pattern COUNTRY = Pattern.compile("^[A-Z]{2}$");

    public RaisePledgeRequest {
        rewardTierId = Patched.orAbsent(rewardTierId);
        addons = Patched.orAbsent(addons);
        contribution = Patched.orAbsent(contribution);
        shippingCountry = Patched.orAbsent(shippingCountry).map(RaisePledgeRequest::normaliseCountry);
    }

    /** The raise, with the caller the body does not carry. */
    public RaisePledge toCommand(UUID pledgeId, UUID backerId) {
        if (expectedAmount == null) {
            throw new IllegalArgumentException("A raise says what the backer agreed to pay: expectedAmount");
        }
        return new RaisePledge(
                pledgeId,
                backerId,
                rewardTierId,
                addons.map(PledgeAddonBody::selectionsOf),
                contribution,
                shippingCountry,
                expectedAmount);
    }

    /** {@link PatchPledgeRequest}'s rule: blank clears, anything else is a two-letter code. */
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
