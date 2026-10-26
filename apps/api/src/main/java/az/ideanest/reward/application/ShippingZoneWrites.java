package az.ideanest.reward.application;

import az.ideanest.project.application.CatalogueWriting;
import az.ideanest.reward.domain.ShippingZone;
import az.ideanest.reward.domain.ShippingZoneCountry;
import az.ideanest.reward.infrastructure.ShippingZoneCountryRepository;
import az.ideanest.reward.infrastructure.ShippingZoneRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes a campaign's shipping regions as a whole: for {@link ShippingZoneService} when a creator
 * replaces them on a campaign nobody has seen, and for {@link RewardTierWritings} when a moderator
 * approves the set a launched campaign's revision proposed (#587). One writer, so the two cannot
 * come to write the same tables differently.
 *
 * <p>Its own component rather than part of {@code ShippingZoneService}, because that service asks
 * {@code ProjectRevisionService} to stage, and the revision service publishes through
 * {@link RewardTierWritings}: a writer inside the service would make the three a cycle.
 */
@Component
public class ShippingZoneWrites {

    private final ShippingZoneRepository zones;
    private final ShippingZoneCountryRepository memberships;

    public ShippingZoneWrites(ShippingZoneRepository zones, ShippingZoneCountryRepository memberships) {
        this.zones = zones;
        this.memberships = memberships;
    }

    /**
     * Makes the campaign's regions exactly these, already checked: a region whose identifier
     * exists is renamed and keeps its rates, a new one is created with the identifier it carries,
     * and one left out is deleted, which cascades to its memberships and to every tier's rate for
     * it. That is what "the creator removed this region" means; the named-country rates are
     * untouched.
     */
    @Transactional
    public void apply(UUID projectId, List<CatalogueWriting.Zone> wanted) {
        Map<UUID, ShippingZone> existing = new HashMap<>();
        for (ShippingZone zone : zones.findByProject(projectId)) {
            existing.put(zone.getId(), zone);
        }

        Map<String, UUID> destinations = new HashMap<>();
        Set<UUID> kept = new HashSet<>();
        for (CatalogueWriting.Zone zone : wanted) {
            ShippingZone row = existing.get(zone.id());
            if (row == null) {
                zones.save(ShippingZone.named(zone.id(), projectId, zone.name()));
            } else {
                row.rename(zone.name());
            }
            kept.add(zone.id());
            zone.countries().forEach(country -> destinations.put(country, zone.id()));
        }

        applyMemberships(projectId, destinations);

        existing.forEach((id, zone) -> {
            if (!kept.contains(id)) {
                zones.delete(zone);
            }
        });
    }

    /** The campaign's regions as they are, in the order the rate editor renders them. */
    @Transactional(readOnly = true)
    public List<ShippingZoneDetail> detailsOf(UUID projectId) {
        Map<UUID, List<String>> countries = new HashMap<>();
        for (ShippingZoneCountry membership : memberships.findByProject(projectId)) {
            countries.computeIfAbsent(membership.getZoneId(), key -> new ArrayList<>())
                    .add(membership.getCountryCode());
        }
        return zones.findByProject(projectId).stream()
                .map(zone -> new ShippingZoneDetail(
                        zone.getId(), zone.getName(), List.copyOf(countries.getOrDefault(zone.getId(), List.of()))))
                .toList();
    }

    /**
     * The diff, destination by destination.
     *
     * <p>A country that stays keeps its row and is moved if its zone changed, rather
     * than being deleted and reinserted — the same reason {@code ShippingRule.reprice}
     * exists: Hibernate orders inserts before deletes inside a flush, so the pair
     * would collide on the primary key that makes a destination belong to one zone.
     */
    private void applyMemberships(UUID projectId, Map<String, UUID> destinations) {
        Map<String, ShippingZoneCountry> existing = new HashMap<>();
        for (ShippingZoneCountry membership : memberships.findByProject(projectId)) {
            existing.put(membership.getCountryCode(), membership);
        }

        destinations.forEach((country, zoneId) -> {
            ShippingZoneCountry stored = existing.get(country);
            if (stored == null) {
                memberships.save(ShippingZoneCountry.of(zoneId, projectId, country));
            } else {
                stored.moveTo(zoneId);
            }
        });

        existing.forEach((country, stored) -> {
            if (!destinations.containsKey(country)) {
                memberships.delete(stored);
            }
        });
    }
}
