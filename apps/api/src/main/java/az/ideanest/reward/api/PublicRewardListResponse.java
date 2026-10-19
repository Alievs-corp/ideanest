package az.ideanest.reward.api;

import az.ideanest.reward.application.PublicRewardCatalogue;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * A campaign's public offer: the tiers a backer may choose, and the add-ons they may
 * put on top.
 *
 * <p>Two arrays rather than one with a flag, because they are two lists everywhere
 * they are shown — see {@code PublicRewardCatalogue#of}. The currency is stated once
 * for the whole body: every price in it is denominated in the campaign's currency, and
 * a client showing "no reward, just support" needs the currency even when both arrays
 * are empty.
 *
 * <p><strong>Nulls are written out</strong>, as they are on each tier. An empty
 * campaign answers {@code {"currency": "AZN", "rewards": [], "addons": []}} rather
 * than an object with keys missing: a client should not have to tell "no tiers" from
 * "this server does not send that key".
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PublicRewardListResponse(
        String currency, List<PublicRewardResponse> rewards, List<PublicRewardResponse> addons) {

    /** ASCII unit separator. Cannot occur in a uuid, a number, or a country code. */
    private static final char FIELD_SEPARATOR = (char) 0x1f;

    /** ASCII record separator, so that a row boundary is not a field boundary. */
    private static final char ROW_SEPARATOR = (char) 0x1e;

    /** ASCII group separator, between the tiers and the add-ons. */
    private static final char GROUP_SEPARATOR = (char) 0x1d;

    public static PublicRewardListResponse of(PublicRewardCatalogue.PublicCatalogue catalogue) {
        return new PublicRewardListResponse(
                catalogue.currency(),
                catalogue.rewards().stream().map(PublicRewardResponse::of).toList(),
                catalogue.addons().stream().map(PublicRewardResponse::of).toList());
    }

    /**
     * A validator for this exact body, per §10.3.
     *
     * <p><strong>A digest over what is serialised, never {@code hashCode()}</strong>,
     * for the reason {@code PublicReads} gives in the discovery module: a tag has to
     * mean the same thing on every instance of the service and after a restart, and
     * nothing guarantees a record's hash does. It is computed here, beside the fields,
     * so that adding a field to this response and forgetting to cover it is a one-line
     * distance rather than a different file.
     *
     * <p><strong>Every field, including the stock.</strong> {@code remainingQuantity}
     * is the value that moves most often and the one a stale answer does the most harm
     * with — a digest that skipped it would hand a client a 304 for a list showing
     * places that have gone, which is precisely what PL-01 exists to prevent.
     *
     * <p>Not shared with {@code PublicReads}: that class is package-private in another
     * module's {@code api} package, and making it public to reuse eight lines of
     * {@link MessageDigest} would be a dependency between two modules that have
     * nothing else to say to each other — the argument {@code SecretTokens} already
     * makes about the auth module's generator.
     */
    public String etag() {
        StringBuilder canonical = new StringBuilder();
        append(canonical, currency);
        for (PublicRewardResponse reward : rewards) {
            appendReward(canonical, reward);
        }
        canonical.append(GROUP_SEPARATOR);
        for (PublicRewardResponse addon : addons) {
            appendReward(canonical, addon);
        }
        return digestOf(canonical.toString());
    }

    private static void appendReward(StringBuilder canonical, PublicRewardResponse reward) {
        append(
                canonical,
                String.valueOf(reward.id()),
                reward.title(),
                reward.description(),
                reward.price().amount().toPlainString(),
                reward.price().currency(),
                String.valueOf(reward.estimatedDelivery()),
                reward.shippingType(),
                String.valueOf(reward.limitQuantity()),
                String.valueOf(reward.remainingQuantity()),
                String.valueOf(reward.isEarlyBird()),
                String.valueOf(reward.isFeatured()));
        for (PublicRewardResponse.ItemBody item : reward.items()) {
            append(canonical, item.name(), String.valueOf(item.quantity()), String.valueOf(item.isDigital()));
        }
        for (ShippingRuleBody rate : reward.shippingRates()) {
            append(
                    canonical,
                    rate.countryCode(),
                    rate.amount().toPlainString(),
                    // Null is impossible today — the service defaults an omitted
                    // additional-item rate to zero — and is written as a distinct
                    // value rather than skipped, so that a column that becomes
                    // nullable later cannot silently share a tag with zero.
                    rate.additionalItemAmount() == null ? null : rate.additionalItemAmount().toPlainString());
        }
        RewardImageBody image = reward.image();
        append(
                canonical,
                image == null ? null : String.valueOf(image.mediaId()),
                image == null ? null : image.url(),
                image == null ? null : String.valueOf(image.width()),
                image == null ? null : String.valueOf(image.height()));
        RewardVideoBody video = reward.video();
        append(
                canonical,
                video == null ? null : String.valueOf(video.mediaId()),
                video == null ? null : video.url(),
                video == null ? null : video.posterUrl(),
                video == null ? null : String.valueOf(video.width()),
                video == null ? null : String.valueOf(video.height()),
                video == null ? null : String.valueOf(video.durationMs()));
    }

    private static void append(StringBuilder canonical, String... fields) {
        for (String field : fields) {
            canonical.append(field).append(FIELD_SEPARATOR);
        }
        canonical.append(ROW_SEPARATOR);
    }

    private static String digestOf(String canonical) {
        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // Every JVM ships SHA-256. Reaching here is not a runtime condition.
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        byte[] digest = sha256.digest(canonical.getBytes(StandardCharsets.UTF_8));
        return "\"" + HexFormat.of().formatHex(digest, 0, 8) + "\"";
    }
}
