package az.ideanest.community.application;

import az.ideanest.user.application.PublicName;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One page of a campaign's Comments tab, and where the next one starts.
 *
 * <p><strong>One shape for both reads.</strong> The default list returns a page of
 * conversations each carrying a preview of its replies; asking for a single thread
 * returns one conversation carrying a page of its replies. Answering the second with a
 * bare list of comments would make a client parse two response shapes to render one
 * tab, and the "show more replies" control would have to know which it was looking at.
 *
 * @param threads newest conversation first
 * @param nextCursor what to send as {@code ?cursor=} for the following page of
 *     conversations, or null when this is the last one. Always null in the
 *     single-thread read, where paging happens inside
 *     {@link CommentThread#nextReplyCursor()} instead
 * @param personal whether this page was shaped for its reader — #324: somebody who has blocked
 *     an account is served the page without that account's comments. A personal page must not
 *     be kept by a shared cache, and {@code PublicCommentController} marks it private; every
 *     other page is the same for everybody and stays public
 * @param authors the names a stranger may see beside these comments, by author — #255,
 *     decided by {@link CommentAuthors}. An author absent from it is drawn without a name
 */
public record CommentPage(
        List<CommentThread> threads, UUID nextCursor, boolean personal, Map<UUID, PublicName> authors) {

    public CommentPage {
        threads = List.copyOf(threads);
        authors = Map.copyOf(authors);
    }
}
