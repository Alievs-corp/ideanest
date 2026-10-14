package az.ideanest.community.api;

import az.ideanest.community.application.CommentDeletionNotPermittedException;
import az.ideanest.community.application.CommentNotFoundException;
import az.ideanest.community.application.CommentReplyNotPermittedException;
import az.ideanest.community.domain.CommentContentInvalidException;
import az.ideanest.community.domain.ReplyDepthExceededException;
import az.ideanest.project.application.ProjectNotFoundException;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What the comment endpoints refuse, as RFC 9457 problem details (§10.4).
 *
 * <p>Scoped to these two controllers rather than declared globally, exactly as
 * {@code ProjectUpdateExceptionHandler} is scoped to its own: a second translation of
 * {@code ProjectNotFoundException} in front of a controller that already has one is two
 * bodies for one refusal, and the drift shows up as the same failure answering
 * differently depending on which endpoint produced it.
 */
@RestControllerAdvice(assignableTypes = {CommentController.class, PublicCommentController.class})
public class CommentExceptionHandler {

    /**
     * 404 for a campaign that does not exist, one that is not publicly visible, and one
     * this caller has no relationship to.
     *
     * <p>Deliberately the same answer for all three, as everywhere else in the platform:
     * a draft is an unreleased product, and telling "not there" apart from "not yours"
     * from a path that needs no token would turn this endpoint into an oracle for what
     * other people are preparing.
     */
    @ExceptionHandler(ProjectNotFoundException.class)
    public ProblemDetail handleProjectNotFound(ProjectNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-found"));
        problem.setTitle("No such project");
        problem.setDetail("That project does not exist.");
        problem.setProperty("code", "PROJECT_NOT_FOUND");
        return problem;
    }

    /**
     * 404 for a comment that does not exist, one that has been removed, and one on a
     * campaign this caller may not see.
     *
     * <p>One answer for all three, for the reason above and for one of this endpoint's
     * own: a removed comment is frequently one trust and safety has just acted on, and
     * an answer that distinguished "removed" from "never existed" would confirm to
     * whoever wrote it that somebody took it down.
     */
    @ExceptionHandler(CommentNotFoundException.class)
    public ProblemDetail handleCommentNotFound(CommentNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/comment-not-found"));
        problem.setTitle("No such comment");
        problem.setDetail("That comment does not exist.");
        problem.setProperty("code", "COMMENT_NOT_FOUND");
        return problem;
    }

    /**
     * 403 for somebody removing a comment that is not theirs to remove.
     *
     * <p>Not a 404, unlike everything above it: the caller is looking at this comment on
     * a public page, so there is nothing left to hide and "no such comment" would be a
     * refusal about something plainly on screen.
     */
    @ExceptionHandler(CommentDeletionNotPermittedException.class)
    public ProblemDetail handleDeletionNotPermitted(CommentDeletionNotPermittedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/comment-deletion-not-permitted"));
        problem.setTitle("Not your comment to remove");
        problem.setDetail("A comment can be removed by the person who wrote it or by the campaign.");
        problem.setProperty("code", "COMMENT_DELETION_NOT_PERMITTED");
        return problem;
    }

    /** 400 for a comment the platform will not store. Names the field, so the message can sit beside the box. */
    @ExceptionHandler(CommentContentInvalidException.class)
    public ProblemDetail handleContentInvalid(CommentContentInvalidException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/comment-content-invalid"));
        problem.setTitle("Invalid comment");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "COMMENT_CONTENT_INVALID");
        problem.setProperty("meta", Map.of("field", exception.field()));
        return problem;
    }

    /**
     * 422 for a reply to a reply.
     *
     * <p><strong>422 rather than 400.</strong> The request is well formed and every
     * field in it is valid; what is wrong is the state of the comment it names, which is
     * the distinction {@code Unprocessable Content} exists for. The bound travels in
     * {@code meta} so a client can hide the control rather than learn the rule by being
     * refused — and {@code CommentResponse#acceptsReplies} means it should never have
     * offered one in the first place.
     */
    @ExceptionHandler(ReplyDepthExceededException.class)
    public ProblemDetail handleReplyDepth(ReplyDepthExceededException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/reply-depth-exceeded"));
        problem.setTitle("Replies go one level deep");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "REPLY_DEPTH_EXCEEDED");
        problem.setProperty("meta", Map.of("maxDepth", exception.maxDepth()));
        return problem;
    }

    /**
     * 403 for a reply to somebody who has blocked the replier — #324.
     *
     * <p><strong>The words do not mention a block</strong>, and must not. A block is private,
     * and "this person blocked you" is the sentence that invites the retaliation the block
     * exists to stop. What is said is true and is the least that refusing requires: this
     * comment does not take a reply from this account.
     */
    @ExceptionHandler(CommentReplyNotPermittedException.class)
    public ProblemDetail handleReplyNotPermitted(CommentReplyNotPermittedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/comment-reply-not-permitted"));
        problem.setTitle("Cannot reply to this comment");
        problem.setDetail("This comment is not accepting replies from your account.");
        problem.setProperty("code", "COMMENT_REPLY_NOT_PERMITTED");
        return problem;
    }
}
