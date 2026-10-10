package az.ideanest.shared.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.mock.env.MockEnvironment;

/**
 * Which return addresses may reach a payment provider — issue #139.
 *
 * <p>A plain unit test: the rule is string arithmetic and needs no database. The two endpoints that
 * apply it have their own end-to-end cases in {@code HostedPaymentApiTests} and
 * {@code PayoutCardRegistrationApiTests}.
 */
class ReturnUrlsTests {

    /** Production's shape: the site on https, and a staging host added beside it. */
    private final ReturnUrls production =
            new ReturnUrls(new ReturnUrlProperties("https://ideanest.az", List.of("https://staging.ideanest.az")));

    @ParameterizedTest
    @DisplayName("the addresses the web sends are accepted: the pledge page and the payout settings")
    @ValueSource(strings = {
        // apps/web/src/lib/pledges/payment.ts
        "https://ideanest.az/az/pledges/7f1c6a8e-3b0d-4c55-9d7e-2a61f0b9c4d2?payment=returned",
        "https://ideanest.az/ru/pledges/7f1c6a8e-3b0d-4c55-9d7e-2a61f0b9c4d2?payment=failed",
        // apps/web/src/lib/account/payout.ts
        "https://ideanest.az/tr/settings/payout?card=returned",
        "https://ideanest.az/en/settings/payout?card=failed",
        // The same origin, spelled differently.
        "https://IdeaNest.AZ/en/settings/payout?card=failed",
        "https://ideanest.az:443/en/settings/payout?card=failed",
        // An additional origin.
        "https://staging.ideanest.az/en/pledges/p?payment=returned",
    })
    void theWebsOwnAddressesPass(String url) {
        assertThat(production.accepts(URI.create(url))).isTrue();
    }

    @ParameterizedTest
    @DisplayName("anything that is not a page on a configured origin is refused")
    @ValueSource(strings = {
        // A foreign host, including ones built to look like ours.
        "https://evil.example/az/pledges/p?payment=failed",
        "https://ideanest.az.evil.example/az/pledges/p",
        "https://evilideanest.az/az/pledges/p",
        "https://www.ideanest.az/az/pledges/p",
        // Our host, over plain http, or on another port.
        "http://ideanest.az/az/pledges/p?payment=returned",
        "https://ideanest.az:8443/az/pledges/p",
        // Not a page at all.
        "javascript:alert(document.cookie)",
        "JavaScript://ideanest.az/%0Aalert(1)",
        "data:text/html,%3Cscript%3Ealert(1)%3C/script%3E",
        "mailto:someone@ideanest.az",
        // A custom scheme: see architecture §9.4 for why the app does not get one.
        "ideanest://pledges/p",
        // Relative, which the provider would resolve against its own domain.
        "/az/pledges/p?payment=returned",
        "//evil.example/az/pledges/p",
        "az/pledges/p",
        // User information: `https://ideanest.az@evil.example` is a trap, and even on our own host
        // the form has no business in a return address.
        "https://ideanest.az@evil.example/az/pledges/p",
        "https://someone@ideanest.az/az/pledges/p",
    })
    void everythingElseIsRefused(String url) {
        assertThat(production.accepts(URI.create(url))).isFalse();
    }

    @ParameterizedTest
    @DisplayName("regressions: hosts that look like ours, hostless https, and every user-information spelling")
    @ValueSource(strings = {
        // A trailing dot: the same host to DNS, not the same string, and not what the site serves.
        "https://ideanest.az./az/pledges/p?payment=returned",
        "https://ideanest.az.:443/az/pledges/p",
        // IDN and homoglyphs: Cyrillic i (U+0456), full-width i (U+FF49), and the punycode form.
        "https://іdeanest.az/az/pledges/p",
        "https://ｉdeanest.az/az/pledges/p",
        "https://xn--deanest-9kg.az/az/pledges/p",
        // A percent-encoded host, which some parsers decode and java.net.URI does not read as one.
        "https://ideanest%2Eaz/az/pledges/p",
        "https://%69deanest.az/az/pledges/p",
        "https://ideanest.az%2F@evil.example/",
        // No authority at all: a browser may "fix" these into https://evil.example/.
        "https:///evil.example/az/pledges/p",
        "https:///ideanest.az/az/pledges/p",
        "https:evil.example/az/pledges/p",
        "https:ideanest.az/az/pledges/p",
        // User information, in every spelling: empty, with a password, with our host as the name.
        "https://@ideanest.az/az/pledges/p",
        "https://:@ideanest.az/az/pledges/p",
        "https://user:pass@ideanest.az/az/pledges/p",
        "https://ideanest.az:443@evil.example/az/pledges/p",
        "https://ideanest.az:@evil.example/az/pledges/p",
        "https://ideanest.az%40evil.example/az/pledges/p",
        "https://ideanest.az@ideanest.az/az/pledges/p",
    })
    void lookAlikesAreRefused(String url) {
        assertThat(production.accepts(URI.create(url))).isFalse();
    }

