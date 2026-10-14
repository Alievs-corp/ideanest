package az.ideanest.community.infrastructure;

import az.ideanest.community.domain.Comment;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Comments, by the four questions asked of them.
 *
 * <p><strong>Reading the tab is two queries, and it stays two however many comments a
 * campaign has.</strong> {@link #rootPage} takes a page of conversations; {@link
 * #repliesOf} takes the replies for <em>all</em> of them at once. The obvious
 * alternative — a page of roots and then a query per root — is an N+1 that is
 * invisible on a campaign with nine comments and is the reason the tab times out on
 * the campaign that raised two million. A JPA association with a fetch join would be
 * the other alternative and is worse: the join multiplies the root rows by their
 * replies, so the page size stops meaning conversations, and it cannot bound how many
 * replies one popular thread contributes.
 *
 * <p><strong>Every page is keyset, never an offset.</strong> §10.3 asks for cursor
 * paging and this table is the reason: a comments tab is written to while it is being
 * read, and an offset against a growing set shows the same comment twice and skips
 * another. The cursor is the identifier, which is a UUID v7 (§7.3) and therefore in
 * arrival order — so ordering by it is ordering by time without carrying
 * {@code created_at} in the index.
 *
 * <p><strong>Deleted comments are not filtered out.</strong> That is deliberate and it
 * is the one place a reader has to know it: V25 makes deletion a tombstone, the tab
 * shows it as one, and a repository that quietly dropped them would orphan the replies
 * under a removed root — which is the exact failure the tombstone exists to prevent.
 * What is never served is the body, and {@code CommentResponse} is the single place
 * that decides so.
 *
 * <p><strong>Every read takes the reader, and hides what they blocked</strong> — #324. A
 * comment whose author the reader has blocked is left out by the query itself, through a
 * {@code NOT EXISTS} against {@code user_blocks}, rather than dropped from the page afterwards:
 * a page filtered after it was read is a short page, and a page filtered to nothing looks like
 * the end of the tab. An anonymous reader, and a reader who has blocked nobody, is passed as
 * {@code CommentService}'s nil identifier, which no row in {@code user_blocks} can name — a
 * value rather than a null bind, for {@link #rootPage}'s reason.
 *
 * <p>There is no update method and no delete method. Removing a comment is
 * {@code Comment#deleteBy} on a loaded row inside a transaction — a tombstone is a
 * field assignment, not a statement of its own — and Spring Data will happily generate
 * a {@code deleteBy…} from a derived name, so the absence has to be deliberate.
 */
public interface CommentRepository extends JpaRepository<Comment, UUID> {

    /**
     * One page of a campaign's conversations, newest first.
     *
     * <p>Roots only. A reply is not a conversation, and including them here would make
     * the page size mean nothing to a client trying to render it.
     *
     * @param below the cursor: only comments ordered before this one. {@code
     *     Identifiers} mints UUID v7, so "below" is "older". The first page passes the
     *     maximum UUID rather than null, for {@code ProjectUpdateRepository#page}'s
     *     reason — a nullable bind would make the predicate
     *     {@code (:below IS NULL OR ...)}, and an untyped null is the shape PostgreSQL
     *     declines to infer a type for
     * @param limit one more than the page size, so "is there another page" is answered
     *     by the rows already read rather than by a count query that could disagree
     *     with them
     * @param readerId who is reading. A conversation started by somebody they blocked is
     *     left out whole — its replies with it, because a reply read without the comment it
     *     answers is half of somebody else's conversation, and the reader asked not to be in
     *     this one
     */
    @Query(
            """
            SELECT c FROM Comment c
             WHERE c.projectId = :projectId
               AND c.parentId IS NULL
               AND c.id < :below
               AND NOT EXISTS (
                   SELECT 1 FROM Block b
                    WHERE b.blockerId = :readerId
                      AND b.blockedId = c.authorId)
             ORDER BY c.id DESC
            """)
    List<Comment> rootPage(
            @Param("projectId") UUID projectId,
            @Param("below") UUID below,
            @Param("readerId") UUID readerId,
            Limit limit);

    /**
     * The replies belonging to every thread on one page, oldest first, bounded per
     * thread.
     *
     * <p><strong>One query for the whole page</strong> — see the interface comment.
     * Native, because the bound is a window function: without it a single thread with
     * eleven thousand replies would decide the size of every response the tab ever
     * serves, and the page size a client asked for would be about conversations while
     * the cost was about the largest argument on the campaign.
     *
     * <p>{@code perThread + 1} rows are taken per thread so the caller can tell "that
     * is all of them" from "there are more", and {@code CommentService} turns the
     * difference into a flag the client uses to ask for the rest through
     * {@link #threadPage}. Counting instead would be a second aggregate over the same
     * rows to learn something these already know.
     *
     * <p>Ascending, because a conversation is read forwards even though the list of
     * conversations is newest first.
     *
     * @param threadIds the identifiers of the roots on this page. Never empty — an
     *     empty {@code IN} is not valid SQL and the caller already knows the page held
     *     nothing
     * @param readerId who is reading. Replies by somebody they blocked are left out
     *     <em>inside</em> the window, so the bound counts replies the reader will see and a
     *     blocked account cannot use up a thread's preview
     */
    @Query(
            value =
                    """
                    SELECT c.* FROM (
                        SELECT r.*, row_number() OVER (PARTITION BY r.thread_id ORDER BY r.id) AS reply_rank
                          FROM comments r
                         WHERE r.thread_id IN (:threadIds)
                           AND r.parent_id IS NOT NULL
                           AND NOT EXISTS (
                               SELECT 1 FROM user_blocks b
                                WHERE b.blocker_id = :readerId
                                  AND b.blocked_id = r.author_id)
                    ) c
                     WHERE c.reply_rank <= :perThread
                     ORDER BY c.thread_id, c.id
                    """,
            nativeQuery = true)
    List<Comment> repliesOf(
            @Param("threadIds") Collection<UUID> threadIds,
            @Param("perThread") int perThread,
            @Param("readerId") UUID readerId);

    /**
     * One page of a single thread's replies, oldest first.
     *
     * <p>What the tab asks for when a conversation outgrew the preview
     * {@link #repliesOf} serves. The same keyset shape as everything else here, in the
     * other direction: {@code above} rather than {@code below}, because replies read
     * forwards and the cursor is therefore the last one already shown. The first page
     * passes the minimum UUID rather than null, for {@link #rootPage}'s reason.
     */
    @Query(
            """
            SELECT c FROM Comment c
             WHERE c.threadId = :threadId
               AND c.parentId IS NOT NULL
               AND c.id > :above
               AND NOT EXISTS (
                   SELECT 1 FROM Block b
                    WHERE b.blockerId = :readerId
                      AND b.blockedId = c.authorId)
             ORDER BY c.id
            """)
    List<Comment> threadPage(
            @Param("threadId") UUID threadId,
            @Param("above") UUID above,
            @Param("readerId") UUID readerId,
            Limit limit);
}
