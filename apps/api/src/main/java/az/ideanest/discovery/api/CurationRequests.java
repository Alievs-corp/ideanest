package az.ideanest.discovery.api;

import az.ideanest.discovery.application.CollectionDraft;
import az.ideanest.discovery.application.CurationRejectedException;
import az.ideanest.discovery.domain.CollectionKind;
import az.ideanest.discovery.domain.ProjectCard;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What the admin curation endpoints accept.
 *
 * <p><strong>{@code PUT} rather than {@code PATCH} on the collection itself</strong>,
 * so these are whole descriptions rather than partial ones. See {@link CollectionDraft}
 * for the reason: telling "not sent" from "cleared" needs {@code Patched} on every
 * nullable field, which is machinery the campaign editor earns by autosaving one field
 * at a time and an admin form does not.
 */
public final class CurationRequests {

    private CurationRequests() {
    }

    /**
     * @param slug the URL handle, set once. Not editable afterwards — D-08's landing
     *     page address is a link people share, and V14 calls the column stable
     * @param collection everything else
     */
    public record CreateCollection(
            @NotBlank String slug, @NotNull @jakarta.validation.Valid CollectionBody collection) {
    }

    /**
     * @param kind {@code staff_selection}, {@code themed}, or {@code open_call}
     * @param grantsBadge whether membership is an editorial badge (§3.2). Defaults to
     *     false when absent, which is the safe half of the pair: a list that badges by
     *     accident puts the platform's name behind campaigns nobody decided to endorse
     * @param copy one entry per locale; {@code az} is required (§21.1)
     */
    public record CollectionBody(
            @NotBlank String kind,
            Instant opensAt,
            Instant closesAt,
            Boolean grantsBadge,
            Integer sortOrder,
            CoverBody cover,
            @NotEmpty @Size(max = 20) Map<String, CopyBody> copy) {

        /** @throws CurationRejectedException when the kind is not one of the three */
        public CollectionDraft toDraft() {
            CollectionKind resolved = CollectionKind.fromWireValue(kind)
                    .orElseThrow(() -> new CurationRejectedException(
                            "kind", "A collection is one of: " + String.join(", ", CollectionKind.wireValues())));

            Map<String, CollectionDraft.Copy> resolvedCopy = new LinkedHashMap<>();
            for (Map.Entry<String, CopyBody> entry : copy.entrySet()) {
                CopyBody body = entry.getValue();
                resolvedCopy.put(
                        entry.getKey(),
                        new CollectionDraft.Copy(
                                body == null ? null : body.title(), body == null ? null : body.description()));
            }

            return new CollectionDraft(
                    resolved,
                    opensAt,
                    closesAt,
                    Boolean.TRUE.equals(grantsBadge),
                    sortOrder == null ? 0 : sortOrder,
                    cover == null ? null : new ProjectCard.CoverImage(cover.url(), cover.width(), cover.height()),
                    resolvedCopy);
        }
    }

    public record CopyBody(String title, String description) {
    }

    /** The interim three columns, as {@code projects} carries them. */
    public record CoverBody(@NotBlank String url, int width, int height) {
    }

    /**
     * @param note why. Required — see {@code CurationAction.requiresANote}
     */
    public record PublishCollection(@NotBlank String note) {
    }

    public record AddProject(@NotNull UUID projectId, @NotBlank String note) {
    }

    public record RemoveProject(@NotBlank String note) {
    }

    /** @param projectIds every campaign in the collection, exactly once, in the new order */
    public record ReorderProjects(@NotEmpty @Size(max = 500) List<UUID> projectIds) {
    }
}
