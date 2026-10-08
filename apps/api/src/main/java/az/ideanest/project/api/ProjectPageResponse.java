package az.ideanest.project.api;

import az.ideanest.project.application.PublicProjectPage;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * A campaign as its public page, on the wire — §10.2's
 * {@code GET /v1/projects/{creatorSlug}/{projectSlug}}.
 *
 * <p>Every amount is §10.3's {@code {"amount", "currency"}} object with a string amount,
 * because {@link Money} carries its own serialiser and there is therefore no call site
 * here that could produce a JSON number. On a page whose whole subject is how much money
 * a campaign has raised, that is not a formality.
 *
 * <p>Nulls are omitted, as on {@link PrelaunchPageResponse} and for its reason: this
 * response feeds a page rather than a form, so "absent" and "empty" mean the same thing
 * to its reader. It matters most for {@code outcome}, which is absent on every campaign
 * that is still running — a client that has to distinguish "not decided" from "decided
 * badly" does so by the key being there.
 *
 * @param state one of §6.1's nine public states, by name. A client renders a countdown, a
 *     "funded" badge or an archive notice from this and from nothing else
 * @param goal null on a pre-launch page, which is the one public state a campaign reaches
 *     before §5.3 requires one
 * @param pledged what the campaign has raised <em>now</em>. On a closed campaign this
 *     keeps moving as collections fail; {@code outcome} is what does not
 * @param story the creator's document as JSON, not as a string containing JSON — see
 *     {@link #of}
 * @param outcome §5.1's decision and the numbers that produced it, once the deadline has
 *     passed. Absent while the campaign is running
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProjectPageResponse(
        UUID id,
        String slug,
        String state,
        String title,
        String blurb,
        Creator creator,
        Taxon category,
        Taxon subcategory,
        CoverImageBody coverImage,
        CampaignVideoBody video,
        Money goal,
        Money pledged,
        int backersCount,
        Instant launchedAt,
        Instant deadline,
        boolean latePledgeEnabled,
        Instant latePledgeEndsAt,
        JsonNode story,
        String risks,
        Outcome outcome) {

    /** Who made it. Three fields; {@code PublicProjectPage.Creator} says why not more. */
    public record Creator(String slug, String name, String avatarUrl) {
    }

    /** What it is filed under, named in the reader's language. */
    public record Taxon(String slug, String name) {
    }

    /** §5.1's frozen decision. {@code finalisedAt} is when, not when this was read. */
    public record Outcome(Money goal, Money pledged, int backersCount, Instant finalisedAt) {
    }

    /**
     * @param story the parsed document, or null when the campaign has none. Parsed by the
     *     caller rather than here, because a record's factory should not be the thing
     *     that holds an {@code ObjectMapper} — {@code ProjectEditResponses} makes the same
     *     split for the same field, and the reason it is a parse at all is there: the
     *     column is {@code jsonb}, the projection holds it as text, and returning the text
     *     would put an escaped document in the response for every client to parse twice
     */
    public static ProjectPageResponse of(PublicProjectPage page, JsonNode story) {
        return new ProjectPageResponse(
                page.id(),
                page.slug(),
                page.state(),
                page.title(),
                page.blurb(),
                new Creator(
                        page.creator().slug(),
                        page.creator().name(),
                        page.creator().avatarUrl()),
                taxon(page.category()),
                taxon(page.subcategory()),
                CoverImageBody.of(page.cover()),
                CampaignVideoBody.of(page.video()),
                page.goal(),
                page.pledged(),
                page.backersCount(),
                page.launchedAt(),
                page.deadline(),
                page.latePledgeEnabled(),
                page.latePledgeEndsAt(),
                story,
                page.risks(),
                outcome(page.outcome()));
    }

    private static Taxon taxon(PublicProjectPage.Taxon taxon) {
        return taxon == null ? null : new Taxon(taxon.slug(), taxon.name());
    }

    private static Outcome outcome(PublicProjectPage.Outcome outcome) {
        return outcome == null
                ? null
                : new Outcome(outcome.goal(), outcome.pledged(), outcome.backersCount(), outcome.finalisedAt());
    }
}
