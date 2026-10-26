package az.ideanest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.auth.AuthProperties;
import az.ideanest.config.JwtConfiguration;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;

/**
 * A process that names no profile runs in the production shape (#587).
 *
 * <p>{@code application.yml} used to make {@code local} the default profile, so a deployment
 * that set none ran with the insecure one: a signing key allowed to be generated on the spot,
 * a refresh cookie without {@code Secure}, and every verification and reset link in the log.
 * These pin both halves of the fix — the file declares no default, and with no profile the
 * service refuses to invent a signing key — without starting a context, because what is being
 * asserted is what happens before there is one.
 */
class DefaultProfileTests {

    private static final AuthProperties NO_KEY = new AuthProperties(
            null, null, null, 12, 256, null, null,
            new AuthProperties.Token(
                    "https://api.ideanest.test", "ideanest", Duration.ofMinutes(15), Duration.ofDays(30), "", ""),
            null, null, null, false, false);

    @Test
    @DisplayName("application.yml names no default profile")
    void theApplicationHasNoDefaultProfile() throws IOException {
        List<PropertySource<?>> documents =
                new YamlPropertySourceLoader().load("application.yml", new ClassPathResource("application.yml"));

        // bootRun asks for `local` itself (build.gradle.kts); nothing that runs the jar
        // should be handed it without asking.
        assertThat(documents).allSatisfy(document -> assertThat(document.getProperty("spring.profiles.default"))
                .as("spring.profiles.default in %s", document.getName())
                .isNull());
    }

    @Test
    @DisplayName("with no profile, the service refuses to start without a signing key rather than invent one")
    void noProfileMeansNoEphemeralKey() {
        // A mock rather than a StandardEnvironment, which would read this machine's own
        // SPRING_PROFILES_ACTIVE and make the test depend on who runs it.
        MockEnvironment unconfigured = new MockEnvironment();

        assertThat(unconfigured.getDefaultProfiles()).containsExactly("default");
        assertThatThrownBy(() -> new JwtConfiguration().accessTokenSigningKey(NO_KEY, unconfigured))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("No signing key configured");
    }

    @Test
    @DisplayName("local, once asked for, still gets its generated key")
    void localStillGetsOne() {
        MockEnvironment local = new MockEnvironment();
        local.setDefaultProfiles("local");

        assertThat(new JwtConfiguration().accessTokenSigningKey(NO_KEY, local)).isNotNull();
    }
}
