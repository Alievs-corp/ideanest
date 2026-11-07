package az.ideanest.analytics.infrastructure;

import az.ideanest.analytics.AudienceAnalyticsProperties;
import az.ideanest.analytics.application.CountryLookup;
import az.ideanest.analytics.domain.AudienceCountry;
import com.maxmind.db.MaxMindDbConstructor;
import com.maxmind.db.MaxMindDbParameter;
import com.maxmind.db.Reader;
import jakarta.annotation.PreDestroy;
import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * {@link CountryLookup} over DB-IP's "IP to Country Lite" database — #633.
 *
 * <p>The file is DB-IP's free monthly release (CC BY 4.0; the attribution is on the
 * legal page), in MaxMind's format, downloaded by the Dockerfile at build time to the
 * path {@code ideanest.analytics.audience.geoip-database} names. It is read once at
 * start-up into the heap -- about 9 MB -- rather than memory-mapped: a mapped file that
 * fails to parse stays mapped (and, on Windows, locked) until the collector finds it,
 * and the copy costs nothing worth saving. The reader is thread-safe and a lookup is a
 * few microseconds of tree walk.
 *
 * <p><strong>Optional, and that is the contract rather than a fallback.</strong> No
 * file, an unreadable file or a corrupt one is one WARN at start-up and every lookup
 * answering "unknown" afterwards. A country is a dimension of a statistic; the API not
 * starting because a monthly download failed would trade every request for it.
 *
 * <p><strong>No address ever leaves for a DNS lookup.</strong> {@link InetAddress#getByName}
 * resolves anything that is not an IP literal, so the address is checked to be one
 * first — a header can carry any string, and resolving it would make every event a
 * request to somebody's name server.
 */
@Component
public class DbIpCountryLookup implements CountryLookup {

    private static final Logger log = LoggerFactory.getLogger(DbIpCountryLookup.class);

    private static final Pattern IPV4 = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}$");

    /** An IPv6 literal always has a colon, which no host name can, and only these characters. */
    private static final Pattern IPV6 = Pattern.compile("^[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*$");

    private final Reader reader;

    public DbIpCountryLookup(AudienceAnalyticsProperties properties) {
        this.reader = open(properties.geoipDatabase());
    }

    static Reader open(String path) {
        if (path == null || path.isBlank()) {
            log.info("No GeoIP database is configured; audience countries come only from CF-IPCountry");
            return null;
        }
        File file = new File(path);
        if (!file.isFile() || !file.canRead()) {
            log.warn("The GeoIP database {} is not there; audience countries come only from CF-IPCountry", path);
            return null;
        }
        try {
            Reader opened = new Reader(file, Reader.FileMode.MEMORY);
            log.info("GeoIP database {} loaded ({}, built {})",
                    path, opened.getMetadata().databaseType(), opened.getMetadata().buildTime());
            return opened;
        } catch (IOException | RuntimeException exception) {
            log.warn("The GeoIP database {} could not be read; audience countries come only from CF-IPCountry",
                    path, exception);
            return null;
        }
    }

    /** Whether a database was loaded. For the health of the feature, not for a decision. */
    public boolean isLoaded() {
        return reader != null;
    }

    @Override
    public Optional<String> countryOf(String address) {
        if (reader == null || address == null || !isIpLiteral(address)) {
            return Optional.empty();
        }
        try {
            Located located = reader.get(InetAddress.getByName(address), Located.class);
            if (located == null || located.country() == null) {
                return Optional.empty();
            }
            return AudienceCountry.fromLookup(located.country().isoCode());
        } catch (UnknownHostException exception) {
            return Optional.empty();
        } catch (IOException | RuntimeException exception) {
            // A lookup that fails is a missing dimension on one event, never a failed request.
            log.debug("GeoIP lookup failed", exception);
            return Optional.empty();
        }
    }

    static boolean isIpLiteral(String address) {
        return IPV4.matcher(address).matches() || IPV6.matcher(address).matches();
    }

    @PreDestroy
    void close() throws IOException {
        if (reader != null) {
            reader.close();
        }
    }

    /** The one field of a DB-IP or GeoIP2 country record this reads. */
    public record Located(@MaxMindDbParameter(name = "country") Country country) {

        @MaxMindDbConstructor
        public Located {
        }
    }

    public record Country(@MaxMindDbParameter(name = "iso_code") String isoCode) {

        @MaxMindDbConstructor
        public Country {
        }
    }
}
