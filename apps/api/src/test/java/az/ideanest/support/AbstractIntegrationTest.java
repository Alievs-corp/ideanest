package az.ideanest.support;

import az.ideanest.payment.application.ProviderCircuitBreaker;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Base class for tests that need the application wired to a real database.
 *
 * <p>Extend this rather than annotating a test class directly. Sharing one
 * annotation set is what lets Spring cache a single context — and with it a
 * single PostgreSQL container — across the suite.
 *
 * <p>A test that needs no database should not extend this. Starting a container
 * to assert on a pure function makes the suite slower for no coverage.
 */
// One web environment for the whole suite. Varying it per class would split the
// context cache and start a second PostgreSQL container to no purpose.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
// Spring Boot 4 no longer registers a TestRestTemplate just because the web
// environment has a port; the bean comes from this annotation. Declared here so
// that every class carries the identical annotation set and the context cache —
// and the single PostgreSQL container behind it — still holds.
@AutoConfigureTestRestTemplate
@ActiveProfiles("test")
@Import({ContainersConfiguration.class, TestDoublesConfiguration.class})
public abstract class AbstractIntegrationTest {

    @Autowired
    private ProviderCircuitBreaker providerCircuitBreaker;

    /**
     * #470: the breaker counts every provider call, and a test that scripts an outage would
     * otherwise leave the next class one failure from an open breaker.
     */
    @BeforeEach
    void closeTheProviderCircuitBreaker() {
        providerCircuitBreaker.reset();
    }

    /**
     * Points the identity providers at the local stub.
     *
     * <p>Here rather than on the one test class that signs in with a provider,
     * for the reason above: a class that adds a property source of its own gets
     * a context of its own, and with it a second PostgreSQL container. The
     * issuers and audiences are ordinary configuration in
     * {@code application-test.yml}; only the key set address is decided at run
     * time, because the stub takes whichever port is free.
     */
    @DynamicPropertySource
    static void identityProviderStub(DynamicPropertyRegistry registry) {
        registry.add("ideanest.auth.oauth.providers.google.jwks-uri", OidcProviderStub::googleJwksUri);
        registry.add("ideanest.auth.oauth.providers.apple.jwks-uri", OidcProviderStub::appleJwksUri);
        // #86's relay, here for the identical reason and not on the classes that assert
        // on mail: GreenMail takes whichever port is free, and a class registering a
        // property source of its own gets a context of its own and a second PostgreSQL
        // container with it. Everything else about the transport is ordinary
        // configuration in application-test.yml.
        registry.add("spring.mail.host", MailServerStub::smtpHost);
        registry.add("spring.mail.port", MailServerStub::smtpPort);
        // #429's provider, here for the same reason again. Everything else about SİMA is
        // ordinary configuration in application-test.yml -- the environment stays SANDBOX,
        // which is what SignatureProviders refuses to start without.
        registry.add("ideanest.signature.sima.base-url", SimaImzaStub::baseUrl);
    }
}
