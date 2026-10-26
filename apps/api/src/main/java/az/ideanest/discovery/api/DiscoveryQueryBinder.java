package az.ideanest.discovery.api;

import az.ideanest.discovery.application.DiscoveryQuery;
import az.ideanest.discovery.application.UnknownFilterValueException;
import az.ideanest.discovery.domain.AmountBand;
import az.ideanest.discovery.domain.AmountRange;
import az.ideanest.discovery.domain.CompletionBand;
import az.ideanest.discovery.domain.DiscoveryCursor;
import az.ideanest.discovery.domain.DiscoverySort;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.LocationFilter;
import az.ideanest.discovery.domain.ShowOnly;
import az.ideanest.shared.Slugs;
import java.math.BigDecimal;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.springframework.util.MultiValueMap;

/**
 * Turns a query string into a {@link DiscoveryQuery}.
 *
 * <p>Written by hand rather than bound by Spring, for two reasons. Spring's binder
 * answers an unparseable enum with a 400 whose body names a Java type and a field
 * path, which is not something a client can act on and not the RFC 9457 shape §10.4
 * requires; and every multi-valued filter here has to accept both
 * {@code ?tag=a&tag=b} and {@code ?tag=a,b}, because D-12 makes filter URLs shareable
 * and a shared URL is the comma form.
 *
 * <p><strong>Unknown values from a closed vocabulary are refused; unknown slugs are
 * not.</strong> See {@link UnknownFilterValueException}.
 */
final class DiscoveryQueryBinder {

    /** Every ISO 3166-1 alpha-2 code, the vocabulary of {@code market} and of a campaign's countries. */
    private static final Set<String> COUNTRIES = Locale.getISOCountries(Locale.IsoCountryCode.PART1_ALPHA2);

    /**
     * The longest search text a query carries, in characters (#587).
     *
     * <p>Two hundred is several sentences, far beyond anything typed into a search box, and
     * the text goes into a full-text parse and a trigram match on every request, where a
     * query string of tens of kilobytes is work an anonymous caller could buy for free.
     * Longer text is cut rather than refused: a refusal would have to echo the value, and a
     * pasted paragraph is better answered on its first two hundred characters than not at all.
     */
    static final int MAX_TEXT_LENGTH = 200;

    private DiscoveryQueryBinder() {
    }

    /**
     * {@code q}, cut to {@link #MAX_TEXT_LENGTH}. Never inside a surrogate pair, so an emoji
     * on the boundary is dropped whole rather than leaving half a character to the parser.
     */
    static String text(String raw) {
        if (raw == null || raw.length() <= MAX_TEXT_LENGTH) {
            return raw;
        }
        int end = MAX_TEXT_LENGTH;
        if (Character.isHighSurrogate(raw.charAt(end - 1))) {
            end--;
        }
        return raw.substring(0, end);
    }

    /**
     * {@code market}: the country the reader browses for (#533), or null for every country.
     *
     * <p>Refused when it is not a country rather than read as "every country": a reader who
     * chose Georgia and was shown the world because a code was mistyped would not know it.
     */
    static String market(MultiValueMap<String, String> parameters) {
        return market(single(parameters, "market"));
    }

    static String market(String market) {
        if (market == null || market.isBlank()) {
            return null;
        }
        String code = market.strip().toUpperCase(Locale.ROOT);
        if (!COUNTRIES.contains(code)) {
            throw new UnknownFilterValueException("market", market, List.of());
        }
        return code;
    }

