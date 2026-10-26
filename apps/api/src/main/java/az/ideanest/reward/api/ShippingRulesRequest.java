package az.ideanest.reward.api;

import az.ideanest.reward.application.ShippingRate;
import az.ideanest.reward.application.ZoneRate;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * A tier's complete shipping rate table.
 *
 * <p>{@code PUT}, and the whole table: a country left out of the body is a country the
 * creator has removed. Merging instead would leave them shipping somewhere they believe
 * they no longer do, and that is discovered by a backer selecting it.
 *
 * <p>An empty list is therefore a legitimate request, and it clears the table.
 *
 * <p><strong>Both halves in one body, since #77.</strong> A tier is priced by named
 * destinations and by regions, and they arrive together because a quote reads them
 * together: what a German backer pays depends on the presence of a German row
 * <em>and</em> on whether a region containing Germany is priced. Two endpoints would
 * let a creator commit half a rate change and go looking for the other half while the
 * first half quoted to backers.
 *
 * @param zoneRates §4.8's PM-13. Omitted is an empty table and clears the tier's
 *     regional rates, exactly as an omitted {@code rules} clears its per-country ones
 */
public record ShippingRulesRequest(
        @Size(max = 300) List<ShippingRuleBody> rules, @Size(max = 100) List<ShippingZoneRateBody> zoneRates) {

    public ShippingRulesRequest {
        rules = rules == null ? List.of() : rules;
        zoneRates = zoneRates == null ? List.of() : zoneRates;
    }

    /** A null line is refused by name rather than dereferenced into a 500. */
    public List<ShippingRate> toRates() {
        return rules.stream().map(rule -> rule == null ? null : rule.toRate()).toList();
    }

    /** The same, for the regional half. */
    public List<ZoneRate> toZoneRates() {
        return zoneRates.stream().map(rate -> rate == null ? null : rate.toRate()).toList();
    }
}