    @Test
    @DisplayName("an address on our origin longer than 2048 characters is refused; 2048 exactly is accepted")
    void anOverLongAddressIsRefused() {
        String prefix = "https://ideanest.az/az/pledges/p?payment=returned&pad=";
        String atLimit = prefix + "a".repeat(ReturnUrls.MAX_LENGTH - prefix.length());
        String overLimit = atLimit + "a";

        assertThat(atLimit).hasSize(2048);
        assertThat(production.accepts(URI.create(atLimit))).isTrue();
        assertThat(production.accepts(URI.create(overLimit))).isFalse();
        assertThatThrownBy(() -> production.check(URI.create(overLimit), null))
                .isInstanceOf(InvalidReturnUrlException.class);
    }

    @Test
    @DisplayName("an absent address is accepted, because both fields are optional")
    void absentIsAccepted() {
        assertThatNoException().isThrownBy(() -> production.check(null, null));
    }

    @Test
    @DisplayName("the refusal names the field that was refused, and not the address")
    void theRefusalNamesTheField() {
        URI good = URI.create("https://ideanest.az/az/pledges/p?payment=returned");
        URI bad = URI.create("https://evil.example/");

        assertThatThrownBy(() -> production.check(bad, good))
                .isInstanceOfSatisfying(
                        InvalidReturnUrlException.class, refused -> assertThat(refused.field()).isEqualTo("successUrl"))
                .hasMessageNotContaining("evil.example");
        assertThatThrownBy(() -> production.check(good, bad))
                .isInstanceOfSatisfying(
                        InvalidReturnUrlException.class, refused -> assertThat(refused.field()).isEqualTo("errorUrl"));
    }

    @Test
    @DisplayName("locally the site is http on a loopback host, and that origin alone is accepted")
    void loopbackHttpIsTheLocalException() {
        ReturnUrls local = new ReturnUrls(new ReturnUrlProperties("http://localhost:3000", List.of()));

        assertThat(local.accepts(URI.create("http://localhost:3000/az/pledges/p?payment=returned"))).isTrue();
        assertThat(local.accepts(URI.create("http://localhost:4000/az/pledges/p"))).isFalse();
        assertThat(local.accepts(URI.create("https://ideanest.az/az/pledges/p"))).isFalse();
    }

    @Test
    @DisplayName("a site origin that cannot be a return origin refuses every address rather than stopping the service")
    void anUnusableSiteOriginRefusesEverything() {
        ReturnUrls misconfigured = new ReturnUrls(new ReturnUrlProperties("http://staging.ideanest.az", List.of()));

        assertThat(misconfigured.accepts(URI.create("http://staging.ideanest.az/az/pledges/p"))).isFalse();
        assertThat(misconfigured.accepts(URI.create("https://staging.ideanest.az/az/pledges/p"))).isFalse();
    }

    @Test
    @DisplayName("a trailing slash on the site origin is still the origin")
    void aTrailingSlashIsTolerated() {
        ReturnUrls slashed = new ReturnUrls(new ReturnUrlProperties("https://ideanest.az/", List.of()));

        assertThat(slashed.accepts(URI.create("https://ideanest.az/az/settings/payout?card=returned"))).isTrue();
    }

