package az.ideanest.community.api;

import az.ideanest.community.domain.Comment;
import az.ideanest.user.application.PublicName;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;
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
 * @param authorId who wrote it. Kept beside {@code author} because it is what a reader's
 *     own block list is matched against (#324), and a name is not unique
 * @param author the name and picture to draw beside it, or null to draw neither — #255.
 *     Null for a removed comment and for every author {@code CommentAuthors} withholds a
 *     name for: a private profile, an anonymous backer of this campaign, a closed
 *     account. The client draws a neutral "Member" then, and never says which case it was
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
        CommentAuthor author,
        boolean byCreator,
        boolean deleted,
        boolean acceptsReplies,
        Instant createdAt) {

    /**
     * A comment's author as a stranger may see them: a name and a picture, nothing to
     * address them by.
     *
     * @param avatarUrl null for the many accounts with no picture
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record CommentAuthor(String name, String avatarUrl) {
    }

    /**
     * @param names who may be named, from {@code CommentAuthors}; an author absent from it
     *     is answered with no author
     */
    public static CommentResponse of(Comment comment, Map<UUID, PublicName> names) {
        boolean deleted = comment.isDeleted();
        PublicName name = deleted ? null : names.get(comment.getAuthorId());
        return new CommentResponse(
                comment.getId(),
                comment.getParentId(),
                comment.getThreadId(),
                comment.getDepth(),
                deleted ? null : comment.getBody(),
                deleted ? null : comment.getAuthorId(),
                name == null ? null : new CommentAuthor(name.name(), name.avatarUrl()),
                // A tombstone claims nothing on the campaign's behalf, whoever wrote it.
                !deleted && comment.isByCreator(),
                deleted,
                // A removed comment takes no new replies — see CommentService#reply.
                !deleted && comment.acceptsReplies(),
                comment.getCreatedAt());
    }
}
