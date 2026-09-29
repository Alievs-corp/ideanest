package az.ideanest.moderation.application;

import az.ideanest.community.application.CommentNotFoundException;
import az.ideanest.community.application.ProjectUpdateNotFoundException;
import az.ideanest.community.application.PublicComments;
import az.ideanest.community.application.PublicProjectUpdates;
import az.ideanest.moderation.domain.ReportTargetType;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.project.application.PublicProjects;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Whether there is anything at that identifier worth reporting.
 *
 * <p><strong>The check is not optional, and it is not about correctness of
 * data.</strong> Without it the endpoint accepts a report about any UUID a client
 * cares to invent, which is two problems: the queue fills with rows a moderator
 * opens, cannot find anything behind, and closes; and the endpoint becomes an oracle
 * — a caller who could report an identifier and be told "accepted" would learn that
 * the identifier names something, which for a draft campaign is exactly what
 * {@code ProjectAccess} spends its class comment refusing to say.
 *
 * <p><strong>Each module answers for its own surface.</strong> A campaign is
 * resolved through {@code PublicProjects}, which already encodes §6.1's nine public
 * states and answers 404 for a draft and for a suspended campaign alike; an account
 * through {@code UserAccounts}, which excludes soft-deleted rows; a comment through
 * {@code PublicComments} (#84), which excludes tombstones and asks
 * {@code PublicProjects} the same question about the campaign it is under. No rule is
 * restated here, because a second copy of "which campaigns may a stranger see" is
 * the copy that forgets {@code SUSPENDED} the next time the list changes.
 *
 * <p><strong>A suspended campaign is deliberately unreportable.</strong> It reads
 * oddly for a safety feature until you notice what a suspension is: trust and safety
 * has already stopped that campaign, so a further report about it adds a row to the
 * queue and no information. The reporter gets the same 404 anybody else browsing
 * gets, which is consistent rather than special. A removed comment is refused for the
 * identical reason, and {@code PublicComments} makes the argument there.
 */
@Service
public class ReportTargets {

    private final PublicProjects projects;
    private final UserAccounts accounts;
    private final PublicComments comments;
    private final PublicProjectUpdates updates;

    public ReportTargets(
            PublicProjects projects,
            UserAccounts accounts,
            PublicComments comments,
            PublicProjectUpdates updates) {
        this.projects = projects;
        this.accounts = accounts;
        this.comments = comments;
        this.updates = updates;
    }

    /**
     * Establishes that the target exists and may be named by a stranger.
     *
     * @throws ReportTargetNotFoundException when it does not exist, or exists and is
     *     not something this caller is allowed to know exists
     * @throws UnsupportedReportTargetException for a surface the platform has not
     *     built yet. Unreachable through today's four routes — #297 published the
     *     last of them — and kept for the next target that is enumerated before it
     *     is reachable. See the exception, and {@code ReportTargetType.isReportable}
     */
    public void require(ReportTargetType targetType, UUID targetId) {
        switch (targetType) {
            case PROJECT -> requireProject(targetId);
            case USER -> requireAccount(targetId);
            case COMMENT -> requireComment(targetId);
            case PROJECT_UPDATE -> requireUpdate(targetId);
        }
    }

    private void requireProject(UUID projectId) {
        try {
            projects.requireVisible(projectId);
        } catch (ProjectNotFoundException e) {
            // Translated rather than propagated. The project module's advice is
            // scoped to the project module's controllers, so an exception of its
            // escaping here would reach the fallback handler and become a 500.
            throw new ReportTargetNotFoundException(ReportTargetType.PROJECT, projectId);
        }
    }

    /**
     * The account behind a public slug, which is how a profile addresses it (#143).
     *
     * <p>The public profile response carries the slug and deliberately no identifier,
     * and following is already addressed by slug, so reporting is too. Resolved
     * through {@code UserAccounts.findBySlug} — the same lookup the follow route
     * uses — which excludes soft-deleted accounts exactly as {@link #require} does.
     *
     * @throws ReportTargetNotFoundException when no account answers to the slug
     */
    public UUID requireAccountBySlug(String slug) {
        return accounts.findBySlug(slug)
                .map(UserAccount::id)
                .orElseThrow(() -> new ReportTargetNotFoundException(ReportTargetType.USER, String.valueOf(slug)));
    }

    private void requireAccount(UUID accountId) {
        accounts.findById(accountId)
                .orElseThrow(() -> new ReportTargetNotFoundException(ReportTargetType.USER, accountId));
    }

    private void requireUpdate(UUID updateId) {
        try {
            updates.requireReportable(updateId);
        } catch (ProjectUpdateNotFoundException e) {
            // Translated rather than propagated, for the reason the two below give: the
            // community module's advice is scoped to the community module's controllers,
            // so its exception escaping here would reach the fallback handler and become
            // a 500 on a safety endpoint.
            throw new ReportTargetNotFoundException(ReportTargetType.PROJECT_UPDATE, updateId);
        }
    }

    private void requireComment(UUID commentId) {
        try {
            comments.requireReportable(commentId);
        } catch (CommentNotFoundException e) {
            // Translated rather than propagated, for the reason above: the community
            // module's advice is scoped to the community module's controllers, so its
            // exception escaping here would reach the fallback handler and become a
            // 500 on a safety endpoint.
            throw new ReportTargetNotFoundException(ReportTargetType.COMMENT, commentId);
        }
    }
}
