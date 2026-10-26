package az.ideanest.project.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * A campaign as a card on somebody's profile — §4.2's created and backed tabs.
 *
 * <p><strong>A third projection of {@code projects}, and the reason it is not one of the
 * two that exist is worth stating.</strong> {@link PublicProjectPage} is the campaign page
 * and carries the story document, the risks, the taxonomy and V29's frozen outcome; a grid
 * of twenty of those would fetch twenty story documents to render twenty titles.
 * {@code shared.project.ProjectSummary} is the other, and its own comment forbids exactly
 * this use: it is five fields on purpose, it is a published contract every implementation
 * must produce, and a caller that wanted the goal or the state from it "is asking for a
 * projection rather than a summary". This is that projection.
 *
 * <p><strong>The cover is a nested record rather than {@code project.domain.CoverImage},
 * and that is a module boundary rather than a preference.</strong> This projection is read
 * by the pledge module — {@code GET /v1/users/{slug}/backed} and {@code GET /v1/me/pledges}
 * are its endpoints and both render these cards — and {@code ModuleBoundaryTests} forbids
 * any module from naming another's {@code .domain}. A projection that carried the value
 * object would compile here and fail the boundary test over there, which is the same
 * argument {@code PublicProjects.PublicCampaign} makes about handing out a {@code Project}.
 *
 * <p><strong>{@code createdAt} is here and is never serialised.</strong> It is the
 * ordering key {@link ProfileCursor} pages on, so the service needs it to build the cursor
 * for the next page. It does not reach a client: when a campaign was drafted is a fact
 * about a creator's working habits, and {@code launchedAt} is the date a reader means when
 * they ask how old a campaign is.
 *
 * @param state one of §6.1's sixteen, by name. Nine of them on the public lists — see
 *     {@link ProfileCampaigns} — and any of the sixteen on a backer's own pledge list,
 *     which must still name a campaign trust and safety has stopped
 * @param goal null on a {@code PRELAUNCH} campaign, which is the one public state §5.3
 *     lets a campaign reach before it has a goal
 * @param pledged never null; {@code projects.pledged_amount} is {@code NOT NULL DEFAULT 0}
 * @param creatorSlug the campaign's half of a link needs the creator's half beside it —
 *     §10.2's public campaign page is {@code /projects/{creatorSlug}/{projectSlug}} and one
 *     slug alone addresses nothing. Null only when the creator row could not be joined,
 *     which {@link ProfileCampaigns#ofAnyState} explains and the two public reads exclude
 * @param cover null for a campaign with no cover image
 * @param video the campaign's ready video, or null. A client shows its poster as the
 *     card's cover and plays it on hover or a long press
 * @param scheduledLaunchAt the launch time its creator set, or null
 */
public record ProfileCampaign(
        UUID id,
        String slug,
        String creatorSlug,
        String title,
        String blurb,
        String state,
        Money goal,
        Money pledged,
        int backersCount,
        Instant launchedAt,
        Instant deadline,
        Instant createdAt,
        Instant scheduledLaunchAt,
        Cover cover,
        Video video) {

    /**
     * Where the cover image is, and how large it was measured.
     *
     * <p>The same three values {@code project.domain.CoverImage} holds, restated here
     * because this record crosses a module boundary and that one may not — see the class
     * comment. When §13's media pipeline replaces the three columns with a reference to a
     * {@code media} row, this record is what absorbs the change for every reader outside
     * this module.
     */
    public record Cover(String url, int width, int height) {
    }

    /** The video's addresses and frame, as much as a card previews. */
    public record Video(String url, String posterUrl, int width, int height) {
    }
}
