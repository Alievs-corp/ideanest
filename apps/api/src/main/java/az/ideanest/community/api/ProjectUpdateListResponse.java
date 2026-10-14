package az.ideanest.community.api;

import az.ideanest.community.application.UpdateTimeline;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * A page of a campaign's updates, newest first.
 *
 * <p>Cursor based, per §10.3: the response carries {@code nextCursor} and the client
 * sends it back as {@code ?cursor=}. Offsets are not offered, because an update
 * published between two requests would shift every page after it and the reader would
 * see one twice or not at all.
 *
 * <p><strong>Nulls are written out.</strong> A campaign with no updates answers
 * {@code {"updates": [], "nextCursor": null}} rather than an object with a key missing:
 * a client should not have to tell "this is the last page" from "this server does not
 * send that key".
 *
 * @param nextCursor the number to ask below for the next page, or null when this is the
 *     last one. It is an update's number and therefore public information already —
 *     there is nothing to obfuscate and an opaque token would only need decoding
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProjectUpdateListResponse(List<ProjectUpdateResponse> updates, Integer nextCursor) {

    /** ASCII unit separator. Cannot occur in a number, an enum name, or an ISO 8601 instant. */
    private static final char FIELD_SEPARATOR = (char) 0x1f;

    /** ASCII record separator, so that a row boundary is not a field boundary. */
    private static final char ROW_SEPARATOR = (char) 0x1e;

    public static ProjectUpdateListResponse of(UpdateTimeline timeline) {
        return new ProjectUpdateListResponse(
                timeline.updates().stream().map(ProjectUpdateResponse::of).toList(), timeline.nextCursor());
    }

    /**
     * A validator for this exact body, per §10.3.
     *
     * <p>A digest over what is serialised rather than {@code hashCode()}, for the reason
     * {@code PublicRewardListResponse} gives: a tag has to mean the same thing on every
     * instance of the service and after a restart, and nothing guarantees a record's
     * hash does. Computed beside the fields, so that adding one and forgetting to cover
     * it is a one-line distance rather than a different file.
     *
     * <p><strong>The body is part of the tag, not just the number.</strong> An update is
     * immutable today, so a tag over the numbers alone would be correct — and it would
     * stop being correct the moment AD-09's moderation edits or withdraws one, silently,
     * by serving a 304 for a page that had changed.
     *
     * <p>The cursor is covered too. Two pages of one campaign are different bodies and
     * must not share a tag; without it, a client that had page two cached would be told
     * page one had not changed.
     */
    public String etag() {
        StringBuilder canonical = new StringBuilder();
        canonical.append(nextCursor).append(FIELD_SEPARATOR).append(ROW_SEPARATOR);
        for (ProjectUpdateResponse update : updates) {
            canonical
                    .append(update.id())
                    .append(FIELD_SEPARATOR)
                    .append(update.number())
                    .append(FIELD_SEPARATOR)
                    .append(update.title())
                    .append(FIELD_SEPARATOR)
                    .append(update.body())
                    .append(FIELD_SEPARATOR)
                    .append(update.visibility())
                    .append(FIELD_SEPARATOR)
                    .append(update.publishedAt())
                    .append(FIELD_SEPARATOR)
                    .append(update.authorId())
                    .append(FIELD_SEPARATOR)
                    .append(ROW_SEPARATOR);
        }
        return digestOf(canonical.toString());
    }

    private static String digestOf(String canonical) {
        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // Every JVM ships SHA-256. Reaching here is not a runtime condition.
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        byte[] digest = sha256.digest(canonical.getBytes(StandardCharsets.UTF_8));
        return "\"" + HexFormat.of().formatHex(digest, 0, 8) + "\"";
    }
}
