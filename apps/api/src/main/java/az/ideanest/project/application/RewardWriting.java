package az.ideanest.project.application;

import az.ideanest.project.domain.RevisionContent;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Everything a creator may change about a reward tier on a launched campaign, which its
 * revision holds until a moderator approves it: the writing (#559) and, since #569, the rest
 * of the tier, its composition and its shipping rates. Not the price, which is frozen, nor
 * the counts, which are backers'.
 *
 * <p>The reward module's view of {@link RevisionContent.Reward}, which lives in this module's
 * {@code domain} package and so cannot be named there. The lists are sorted, so two writings
 * of the same tier compare equal whatever order a client sent its lines in.
 *
 * @param description null when the tier has none
 * @param imageMediaId the tier's picture, or null
 * @param videoMediaId the tier's clip, or null
 * @param limitQuantity null is unlimited
 * @param shippingType the reward module's {@code ShippingType}, by name
 * @param secretToken the link that reaches a secret tier, or null for a public one
 */
public record RewardWriting(
        String title,
        String description,
        UUID imageMediaId,
        UUID videoMediaId,
        LocalDate estimatedDelivery,
        Integer limitQuantity,
        String shippingType,
        boolean earlyBird,
        boolean featured,
        boolean addon,
        String secretToken,
        Instant availableFrom,
        Instant availableUntil,
        List<Line> items,
        List<CountryRate> shippingRules,
        List<ZoneRate> zoneRates) {

    /** So many of an item in the tier. */
    public record Line(UUID itemId, int quantity) {}

    /** What shipping to one country costs. Amounts as {@code numeric(14,2)} holds them. */
    public record CountryRate(
            String countryCode, BigDecimal amount, BigDecimal additionalItemAmount, BigDecimal perKilogramAmount) {

        public CountryRate {
            amount = scaled(amount);
            additionalItemAmount = scaled(additionalItemAmount);
            perKilogramAmount = scaled(perKilogramAmount);
        }
    }

    /** What shipping to one of the campaign's zones costs. */
    public record ZoneRate(
            UUID zoneId, BigDecimal amount, BigDecimal additionalItemAmount, BigDecimal perKilogramAmount) {

        public ZoneRate {
            amount = scaled(amount);
            additionalItemAmount = scaled(additionalItemAmount);
            perKilogramAmount = scaled(perKilogramAmount);
        }
    }

    public RewardWriting {
        items = sorted(items, Comparator.comparing(Line::itemId));
        shippingRules = sorted(shippingRules, Comparator.comparing(CountryRate::countryCode));
        zoneRates = sorted(zoneRates, Comparator.comparing(ZoneRate::zoneId));
    }

    public boolean secret() {
        return secretToken != null;
    }

    /**
     * The names of the fields in which this writing differs from {@code live}: the names the
     * creator's reward response gives them, in its order.
     */
    public List<String> changedFrom(RewardWriting live) {
        List<String> changed = new ArrayList<>();
        compare(changed, "title", title, live.title);
        compare(changed, "description", description, live.description);
        compare(changed, "imageMediaId", imageMediaId, live.imageMediaId);
        compare(changed, "videoMediaId", videoMediaId, live.videoMediaId);
        compare(changed, "estimatedDelivery", estimatedDelivery, live.estimatedDelivery);
        compare(changed, "limitQuantity", limitQuantity, live.limitQuantity);
        compare(changed, "shippingType", shippingType, live.shippingType);
        compare(changed, "isEarlyBird", earlyBird, live.earlyBird);
        compare(changed, "isFeatured", featured, live.featured);
        // A new link is a change even to a tier that stays secret: the old one stops working.
        compare(changed, "isSecret", secretToken, live.secretToken);
        compare(changed, "isAddon", addon, live.addon);
        compare(changed, "availableFrom", availableFrom, live.availableFrom);
        compare(changed, "availableUntil", availableUntil, live.availableUntil);
        compare(changed, "items", items, live.items);
        compare(changed, "shippingRules", shippingRules, live.shippingRules);
        compare(changed, "shippingZoneRates", zoneRates, live.zoneRates);
        return List.copyOf(changed);
    }

    /** A revision's entry for a tier, once read against the tier (see {@link RevisionContent#heldAgainst}). */
    static RewardWriting of(RevisionContent.Reward reward) {
        RevisionContent.Terms terms = Objects.requireNonNull(reward.terms(), "Read against the live tier first");
        return new RewardWriting(
                reward.title(),
                reward.description(),
                reward.imageMediaId(),
                reward.videoMediaId(),
                terms.estimatedDelivery(),
                terms.limitQuantity(),
                terms.shippingType(),
                terms.earlyBird(),
                terms.featured(),
                terms.addon(),
                terms.secretToken(),
                terms.availableFrom(),
                terms.availableUntil(),
                terms.items().stream().map(line -> new Line(line.itemId(), line.quantity())).toList(),
                terms.shippingRules().stream()
                        .map(rate -> new CountryRate(
                                rate.countryCode(), rate.amount(), rate.additionalItemAmount(), rate.perKilogramAmount()))
                        .toList(),
                terms.zoneRates().stream()
                        .map(rate -> new ZoneRate(
                                rate.zoneId(), rate.amount(), rate.additionalItemAmount(), rate.perKilogramAmount()))
                        .toList());
    }

    RevisionContent.Reward held() {
        return new RevisionContent.Reward(
                title,
                description,
                imageMediaId,
                videoMediaId,
                new RevisionContent.Terms(
                        estimatedDelivery,
                        limitQuantity,
                        shippingType,
                        earlyBird,
                        featured,
                        addon,
                        secretToken,
                        availableFrom,
                        availableUntil,
                        items.stream()
                                .map(line -> new RevisionContent.Terms.Line(line.itemId(), line.quantity()))
                                .toList(),
                        shippingRules.stream()
                                .map(rate -> new RevisionContent.Terms.CountryRate(
                                        rate.countryCode(),
                                        rate.amount(),
                                        rate.additionalItemAmount(),
                                        rate.perKilogramAmount()))
                                .toList(),
                        zoneRates.stream()
                                .map(rate -> new RevisionContent.Terms.ZoneRate(
                                        rate.zoneId(), rate.amount(), rate.additionalItemAmount(), rate.perKilogramAmount()))
                                .toList()));
    }

    private static void compare(List<String> changed, String field, Object proposed, Object live) {
        if (!Objects.equals(proposed, live)) {
            changed.add(field);
        }
    }

    private static <T> List<T> sorted(List<T> values, Comparator<T> order) {
        if (values == null) {
            return List.of();
        }
        return values.stream().sorted(order).toList();
    }

    private static BigDecimal scaled(BigDecimal amount) {
        return amount == null ? null : amount.setScale(Money.SCALE, RoundingMode.UNNECESSARY);
    }
}
