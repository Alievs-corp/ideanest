package az.ideanest.project.application;

import az.ideanest.project.domain.ProjectState;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * One campaign waiting on a moderator, as the queue screen needs it.
 *
 * <p>Deliberately not the campaign. A moderator working a queue is deciding which row
 * to open, not reading the story — so this carries what that decision is made on and
 * nothing else, and everything further is one navigation away on the campaign's own
 * page. The alternative, returning the full project, would put a story document and a
 * risks section into every row of a page of twenty-five.
 *
 * @param cursor the keyset position of this row, and the value a client passes as
 *     {@code after} to get the next page. The identifier of the transition that put
 *     the campaign in this state — see {@code SubmissionQueueRow} for why it is not
 *     the campaign's own
 * @param waitingSince when the campaign entered this state. The number the queue is
 *     really about: a campaign is not late because of anything it contains
 * @param note whatever was written on that transition, or null
 * @param creatorName the display name, resolved through {@code UserAccounts}. Null
 *     when the account has been deleted since — §17.4 anonymises rather than removes
 *     the campaign, so the row survives its author and says so rather than throwing
 * @param goal null only for a campaign that reached a decision before §5.3 required
 *     one; nothing in {@code SUBMITTED} can have a null goal
 * @param scheduledLaunchAt the launch time its creator set, or null. Approving a campaign whose
 *     time is still to come leaves it waiting for that time rather than publishing it (#595), and
 *     the moderator is told so before deciding
 */
public record SubmittedCampaign(
        UUID cursor,
        UUID projectId,
        String title,
        String slug,
        ProjectState state,
        Instant waitingSince,
        String note,
        UUID creatorId,
        String creatorName,
        String creatorSlug,
        Money goal,
        Instant scheduledLaunchAt) {
}
