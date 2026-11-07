package az.ideanest.analytics.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.analytics.AudienceAnalyticsProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * #633: the GeoIP database is optional. Whatever is or is not at the configured path, the
 * lookup is constructed and answers "unknown" rather than failing — which is what keeps a
 * failed monthly download from stopping the API.
 */
class DbIpCountryLookupTests {

    @Test
    @DisplayName("no path configured: every lookup is unknown")
    void noPath() {
        DbIpCountryLookup lookup = new DbIpCountryLookup(properties(""));

        assertThat(lookup.isLoaded()).isFalse();
        assertThat(lookup.countryOf("85.132.0.1")).isEmpty();
    }

    @Test
    @DisplayName("a path with nothing there: every lookup is unknown, and start-up goes on")
    void missingFile(@TempDir Path directory) {
        DbIpCountryLookup lookup = new DbIpCountryLookup(properties(directory.resolve("absent.mmdb").toString()));

        assertThat(lookup.isLoaded()).isFalse();
        assertThat(lookup.countryOf("85.132.0.1")).isEmpty();
    }

    @Test
    @DisplayName("a file that is not a database: every lookup is unknown, and start-up goes on")
    void corruptFile(@TempDir Path directory) throws IOException {
        Path junk = Files.writeString(directory.resolve("junk.mmdb"), "not a database", StandardCharsets.UTF_8);

        DbIpCountryLookup lookup = new DbIpCountryLookup(properties(junk.toString()));

        assertThat(lookup.isLoaded()).isFalse();
        assertThat(lookup.countryOf("85.132.0.1")).isEmpty();
    }

    @Test
    @DisplayName("only IP literals are looked up, so a header can never make the API resolve a name")
    void onlyLiterals() {
        assertThat(DbIpCountryLookup.isIpLiteral("85.132.0.1")).isTrue();
        assertThat(DbIpCountryLookup.isIpLiteral("2a02:6b8::1")).isTrue();
        assertThat(DbIpCountryLookup.isIpLiteral("::1")).isTrue();
        assertThat(DbIpCountryLookup.isIpLiteral("example.com")).isFalse();
        assertThat(DbIpCountryLookup.isIpLiteral("abc.def")).isFalse();
        assertThat(DbIpCountryLookup.isIpLiteral("unknown")).isFalse();
        assertThat(DbIpCountryLookup.isIpLiteral("")).isFalse();
    }

    private static AudienceAnalyticsProperties properties(String path) {
        return new AudienceAnalyticsProperties(path, 0, null, null);
    }
}
