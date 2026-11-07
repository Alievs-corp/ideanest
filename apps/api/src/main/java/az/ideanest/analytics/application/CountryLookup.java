package az.ideanest.analytics.application;

import java.util.Optional;

/**
 * Which country an address is in, as far as a GeoIP database knows — #633.
 *
 * <p>Asked only when Cloudflare did not say: the mobile apps reach the API directly and
 * carry no {@code CF-IPCountry}. Empty for an address the database does not place, for
 * a private or malformed one, and for every address when there is no database at all —
 * which is the state of a test run and of a local one, and must never be an error.
 */
public interface CountryLookup {

    /** @param address an IP literal; anything else is empty without a lookup */
    Optional<String> countryOf(String address);
}
