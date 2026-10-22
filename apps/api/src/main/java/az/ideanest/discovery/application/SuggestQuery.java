package az.ideanest.discovery.application;

/**
 * What {@code GET /v1/search/suggest} was asked for. D-02.
 *
 * <p>Its own value rather than a {@link DiscoveryQuery}, because a suggestion is
 * not a narrowed feed: it has no filters, no sort, no cursor, and no facets, and
 * passing a fourteen-component query object to a method that reads three of them
 * would invite the other eleven to start meaning something here later.
 *
 * @param text what has been typed so far. <strong>A prefix, not a sentence</strong>
 *     — this is called on every keystroke by #46 — and unfolded, for the reason
 *     {@link DiscoveryQuery#text()} is
 * @param limit how many suggestions to return at most, already clamped into
 *     {@link #MIN_LIMIT}..{@link #MAX_LIMIT}
 * @param locale the negotiated language, which decides what a category is called
 * @param market the country the reader browses for (#533), or null for every country.
 *     Narrows the campaign suggestions only; a category is offered wherever it is
 */
public record SuggestQuery(String text, int limit, String locale, String market) {

    /**
     * Suggestions when the caller does not say.
     *
     * <p>Ten. A suggestion list is read with the eyes and dismissed with the
     * keyboard, and a list longer than a screenful is one nobody reaches the bottom
     * of; #46 has to be able to arrow through it without scrolling.
     */
    public static final int DEFAULT_LIMIT = 10;

    public static final int MIN_LIMIT = 1;

    /**
     * The ceiling.
     *
     * <p>Twenty, and far lower than the feed's hundred, because this endpoint is
     * called on every keystroke rather than every scroll: the same person browsing
     * one search box issues an order of magnitude more requests here than at
     * {@code /v1/discover}, and the response is rendered into a dropdown that has
     * no use for more.
     */
    public static final int MAX_LIMIT = 20;

    /** How short a fragment is worth suggesting from. See {@link #isAnswerable()}. */
    public static final int MIN_LENGTH = 2;

    public SuggestQuery {
        text = text == null || text.isBlank() ? null : text.trim();
        limit = Math.clamp(limit, MIN_LIMIT, MAX_LIMIT);
        locale = locale == null ? "az" : locale;
        market = market == null || market.isBlank() ? null : market.strip().toUpperCase(java.util.Locale.ROOT);
    }

    /**
     * Whether there is enough here to suggest from.
     *
     * <p><strong>A blank query suggests nothing, not everything.</strong> An empty
     * search box is the state every session starts in, and answering it with the
     * first ten campaigns in the table would make the platform issue that query to
     * every visitor who ever focuses the field — and would put a list under the
     * cursor of somebody who has not asked for one.
     *
     * <p>One character is refused for the same reason with a different arithmetic:
     * "a" is a prefix of a large fraction of everything, so the answer is both
     * expensive and useless. Two is where a prefix starts to mean something.
     */
    public boolean isAnswerable() {
        return text != null && text.length() >= MIN_LENGTH;
    }
}
