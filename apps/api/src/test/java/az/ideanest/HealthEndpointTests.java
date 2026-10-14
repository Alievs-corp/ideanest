package az.ideanest;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * The health endpoint is what the load balancer and the orchestrator read to
 * decide whether this instance receives traffic. It is part of the contract with
 * the platform, so it is tested like one.
 */
class HealthEndpointTests extends AbstractIntegrationTest {

    @Autowired
    private TestRestTemplate rest;

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
