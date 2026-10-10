package az.ideanest.platform;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.platform.application.MaintenanceWindows;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.jobs.JobLease;
import az.ideanest.shared.jobs.JobRunner;
import az.ideanest.shared.jobs.ScheduledJob;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Maintenance windows end to end, through the real security chain — issue #214.
 *
 * <p><strong>Every test leaves the platform open.</strong> The windows live in one table
 * and one cached snapshot shared by the whole suite's application context, so a window
 * left behind would turn every suite that runs after this one into a wall of 503s. The
 * teardown deletes the rows and forgets the snapshot, whatever the test did.
 *
 * <p>Fixture accounts use a {@code maint-} prefix and a random suffix: a re-registered
 * address gets no credential ({@code ideanest-test-fixture-handle-collisions}), and the
 * one shared moderator address is never signed in with, only issued a token for.
 */
class MaintenanceApiTests extends AbstractIntegrationTest {

    private static final String PASSWORD = "a-long-enough-password";

    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static final String ROLE_FIXTURE_NOTE = "maintenance fixture";

    private static final String MAINTENANCE_TYPE = "https://ideanest.az/problems/maintenance";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT = new ParameterizedTypeReference<>() {};

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private MaintenanceWindows windows;

    @Autowired
    private JobRunner runner;

    @Autowired
    private JobLease lease;

    @Autowired
    private List<ScheduledJob> jobs;

    private Account moderator;

    @BeforeEach
    void startOpen() {
        windows.invalidate();
    }

    @AfterEach
    void leaveThePlatformOpen() {
        clock.reset();
        jdbc().update("DELETE FROM maintenance_windows");
        windows.invalidate();
        jdbc().update("DELETE FROM staff_role_grants WHERE note = ?", ROLE_FIXTURE_NOTE);
        jdbc().update("DELETE FROM scheduled_jobs WHERE name LIKE 'maint-test-%'");
    }

    // ------------------------------------------------------------------
    // GET /v1/status
    // ------------------------------------------------------------------

