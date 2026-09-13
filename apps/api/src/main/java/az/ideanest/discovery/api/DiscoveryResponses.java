package az.ideanest.discovery.api;

import az.ideanest.discovery.application.DiscoveryPage;
import az.ideanest.discovery.application.FacetCounts;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.ProjectCard;
import az.ideanest.discovery.domain.Suggestion;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.List;

/**
 * What the two discovery endpoints answer with.
 *
 * <p>Separate from the domain types so that a rename inside the module is not a
 * breaking API change, and so that the wire format is legible in one file. Same
 * reason as {@code project.api.ProjectEditResponses}.
 *
 * <p><strong>Null fields are absent, not null.</strong> The service sets
 * {@code spring.jackson.default-property-inclusion: non_null}, so a campaign with no
 * deadline has no {@code daysLeft} key at all and the last page has no
 * {@code nextCursor} key. Absence is the signal; a client must not distinguish it
 * from an explicit null.
 */
public final class DiscoveryResponses {

    private DiscoveryResponses() {
    }

    /**
     * @param items at most {@code limit}, in the requested order
     * @param nextCursor absent on the last page. <strong>A short page is not the end
     *     of the feed</strong> — only the absence of this is
     */
    public record Feed(List<Card> items, String nextCursor) {
    }

    /**
     * D-05's project card.
     *
     * @param completionPercent a string, to two places, rounded down. It is a ratio of
     *     two money values and is carried the way money is carried (§10.3): a JSON
     *     number here would be parsed into an IEEE 754 double by every mainstream
     *     client, at the one number a backer reads as "did it make it"
     * @param daysLeft absent when there is no deadline; zero once it has passed
     * @param badge one of §4.3's five status words, or absent for a state none of them
     *     covers — a cancelled campaign
     * @param state the internal state (§6.1), so a client can be specific without this
     *     module having to invent a sixth word
     * @param closingSoon §4.3's "Closing soon" (IDN-EXT-01): in the seven days after the first
     *     deadline, or fourteen days or fewer from the end of funding
     * @param extended §4.3's "Extended": the campaign was extended and is still funding
     */
    public record Card(
            String id,
            String slug,
            String creatorSlug,
            String title,
            Creator creator,
            Image image,
            Money goal,
            Money pledged,
            String completionPercent,
            int backersCount,
            Integer daysLeft,
            String badge,
            String state,
            Instant launchedAt,
            Instant deadline,
            boolean closingSoon,
            boolean extended) {
    }

    public record Creator(String name, String slug, String avatarUrl) {
    }

    public record Image(String url, int width, int height) {
    }

    /**
     * @param tags only tags with campaigns behind them; the vocabulary is free and
     *     unbounded
     * @param countries §4.3's Location control (#47): the ISO 3166-1 alpha-2 code as
     *     both the key and the label, because every client already has a localised
     *     country-name table and §21.1 says to use it
     * @param cities every place in the gazetteer, named in the negotiated language,
     *     including the ones at zero. Country and city are <strong>one</strong> facet
     *     dimension, as category and subcategory are, so both are counted with the
     *     whole Location filter — country, city and radius alike — excluded
     * @param programmes every open call the public may see, in the order
     *     {@code GET /v1/collections} lists them, including the ones at zero (#48)
     * @param showOnly §4.3's "Show only" control. One value, {@code featured}: the
     *     other two are per-caller or unbuilt and cannot be counted
     */
    public record Facets(
            List<ValueCount> status,
            List<CategoryCount> categories,
            List<NamedCount> tags,
            List<ValueCount> completion,
            List<ValueCount> goalAmount,
            List<ValueCount> amountRaised,
            List<NamedCount> countries,
            List<NamedCount> cities,
            List<NamedCount> programmes,
            List<ValueCount> showOnly) {
    }

