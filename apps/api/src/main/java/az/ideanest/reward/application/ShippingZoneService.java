package az.ideanest.reward.application;

import az.ideanest.project.application.CatalogueWriting;
import az.ideanest.project.application.EditLocks;
import az.ideanest.project.application.ProjectRevisionService;
import az.ideanest.reward.domain.ShippingZone;
import az.ideanest.reward.infrastructure.ShippingZoneRepository;
import az.ideanest.shared.Identifiers;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A campaign's shipping regions — §4.8's PM-13 (#77).
 *
 * <h2>Replaced wholesale, like the rate tables they price</h2>
 *
 * <p>{@code PUT}, and the whole set. A zone left out of the body is a zone the
 * creator has removed, which is the same contract {@code PUT /v1/rewards/{id}/
 * shipping-rules} has had since V7 and for the same reason: a set of destinations is
 * read as a whole by whatever quotes from it, and merging would leave a creator
 * shipping to a region they believe they deleted.
 *
 * <p>A zone present in both the old and the new set <strong>keeps its
 * identifier</strong>, matched on its folded name. That is not a nicety: a tier's
 * rates name the zone by identifier, so deleting and recreating "EU" on every edit
 * would silently discard every rate every tier charges to it. Matching by name is
 * what makes renaming the one operation that has to be done deliberately — a rename
 * arrives as the same identifier with a different name, and the editor sends it that
 * way.
 *
 * <h2>On a launched campaign the set waits for a moderator (#587)</h2>
 *
 * <p>A region's destinations decide who may pledge for a physical reward and what shipping
 * costs them, through {@code ShippingRates} into every live quote, and deleting one takes every
 * tier's rate for it with it. So once the public has seen the campaign a replacement is staged
 * in its open revision, as a tier's change is, and applied when a moderator approves it; the
 * editor reads the staged set back. A region added in a revision gets the identifier it will be
 * created with, and can be priced once it exists.
 *
 * <h2>{@code EDIT_REWARDS}, because a zone is part of what a backer is promised</h2>
 *
 * <p>The same capability that guards the rate tables and the tiers themselves.
 * §17's vocabulary calls it "items, reward tiers, shipping rules — what a backer is
 * promised", and a region is the shape of a shipping rule rather than a separate
 * kind of thing.
 */
@Service
public class ShippingZoneService {

    /**
     * How many regions one campaign may name.
     *
     * <p>A bound rather than a preference. Every zone is a row the checkout may have
     * to consider and a row in an editor somebody has to read, and a campaign with
     * two hundred regions has not modelled its tariff — it has modelled its country
     * list twice. Twenty-five is more than any real carrier agreement distinguishes.
     */
    private static final int ZONE_LIMIT = 25;

    /**
     * How many destinations one campaign may place in zones, across all of them.
     *
     * <p>Above the number of countries that exist, deliberately: the bound is a
     * runaway guard on a request body rather than a product rule, and a creator who
     * genuinely ships everywhere should not meet it.
     */
    private static final int MEMBERSHIP_LIMIT = 300;

    private final ShippingZoneRepository zones;
    private final ShippingZoneWrites writes;
    private final RewardAccess access;
    private final ProjectRevisionService revisions;

    public ShippingZoneService(
            ShippingZoneRepository zones,
            ShippingZoneWrites writes,
            RewardAccess access,
            ProjectRevisionService revisions) {

        this.zones = zones;
        this.writes = writes;
        this.access = access;
        this.revisions = revisions;
    }

    /**
     * The campaign's regions and what each covers: on a launched campaign with a set waiting
     * for a moderator, that set, marked pending.
     *
     * @throws az.ideanest.project.application.ProjectNotFoundException for a campaign
     *     that does not exist and for one this account has no part in, identically
     * @throws az.ideanest.project.application.CapabilityNotGrantedException without
     *     {@code EDIT_REWARDS}
     */
    @Transactional(readOnly = true)
    public ShippingZones list(UUID projectId, UUID accountId) {
        EditLocks locks = access.requireEditableProject(projectId, accountId);
        if (locks.rewardWritingHeld()) {
            Optional<List<CatalogueWriting.Zone>> held = revisions.heldZones(projectId);
            if (held.isPresent()) {
                return new ShippingZones(detailsOf(held.get()), true);
            }
        }
        return new ShippingZones(writes.detailsOf(projectId), false);
    }

    /**
     * Makes the campaign's regions exactly the ones given, or on a launched campaign proposes
     * that they be (#587).
     *
     * @throws ShippingZoneInvalidException when a zone has no name or no
     *     destinations, when two zones are named the same thing after folding, when a
     *     destination appears in two zones, or when either bound is exceeded
     */
    @Transactional
    public ShippingZones replace(UUID projectId, UUID accountId, List<ZoneDefinition> definitions) {
        EditLocks locks = access.requireEditableProject(projectId, accountId);
        List<Requested> requested = validated(definitions);
        List<ShippingZone> rows = zones.findByProject(projectId);

        if (locks.rewardWritingHeld()) {
            List<CatalogueWriting.Zone> staged = revisions.stageZones(
                    projectId, accountId, current -> identified(requested, current, rows));
            boolean pending = revisions.heldZones(projectId).isPresent();
            return new ShippingZones(detailsOf(staged), pending);
        }

        List<CatalogueWriting.Zone> shown = rows.stream()
                .map(zone -> new CatalogueWriting.Zone(zone.getId(), zone.getName(), List.of()))
                .toList();
        writes.apply(projectId, identified(requested, shown, rows));
        return new ShippingZones(writes.detailsOf(projectId), false);
    }

    /**
     * The regions a creator asked for, checked as a whole before anything is written or staged.
     */
    private static List<Requested> validated(List<ZoneDefinition> definitions) {
        List<ZoneDefinition> asked = definitions == null ? List.of() : definitions;
        if (asked.size() > ZONE_LIMIT) {
            throw new ShippingZoneInvalidException(
                    "A campaign names at most " + ZONE_LIMIT + " shipping regions, not " + asked.size() + ".");
        }

        Set<String> names = new LinkedHashSet<>();
        Map<String, String> destinations = new HashMap<>();
        List<Requested> requested = new ArrayList<>();
        for (ZoneDefinition definition : asked) {
            if (definition == null) {
                throw new ShippingZoneInvalidException("A shipping region has a name and at least one destination.");
            }
            Set<String> countries;
            String name;
            try {
                countries = ShippingZone.normaliseCountries(
                        definition.countryCodes() == null ? List.of() : definition.countryCodes());
                name = ShippingZone.validName(definition.name());
            } catch (IllegalArgumentException rejected) {
                throw new ShippingZoneInvalidException(rejected.getMessage());
            }
            String folded = fold(name);
            if (!names.add(folded)) {
                throw new ShippingZoneInvalidException("Two regions are called \"" + name + "\".");
            }
            for (String country : countries) {
                if (destinations.putIfAbsent(country, folded) != null) {
                    // V37 refuses this with a primary key. Refusing it here means the
                    // creator reads which destination is in two regions rather than a
                    // constraint name.
                    throw new ShippingZoneInvalidException(
                            country + " is in two regions. A destination belongs to one region at most.");
                }
            }
            requested.add(new Requested(name, folded, List.copyOf(countries)));
        }

        if (destinations.size() > MEMBERSHIP_LIMIT) {
            throw new ShippingZoneInvalidException(
                    "A campaign places at most " + MEMBERSHIP_LIMIT + " destinations in regions.");
        }
        return List.copyOf(requested);
    }

    /**
     * The requested regions with identifiers: the one a region of the same folded name already
     * has in {@code current} (the set being replaced, which on a launched campaign may be a set
     * still waiting), or else in {@code rows} (the regions as they are, so one removed and added
     * back in the same revision keeps its rates), or else a new one. See the class comment for
     * why matching on the name is what keeps a tier's rates.
     */
    private static List<CatalogueWriting.Zone> identified(
            List<Requested> requested, List<CatalogueWriting.Zone> current, List<ShippingZone> rows) {
        Map<String, UUID> known = new HashMap<>();
        rows.forEach(zone -> known.put(fold(zone.getName()), zone.getId()));
        current.forEach(zone -> known.put(fold(zone.name()), zone.id()));
        return requested.stream()
                .map(zone -> new CatalogueWriting.Zone(
                        known.getOrDefault(zone.folded(), Identifiers.newIdentifier()), zone.name(), zone.countries()))
                .toList();
    }

    /** Regions in the order the rate editor renders them: by name. */
    private static List<ShippingZoneDetail> detailsOf(List<CatalogueWriting.Zone> staged) {
        return staged.stream()
                .sorted(Comparator.comparing(zone -> fold(zone.name())))
                .map(zone -> new ShippingZoneDetail(zone.id(), zone.name(), zone.countries()))
                .toList();
    }

    /** The comparable form V37's unique index folds to, so the two agree. */
    static String fold(String name) {
        return name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
    }

    /** One region as asked for, checked. */
    private record Requested(String name, String folded, List<String> countries) {}

    /**
     * What the rate editor reads.
     *
     * @param pending true when these are a launched campaign's proposed regions, waiting in its
     *     revision, rather than the ones its quotes use
     */
    public record ShippingZones(List<ShippingZoneDetail> zones, boolean pending) {}
}
