package az.ideanest.project.api;

import az.ideanest.project.application.ProfileCampaign;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/**
 * A campaign as a card on somebody's profile, on the wire — §4.2's created and backed tabs.
 *
 * <p><strong>One record, used by two modules, declared here because {@code projects} is
 * this module's table.</strong> {@code GET /v1/users/{slug}/projects} is served from this
 * module and {@code GET /v1/users/{slug}/backed} from the pledge module, and they render
 * the same grid on the same page — a reader switching tabs must not find that a cover image
 * is called something else on one of them. Two records would be that difference waiting to
 * happen, and the second one to gain a field is the one nobody notices. The pledge module
 * imports this type, which is the direction {@code ModuleBoundaryTests} already permits and
 * {@code PublicBackers} already takes.
 *
 * <p><strong>Every amount is §10.3's {@code {"amount", "currency"}} object with a string
 * amount</strong>, because {@link Money} carries its own serialiser and there is therefore
 * no call site here that could produce a JSON number. On a card whose subject is how much a
 * campaign has raised, that is not a formality.
 *
 * <p><strong>Nulls are written out.</strong> {@code goal} is absent on a {@code PRELAUNCH}
 * campaign and {@code coverImage} on one nobody has illustrated, and a grid renderer that
 * could not tell an unset field from a key it failed to read would show a spinner where a
 * placeholder belongs. {@code ProjectPageResponse} omits its nulls and is right to — it
 * feeds one page where absent and empty mean the same thing — and this feeds a list where
 * the client branches on each field per row.
 *
 * <p><strong>No story, no risks, no taxonomy, no outcome.</strong> Those are the campaign
 * page's, they are already served by {@code GET /v1/projects/{creatorSlug}/{projectSlug}},
 * and a profile that carried them would fetch twenty story documents to render twenty
 * titles. The two slugs are here instead, which is how a client builds the link to that
 * page — the whole path, because one slug alone addresses nothing.
 *
 * @param state one of §6.1's states, by name. Nine of them on the two public tabs; a
 *     backer's own pledge list can carry any of the sixteen, which is deliberate and is
 *     argued in {@code ProfileCampaigns.ofAnyState}
 * @param pledged what the campaign has raised now, which on a closed campaign keeps moving
 *     as collections fail. The frozen outcome that does not is on the campaign page, and a
 *     card is not where somebody reads a final result
 * @param creatorSlug null only when the campaign's creator row could not be joined. The two
 *     public tabs exclude those rows rather than serving a half-built link
 * @param video the campaign's ready video, or null. When present a client shows
 *     {@code video.posterUrl} as the cover and plays the clip on hover or a long press;
 *     {@code coverImage} stays the uploaded cover
 * @param opensAt when an approved campaign opens on its own (#595), and null on every other
 *     state: a card is the creator's way to see that it is waiting rather than lost. The two
 *     public tabs never carry an approved campaign, so this is only ever set on the owner's list;
 *     absent rather than null, unlike the rest, so every other card keeps the shape it had
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProfileProjectCard(
        UUID id,
        String title,
        String slug,
        String creatorSlug,
        String blurb,
        String state,
        Money goal,
        Money pledged,
        int backersCount,
        Instant deadline,
        Instant launchedAt,
        CoverImageBody coverImage,
        CardVideoBody video,
        @JsonInclude(JsonInclude.Include.NON_NULL) Instant opensAt) {

    /**
     * @param campaign the projection. {@code createdAt} on it is deliberately not mapped:
     *     it is the key {@code ProfileCursor} pages on, and when a creator started drafting
     *     is a fact about their working habits rather than about the campaign
     */
    public static ProfileProjectCard of(ProfileCampaign campaign) {
        return new ProfileProjectCard(
                campaign.id(),
                campaign.title(),
                campaign.slug(),
                campaign.creatorSlug(),
                campaign.blurb(),
                campaign.state(),
                campaign.goal(),
                campaign.pledged(),
                campaign.backersCount(),
                campaign.deadline(),
                campaign.launchedAt(),
                cover(campaign.cover()),
                CardVideoBody.of(campaign.video()),
                opensAt(campaign));
    }

    private static Instant opensAt(ProfileCampaign campaign) {
        boolean waiting = "APPROVED".equals(campaign.state()) || "SCHEDULED".equals(campaign.state());
        return waiting ? campaign.scheduledLaunchAt() : null;
    }

    /**
     * The cover image, in the shape every other campaign response on this API uses.
     *
     * <p>{@link CoverImageBody#of} takes {@code project.domain.CoverImage} and cannot be
     * used: the projection deliberately carries its own three values so that it can cross
     * into the pledge module, which may not name this module's domain. See
     * {@code ProfileCampaign.Cover}.
     */
    private static CoverImageBody cover(ProfileCampaign.Cover cover) {
        /*
         * No media identifier: this projection carries three values so that it can cross a
         * module boundary, and adding a fourth would mean carrying a reference nothing on
         * this path can resolve. A card renders the URL and the box it reserves; the
         * placeholder belongs to the surfaces that read a campaign whole.
         */
        return cover == null ? null : new CoverImageBody(cover.url(), cover.width(), cover.height(), null);
    }
}
