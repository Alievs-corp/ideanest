package az.ideanest.reward.api;

import az.ideanest.reward.application.ShippingZoneService;
import java.util.List;

/**
 * A campaign's shipping regions.
 *
 * <p>An object with one field rather than a bare array, as every list response on
 * this platform is: a top-level array cannot gain a field, and the first thing this
 * one will want is a count or a warning about destinations nothing prices. The second
 * thing it wanted was {@code pending} (#587).
 *
 * @param pending true when {@code zones} are the regions a launched campaign's open revision
 *     proposes, waiting for a moderator, rather than the ones its quotes use now
 */
public record ShippingZoneListResponse(List<ShippingZoneBody> zones, boolean pending) {

    public static ShippingZoneListResponse of(ShippingZoneService.ShippingZones zones) {
        return new ShippingZoneListResponse(zones.zones().stream().map(ShippingZoneBody::of).toList(), zones.pending());
    }
}
