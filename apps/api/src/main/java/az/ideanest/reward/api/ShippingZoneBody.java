package az.ideanest.reward.api;

import az.ideanest.reward.application.ShippingZoneDetail;
import az.ideanest.reward.application.ZoneDefinition;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * One shipping region, in a request and in a response.
 *
 * <p>{@code id} is <strong>read-only</strong>: it comes back so a client can key a
 * tier's zone rates on it, and it is ignored on the way in. A zone is matched to an
 * existing one by its folded name — {@code ShippingZoneService} argues why — so
 * accepting an identifier here would be accepting a field the service does not read,
 * which is worse than not having one.
 *
 * @param countryCodes ISO 3166-1 alpha-2. Normalised to uppercase on the way in,
 *     because a creator typing "de" means Germany
 */
public record ShippingZoneBody(UUID id, String name, @Size(max = 300) List<String> countryCodes) {

    public ShippingZoneBody {
        countryCodes = countryCodes == null ? List.of() : List.copyOf(countryCodes);
    }

    public static ShippingZoneBody of(ShippingZoneDetail zone) {
        return new ShippingZoneBody(zone.id(), zone.name(), zone.countryCodes());
    }

    public ZoneDefinition toDefinition() {
        return new ZoneDefinition(name, countryCodes);
    }
}
