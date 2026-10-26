package az.ideanest.project.api;

import az.ideanest.project.application.CatalogueWriting;
import az.ideanest.project.application.ProjectRevisionService;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.UUID;

/**
 * The items and shipping regions a revision of a launched campaign would change (#587), for the
 * moderator's review.
 */
public final class RevisionCatalogueBody {

    private RevisionCatalogueBody() {
    }

    /**
     * One item an approved tier contains, as the public sees it and as proposed.
     *
     * @param changedFields named as the creator's item response names them
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Item(UUID id, List<String> changedFields, ItemWriting live, ItemWriting proposed) {

        static Item of(ProjectRevisionService.ItemChange change) {
            return new Item(
                    change.itemId(),
                    change.changedFields(),
                    ItemWriting.of(change.live()),
                    ItemWriting.of(change.proposed()));
        }
    }

    /** @param weightGrams null for a digital item, and for a physical one nobody has weighed */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ItemWriting(
            String name, String description, String imageUrl, Integer weightGrams, boolean isDigital) {

        static ItemWriting of(CatalogueWriting.Item item) {
            return new ItemWriting(item.name(), item.description(), item.imageUrl(), item.weightGrams(), item.digital());
        }
    }

    /** The regions the campaign has, and the whole set the revision proposes instead. */
    public record Zones(List<Zone> live, List<Zone> proposed) {

        static Zones of(ProjectRevisionService.ZoneChange change) {
            return new Zones(
                    change.live().stream().map(Zone::of).toList(),
                    change.proposed().stream().map(Zone::of).toList());
        }
    }

    /**
     * @param id the region's identifier; a region the revision adds carries the one it will be
     *     created with
     */
    public record Zone(UUID id, String name, List<String> countryCodes) {

        static Zone of(CatalogueWriting.Zone zone) {
            return new Zone(zone.id(), zone.name(), zone.countries());
        }
    }
}
