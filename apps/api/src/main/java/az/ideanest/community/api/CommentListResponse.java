package az.ideanest.community.api;

import az.ideanest.community.application.CommentPage;
import az.ideanest.community.application.CommentThread;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * A page of a campaign's conversations, newest first.
 *
 * <p>Cursor based, per §10.3, for {@code ProjectUpdateListResponse}'s reason and more
 * urgently: a comments tab is written to while it is being read, so an offset would
 * show one comment twice and skip another every time somebody posted mid-page.
 *
 * <p><strong>Nulls are written out.</strong> A campaign nobody has commented on answers
 * {@code {"threads": [], "nextCursor": null}} rather than an object with a key missing.
 *
 * @param nextCursor the identifier to ask below for the next page of conversations, or
 *     null when this is the last one. A comment's own identifier, which the client
 *     already holds for every row on the page — there is nothing to obfuscate, and an
 *     opaque token would only need decoding
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CommentListResponse(List<Thread> threads, UUID nextCursor) {

    /** ASCII unit separator. Cannot occur in a UUID, a number, or an ISO 8601 instant. */
    private static final char FIELD_SEPARATOR = (char) 0x1f;

    /** ASCII record separator, so that a row boundary is not a field boundary. */
    private static final char ROW_SEPARATOR = (char) 0x1e;

    /**
     * One conversation: a root and the replies under it.
     *
     * @param nextReplyCursor what to send as {@code ?thread=<root>&cursor=} to read the
     *     rest, or null when these are all of them. Null rather than a count of what
     *     remains: a count is a second aggregate over rows already read, and a client
     *     only needs to know whether to draw "show more replies" and what to ask for
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Thread(CommentResponse root, List<CommentResponse> replies, UUID nextReplyCursor) {
    }

    public static CommentListResponse of(CommentPage page) {
        return new CommentListResponse(
                page.threads().stream().map(thread -> threadOf(thread, page)).toList(), page.nextCursor());
    }

    private static Thread threadOf(CommentThread thread, CommentPage page) {
        return new Thread(
                CommentResponse.of(thread.root(), page.authors()),
                thread.replies().stream().map(reply -> CommentResponse.of(reply, page.authors())).toList(),
                thread.nextReplyCursor());
    }

    /**
     * A validator for this exact body, per §10.3.
     *
     * <p>A digest over what is serialised rather than {@code hashCode()}, for
     * {@code ProjectUpdateListResponse}'s reason: a tag has to mean the same thing on
     * every instance of the service and after a restart, and nothing guarantees a
     * record's hash does.
     *
     * <p><strong>The deletion flag is in the tag, and it has to be.</strong> A comment
     * being removed changes the body without adding or removing a row, so a tag over
     * identifiers alone would serve a 304 for a page still showing something a
     * moderator had taken down — which is the one revalidation on this endpoint that
     * must never be wrong. {@code byCreator} is in for the same reason in the other
     * direction: it is a claim of authority, and a stale one is a claim nobody made.
     * The author's name and picture are in it too (#255): a profile turned private has to
     * take the name off the page at the next revalidation, not when the cache expires.
     */
    public String etag() {
        StringBuilder canonical = new StringBuilder();
        canonical.append(nextCursor).append(FIELD_SEPARATOR).append(ROW_SEPARATOR);
        for (Thread thread : threads) {
            append(canonical, thread.root());
            for (CommentResponse reply : thread.replies()) {
                append(canonical, reply);
            }
            canonical.append(thread.nextReplyCursor()).append(FIELD_SEPARATOR).append(ROW_SEPARATOR);
        }
        return digestOf(canonical.toString());
    }

    private static void append(StringBuilder canonical, CommentResponse comment) {
        canonical
                .append(comment.id())
                .append(FIELD_SEPARATOR)
                .append(comment.body())
                .append(FIELD_SEPARATOR)
                .append(comment.authorId())
                .append(FIELD_SEPARATOR)
                .append(comment.author() == null ? null : comment.author().name())
                .append(FIELD_SEPARATOR)
                .append(comment.author() == null ? null : comment.author().avatarUrl())
                .append(FIELD_SEPARATOR)
                .append(comment.byCreator())
                .append(FIELD_SEPARATOR)
                .append(comment.deleted())
                .append(FIELD_SEPARATOR)
                .append(comment.createdAt())
                .append(FIELD_SEPARATOR)
                .append(ROW_SEPARATOR);
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
