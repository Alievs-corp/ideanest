package az.ideanest.community.application;

import java.util.UUID;

/**
 * The person who wrote this comment has blocked the person replying to it — #324.
 *
 * <p>A 403. <strong>The refusal does not say why</strong>, and that is the point: a block is
 * private, and "this person has blocked you" is the message that invites the retaliation the
 * block exists to stop. What the replier learns is that this one comment does not take a reply
 * from them, which is the least that can be said while still refusing.
 */
public class CommentReplyNotPermittedException extends RuntimeException {

    private final UUID commentId;

    public CommentReplyNotPermittedException(UUID commentId) {
        super("Replies to comment " + commentId + " are not accepted from this account");
        this.commentId = commentId;
    }

    public UUID commentId() {
        return commentId;
    }
}
