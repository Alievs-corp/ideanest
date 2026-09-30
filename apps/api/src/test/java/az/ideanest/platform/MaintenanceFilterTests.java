package az.ideanest.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import az.ideanest.platform.api.MaintenanceFilter;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.maintenance.ActiveMaintenance;
import az.ideanest.shared.maintenance.MaintenanceGate;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

/**
 * The maintenance gate on its own, through MockMvc — issue #214.
 *
 * <p>A controller that answers 200 on every path stands in for the application, so
 * "passes" means "reached a controller" and nothing else. {@code MaintenanceApiTests}
 * repeats the important cases through the real security chain.
 */
class MaintenanceFilterTests {

    private static final Instant NOW = Instant.parse("2026-10-04T22:10:00Z");

    private static final UUID STAFF = UUID.randomUUID();

    private static final UUID READER = UUID.randomUUID();

    private final FixedGate gate = new FixedGate();

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        MaintenanceFilter filter = new MaintenanceFilter(
                gate, new OneStaffMember(STAFF), JsonMapper.builder().build(), Clock.fixed(NOW, ZoneOffset.UTC));
        mvc = MockMvcBuilders.standaloneSetup(new Anything()).addFilters(filter).build();
    }

    @AfterEach
    void clearTheSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("outside a window every request passes")
    void nothingIsClosedWithoutAWindow() throws Exception {
        gate.window = null;

        mvc.perform(get("/v1/categories")).andExpect(status().isOk());
        mvc.perform(post("/v1/projects")).andExpect(status().isOk());
    }

    static Stream<Arguments> closedPaths() {
        return Stream.of(
                Arguments.of(HttpMethod.GET, "/v1/categories"),
                Arguments.of(HttpMethod.GET, "/v1/projects/some-creator/some-project"),
                Arguments.of(HttpMethod.POST, "/v1/projects"),
                Arguments.of(HttpMethod.GET, "/v1/me"),
                Arguments.of(HttpMethod.GET, "/v1/admin/maintenance"),
                Arguments.of(HttpMethod.POST, "/v1/auth/register"),
                Arguments.of(HttpMethod.POST, "/v1/auth/oauth/google"),
                Arguments.of(HttpMethod.POST, "/v1/auth/forgot-password"),
                Arguments.of(HttpMethod.GET, "/v3/api-docs"),
                // Exempt paths only on their own method or shape.
                Arguments.of(HttpMethod.POST, "/v1/status"),
                Arguments.of(HttpMethod.GET, "/v1/webhooks/psp/payriff"),
                Arguments.of(HttpMethod.POST, "/v1/webhooks/psp"),
                Arguments.of(HttpMethod.POST, "/v1/webhooks/psp/payriff/extra"),
                Arguments.of(HttpMethod.GET, "/v1/status/extra"),
                Arguments.of(HttpMethod.GET, "/v1/actuator"),
                Arguments.of(HttpMethod.GET, "/actuatorx"));
    }

    @ParameterizedTest(name = "{0} {1} is closed")
    @MethodSource("closedPaths")
    @DisplayName("every non-exempt path answers the maintenance contract")
    void nonExemptPathsAreClosed(HttpMethod method, String path) throws Exception {
        gate.window = new ActiveMaintenance(NOW.minus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(20)));

        mvc.perform(request(method, path))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "1200"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("https://ideanest.az/problems/maintenance"))
                .andExpect(jsonPath("$.title").value("Scheduled maintenance"))
                .andExpect(jsonPath("$.status").value(503))
                .andExpect(jsonPath("$.startsAt").value("2026-10-04T22:00:00Z"))
                .andExpect(jsonPath("$.endsAt").value("2026-10-04T22:30:00Z"))
                .andExpect(jsonPath("$.source").value("api"))
                // No prose for readers: clients render their own copy.
                .andExpect(jsonPath("$.detail").doesNotExist());
    }

    static Stream<Arguments> exemptPaths() {
        return Stream.of(
                Arguments.of(HttpMethod.GET, "/v1/status"),
                Arguments.of(HttpMethod.HEAD, "/v1/status"),
                Arguments.of(HttpMethod.GET, "/actuator/health"),
                Arguments.of(HttpMethod.GET, "/actuator/health/liveness"),
                Arguments.of(HttpMethod.GET, "/actuator/prometheus"),
                Arguments.of(HttpMethod.POST, "/v1/auth/login"),
                Arguments.of(HttpMethod.POST, "/v1/auth/refresh"),
                Arguments.of(HttpMethod.POST, "/v1/auth/2fa/verify"),
                Arguments.of(HttpMethod.POST, "/v1/auth/logout"),
                Arguments.of(HttpMethod.POST, "/v1/webhooks/psp/payriff"),
                Arguments.of(HttpMethod.POST, "/v1/webhooks/psp/epoint"));
    }

    @ParameterizedTest(name = "{0} {1} passes")
    @MethodSource("exemptPaths")
    @DisplayName("each exempt path passes during a window")
    void exemptPathsPass(HttpMethod method, String path) throws Exception {
        gate.window = new ActiveMaintenance(NOW.minus(Duration.ofMinutes(10)), null);

        mvc.perform(request(method, path)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("a staff token passes and a reader's does not")
    void staffPassReadersDoNot() throws Exception {
        gate.window = new ActiveMaintenance(NOW.minus(Duration.ofMinutes(10)), null);

        signedInAs(STAFF);
        mvc.perform(get("/v1/admin/maintenance")).andExpect(status().isOk());
        mvc.perform(patch("/v1/projects/" + UUID.randomUUID())).andExpect(status().isOk());

        signedInAs(READER);
        mvc.perform(get("/v1/me"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.type").value("https://ideanest.az/problems/maintenance"));
    }

    @Test
    @DisplayName("a window with no announced end says so with a null, and Retry-After is 300")
    void anOpenEndedWindow() throws Exception {
        gate.window = new ActiveMaintenance(NOW.minus(Duration.ofMinutes(10)), null);

        mvc.perform(head("/v1/categories").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "300"));

        String body = mvc.perform(get("/v1/categories"))
                .andExpect(status().isServiceUnavailable())
                .andReturn()
                .getResponse()
                .getContentAsString();
        // Present and null, not missing: null is "until further notice".
        assertThat(body).contains("\"endsAt\":null");
    }

    @Test
    @DisplayName("Retry-After is clamped to between thirty seconds and an hour")
    void retryAfterIsClamped() throws Exception {
        gate.window = new ActiveMaintenance(NOW.minus(Duration.ofMinutes(10)), NOW.plusSeconds(5));
        mvc.perform(get("/v1/categories")).andExpect(header().string("Retry-After", "30"));

        gate.window = new ActiveMaintenance(NOW.minus(Duration.ofMinutes(10)), NOW.plus(Duration.ofHours(6)));
        mvc.perform(get("/v1/categories")).andExpect(header().string("Retry-After", "3600"));
    }

    private static void signedInAs(UUID account) {
        Jwt token = Jwt.withTokenValue("token")
                .header("alg", "RS256")
                .subject(account.toString())
                .issuedAt(NOW)
                .expiresAt(NOW.plus(Duration.ofMinutes(15)))
                .build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(token));
    }

    /** Answers 200 on every path, so passing the filter is observable. */
    @RestController
    static class Anything {

        @RequestMapping("/**")
        String anything() {
            return "reached";
        }
    }

    private static final class FixedGate implements MaintenanceGate {

        private ActiveMaintenance window;

        @Override
        public Optional<ActiveMaintenance> active() {
            return Optional.ofNullable(window);
        }

        @Override
        public void admitSession(UUID accountId) {
            throw new UnsupportedOperationException("The filter never asks this");
        }
    }

    private record OneStaffMember(UUID member) implements PlatformStaff {

        @Override
        public boolean isStaff(UUID accountId) {
            return member.equals(accountId);
        }

        @Override
        public void requireStaff(UUID accountId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Set<StaffCapability> capabilitiesOf(UUID accountId) {
            return Set.of();
        }

        @Override
        public void requireCapability(UUID accountId, StaffCapability capability) {
            throw new UnsupportedOperationException();
        }
    }
}
