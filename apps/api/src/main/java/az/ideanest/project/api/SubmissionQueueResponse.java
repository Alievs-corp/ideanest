package az.ideanest.project.api;

import az.ideanest.project.application.SubmissionQueuePage;
import az.ideanest.project.application.SubmittedCampaign;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The submission queue, on the wire.
 *
 * <p>Shaped like {@code ReportQueueResponse} — the state, the rows, a cursor — because
 * it is read by the same screen family and a console with two paginated queues that
 * page differently is a console with two bugs waiting.
 *
 * @param state which state these are in, echoed back
 * @param submissions the campaigns, oldest first
 * @param nextCursor {@code after} for the next page, or null at the end
 */
public record SubmissionQueueResponse(String state, List<Submission> submissions, UUID nextCursor) {

    static SubmissionQueueResponse of(SubmissionQueuePage page) {
        return new SubmissionQueueResponse(
                page.state().name(), page.submissions().stream().map(Submission::of).toList(), page.nextCursor());
    }

    /**
     * One campaign waiting on a decision.
     *
     * @param cursor this row's keyset position, and what a client passes as
     *     {@code after} to continue from here
     * @param waitingSince when it entered this state. The queue is sorted by it, and it
     *     is what a moderator triages on — there is no other measure of "how late are
     *     we" that does not depend on what the campaign contains
     * @param note whatever was written on the transition into this state, or null
     * @param creatorName null when the account has been anonymised since. §17.4 leaves
     *     the campaign behind, so the row exists without an author, and a placeholder
     *     name would tell a moderator there is somebody to write to
     * @param goal amount as a string, per §10.3 — see {@link Money}
     */
    public record Submission(
            UUID cursor,
            UUID projectId,
            String title,
            String slug,
            String state,
            Instant waitingSince,
            String note,
            UUID creatorId,
            String creatorName,
            String creatorSlug,
            Money goal,
            Instant scheduledLaunchAt) {

        static Submission of(SubmittedCampaign campaign) {
            return new Submission(
                    campaign.cursor(),
                    campaign.projectId(),
                    campaign.title(),
                    campaign.slug(),
                    campaign.state().name(),
                    campaign.waitingSince(),
                    campaign.note(),
                    campaign.creatorId(),
                    campaign.creatorName(),
                    campaign.creatorSlug(),
                    campaign.goal(),
                    campaign.scheduledLaunchAt());
        }
    }
}
