package az.ideanest.discovery.application;

import az.ideanest.discovery.domain.AmountRange;
import az.ideanest.discovery.domain.CompletionBand;
import az.ideanest.discovery.domain.DiscoveryCapability;
import az.ideanest.discovery.domain.DiscoveryCursor;
import az.ideanest.discovery.domain.DiscoverySort;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.LocationFilter;
import az.ideanest.discovery.domain.ShowOnly;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

/**
 * Everything a caller asked discovery for, in one value.
 *
 * <p><strong>This is the input half of the §11.1 seam.</strong> Nothing on it is a
 * SQL fragment, a JDBC type, a Spring Data {@code Pageable}, or a column name, so an
 * implementation backed by a dedicated search engine reads the same object.
 *
 * <p><strong>Every filter composes with every other.</strong> The dimensions are
 * AND'd; within a dimension the rule depends on whether a campaign can hold one
 * value or several, and it is not a preference:
 *
 * <table>
 *   <caption>How multiple values within one dimension combine</caption>
 *   <tr><th>Dimension</th><th>Rule</th><th>Why</th></tr>
 *   <tr><td>Status</td><td>OR</td><td>a campaign is in one state</td></tr>
 *   <tr><td>Category, subcategory</td><td>OR</td><td>a campaign is filed in one place; AND would return nothing</td></tr>
 *   <tr><td>Completion, goal band, raised band</td><td>OR</td><td>the bands partition the line</td></tr>
 *   <tr><td>Programmes</td><td>OR</td><td>a campaign is in one open call; see below</td></tr>
 *   <tr><td><strong>Tags</strong></td><td><strong>AND</strong></td><td>a campaign carries several, and adding a tag is a refinement</td></tr>
 * </table>
 *
 * <p><strong>Programmes are OR'd rather than AND'd, unlike tags, and the reason is
 * the same reason.</strong> A tag is something a creator says about their campaign
 * and several are true at once, so ticking a second one refines. A programme is a
 * list somebody was accepted into; a campaign is normally in one, and requiring
 * membership of two open calls at once would return nothing for almost every pair —
 * the same dead end the category dimension avoids by OR'ing.
 *
 * <p>Tags are the only genuine choice there, and AND is the answer because of what
 * the control looks like. Every other filter in this set narrows when a second value
 * is ticked; a tag list that widened would be the one control on the page that moves
 * the count in the other direction, and a backer who ticked "handmade" and "ceramics"
 * meant campaigns that are both. The cost is that two unrelated tags return nothing,
 * which is visible and self-correcting, rather than a hundred irrelevant cards, which
 * is not.
 *
 * <p><strong>Adding a field is additive.</strong> The builder exists so that #43,
 * #44, #47 and #48 each add one component and one setter without touching each
 * other's lines or every call site. The corresponding rule for behaviour is
 * {@link DiscoveryCapability}: a field that is representable and not yet servable is
 * refused loudly by {@link SearchService}, never ignored.
 *
 * @param text free-text query (D-01), as the reader typed it — <strong>unfolded</strong>,
 *     because §11.3's fold belongs to the index and the query has to be folded the
 *     same way the index was, which is the database's job. Makes the whole filter
 *     and pagination machinery reusable by {@code GET /v1/search} without a second
 *     query object; refused by any implementation that does not declare
 *     {@link DiscoveryCapability#FULL_TEXT}
 * @param statuses §4.3's five words; empty means every publicly visible state
 * @param categorySlugs primary category slugs; empty means any
 * @param subcategorySlugs subcategory slugs; empty means any. Independent of
 *     {@code categorySlugs} and AND'd with it, so "games, and subcategory tabletop"
 *     and "subcategory tabletop" are both expressible
 * @param tagSlugs folded tag slugs, AND'd. See the table above
 * @param programmeSlugs §4.3's Programmes filter: the slugs of the open calls a
 *     campaign may be part of, OR'd. <strong>#48.</strong> A slug naming no open call
 *     matches nothing, exactly as an unknown category slug does — it is content, not
 *     a closed vocabulary, so a stale link is an empty feed rather than a 400
 * @param goal the {@code goal_amount} dimension
 * @param raised the {@code pledged_amount} dimension
 * @param completion §4.3's five completion bands, OR'd
 * @param location country, city, proximity. <strong>Served (#47).</strong> Country
 *     and city are one dimension for faceting, as category and subcategory are; the
 *     origin is quantised on the way in and is part of {@link #fingerprint()}, which
 *     is what pins it to the cursor. See {@link LocationFilter}
 * @param market the country the reader browses for (#533): only campaigns whose
 *     {@code countries} contain it, as an upper-case ISO 3166-1 alpha-2 code, or null for
 *     every country. Not {@code location}, which is where a campaign is; this is who it is
 *     for. Part of the fingerprint, because it decides which rows a page holds
 * @param showOnly saved, recommended, featured. <strong>Featured is served (#48);
 *     saved and recommended are still refused</strong>
 * @param sort one of §4.3's seven plus {@link DiscoverySort#BEST_MATCH}. When
 *     unstated it is {@link DiscoverySort#DEFAULT} while browsing and
 *     {@link DiscoverySort#DEFAULT_WITH_TEXT} while searching; the constructor
 *     resolves it, so this component is never null and the fingerprint and the
 *     cursor always name a real order
 * @param limit page size, already clamped into {@link #MIN_LIMIT}..{@link #MAX_LIMIT}
 * @param cursor where the previous page stopped, or null for the first page
 * @param locale the negotiated language, for facet labels. <strong>Deliberately not
 *     part of the fingerprint</strong> — switching language mid-scroll must not
 *     invalidate the cursor, because the order and the membership of the results do
 *     not depend on it
 */
