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
    public record RevisionItem(
            UUID id, List<String> changedFields, RevisionItemWriting live, RevisionItemWriting proposed) {

        static RevisionItem of(ProjectRevisionService.ItemChange change) {
            return new RevisionItem(
                    change.itemId(),
                    change.changedFields(),
                    RevisionItemWriting.of(change.live()),
                    RevisionItemWriting.of(change.proposed()));
        }
    }

    /** @param weightGrams null for a digital item, and for a physical one nobody has weighed */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record RevisionItemWriting(
            String name, String description, String imageUrl, Integer weightGrams, boolean isDigital) {

        static RevisionItemWriting of(CatalogueWriting.Item item) {
            return new RevisionItemWriting(item.name(), item.description(), item.imageUrl(), item.weightGrams(), item.digital());
        }
    }

    /** The regions the campaign has, and the whole set the revision proposes instead. */
    public record RevisionZones(List<RevisionZone> live, List<RevisionZone> proposed) {

        static RevisionZones of(ProjectRevisionService.ZoneChange change) {
            return new RevisionZones(
                    change.live().stream().map(RevisionZone::of).toList(),
                    change.proposed().stream().map(RevisionZone::of).toList());
        }
    }

    /**
     * @param id the region's identifier; a region the revision adds carries the one it will be
     *     created with
     */
    public record RevisionZone(UUID id, String name, List<String> countryCodes) {

        static RevisionZone of(CatalogueWriting.Zone zone) {
            return new RevisionZone(zone.id(), zone.name(), zone.countries());
        }
    }
}
