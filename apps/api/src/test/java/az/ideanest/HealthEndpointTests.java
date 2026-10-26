package az.ideanest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.support.AbstractIntegrationTest;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

/**
 * The health endpoint is what the load balancer and the orchestrator read to
 * decide whether this instance receives traffic. It is part of the contract with
 * the platform, so it is tested like one.
 */
class HealthEndpointTests extends AbstractIntegrationTest {

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FilterChainProxy securityFilters;

    @Autowired
    private AccessTokenIssuer tokens;

    @Test
    @DisplayName("health reports UP without leaking component detail")
    void healthIsUpAndOpaque() {
        ResponseEntity<String> response = rest.getForEntity("/actuator/health", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).contains("\"status\":\"UP\"");
        // Anonymous callers learn that the service is up and nothing else. A
        // component breakdown names our dependencies — database, cache, mail
        // relay — to anyone who asks.
        assertThat(response.getBody()).doesNotContain("components").doesNotContain("details");
    }

    @Test
    @DisplayName("liveness and readiness are separately addressable")
    void probesAreExposedIndependently() {
        // Distinct probes matter under a rolling deploy: an instance that is
        // alive but not ready should be taken out of rotation, not restarted.
        assertThat(rest.getForEntity("/actuator/health/liveness", String.class).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(rest.getForEntity("/actuator/health/readiness", String.class).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    /**
     * #138 exposed {@code /actuator/prometheus} and guarded it with HTTP Basic.
     *
     * <p>The refusal is the half worth pinning hardest. Metrics are not confidential the way a
     * pledge is, and they are a map: queue depths, provider availability, JVM internals, and
     * every URI template this service serves. Read continuously by a stranger that is
     * reconnaissance, and a rate-limit-free way to measure when the platform is under strain.
     */
    @Test
    @DisplayName("the metrics endpoint refuses a caller with no credential")
    void metricsAreNotAnonymous() {
        assertThat(rest.getForEntity("/actuator/prometheus", String.class).getStatusCode())
                .isIn(HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("the metrics endpoint answers the scraper, with §8.4's alert families in it")
    void metricsAnswerTheScraper() {
        ResponseEntity<String> response = rest.withBasicAuth("prometheus", "scrape-me")
                .getForEntity("/actuator/prometheus", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        String body = response.getBody();
        assertThat(body).isNotNull();
        // The §8.4 alerts read these families. A rename that broke `alerts.yml` would
        // otherwise be invisible until the night somebody needed the alert. The collection
        // attempts family went with the stored-card collection (#45), and its alert with it.
        assertThat(body).contains("ideanest_ledger_reconciliation_findings");
        assertThat(body).contains("ideanest_queue_waiting");
    }

    /**
     * #587: the API's own chain refuses {@code /actuator/prometheus}, so that a deployment with
     * no scrape credential has no metrics endpoint rather than one any account can read.
     *
     * <p>The suite configures a credential, so {@code MetricsScrapeSecurity} claims the path
     * ahead of the API chain in every other test, and a request through the real filter stack
     * never reaches the rule being asserted. This one runs the API chain alone -- exactly what
     * an unconfigured deployment runs -- rather than starting a second context, and a second
     * PostgreSQL container, for one property. Before the fix the signed-in account below was
     * handed the whole scrape.
     */
    @Test
    @DisplayName("without the scrape chain, a signed-in account is refused the metrics endpoint")
    void metricsAreRefusedByTheApiChain() throws Exception {
        MockHttpServletRequest probe = new MockHttpServletRequest("GET", "/v1/me");
        SecurityFilterChain apiChain = securityFilters.getFilterChains().stream()
                .filter(chain -> chain.matches(probe))
                .findFirst()
                .orElseThrow();
        MockMvc apiChainOnly = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(new FilterChainProxy(apiChain))
                .build();

        String accessToken = tokens.issue(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        apiChainOnly
                .perform(get("/actuator/prometheus").header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
                .andExpect(status().isForbidden());
        apiChainOnly.perform(get("/actuator/prometheus")).andExpect(status().isUnauthorized());
        // And the container's probes still answer on the same chain.
        apiChainOnly.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("no endpoint beyond health and metrics is exposed")
    void otherEndpointsStayClosed() {
        // env and configprops print configuration, which includes the database
        // password. beans and mappings describe the attack surface.
        //
        // 401 rather than 404 since #23 added deny-by-default security: the
        // endpoint is refused before anything works out that it is also not
        // exposed. Either way an anonymous caller reads nothing, which is the
        // property being asserted.
        assertThat(rest.getForEntity("/actuator/env", String.class).getStatusCode())
                .isIn(HttpStatus.NOT_FOUND, HttpStatus.UNAUTHORIZED);
        assertThat(rest.getForEntity("/actuator/beans", String.class).getStatusCode())
                .isIn(HttpStatus.NOT_FOUND, HttpStatus.UNAUTHORIZED);
        assertThat(rest.getForEntity("/actuator/flyway", String.class).getStatusCode())
                .isIn(HttpStatus.NOT_FOUND, HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("an endpoint nobody granted access to is refused")
    void unknownEndpointsAreDeniedByDefault() {
        // Deny by default is what makes forgetting to protect a new endpoint a
        // 401 in a test rather than an open door in production.
        assertThat(rest.getForEntity("/v1/me", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
