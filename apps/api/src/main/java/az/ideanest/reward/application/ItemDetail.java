package az.ideanest.reward.application;

import az.ideanest.project.application.CatalogueWriting;
import az.ideanest.reward.domain.Item;
import java.util.List;

/**
 * An item as its creator's editor reads it: the row, with what waits for a moderator written on
 * (#587).
 *
 * @param shown the item as the editor should show it: its proposed state when a launched
 *     campaign's open revision changes it, the row's otherwise
 * @param revisionChangedFields the fields that wait, named as the item response names them;
 *     empty when nothing does
 */
public record ItemDetail(Item item, CatalogueWriting.Item shown, List<String> revisionChangedFields) {

    public ItemDetail {
        revisionChangedFields = List.copyOf(revisionChangedFields);
    }

    /** {@code item} with {@code held} written on, when the revision holds anything for it. */
    public static ItemDetail of(Item item, CatalogueWriting.Item held) {
        CatalogueWriting.Item live = RewardTierWritings.writingOf(item);
        if (held == null) {
            return new ItemDetail(item, live, List.of());
        }
        return new ItemDetail(item, held, held.changedFrom(live));
    }
}