public record DiscoveryQuery(
        String text,
        Set<DiscoveryStatus> statuses,
        Set<String> categorySlugs,
        Set<String> subcategorySlugs,
        Set<String> tagSlugs,
        Set<String> programmeSlugs,
        AmountRange goal,
        AmountRange raised,
        Set<CompletionBand> completion,
        LocationFilter location,
        String market,
        Set<ShowOnly> showOnly,
        DiscoverySort sort,
        int limit,
        DiscoveryCursor cursor,
        String locale) {

    /**
     * Cards per page when the caller does not say.
     *
     * <p>Twenty-four, which divides exactly by two, three, four, and six — every
     * column count the grid takes between a phone and a wide desktop — so a page
     * never ends in a half-filled row.
     */
    public static final int DEFAULT_LIMIT = 24;

    /** One card. Zero would be a request for nothing, which is a client bug. */
    public static final int MIN_LIMIT = 1;

    /**
     * The most a caller may ask for at once.
     *
     * <p>A hundred. The bound exists because the page size multiplies everything §20
     * budgets: a caller asking for ten thousand cards turns one request into a scan,
     * a sort, and a response body of several megabytes, and does it without needing
     * an account. Clamped rather than refused — a client that asked for more gets a
     * hundred and a working feed, which is the useful answer, and the ceiling is
     * documented so nobody builds against a larger one.
     */
    public static final int MAX_LIMIT = 100;

    public DiscoveryQuery {
        text = text == null || text.isBlank() ? null : text.trim();
        statuses = immutable(statuses, DiscoveryStatus.class);
        completion = immutable(completion, CompletionBand.class);
        showOnly = immutable(showOnly, ShowOnly.class);
        categorySlugs = slugs(categorySlugs);
        subcategorySlugs = slugs(subcategorySlugs);
        tagSlugs = slugs(tagSlugs);
        programmeSlugs = slugs(programmeSlugs);
        goal = goal == null ? AmountRange.ANY : goal;
        raised = raised == null ? AmountRange.ANY : raised;
        location = location == null ? LocationFilter.ANYWHERE : location;
        market = market == null || market.isBlank() ? null : market.strip().toUpperCase(Locale.ROOT);
        // An unstated sort means something different when there is a query to rank
        // by. See DiscoverySort.DEFAULT_WITH_TEXT: ordering search results by launch
        // date puts the campaign that mentions the word once in its ninth paragraph
        // above the one named after it.
        //
        // And the reverse: `sort=best_match` with nothing to match resolves back to
        // the browsing default, because a text score over no text is zero for every
        // campaign and the order would collapse to the tiebreaker. This is not the
        // "accepted and quietly ignored" failure DiscoveryCapability exists to
        // prevent — nothing is dropped, the request is simply underspecified and has
        // exactly one sensible reading.
        sort = sort == null
                ? (text == null ? DiscoverySort.DEFAULT : DiscoverySort.DEFAULT_WITH_TEXT)
                : sort;
        sort = sort == DiscoverySort.BEST_MATCH && text == null ? DiscoverySort.DEFAULT : sort;
        limit = Math.clamp(limit, MIN_LIMIT, MAX_LIMIT);
        locale = locale == null ? "az" : locale;
    }

    public static Builder builder() {
        return new Builder();
    }

    /** The same query, resuming after {@code cursor}. */
    public DiscoveryQuery withCursor(DiscoveryCursor next) {
        return new DiscoveryQuery(
                text, statuses, categorySlugs, subcategorySlugs, tagSlugs, programmeSlugs, goal, raised,
                completion, location, market, showOnly, sort, limit, next, locale);
    }

    /**
     * What this query needs an implementation to be able to do.
     *
     * <p>Everything the tier-1 implementation cannot serve is listed here rather than
     * discovered by an empty result set. The caller compares this with
     * {@link SearchService#capabilities()} and refuses the difference.
     */
    public Set<DiscoveryCapability> requiredCapabilities() {
        Set<DiscoveryCapability> required = EnumSet.noneOf(DiscoveryCapability.class);
        if (text != null) {
            required.add(DiscoveryCapability.FULL_TEXT);
        }
        sort.requiredCapability().ifPresent(required::add);
        if (!location.countries().isEmpty() || !location.cities().isEmpty()) {
            required.add(DiscoveryCapability.FILTER_LOCATION);
        }
        if (location.proximity() != null) {
            required.add(DiscoveryCapability.FILTER_PROXIMITY);
        }
        if (!programmeSlugs.isEmpty()) {
            required.add(DiscoveryCapability.FILTER_PROGRAMME);
        }
        for (ShowOnly only : showOnly) {
            required.add(only.requiredCapability());
        }
        return Collections.unmodifiableSet(required);
    }

    /**
     * A digest of everything that decides which campaigns are returned and in what
     * order, and of nothing else.
     *
     * <p>This is what a cursor is bound to. Replaying a {@code newest} cursor against
     * a {@code most_funded} query, or against the same sort with one more tag ticked,
     * would resume from a key that means something different in the new ordering and
     * return a page of nonsense — so it is refused, and this is the value that
     * catches it.
     *
     * <p><strong>{@code limit}, {@code cursor}, and {@code locale} are excluded, each
     * on purpose.</strong> A client that changes its page size mid-scroll is doing
     * something legitimate and the keyset stays valid. The cursor cannot fingerprint
     * itself. And the language changes the labels on facets, never the membership or
     * the order of the results.
     *
     * <p>Sets are written in sorted order rather than iteration order, so that two
     * clients sending the same filters in different orders share a fingerprint — and
     * therefore share a cursor and a cache entry — rather than being told their
     * cursors do not match.
     */
    public String fingerprint() {
        List<String> parts = new ArrayList<>();
        parts.add("v1");
        parts.add(text == null ? "" : text.toLowerCase(Locale.ROOT));
        parts.add(sorted(statuses.stream().map(DiscoveryStatus::wireValue).toList()));
        parts.add(sorted(categorySlugs));
        parts.add(sorted(subcategorySlugs));
        parts.add(sorted(tagSlugs));
        parts.add(sorted(programmeSlugs));
        parts.add(amount(goal));
        parts.add(amount(raised));
        parts.add(sorted(completion.stream().map(CompletionBand::wireValue).toList()));
        parts.add(sorted(location.countries()));
        parts.add(sorted(location.cities()));
        // The origin, canonically (#47). This is what pins it: every distance on a
        // near-me feed is measured from this point, so a client whose location moved
        // between page one and page two would resume a keyset from a key that no
        // longer picks out the row it was written for. Including it here makes that a
        // DISCOVERY_CURSOR_MISMATCH and a restart rather than a silently reshuffled
        // scroll — the same protection #42 gave the decay clock and #44 gave the
        // ranking weights. See LocationFilter.Proximity.canonical.
        parts.add(location.proximity() == null ? "" : location.proximity().canonical());
        parts.add(sorted(showOnly.stream().map(ShowOnly::wireValue).toList()));
        parts.add(sort.wireValue());
        parts.add(market == null ? "" : market);

        // A separator that cannot occur in a slug, a wire value, or a decimal, so
        // that ["ab", "c"] and ["a", "bc"] cannot digest to the same value.
        String canonical = String.join(String.valueOf((char) 0x1f), parts);
        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // Every JVM ships SHA-256. Reaching here is not a runtime condition.
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        byte[] digest = sha256.digest(canonical.getBytes(StandardCharsets.UTF_8));
        // Sixty-four bits. This is a consistency check against a client's own
        // previous request, not a defence against a collision somebody searched for.
        return HexFormat.of().formatHex(digest, 0, 8);
    }

    private static String amount(AmountRange range) {
        return sorted(range.bands().stream().map(band -> band.wireValue()).toList())
                + "|"
                + (range.minInclusive() == null ? "" : range.minInclusive().toPlainString())
                + "|"
                + (range.maxInclusive() == null ? "" : range.maxInclusive().toPlainString());
    }

    private static String sorted(java.util.Collection<String> values) {
        return String.join(",", new TreeSet<>(values));
    }

    private static <E extends Enum<E>> Set<E> immutable(Set<E> values, Class<E> type) {
        return values == null || values.isEmpty()
                ? Collections.unmodifiableSet(EnumSet.noneOf(type))
                : Collections.unmodifiableSet(EnumSet.copyOf(values));
    }

    private static Set<String> slugs(Set<String> values) {
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        Set<String> cleaned = new LinkedHashSet<>();
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                // Slugs are lower case everywhere in the schema. Folding here means
                // a client that upper-cased one is answered rather than told nothing
                // matched.
                cleaned.add(value.trim().toLowerCase(Locale.ROOT));
            }
        }
        return Set.copyOf(cleaned);
    }

    /**
     * Builds a query field by field.
     *
     * <p>Not a convenience. A record with fourteen components has a constructor
     * nobody can call correctly twice, and every issue that adds a component to it
     * would otherwise have to edit every construction site — which, with four issues
     * of this epic in flight at once, is four branches conflicting in the same lines.
     */
    public static final class Builder {

        private String text;
        private Set<DiscoveryStatus> statuses = Set.of();
        private Set<String> categorySlugs = Set.of();
        private Set<String> subcategorySlugs = Set.of();
        private Set<String> tagSlugs = Set.of();
        private Set<String> programmeSlugs = Set.of();
        private AmountRange goal = AmountRange.ANY;
        private AmountRange raised = AmountRange.ANY;
        private Set<CompletionBand> completion = Set.of();
        private LocationFilter location = LocationFilter.ANYWHERE;
        private String market;
        private Set<ShowOnly> showOnly = Set.of();
        // Null rather than DEFAULT, and it matters: the record resolves an unstated
        // sort against whether there is text to rank by, and a builder that filled
        // in NEWEST here would make that resolution unreachable for every caller
        // that did not name a sort — which is every caller that is searching.
        private DiscoverySort sort;
        private int limit = DEFAULT_LIMIT;
        private DiscoveryCursor cursor;
        private String locale = "az";

        private Builder() {
        }

        public Builder text(String value) {
            this.text = value;
            return this;
        }

        public Builder statuses(Set<DiscoveryStatus> value) {
            this.statuses = value;
            return this;
        }

        public Builder categorySlugs(Set<String> value) {
            this.categorySlugs = value;
            return this;
        }

        public Builder subcategorySlugs(Set<String> value) {
            this.subcategorySlugs = value;
            return this;
        }

        public Builder tagSlugs(Set<String> value) {
            this.tagSlugs = value;
            return this;
        }

        public Builder programmeSlugs(Set<String> value) {
            this.programmeSlugs = value;
            return this;
        }

        public Builder goal(AmountRange value) {
            this.goal = value;
            return this;
        }

        public Builder raised(AmountRange value) {
            this.raised = value;
            return this;
        }

        public Builder completion(Set<CompletionBand> value) {
            this.completion = value;
            return this;
        }

        public Builder location(LocationFilter value) {
            this.location = value;
            return this;
        }

        public Builder market(String value) {
            this.market = value;
            return this;
        }

        public Builder showOnly(Set<ShowOnly> value) {
            this.showOnly = value;
            return this;
        }

        public Builder sort(DiscoverySort value) {
            this.sort = value;
            return this;
        }

        public Builder limit(int value) {
            this.limit = value;
            return this;
        }

        public Builder cursor(DiscoveryCursor value) {
            this.cursor = value;
            return this;
        }

        public Builder locale(String value) {
            this.locale = value;
            return this;
        }

        public DiscoveryQuery build() {
            return new DiscoveryQuery(
                    text, statuses, categorySlugs, subcategorySlugs, tagSlugs, programmeSlugs, goal, raised,
                    completion, location, market, showOnly, sort, limit, cursor, locale);
        }
    }
}
