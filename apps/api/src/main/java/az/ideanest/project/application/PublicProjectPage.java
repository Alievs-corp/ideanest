package az.ideanest.project.application;

import az.ideanest.project.domain.CoverImage;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * A campaign as its public page shows it — §4.4, and §10.2's
 * {@code GET /v1/projects/{creatorSlug}/{projectSlug}}.
 *
 * <p><strong>The projection {@code PrelaunchPageResponse} said it would not
 * pre-empt.</strong> That response is a teaser for a campaign that has not launched and
 * says so at length; this is the campaign itself, and it exists now because #119 needs
 * the page's content to be in the first byte of HTML rather than assembled by a browser.
 * A server render cannot fetch what no endpoint serves.
 *
 * <h2>What is here, and what has its own endpoint</h2>
 *
 * <p>This carries the campaign's own row and the two things that are useless without it:
 * who made it, and what it is filed under. Everything else on §4.4's page is already a
 * public endpoint of its own — {@code /rewards/public}, {@code /backers/public},
 * {@code /updates}, {@code /comments} — and folding them in here would produce one
 * response whose cost is decided by the longest comment thread on the platform, cached
 * for as long as the least cacheable part of it.
 *
 * <p><strong>The story is carried, and it is the reason this is not a card.</strong>
 * {@code discovery.domain.ProjectCard} is the same campaign for a grid; a page needs the
 * document the creator wrote, and a page that fetched its own body in a second request is
 * a page whose text is not in the HTML — which is the entire complaint #119 is about.
 *
 * <h2>The outcome</h2>
 *
 * <p>Null while the campaign is running, and V29's four frozen columns once it has
 * closed. It is what lets a closed campaign's page say "raised 12,500 ₼ of 10,000 ₼ from
 * 42 backers" months later, after collections have failed and {@link #pledged()} has
 * moved: #63's rule is that a later collection failure reduces the payout, never the
 * outcome, and a page that reported only the live total would quietly contradict the word
 * "successful" printed next to it.
 *
 * @param state one of §6.1's nine public states. By name, because every consumer of this
 *     projection is outside the module that owns the enum
 * @param goal null on a campaign that has not launched — §5.3 requires one by submission
 *     and {@code PRELAUNCH} precedes it
 * @param pledged never null; {@code projects.pledged_amount} is {@code NOT NULL DEFAULT 0}
 * @param story the creator's document, verbatim, as the JSON it is stored as. Opaque
 *     here: #35 owns its schema, and a projection that parsed it would be a second
 *     implementation of that schema in the read path
 * @param latePledgeEnabled §4.5's PL-16 (#81): whether this creator offers late pledges.
 *     On the public page because a visitor arriving after the deadline needs to know
 *     whether there is still a way to back this, and the campaign's state alone does not
 *     say it -- a campaign can be in LATE_PLEDGE with the switch turned off, which is a
 *     creator who ran out of stock
 * @param latePledgeEndsAt when the window closes, or null when none is open. The date a
 *     backer is counting down to, which is why it is published rather than left as
 *     something the checkout refuses them with
 * @param video the campaign's video when it has a ready one — issue #331. Null otherwise
 * @param outcome null until the deadline has been decided
 */
public record PublicProjectPage(
        UUID id,
        String slug,
        String state,
        String title,
        String blurb,
        Creator creator,
        Taxon category,
        Taxon subcategory,
        CoverImage cover,
        CampaignVideo video,
        Money goal,
        Money pledged,
        int backersCount,
        Instant launchedAt,
        Instant deadline,
        boolean latePledgeEnabled,
        Instant latePledgeEndsAt,
        String story,
        String risks,
        Outcome outcome) {

    /**
     * Who made the campaign.
     *
     * <p>Three fields, which is deliberately less than a profile: this is what §4.4's
     * header renders and what a link to the creator needs. The public profile projection
     * belongs to the profile epic, and a page that carried a bio here would be deciding
     * that projection's shape by accident — the mistake {@code PrelaunchPageResponse}
     * refused to make about this very endpoint.
     */
    public record Creator(String slug, String name, String avatarUrl) {
    }

    /**
     * A category or subcategory, named in the reader's language.
     *
     * <p>The name is resolved by the query, against the same chain {@link Taxonomy} uses
     * — requested locale, then {@code az}, then the slug. Two statements of one rule,
     * which {@code PublicProjectTaxonomyTests} checks against each other, and which is
     * the arrangement {@code DiscoveryStatus} already uses for its own partition.
     *
     * <p>Both are null on a campaign nobody has filed yet, which is every draft and some
     * pre-launch pages: §5.3 requires a category by submission and not before.
     */
    public record Taxon(String slug, String name) {
    }

    /**
     * §5.1's decision, as the page reports it.
     *
     * @param goal what the campaign had to raise, as it stood at the deadline
     * @param pledged what it had raised then. Not what was eventually collected
     * @param backersCount how many people were behind that total
     * @param finalisedAt when the campaign closed
     */
    public record Outcome(Money goal, Money pledged, int backersCount, Instant finalisedAt) {
    }
}
