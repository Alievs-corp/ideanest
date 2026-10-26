package az.ideanest.reward.api;

import az.ideanest.reward.application.ItemDetail;
import az.ideanest.reward.domain.Item;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * An item as its creator's editor sees it.
 *
 * <p><strong>Nulls are written out.</strong> The service is configured with
 * {@code default-property-inclusion: non_null}, which is right for most responses and
 * wrong for this one: the editor binds a form to every field here, and an absent key
 * cannot be told from a field that is genuinely unset. That is the same distinction
 * the {@code PATCH} body depends on, in the other direction. {@code ProjectEdit} is
 * annotated for the same reason.
 *
 * @param imageUrl where the image is, as the client declared it. Nothing has been
 *     uploaded and nothing has been measured — there is no media pipeline (§13) — and
 *     this becomes a reference to a {@code media} row when there is one
 * @param isDigital whether the item is delivered as a file. Named with its prefix
 *     because that is the JSON key the client reads and writes
 * @param revisionChangedFields on a launched campaign, the fields of an item the public sees
 *     whose new values wait in the campaign's revision for a moderator (#587). The other
 *     fields of this response already show those new values. Empty when nothing waits
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ItemResponse(
        UUID id,
        UUID projectId,
        String name,
        String description,
        String imageUrl,
        Integer weightGrams,
        boolean isDigital,
        String sku,
        Instant createdAt,
        Instant updatedAt,
        List<String> revisionChangedFields) {

    public static ItemResponse of(Item item) {
        return of(ItemDetail.of(item, null));
    }

    public static ItemResponse of(ItemDetail detail) {
        Item item = detail.item();
        return new ItemResponse(
                item.getId(),
                item.getProjectId(),
                detail.shown().name(),
                detail.shown().description(),
                detail.shown().imageUrl(),
                detail.shown().weightGrams(),
                detail.shown().digital(),
                item.getSku(),
                item.getCreatedAt(),
                item.getUpdatedAt(),
                detail.revisionChangedFields());
    }
}
