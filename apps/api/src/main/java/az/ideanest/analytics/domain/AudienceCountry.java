package az.ideanest.analytics.domain;

import java.util.Locale;
import java.util.Optional;

/**
 * A visitor's country, as an ISO 3166-1 alpha-2 code — #633.
 *
 * <p>{@link #UNKNOWN} is {@code ZZ}, which ISO 3166 leaves to its users and the CLDR
 * uses for exactly this: an unknown region. Stored as a code like any other so that
 * "unknown" is a row a report can show — the owner asked for it to be shown — rather
 * than a NULL every query has to remember.
 */
public final class AudienceCountry {

    public static final String UNKNOWN = "ZZ";

    private AudienceCountry() {
    }

    /**
     * What Cloudflare's {@code CF-IPCountry} header says, when it says a country.
     *
     * <p>Cloudflare sends {@code XX} when it has no country for the address and
     * {@code T1} for Tor; neither is a country, so both are empty here and the caller
     * falls back to its own lookup. So is anything that is not two letters.
     */
    public static Optional<String> fromHeader(String header) {
        if (header == null) {
            return Optional.empty();
        }
        String code = header.trim().toUpperCase(Locale.ROOT);
        if (!code.matches("^[A-Z]{2}$") || "XX".equals(code) || UNKNOWN.equals(code)) {
            return Optional.empty();
        }
        return Optional.of(code);
    }

    /** A code from the GeoIP database, kept only when it is the shape a country code has. */
    public static Optional<String> fromLookup(String isoCode) {
        if (isoCode == null) {
            return Optional.empty();
        }
        String code = isoCode.trim().toUpperCase(Locale.ROOT);
        return code.matches("^[A-Z]{2}$") ? Optional.of(code) : Optional.empty();
    }
}
