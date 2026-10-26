package az.ideanest.reward.api;

import az.ideanest.reward.application.ZoneDefinition;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * A campaign's complete set of shipping regions.
 *
 * <p>{@code PUT}, and the whole set: a region left out of the body is one the creator
 * has removed, along with every rate that priced it. Merging instead would leave them
 * quoting for a region they believe they deleted, which is discovered by a backer
 * checking out.
 *
 * <p>An empty list is therefore a legitimate request, and it clears them.
 */
public record ShippingZonesRequest(@Size(max = 100) List<@Valid ShippingZoneBody> zones) {

    public ShippingZonesRequest {
        zones = zones == null ? List.of() : List.copyOf(zones);
    }

    /** A null entry is refused by name in the service rather than dereferenced into a 500. */
    public List<ZoneDefinition> toDefinitions() {
        return zones.stream().map(zone -> zone == null ? null : zone.toDefinition()).toList();
    }
}
