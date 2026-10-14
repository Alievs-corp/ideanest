package az.ideanest.community.api;

import az.ideanest.community.domain.Comment;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/**
 * One comment, as the Comments tab reads it.
 *
 * <p><strong>This is the single place a tombstone is turned into a body somebody may
 * read.</strong> A removed comment answers with {@code body: null},
 * {@code authorId: null} and {@code deleted: true}, and V25 keeps the text on the row
 * for the moderator who has a report about it. Deciding this in one place is the point:
 * a projection that made the decision per endpoint would eventually have an endpoint
 * that forgot, and what leaks then is a comment somebody had removed.
 *
 * <p><strong>The author is withheld from a tombstone too.</strong> The row still names
 * them — CD-14 and AD-04 both need to know whose comment was removed — and the page
 * does not: "removed" beside a name is an accusation published to everybody reading the
 * campaign, which is not what deleting a comment is supposed to do to the person who
 * wrote it.
 *
 * <p><strong>It carries an identifier.</strong> §10.2 gives a comment three endpoints of
 * its own — reply, delete, report — so this one is a handle to a resource that really
 * exists. {@code ProjectUpdateResponse} carries one for its single endpoint, report.
 *
 * @param authorId who wrote it. The name behind it is the profile endpoint's to serve,
 *     for {@code ProjectUpdateResponse}'s reason: a body carrying names would need a
 *     join per row and a decision about what a deleted account is called
 * @param byCreator C-02's highlight. Computed at write time from the authorisation
 *     then in force — never from anything the client sent
 * @param acceptsReplies whether {@code POST /v1/comments/{id}/reply} would be accepted
 *     for this comment. Sent so a client can place the control rather than discover the
 *     depth rule by being refused; it is {@code Comment#acceptsReplies}, so the button
 *     and the server cannot disagree about where a reply may go
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record CommentResponse(
        UUID id,
        UUID parentId,
        UUID threadId,
        int depth,
        String body,
        UUID authorId,
        boolean byCreator,
        boolean deleted,
        boolean acceptsReplies,
        Instant createdAt) {

    public static CommentResponse of(Comment comment) {
        boolean deleted = comment.isDeleted();
        return new CommentResponse(
                comment.getId(),
                comment.getParentId(),
                comment.getThreadId(),
                comment.getDepth(),
                deleted ? null : comment.getBody(),
                deleted ? null : comment.getAuthorId(),
                // A tombstone claims nothing on the campaign's behalf, whoever wrote it.
                !deleted && comment.isByCreator(),
                deleted,
                // A removed comment takes no new replies — see CommentService#reply.
                !deleted && comment.acceptsReplies(),
                comment.getCreatedAt());
    }
}