    /**
     * D-02's autocomplete payload.
     *
     * <p>An object with one array rather than a bare array, for the reason every
     * other response here is an object: a top-level JSON array cannot grow a field.
     * When this needs to say how it matched, or to carry a request id, the clients
     * that already parse it do not have to change.
     *
     * @param items at most the requested limit, possibly empty. <strong>Empty is a
     *     result, not an error</strong> — it is what an unanswerable fragment gets
     */
    public record Suggestions(List<SuggestionItem> items) {
    }

    /**
     * @param kind {@code campaign}, {@code category}, {@code subcategory}, or
     *     {@code tag} — what to render this row as and where it leads
     * @param label what to show, in the negotiated language and with its diacritics
     * @param slug what to send back: a campaign's slug, a taxon's slug, a tag's slug
     * @param parentSlug what qualifies the slug — a subcategory's category, a
     *     campaign's creator (project URLs are {@code /{creatorSlug}/{projectSlug}}).
     *     Absent for a category and a tag, which need no qualification
     */
    public record SuggestionItem(String kind, String label, String slug, String parentSlug) {
    }

    public record ValueCount(String value, long count) {
    }

    public record NamedCount(String slug, String name, long count) {
    }

    public record CategoryCount(String slug, String name, long count, List<NamedCount> subcategories) {
    }

    public static Feed feed(DiscoveryPage page) {
        return new Feed(
                page.items().stream().map(DiscoveryResponses::card).toList(),
                page.nextCursor() == null ? null : page.nextCursor().encode());
    }

    public static Card card(ProjectCard card) {
        DiscoveryStatus badge = card.badge();
        return new Card(
                card.id().toString(),
                card.slug(),
                card.creatorSlug(),
                card.title(),
                new Creator(card.creator().name(), card.creator().slug(), card.creator().avatarUrl()),
                card.coverImage() == null
                        ? null
                        : new Image(
                                card.coverImage().url(),
                                card.coverImage().width(),
                                card.coverImage().height()),
                card.goal(),
                card.pledged(),
                card.completionPercent() == null ? null : card.completionPercent().toPlainString(),
                card.backersCount(),
                card.daysLeft(),
                badge == null ? null : badge.wireValue(),
                card.state(),
                card.launchedAt(),
                card.deadline(),
                card.closingSoon(),
                card.extended());
    }

    public static Facets facets(FacetCounts counts) {
        return new Facets(
                counts.statuses().stream().map(DiscoveryResponses::valueCount).toList(),
                counts.categories().stream()
                        .map(category -> new CategoryCount(
                                category.slug(),
                                category.name(),
                                category.count(),
                                category.subcategories().stream()
                                        .map(DiscoveryResponses::namedCount)
                                        .toList()))
                        .toList(),
                counts.tags().stream().map(DiscoveryResponses::namedCount).toList(),
                counts.completion().stream().map(DiscoveryResponses::valueCount).toList(),
                counts.goalAmount().stream().map(DiscoveryResponses::valueCount).toList(),
                counts.amountRaised().stream().map(DiscoveryResponses::valueCount).toList(),
                counts.countries().stream().map(DiscoveryResponses::namedCount).toList(),
                counts.cities().stream().map(DiscoveryResponses::namedCount).toList(),
                counts.programmes().stream().map(DiscoveryResponses::namedCount).toList(),
                counts.showOnly().stream().map(DiscoveryResponses::valueCount).toList());
    }

    public static Suggestions suggestions(List<Suggestion> suggestions) {
        return new Suggestions(suggestions.stream()
                .map(suggestion -> new SuggestionItem(
                        suggestion.kind().wireValue(),
                        suggestion.label(),
                        suggestion.slug(),
                        suggestion.parentSlug()))
                .toList());
    }

    private static ValueCount valueCount(FacetCounts.ValueCount count) {
        return new ValueCount(count.value(), count.count());
    }

    private static NamedCount namedCount(FacetCounts.NamedCount count) {
        return new NamedCount(count.slug(), count.name(), count.count());
    }
}