    @Test
    @DisplayName("status is public, no-store, and operational with both windows null")
    void operationalStatus() {
        ResponseEntity<Map<String, Object>> response = rest.exchange("/v1/status", HttpMethod.GET, null, OBJECT);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getBody())
                .containsEntry("state", "operational")
                .containsEntry("maintenance", null)
                .containsEntry("upcoming", null);
    }

    @Test
    @DisplayName("an announced window shows as upcoming, without its internal note")
    void upcomingStatus() {
        Instant startsAt = seconds(Instant.now().plus(Duration.ofHours(2)));
        Instant endsAt = startsAt.plus(Duration.ofMinutes(30));
        schedule(startsAt, endsAt, "migrating the ledger");

        Map<String, Object> status = status();

        assertThat(status).containsEntry("state", "operational").containsEntry("maintenance", null);
        assertThat(status.get("upcoming"))
                .isEqualTo(Map.of("startsAt", startsAt.toString(), "endsAt", endsAt.toString()));
        assertThat(status.toString()).doesNotContain("migrating the ledger");
    }

    // ------------------------------------------------------------------
    // The gate
    // ------------------------------------------------------------------

    @Test
    @DisplayName("during a window non-exempt paths answer 503 with Retry-After and the problem type")
    void nonExemptPathsAreClosed() {
        Account reader = reader();
        Instant endsAt = seconds(Instant.now().plus(Duration.ofMinutes(20)));
        startNow(endsAt);

        for (ResponseEntity<Map<String, Object>> response : List.of(
                exchange(HttpMethod.GET, "/v1/categories", null, null),
                exchange(HttpMethod.GET, "/v1/me", reader.accessToken(), null),
                exchange(HttpMethod.GET, "/v1/admin/feature-flags", null, null),
                exchange(HttpMethod.GET, "/v3/api-docs", null, null),
                exchange(HttpMethod.POST, "/v1/auth/register", null, Map.of(
                        "email", "maint-closed-" + UUID.randomUUID() + "@example.com",
                        "password", PASSWORD,
                        "name", "Closed")))) {

            assertMaintenance(response);
            long retryAfter = Long.parseLong(response.getHeaders().getFirst(HttpHeaders.RETRY_AFTER));
            assertThat(retryAfter).isBetween(1100L, 1200L);
            assertThat(response.getBody().get("endsAt")).isEqualTo(endsAt.toString());
        }

        assertThat(status()).containsEntry("state", "maintenance");
        assertThat(((Map<?, ?>) status().get("maintenance")).get("endsAt")).isEqualTo(endsAt.toString());
    }

    @Test
    @DisplayName("during a window each exempt path still reaches its endpoint")
    void exemptPathsPass() {
        startNow(null);

        assertThat(exchange(HttpMethod.GET, "/v1/status", null, null).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(exchange(HttpMethod.GET, "/actuator/health", null, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(exchange(HttpMethod.POST, "/v1/auth/logout", null, null).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        // Each of these refuses on its own terms — no token, no challenge, no such
        // provider — which is the point: the endpoint answered, not the gate.
        assertNotMaintenance(exchange(HttpMethod.POST, "/v1/auth/refresh", null, Map.of()));
        assertNotMaintenance(exchange(
                HttpMethod.POST, "/v1/auth/2fa/verify", null, Map.of("challenge", "nothing", "code", "000000")));
        assertNotMaintenance(exchange(HttpMethod.POST, "/v1/webhooks/psp/no-such-provider", null, Map.of()));
        assertNotMaintenance(exchange(
                HttpMethod.POST, "/v1/auth/login", null, Map.of("email", "maint-nobody@example.com", "password", "x")));
    }

    @Test
    @DisplayName("a staff token passes the gate and a reader's does not")
    void staffPassReadersDoNot() {
        // Registered before the window: registration itself is closed during one.
        Account curator = staffWith(StaffRole.CURATOR);
        Account reader = reader();
        startNow(null);

        assertThat(statusOf("/v1/categories", moderator().accessToken())).isEqualTo(HttpStatus.OK);
        assertThat(exchange(HttpMethod.GET, "/v1/admin/maintenance", moderator().accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(exchange(HttpMethod.GET, "/v1/me", curator.accessToken(), null).getStatusCode())
                .as("any staff role passes, not only the ones that can edit maintenance")
                .isEqualTo(HttpStatus.OK);

        assertMaintenance(exchange(HttpMethod.GET, "/v1/me", reader.accessToken(), null));
    }

    @Test
    @DisplayName("a reader's sign-in is refused after the password, and no session or refresh token is issued")
    void readersCannotSignIn() {
        String email = "maint-reader-" + UUID.randomUUID() + "@example.com";
        register(email);
        UUID readerId = idOf(email);
        startNow(null);

        ResponseEntity<Map<String, Object>> signIn = exchange(
                HttpMethod.POST, "/v1/auth/login", null, Map.of("email", email, "password", PASSWORD, "tokenDelivery",
                        "body"));

        assertMaintenance(signIn);
        assertThat(signIn.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM sessions WHERE user_id = ?", Integer.class, readerId))
                .isZero();
        assertThat(jdbc().queryForObject(
                        """
                        SELECT count(*) FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id
                        WHERE s.user_id = ?
                        """,
                        Integer.class,
                        readerId))
                .isZero();

        // And a wrong password is still just a wrong password: the refusal says nothing to
        // somebody who does not hold the credentials.
        ResponseEntity<Map<String, Object>> wrong = exchange(
                HttpMethod.POST, "/v1/auth/login", null, Map.of("email", email, "password", "not-the-password"));
        assertThat(wrong.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a reader's refresh is refused without spending the token, which works again afterwards")
    void readersCannotRefresh() {
        String email = "maint-refresh-" + UUID.randomUUID() + "@example.com";
        register(email);
        String refreshToken = (String) signIn(email).get("refreshToken");
        UUID window = startNow(null);

        assertMaintenance(exchange(HttpMethod.POST, "/v1/auth/refresh", null, Map.of("refreshToken", refreshToken)));

        endNow(window);
        ResponseEntity<Map<String, Object>> after =
                exchange(HttpMethod.POST, "/v1/auth/refresh", null, Map.of("refreshToken", refreshToken));
        assertThat(after.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(after.getBody()).containsKey("accessToken");
    }

    @Test
    @DisplayName("staff can sign in with a password during a window")
    void staffCanSignIn() {
        String email = "maint-staff-" + UUID.randomUUID() + "@ideanest.test";
        register(email);
        grant(idOf(email), StaffRole.CURATOR);
        startNow(null);

        Map<String, Object> signedIn = signIn(email);

        assertThat(signedIn).containsKey("accessToken").containsKey("refreshToken");
    }

    // ------------------------------------------------------------------
    // The snapshot
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a window written behind the cache's back reaches the gate within the TTL, not before")
    void theSnapshotIsHeldForTheTtl() {
        clock.freeze();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        assertThat(status()).containsEntry("state", "operational");

        jdbc().update(
                """
                INSERT INTO maintenance_windows (id, starts_at, announce_from, created_at)
                VALUES (?, ?, ?, now())
                """,
                UUID.randomUUID(),
                java.sql.Timestamp.from(now.minusSeconds(60)),
                java.sql.Timestamp.from(now.minusSeconds(60)));

        assertThat(status()).as("still the cached answer").containsEntry("state", "operational");

        clock.advance(Duration.ofSeconds(11));
        assertThat(status()).containsEntry("state", "maintenance");
    }

    @Test
    @DisplayName("every edit clears the cache: start and end take effect on the next request")
    void editsClearTheCache() {
        clock.freeze();
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        assertThat(status()).containsEntry("state", "operational");

        UUID window = schedule(now.plus(Duration.ofHours(1)), null, null);
        assertThat(status().get("upcoming")).isNotNull();

        post("/v1/admin/maintenance/" + window + "/start-now", Map.of(), HttpStatus.OK);
        assertThat(status()).containsEntry("state", "maintenance");
        assertMaintenance(exchange(HttpMethod.GET, "/v1/categories", null, null));

        post("/v1/admin/maintenance/" + window + "/end-now", Map.of(), HttpStatus.OK);
        assertThat(status()).containsEntry("state", "operational");
        assertThat(statusOf("/v1/categories", null)).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // The console
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an overlapping window is refused")
    void overlapsAreRefused() {
        Instant startsAt = seconds(Instant.now().plus(Duration.ofHours(3)));
        schedule(startsAt, startsAt.plus(Duration.ofHours(1)), null);

        ResponseEntity<Map<String, Object>> overlapping = exchange(
                HttpMethod.POST,
                "/v1/admin/maintenance",
                moderator().accessToken(),
                Map.of("startsAt", startsAt.plus(Duration.ofMinutes(30)).toString()));

        assertThat(overlapping.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(overlapping.getBody()).containsEntry("code", "MAINTENANCE_WINDOW_OVERLAPS");

        // Its announcement counts too: a day's notice before a start two hours after the
        // first window ends would have two windows on the status endpoint at once.
        ResponseEntity<Map<String, Object>> announcedDuring = exchange(
                HttpMethod.POST,
                "/v1/admin/maintenance",
                moderator().accessToken(),
                Map.of("startsAt", startsAt.plus(Duration.ofHours(3)).toString()));
        assertThat(announcedDuring.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        // After the first one's end, announced from then, is fine.
        Map<String, Object> after = new HashMap<>();
        after.put("startsAt", startsAt.plus(Duration.ofHours(3)).toString());
        after.put("announceFrom", startsAt.plus(Duration.ofHours(1)).toString());
        assertThat(exchange(HttpMethod.POST, "/v1/admin/maintenance", moderator().accessToken(), after)
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
    }

    @Test
    @DisplayName("schedule, extend, cancel: each is audited with the window before and after")
    void changesAreAudited() {
        Instant startsAt = seconds(Instant.now().plus(Duration.ofHours(5)));
        UUID window = schedule(startsAt, startsAt.plus(Duration.ofMinutes(30)), "first note");

        Instant extended = startsAt.plus(Duration.ofHours(2));
        ResponseEntity<Map<String, Object>> patched = exchange(
                HttpMethod.PATCH,
                "/v1/admin/maintenance/" + window,
                moderator().accessToken(),
                Map.of("endsAt", extended.toString()));
        assertThat(patched.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(patched.getBody())
                .containsEntry("endsAt", extended.toString())
                .containsEntry("note", "first note");

        ResponseEntity<Map<String, Object>> cancelled =
                exchange(HttpMethod.DELETE, "/v1/admin/maintenance/" + window, moderator().accessToken(), null);
        assertThat(cancelled.getBody()).containsEntry("state", "CANCELLED");

        List<Map<String, Object>> trail = jdbc().queryForList(
                "SELECT action, detail, actor_id FROM audit_logs WHERE entity_id = ? ORDER BY occurred_at", window);
        assertThat(trail).extracting(row -> row.get("action"))
                .containsExactly(
                        "maintenance.window_scheduled", "maintenance.window_changed", "maintenance.window_cancelled");
        assertThat(trail).allSatisfy(row -> {
            assertThat((String) row.get("detail")).contains("before: ").contains("after: ");
            assertThat(row.get("actor_id")).isEqualTo(moderator().id());
        });
        assertThat((String) trail.get(1).get("detail"))
                .contains("endsAt=" + startsAt.plus(Duration.ofMinutes(30)))
                .contains("endsAt=" + extended);
    }

    @Test
    @DisplayName("the console lists the current, the upcoming and the recent windows")
    void theOverview() {
        // With an end: an open-ended window runs into everything after it.
        UUID current = startNow(seconds(Instant.now().plus(Duration.ofHours(1))));
        Instant later = seconds(Instant.now().plus(Duration.ofDays(3)));
        Map<String, Object> body = new HashMap<>();
        body.put("startsAt", later.toString());
        body.put("announceFrom", later.minus(Duration.ofHours(1)).toString());
        UUID upcoming = uuid(post("/v1/admin/maintenance", body, HttpStatus.CREATED).get("id"));

        Map<String, Object> overview =
                exchange(HttpMethod.GET, "/v1/admin/maintenance", moderator().accessToken(), null).getBody();

        assertThat(((Map<?, ?>) overview.get("current")).get("id")).isEqualTo(current.toString());
        assertThat(field(overview.get("upcoming"), "id")).containsExactly(upcoming.toString());
        assertThat(field(overview.get("upcoming"), "state")).containsExactly("SCHEDULED");
        assertThat(field(overview.get("recent"), "id")).contains(current.toString(), upcoming.toString());
    }

    @Test
    @DisplayName("the console needs CONFIGURE_PLATFORM")
    void theConsoleNeedsTheCapability() {
        ResponseEntity<Map<String, Object>> curator =
                exchange(HttpMethod.GET, "/v1/admin/maintenance", staffWith(StaffRole.CURATOR).accessToken(), null);
        assertThat(curator.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

        ResponseEntity<Map<String, Object>> reader = exchange(
                HttpMethod.POST,
                "/v1/admin/maintenance",
                reader().accessToken(),
                Map.of("startsAt", Instant.now().plus(Duration.ofHours(1)).toString()));
        assertThat(reader.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM maintenance_windows", Integer.class)).isZero();
    }

    @Test
    @DisplayName("a start in the past or an end before the start is refused")
    void nonsenseIsRefused() {
        ResponseEntity<Map<String, Object>> past = exchange(
                HttpMethod.POST,
                "/v1/admin/maintenance",
                moderator().accessToken(),
                Map.of("startsAt", Instant.now().minus(Duration.ofHours(1)).toString()));
        assertThat(past.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        Instant startsAt = Instant.now().plus(Duration.ofHours(1));
        ResponseEntity<Map<String, Object>> backwards = exchange(
                HttpMethod.POST,
                "/v1/admin/maintenance",
                moderator().accessToken(),
                Map.of("startsAt", startsAt.toString(), "endsAt", startsAt.minusSeconds(60).toString()));
        assertThat(backwards.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(backwards.getBody()).containsEntry("code", "MAINTENANCE_WINDOW_INVALID");
    }

    // ------------------------------------------------------------------
    // Background work
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the jobs that send money or messages out are the ones that pause")
    void theJobsThatPause() {
        assertThat(jobs.stream().filter(ScheduledJob::pausesDuringMaintenance).map(ScheduledJob::name))
                .containsExactlyInAnyOrder(
                        "charge-processor",
                        "charge-retry",
                        "campaign-refunds",
                        "hosted-charge-sweep",
                        "ledger-reconciliation",
                        "notification-sender",
                        "notification-digest",
                        "reminder-sender");
    }

    @Test
    @DisplayName("a pausing job is not claimed during a window and runs again once it ends")
    void runnersDoNotClaimDuringAWindow() {
        String name = "maint-test-" + SEQUENCE.incrementAndGet();
        lease.register(name, Instant.now().minusSeconds(60).truncatedTo(ChronoUnit.MICROS));
        AtomicInteger runs = new AtomicInteger();
        ScheduledJob job = new ScheduledJob() {
            @Override
            public String name() {
                return name;
            }

            @Override
            public String schedule() {
                return "-";
            }

            @Override
            public void run() {
                runs.incrementAndGet();
            }

            @Override
            public boolean pausesDuringMaintenance() {
                return true;
            }
        };
        UUID window = startNow(null);

        assertThat(runner.run(job)).isFalse();
        assertThat(runs.get()).isZero();
        assertThat(jdbc().queryForObject("SELECT attempts FROM scheduled_jobs WHERE name = ?", Integer.class, name))
                .as("not claimed, so nothing counted")
                .isZero();

        endNow(window);
        assertThat(runner.run(job)).isTrue();
        assertThat(runs.get()).isEqualTo(1);
    }

    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private void assertMaintenance(ResponseEntity<Map<String, Object>> response) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isNotBlank();
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getHeaders().getContentType()).isNotNull();
        assertThat(response.getHeaders().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .isTrue();
        assertThat(response.getBody())
                .containsEntry("type", MAINTENANCE_TYPE)
                .containsEntry("title", "Scheduled maintenance")
                .containsEntry("status", 503)
                .containsEntry("source", "api")
                .containsKeys("startsAt", "endsAt")
                .doesNotContainKey("detail");
    }

    private static void assertNotMaintenance(ResponseEntity<Map<String, Object>> response) {
        assertThat(response.getStatusCode()).isNotEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        if (response.getBody() != null) {
            assertThat(response.getBody().get("type")).isNotEqualTo(MAINTENANCE_TYPE);
        }
    }

    private Map<String, Object> status() {
        ResponseEntity<Map<String, Object>> response = rest.exchange("/v1/status", HttpMethod.GET, null, OBJECT);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private UUID schedule(Instant startsAt, Instant endsAt, String note) {
        Map<String, Object> body = new HashMap<>();
        body.put("startsAt", startsAt.toString());
        if (endsAt != null) {
            body.put("endsAt", endsAt.toString());
        }
        if (note != null) {
            body.put("note", note);
        }
        return uuid(post("/v1/admin/maintenance", body, HttpStatus.CREATED).get("id"));
    }

    /** A window that is in force from this request, via the console's own verbs. */
    private UUID startNow(Instant endsAt) {
        UUID window = schedule(seconds(Instant.now().plus(Duration.ofMinutes(5))), endsAt, null);
        post("/v1/admin/maintenance/" + window + "/start-now", Map.of(), HttpStatus.OK);
        return window;
    }

    private void endNow(UUID window) {
        post("/v1/admin/maintenance/" + window + "/end-now", Map.of(), HttpStatus.OK);
    }

    private Map<String, Object> post(String path, Map<String, Object> body, HttpStatus expected) {
        ResponseEntity<Map<String, Object>> response =
                exchange(HttpMethod.POST, path, moderator().accessToken(), body);
        assertThat(response.getStatusCode()).as("%s answered %s", path, response.getBody()).isEqualTo(expected);
        return response.getBody();
    }

    private ResponseEntity<Map<String, Object>> exchange(
            HttpMethod method, String path, String accessToken, Map<String, ?> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (accessToken != null) {
            headers.setBearerAuth(accessToken);
        }
        return rest.exchange(path, method, new HttpEntity<>(body, headers), OBJECT);
    }

    /** For an endpoint whose body is not an object — the categories are an array. */
    private HttpStatus statusOf(String path, String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        if (accessToken != null) {
            headers.setBearerAuth(accessToken);
        }
        return HttpStatus.valueOf(rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), String.class)
                .getStatusCode()
                .value());
    }

    private void register(String email) {
        ResponseEntity<Map<String, Object>> registered = exchange(
                HttpMethod.POST,
                "/v1/auth/register",
                null,
                Map.of("email", email, "password", PASSWORD, "name", "Maintenance Fixture"));
        assertThat(registered.getStatusCode().is2xxSuccessful()).as("registration: %s", registered).isTrue();
    }

    private Map<String, Object> signIn(String email) {
        ResponseEntity<Map<String, Object>> signedIn = exchange(
                HttpMethod.POST,
                "/v1/auth/login",
                null,
                Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"));
        assertThat(signedIn.getStatusCode()).as("sign-in: %s", signedIn.getBody()).isEqualTo(HttpStatus.OK);
        return signedIn.getBody();
    }

    private UUID idOf(String email) {
        return users.findByEmailAndDeletedAtIsNull(EmailAddress.of(email)).orElseThrow().getId();
    }

    /** A reader, with a token issued rather than signed in for. */
    private Account reader() {
        String email = "maint-reader-" + UUID.randomUUID() + "@example.com";
        register(email);
        UUID id = idOf(email);
        return new Account(issue(id), id);
    }

    private Account staffWith(StaffRole role) {
        String email = "maint-" + role.name().toLowerCase() + "-" + UUID.randomUUID() + "@ideanest.test";
        register(email);
        UUID id = idOf(email);
        grant(id, role);
        return new Account(issue(id), id);
    }

    private void grant(UUID account, StaffRole role) {
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """,
                account,
                role.name(),
                moderator().id(),
                ROLE_FIXTURE_NOTE);
    }

    /** The bootstrapped super admin — see {@code ideanest-staff-tokens-are-issued-not-signed-in}. */
    private Account moderator() {
        if (moderator != null) {
            return moderator;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            register(email.value());
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        moderator = new Account(issue(id), id);
        return moderator;
    }

    private String issue(UUID account) {
        return tokens.issue(
                        account,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
    }

    /** One field of every object in a JSON array. */
    private static List<Object> field(Object array, String name) {
        return ((List<?>) array).stream().map(row -> ((Map<?, ?>) row).get(name)).map(Object.class::cast).toList();
    }

    private static Instant seconds(Instant instant) {
        return instant.truncatedTo(ChronoUnit.SECONDS);
    }

    private static UUID uuid(Object value) {
        return UUID.fromString((String) value);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