    static DiscoveryQuery bind(MultiValueMap<String, String> parameters, String locale) {
        DiscoveryQuery.Builder builder = DiscoveryQuery.builder()
                .locale(locale)
                .text(text(single(parameters, "q")))
                .statuses(closedSet(parameters, "status", DiscoveryStatus::fromWireValue, DiscoveryStatus.wireValues()))
                .categorySlugs(openSet(parameters, "category"))
                .subcategorySlugs(openSet(parameters, "subcategory"))
                .tagSlugs(openSet(parameters, "tag"))
                // §4.3's Programmes. An open vocabulary like `category` and `tag`
                // and for the same reason: the slugs are content the platform's own
                // curators create, so a link shared after a programme was renamed
                // gets an empty feed rather than a 400. Singular and comma-separable
                // like every other multi-valued filter here.
                .programmeSlugs(openSet(parameters, "programme"))
                .completion(closedSet(parameters, "completion", CompletionBand::fromWireValue, CompletionBand.wireValues()))
                .goal(amountRange(parameters, "goalBand", "goalMin", "goalMax"))
                .raised(amountRange(parameters, "raisedBand", "raisedMin", "raisedMax"))
                .location(location(parameters))
                .market(market(parameters))
                .showOnly(closedSet(parameters, "showOnly", ShowOnly::fromWireValue, ShowOnly.wireValues()));

        String sort = single(parameters, "sort");
        if (sort != null) {
            // `isClientSelectable` filters out DiscoverySort.CURATED, which names the
            // order the collection landing page is served in and means nothing here:
            // outside a collection there is no curator and no position. Refused by the
            // same path as a misspelt sort, with the same list of what is accepted, so
            // it is not a special error a client has to learn about.
            builder.sort(DiscoverySort.fromWireValue(sort)
                    .filter(DiscoverySort::isClientSelectable)
                    .orElseThrow(() -> new UnknownFilterValueException("sort", sort, DiscoverySort.wireValues())));

            // #47. `sort=near_me` needs somewhere to be near. Refused rather than
            // resolved back to the browsing default, unlike `best_match` with no `q`:
            // a text score over no text is zero for every campaign and the request has
            // one sensible reading, whereas a distance from no origin is undefined and
            // a "near me" control that quietly meant "newest" is exactly the
            // accepted-and-ignored failure DiscoveryCapability exists to prevent.
            //
            // Reported against `near` rather than against `sort`, because `near` is the
            // parameter that is missing and `near_me` is a perfectly good sort.
            if (DiscoverySort.NEAR_ME.wireValue().equals(sort) && single(parameters, "near") == null) {
                throw new UnknownFilterValueException("near", "(absent)", List.of("lat,lon"));
            }
        }

        String limit = single(parameters, "limit");
        if (limit != null) {
            try {
                // Clamped by DiscoveryQuery rather than refused here: a client asking
                // for two hundred cards wants a page, and giving it a hundred is more
                // useful than giving it an error. A limit that is not a number is a
                // different thing and is refused.
                builder.limit(Integer.parseInt(limit.trim()));
            } catch (NumberFormatException e) {
                throw new UnknownFilterValueException("limit", limit, List.of());
            }
        }

        String cursor = single(parameters, "cursor");
        if (cursor != null) {
            // Decoded here so that a malformed cursor fails before a query runs.
            // Whether it belongs to *this* query is checked by the search service,
            // which is the only thing that knows the fingerprint.
            builder.cursor(DiscoveryCursor.decode(cursor));
        }

        return builder.build();
    }

    /**
     * §4.3's Location filter: country, city, and proximity (#47).
     *
     * <p><strong>City is folded here, not compared here.</strong> {@code locations.slug}
     * is §11.3's folded comparable form of a place name — the same form
     * {@code Slugs.slugify} produces and the same one {@code tags.slug} holds — so
     * {@code ?city=Bakı}, {@code ?city=Baku} and {@code ?city=baki} are one filter
     * rather than three. Folding in Java and comparing against a stored fold, rather
     * than folding both sides in SQL, is what lets the comparison be an equality
     * against an indexed column.
     *
     * <p><strong>The slug, not the exonym.</strong> {@code ?city=Bakı} works because
     * the fold takes it to {@code baki}; {@code ?city=Baku} does not, because "Baku" is
     * a different word in a different language rather than a spelling of the same one.
     * That is the same contract {@code category} and {@code programme} have — the value
     * is a handle and the facet panel is where a client gets it — and the alternative,
     * matching {@code location_translations} too, would make the set of accepted values
     * change every time somebody added a translation.
     *
     * <p>An open vocabulary, like {@code category} and {@code tag}: a country or city
     * that names nothing is an empty feed rather than a 400, because a shared link
     * (D-12) outlives the gazetteer it was written against.
     */
    private static LocationFilter location(MultiValueMap<String, String> parameters) {
        Set<String> cities = new LinkedHashSet<>();
        for (String city : openSet(parameters, "city")) {
            String slug = Slugs.slugify(city);
            if (!slug.isEmpty()) {
                cities.add(slug);
            }
        }
        return new LocationFilter(openSet(parameters, "country"), cities, proximity(parameters));
    }

