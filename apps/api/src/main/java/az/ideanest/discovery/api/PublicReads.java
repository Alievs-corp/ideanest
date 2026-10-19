package az.ideanest.discovery.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * The ETag machinery §10.3 asks for on a public read, in one place.
 *
 * <p>Extracted from {@link DiscoveryController} when {@link SearchController}
 * arrived: two controllers serving the same shapes with two copies of a digest is
 * two chances for one of them to hash a subset of what it serves, and a tag that
 * fails to change when the part it does not cover does is a client rendering last
 * minute's cards and never being told.
 *
 * <p>A digest over what is serialised, never {@code hashCode()}: a tag has to mean
 * the same thing to every instance of the service and to the same instance after a
 * restart, and nothing guarantees a record's hash does.
 */
final class PublicReads {

    /** ASCII unit separator, for the digest. Cannot occur in a slug, a uuid, or a number. */
    static final char FIELD_SEPARATOR = (char) 0x1f;

    /** ASCII record separator, so that a row boundary is not a field boundary. */
    static final char ROW_SEPARATOR = (char) 0x1e;

    private PublicReads() {
    }

    /**
     * A tag derived from the content, deterministically.
     *
     * <p>The locale is hashed first. Two languages of one response must not share a
     * tag, or a client that asked for one revalidates the other and is told 304.
     */
    static String etagOf(String locale, String content) {
        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // Every JVM ships SHA-256. Reaching here is not a runtime condition.
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        byte[] digest = sha256.digest((locale + FIELD_SEPARATOR + content).getBytes(StandardCharsets.UTF_8));
        return "\"" + HexFormat.of().formatHex(digest, 0, 8) + "\"";
    }

    static void append(StringBuilder canonical, String... fields) {
        for (String field : fields) {
            canonical.append(field).append(FIELD_SEPARATOR);
        }
        canonical.append(ROW_SEPARATOR);
    }

    /**
     * Everything in a feed that reaches the client, in a fixed order.
     *
     * <p>Every field, not a selection: a digest over a subset is a tag that fails to
     * change when the part it does not cover does.
     */
    static String canonical(DiscoveryResponses.Feed feed) {
        StringBuilder canonical = new StringBuilder();
        for (DiscoveryResponses.Card card : feed.items()) {
            appendCard(canonical, card);
        }
        append(canonical, feed.nextCursor());
        return canonical.toString();
    }

    /**
     * One card, in a fixed order.
     *
     * <p>Extracted when the collection landing page arrived (#48): it serves the same
     * cards, and two digests over one shape is one of them forgetting a field.
     */
    private static void appendCard(StringBuilder canonical, DiscoveryResponses.Card card) {
        append(canonical, card.id(), card.slug(), card.creatorSlug(), card.title(), card.state(), card.badge());
        append(
                canonical,
                card.creator().name(),
                card.creator().slug(),
                card.creator().avatarUrl());
        append(
                canonical,
                card.image() == null ? null : card.image().url(),
                card.image() == null ? null : String.valueOf(card.image().width()),
                card.image() == null ? null : String.valueOf(card.image().height()));
        append(
                canonical,
                card.video() == null ? null : card.video().url(),
                card.video() == null ? null : card.video().posterUrl(),
                card.video() == null ? null : String.valueOf(card.video().width()),
                card.video() == null ? null : String.valueOf(card.video().height()));
        append(
                canonical,
                card.goal() == null ? null : card.goal().amount().toPlainString(),
                card.goal() == null ? null : card.goal().currency(),
                card.pledged().amount().toPlainString(),
                card.pledged().currency(),
                card.completionPercent(),
                String.valueOf(card.backersCount()),
                String.valueOf(card.daysLeft()),
                String.valueOf(card.launchedAt()),
                String.valueOf(card.deadline()));
    }

    static String canonical(DiscoveryResponses.Facets facets) {
        StringBuilder canonical = new StringBuilder();
        appendCounts(canonical, facets.status());
        for (DiscoveryResponses.CategoryCount category : facets.categories()) {
            append(canonical, category.slug(), category.name(), String.valueOf(category.count()));
            for (DiscoveryResponses.NamedCount subcategory : category.subcategories()) {
                append(canonical, subcategory.slug(), subcategory.name(), String.valueOf(subcategory.count()));
            }
        }
        for (DiscoveryResponses.NamedCount tag : facets.tags()) {
            append(canonical, tag.slug(), tag.name(), String.valueOf(tag.count()));
        }
        appendCounts(canonical, facets.completion());
        appendCounts(canonical, facets.goalAmount());
        appendCounts(canonical, facets.amountRaised());
        for (DiscoveryResponses.NamedCount programme : facets.programmes()) {
            append(canonical, programme.slug(), programme.name(), String.valueOf(programme.count()));
        }
        appendCounts(canonical, facets.showOnly());
        return canonical.toString();
    }

    /**
     * Everything in the collections index that reaches the client.
     *
     * <p>{@code projectCount} is in here and it is the field that makes the tag move
     * most often: a campaign in a collection being suspended changes nothing else on
     * the page and changes that number, and a digest that skipped it would serve the
     * old count for the length of the cache window.
     */
    static String canonical(CollectionResponses.CollectionIndex index) {
        StringBuilder canonical = new StringBuilder();
        for (CollectionResponses.Collection collection : index.items()) {
            appendCollection(canonical, collection);
        }
        return canonical.toString();
    }

    /**
     * The gazetteer, both fields of every row.
     *
     * <p>The name is hashed as well as the slug, even though the slug alone identifies the
     * row. A translation being corrected changes only the name, and that is exactly the
     * edit a digest over identifiers would miss — it would serve the old spelling for an
     * hour, which is this response's whole cache window.
     */
    static String canonical(LocationResponses.LocationIndex index) {
        StringBuilder canonical = new StringBuilder();
        for (LocationResponses.Location location : index.items()) {
            append(canonical, location.slug(), location.name());
        }
        return canonical.toString();
    }

    /** The landing page: its header, then its cards, then where the next page starts. */
    static String canonical(CollectionResponses.CollectionPage page) {
        StringBuilder canonical = new StringBuilder();
        appendCollection(canonical, page.collection());
        for (DiscoveryResponses.Card card : page.items()) {
            appendCard(canonical, card);
        }
        append(canonical, page.nextCursor());
        return canonical.toString();
    }

    private static void appendCollection(StringBuilder canonical, CollectionResponses.Collection collection) {
        append(
                canonical,
                collection.id(),
                collection.slug(),
                collection.kind(),
                collection.title(),
                collection.description(),
                String.valueOf(collection.grantsBadge()),
                String.valueOf(collection.projectCount()),
                String.valueOf(collection.opensAt()),
                String.valueOf(collection.closesAt()));
        append(
                canonical,
                collection.image() == null ? null : collection.image().url(),
                collection.image() == null ? null : String.valueOf(collection.image().width()),
                collection.image() == null ? null : String.valueOf(collection.image().height()));
    }

    static String canonical(DiscoveryResponses.Suggestions suggestions) {
        StringBuilder canonical = new StringBuilder();
        for (DiscoveryResponses.SuggestionItem item : suggestions.items()) {
            append(canonical, item.kind(), item.label(), item.slug(), item.parentSlug());
        }
        return canonical.toString();
    }

    private static void appendCounts(StringBuilder canonical, Iterable<DiscoveryResponses.ValueCount> counts) {
        for (DiscoveryResponses.ValueCount count : counts) {
            append(canonical, count.value(), String.valueOf(count.count()));
        }
    }
}
