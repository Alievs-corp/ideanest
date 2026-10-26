package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.auth.AuthProperties.OAuth;
import az.ideanest.auth.AuthProperties.OAuth.Provider;
import az.ideanest.auth.application.ProviderNotConfiguredException;
import az.ideanest.auth.domain.IdentityProvider;
import az.ideanest.auth.infrastructure.JwksOidcIdentityVerifier;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What happens to a provider nobody configured.
 *
 * <p>Two failures that look similar and are not. An environment with no Apple
 * credentials is an ordinary environment — staging, a laptop, the first month —
 * and the whole API refusing to start over it would take down password sign-in,
 * discovery, and pledges for a feature nobody has called. An environment with
 * half of Apple's configuration is a mistake, and it fails as a 401 nobody can
 * explain unless it fails at start-up instead.
 *
 * <p>A plain unit test: it constructs the verifier and asks it questions, and
 * needs no database for either.
 */
class OidcProviderConfigurationTests {

    private static final String JWKS = "https://example.test/keys";

    private static JwksOidcIdentityVerifier verifierFor(Map<IdentityProvider, Provider> providers) {
        OAuth oauth = new OAuth(Duration.ofSeconds(60), Duration.ofMinutes(5), providers);
        // Only the OAuth block matters here; everything else is unread by the
        // verifier and left null so that this test does not silently start
        // depending on an unrelated setting.
        AuthProperties properties =
                new AuthProperties(null, null, null, 0, 0, null, null, null, null, oauth, null, false, false);
        return new JwksOidcIdentityVerifier(properties, Clock.systemUTC());
    }

    @Test
    @DisplayName("a provider with no client identifiers is simply not enabled")
    void anUnconfiguredProviderIsNotEnabled() {
        // The shape the repository ships: the issuer and the key set are facts
        // about Apple and are checked in; the client identifiers come from the
        // environment, and this environment was not given any.
        JwksOidcIdentityVerifier verifier = verifierFor(Map.of(
                IdentityProvider.APPLE, new Provider("https://appleid.apple.com", JWKS, List.of(), true)));

        assertThatThrownBy(() -> verifier.verify(IdentityProvider.APPLE, "any-token", "any-nonce"))
                .isInstanceOf(ProviderNotConfiguredException.class);
    }

    @Test
    @DisplayName("a provider absent from configuration altogether is not enabled either")
    void aProviderThatIsNotMentionedIsNotEnabled() {
        JwksOidcIdentityVerifier verifier = verifierFor(Map.of());

        assertThatThrownBy(() -> verifier.verify(IdentityProvider.GOOGLE, "any-token", "any-nonce"))
                .isInstanceOf(ProviderNotConfiguredException.class);
    }

    @Test
    @DisplayName("client identifiers with nowhere to check them stop start-up")
    void halfAConfigurationIsAStartUpFailure() {
        // Somebody enabled the provider and lost the issuer. Nothing about this
        // is a decision, and left alone it is a 401 during a demo.
        assertThatThrownBy(() -> verifierFor(Map.of(
                        IdentityProvider.GOOGLE, new Provider(null, JWKS, List.of("a-client-id"), true))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("ideanest.auth.oauth.providers.google");

        assertThatThrownBy(() -> verifierFor(Map.of(
                        IdentityProvider.GOOGLE,
                        new Provider("https://accounts.google.com", " ", List.of("a-client-id"), true))))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("a fully configured provider builds without reaching the network")
    void aConfiguredProviderBuildsLazily() {
        // The key set is fetched on the first token, not at start-up. A service
        // that could not boot while Google was having a bad morning would be a
        // worse service than one that fails that one sign-in.
        assertThatCode(() -> verifierFor(Map.of(
                        IdentityProvider.GOOGLE,
                        new Provider("https://accounts.google.com", JWKS, List.of("a-client-id"), true))))
                .doesNotThrowAnyException();
    }
}
