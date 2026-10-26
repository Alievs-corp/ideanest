package az.ideanest.pledge.api;

import az.ideanest.pledge.application.DraftPledge;
import az.ideanest.shared.money.Money;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * What a client sends to {@code POST /v1/pledges/draft}.
 *
 * <p>Everything §4.5 lets a backer decide at the checkout, and nothing else. The
 * backer is not in the body — it is whoever the access token says — and neither is
 * the idempotency key, which is a header (§10.3).
 *
 * @param rewardTierId null for §4.5's PL-02, support with no reward
 * @param contribution {@code {"amount": "50.00", "currency": "AZN"}} — the amount a
 *     string, §10.3. <strong>What the backer chose to give:</strong> the tier's price
 *     plus PL-03's bonus, or the whole of a support-only pledge. Add-ons, shipping
 *     and tax are added on top of it and are not part of it
 * @param shippingCountry ISO 3166-1 alpha-2, or null when nothing is posted
 * @param isAnonymous PL-12. Stored here because the contract carries it; what it
 *     hides is #57's
 * @param referrerCode which referral link brought this backer, for §4.7's report.
 *     Free text from a query parameter, so it is bounded and nothing is resolved
 *     from it
 */
public record DraftPledgeRequest(
        @NotNull(message = "A pledge names the campaign it backs") UUID projectId,
        UUID rewardTierId,
        @Valid @Size(max = 200) List<PledgeAddonBody> addons,
        @NotNull(message = "A pledge is an amount somebody chose to give") Money contribution,
        String shippingCountry,
        Boolean isAnonymous,
        @Size(max = 64, message = "A referrer code may not exceed 64 characters") String referrerCode) {

    /** The same shape {@code shipping_rules.country_code} and {@code pledges.shipping_country} hold. */
    private static final Pattern COUNTRY = Pattern.compile("^[A-Z]{2}$");

    public DraftPledgeRequest {
        // Normalised here rather than deeper in, because this value is used three
        // times — to look up the rates, to quote against, and to store on the row —
        // and normalising it at each of those would be three chances for one of them
        // to disagree. A creator's rate table is uppercase (`ShippingRule.of`), so a
        // client sending "az" has to mean the same country.
        shippingCountry = blankToNull(shippingCountry);
        if (shippingCountry != null) {
            shippingCountry = shippingCountry.trim().toUpperCase(Locale.ROOT);
            if (!COUNTRY.matcher(shippingCountry).matches()) {
                throw new IllegalArgumentException("A destination is a two-letter ISO 3166-1 country code");
            }
        }
        // An empty string is a client sending the absence of a referrer, and
        // `pledges_referrer_code_length` refuses a blank one rather than storing it.
        referrerCode = blankToNull(referrerCode);
    }

    /**
     * The checkout's command, with the caller and the header the body does not carry.
     *
     * @param idempotencyKey already established to be a UUID by {@code IdempotencyKey}
     */
    public DraftPledge toCommand(UUID backerId, String idempotencyKey) {
        return new DraftPledge(
                projectId,
                backerId,
                rewardTierId,
                PledgeAddonBody.selectionsOf(addons),
                contribution,
                shippingCountry,
                Boolean.TRUE.equals(isAnonymous),
                referrerCode,
                idempotencyKey);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