    @ParameterizedTest
    @DisplayName("an additional origin that is not https://host[:port] stops the service starting")
    @ValueSource(strings = {
        "http://staging.ideanest.az",
        "ideanest://",
        "staging.ideanest.az",
        "https://staging.ideanest.az/az",
        "https://staging.ideanest.az?x=1",
        "https://someone@staging.ideanest.az",
    })
    void aMalformedAdditionalOriginIsAStartUpFailure(String origin) {
        assertThatThrownBy(() -> new ReturnUrls(new ReturnUrlProperties("https://ideanest.az", List.of(origin))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("an unset list binds to nothing, and stray commas are not origins")
    void blankEntriesAreDropped() {
        assertThat(new ReturnUrlProperties(null, null).additionalOrigins()).isEmpty();
        assertThat(new ReturnUrlProperties(null, List.of("", " ", "https://staging.ideanest.az")).additionalOrigins())
                .containsExactly("https://staging.ideanest.az");
    }

    @Nested
    @DisplayName("what is logged")
    class Logging {

        private static final ReturnUrlProperties LOOPBACK_DEFAULT =
                new ReturnUrlProperties("http://localhost:3000", List.of());

        private Logger logger;
        private ListAppender<ILoggingEvent> appender;

        @BeforeEach
        void captureTheAppender() {
            LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
            logger = context.getLogger(ReturnUrls.class);
            appender = new ListAppender<>();
            appender.setContext(context);
            appender.start();
            logger.addAppender(appender);
        }

        @AfterEach
        void releaseTheAppender() {
            logger.detachAppender(appender);
            appender.stop();
        }

        private List<ILoggingEvent> warnings() {
            return appender.list.stream().filter(event -> event.getLevel() == Level.WARN).toList();
        }

        @Test
        @DisplayName("a refusal is a WARN naming the field and the host, and never the path or query")
        void aRefusalLogsTheFieldAndTheHostOnly() {
            URI bad = URI.create("https://evil.example/phish/secret-path?token=s3cr3t#frag");

            assertThatThrownBy(() -> production.check(null, bad)).isInstanceOf(InvalidReturnUrlException.class);

            assertThat(warnings()).singleElement().satisfies(event -> {
                String line = event.getFormattedMessage();
                assertThat(line).contains("errorUrl").contains("evil.example");
                assertThat(line).doesNotContain("phish", "secret-path", "token", "s3cr3t", "frag", "https://");
            });
        }

        @Test
        @DisplayName("a refused address with no host logs that it had none")
        void aHostlessRefusalSaysSo() {
            assertThatThrownBy(() -> production.check(URI.create("javascript:alert(document.cookie)"), null))
                    .isInstanceOf(InvalidReturnUrlException.class);

            assertThat(warnings()).singleElement().satisfies(event -> assertThat(event.getFormattedMessage())
                    .contains("successUrl")
                    .contains("(none)")
                    .doesNotContain("alert", "cookie"));
        }

        @Test
        @DisplayName("an accepted address logs nothing")
        void anAcceptedAddressIsQuiet() {
            production.check(URI.create("https://ideanest.az/az/pledges/p?payment=returned"), null);

            assertThat(warnings()).isEmpty();
        }

        @Test
        @DisplayName("loopback only with a payment provider and no explicit profile: loud WARN, and the service starts")
        void loopbackOnlyWithAProviderWarns() {
            MockEnvironment deployed = new MockEnvironment().withProperty("ideanest.payment.provider.primary", "EPOINT");

            ReturnUrls urls = new ReturnUrls(LOOPBACK_DEFAULT, deployed);

            assertThat(warnings()).singleElement().satisfies(event -> assertThat(event.getFormattedMessage())
                    .contains("LOOPBACK ONLY")
                    .contains("localhost")
                    .contains("WEB_BASE_URL"));
            // Still serving: the rule is unchanged, the log is the whole reaction.
            assertThat(urls.accepts(URI.create("http://localhost:3000/az/pledges/p"))).isTrue();
        }

        @Test
        @DisplayName("loopback only under an explicit non-development profile: loud WARN")
        void loopbackOnlyUnderAProductionProfileWarns() {
            MockEnvironment deployed = new MockEnvironment();
            deployed.setActiveProfiles("prod");

            new ReturnUrls(LOOPBACK_DEFAULT, deployed);

            assertThat(warnings()).singleElement().satisfies(event -> assertThat(event.getFormattedMessage())
                    .contains("LOOPBACK ONLY"));
        }

        @Test
        @DisplayName("loopback only on a developer's machine or in the test suite: quiet")
        void loopbackOnlyInDevelopmentIsQuiet() {
            MockEnvironment developer = new MockEnvironment();
            MockEnvironment testSuite = new MockEnvironment().withProperty("ideanest.payment.provider.primary", "AZERICARD");
            testSuite.setActiveProfiles("test");
            MockEnvironment localWithSandboxKeys =
                    new MockEnvironment().withProperty("ideanest.payment.provider.primary", "EPOINT");
            localWithSandboxKeys.setActiveProfiles("local");

            new ReturnUrls(LOOPBACK_DEFAULT, developer);
            new ReturnUrls(LOOPBACK_DEFAULT, testSuite);
            new ReturnUrls(LOOPBACK_DEFAULT, localWithSandboxKeys);

            assertThat(warnings()).isEmpty();
        }

        @Test
        @DisplayName("a deployment with an https origin, or a loopback one beside it, is quiet")
        void aRealOriginIsQuiet() {
            MockEnvironment deployed = new MockEnvironment().withProperty("ideanest.payment.provider.primary", "EPOINT");
            deployed.setActiveProfiles("prod");

            new ReturnUrls(new ReturnUrlProperties("https://ideanest.az", List.of()), deployed);
            new ReturnUrls(
                    new ReturnUrlProperties("http://localhost:3000", List.of("https://staging.ideanest.az")), deployed);

            assertThat(warnings()).isEmpty();
        }
    }
}
