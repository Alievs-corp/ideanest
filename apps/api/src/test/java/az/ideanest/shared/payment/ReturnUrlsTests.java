package az.ideanest.shared.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

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
}
