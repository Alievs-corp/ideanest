package az.ideanest.project.application;

import az.ideanest.project.domain.RevisionContent;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * An item and a shipping region as a launched campaign's revision holds them (#587), for the
 * reward module, which cannot name {@link RevisionContent}'s records: they live in this
 * module's {@code domain} package. {@link RewardWriting} is the same arrangement for a tier.
 */
public final class CatalogueWriting {

    private CatalogueWriting() {
    }

    /**
     * What a backer is shown and charged for about an item: not its stock code.
     *
     * @param description null when it has none
     * @param imageUrl null when it has none
     * @param weightGrams null for a digital item, and for a physical one nobody has weighed
     */
    public record Item(String name, String description, String imageUrl, boolean digital, Integer weightGrams) {

        /**
         * The names of the fields in which this differs from {@code live}: the names the
         * creator's item response gives them, in its order.
         */
        public List<String> changedFrom(Item live) {
            List<String> changed = new ArrayList<>();
            if (!Objects.equals(name, live.name)) {
                changed.add("name");
            }
            if (!Objects.equals(description, live.description)) {
                changed.add("description");
            }
            if (!Objects.equals(imageUrl, live.imageUrl)) {
                changed.add("imageUrl");
            }
            if (!Objects.equals(weightGrams, live.weightGrams)) {
                changed.add("weightGrams");
            }
            if (digital != live.digital) {
                changed.add("isDigital");
            }
            return List.copyOf(changed);
        }

        static Item of(RevisionContent.Item item) {
            return new Item(item.name(), item.description(), item.imageUrl(), item.digital(), item.weightGrams());
        }

        RevisionContent.Item held() {
            return new RevisionContent.Item(name, description, imageUrl, digital, weightGrams);
        }
    }

    /**
     * One shipping region.
     *
     * @param id the region's row, or for a region proposed while the campaign is live, the
     *     identifier it is created with when the revision is approved
     * @param countries the destinations it covers, sorted
     */
    public record Zone(UUID id, String name, List<String> countries) {

        public Zone {
            Objects.requireNonNull(id, "A region has an identifier, proposed or real");
            countries = countries == null ? List.of() : countries.stream().sorted().toList();
        }

        static Zone of(RevisionContent.Zone zone) {
            return new Zone(zone.id(), zone.name(), zone.countries());
        }

        RevisionContent.Zone held() {
            return new RevisionContent.Zone(id, name, countries);
        }
    }
}