    /**
     * {@code near=lat,lon} and {@code radiusKm}, or null.
     *
     * <p>One parameter for the point rather than two, because a latitude without a
     * longitude is not half a request — it is a request that cannot be answered, and
     * two independent parameters make that a state the binder has to check for rather
     * than one it cannot represent. Comma-separated because that is the form every
     * geographic API uses and the form a shared URL (D-12) reads legibly in.
     *
     * <p>Parsed as {@code BigDecimal}, never {@code Double.parseDouble}, for the reason
     * the money bounds are: the value ends up as a keyset sort key compared for exact
     * equality. The quantisation, the range checks and the radius bound all live on
     * {@code LocationFilter.Proximity}, so they apply however the record is built; this
     * method only turns the refusal into the RFC 9457 shape §10.4 requires.
     */
    private static LocationFilter.Proximity proximity(MultiValueMap<String, String> parameters) {
        String near = single(parameters, "near");
        String radius = single(parameters, "radiusKm");
        if (near == null) {
            // A radius with nothing to be a radius of. Refused rather than dropped: a
            // client that sent one believes it narrowed the feed.
            if (radius != null) {
                throw new UnknownFilterValueException("near", "(absent)", List.of("lat,lon"));
            }
            return null;
        }
        String[] parts = near.split(",", -1);
        if (parts.length != 2) {
            throw new UnknownFilterValueException("near", near, List.of("lat,lon"));
        }
        try {
            return new LocationFilter.Proximity(
                    new BigDecimal(parts[0].trim()),
                    new BigDecimal(parts[1].trim()),
                    radius == null ? null : new BigDecimal(radius.trim()));
        } catch (NumberFormatException e) {
            throw new UnknownFilterValueException("near", near, List.of("lat,lon"));
        } catch (IllegalArgumentException e) {
            // A latitude past a pole, a longitude past the antimeridian, or a radius
            // that is not positive or is past the bound. The message from the record
            // says which; the parameter is whichever of the two the value came from.
            String parameter = radius != null && e.getMessage().contains("radius") ? "radiusKm" : "near";
            throw new UnknownFilterValueException(parameter, "radiusKm".equals(parameter) ? radius : near, List.of());
        }
    }

    /**
     * Values of a closed vocabulary the API defines.
     *
     * @param known what a value maps to, or empty when it is not one of them
     * @param allowed every accepted value, for the error body
     */
    private static <E extends Enum<E>> Set<E> closedSet(
            MultiValueMap<String, String> parameters,
            String parameter,
            Function<String, Optional<E>> known,
            List<String> allowed) {

        Set<String> raw = openSet(parameters, parameter);
        if (raw.isEmpty()) {
            return Set.of();
        }
        Set<E> values = new LinkedHashSet<>();
        for (String value : raw) {
            values.add(known.apply(value)
                    .orElseThrow(() -> new UnknownFilterValueException(parameter, value, allowed)));
        }
        return values.isEmpty() ? Set.of() : EnumSet.copyOf(values);
    }

    /**
     * Values of an open vocabulary the platform's content defines — slugs.
     *
     * <p>Accepts repetition and comma separation, and both at once. Blank entries are
     * dropped rather than refused: {@code ?tag=} is what a client sends when its
     * filter control is empty, and a 400 for it would make an empty filter an error.
     */
    private static Set<String> openSet(MultiValueMap<String, String> parameters, String parameter) {
        List<String> values = parameters.get(parameter);
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        Set<String> result = new LinkedHashSet<>();
        for (String value : values) {
            if (value == null) {
                continue;
            }
            for (String part : value.split(",")) {
                String trimmed = part.trim();
                if (!trimmed.isEmpty()) {
                    result.add(trimmed);
                }
            }
        }
        return result;
    }

    private static AmountRange amountRange(
            MultiValueMap<String, String> parameters, String bandParameter, String minParameter, String maxParameter) {
        Set<AmountBand> bands =
                closedSet(parameters, bandParameter, AmountBand::fromWireValue, AmountBand.wireValues());
        BigDecimal min = amount(parameters, minParameter);
        BigDecimal max = amount(parameters, maxParameter);
        try {
            return new AmountRange(bands, min, max);
        } catch (IllegalArgumentException e) {
            // A minimum above the maximum, or a negative bound. Reported against the
            // pair rather than against one of them, because neither is wrong alone.
            throw new UnknownFilterValueException(minParameter + "/" + maxParameter, min + ".." + max, List.of());
        }
    }

    /**
     * A money bound, as a string.
     *
     * <p>§10.3 and {@code CLAUDE.md}: money crosses the wire as a string and is
     * {@code BigDecimal} inside. A filter bound is money — it is compared against
     * {@code goal_amount} — so it is parsed the same way, and never through
     * {@code Double.parseDouble}, which would put a campaign on the wrong side of a
     * boundary it sits exactly on.
     */
    private static BigDecimal amount(MultiValueMap<String, String> parameters, String parameter) {
        String value = single(parameters, parameter);
        if (value == null) {
            return null;
        }
        try {
            return new BigDecimal(value.trim());
        } catch (NumberFormatException e) {
            throw new UnknownFilterValueException(parameter, value, List.of());
        }
    }

    /** The first value, or null. A repeated single-valued parameter takes the first. */
    private static String single(MultiValueMap<String, String> parameters, String parameter) {
        String value = parameters.getFirst(parameter);
        return value == null || value.isBlank() ? null : value;
    }
}
