package az.ideanest.platform;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
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
 * AD-12 over HTTP: the console's list and save, and the public answer a client reads.
 *
 * <p>What is held here is what the console relies on and could not see go wrong: a create
 * never overwrites a flag that exists, an edit made from a stale list is refused rather than
 * applied over somebody else's, a save moves "last changed", a name the schema refuses is a
 * 400 rather than a 500, and the audit row says what the flag was before as well as after.
 *
 * <p>Flags use a {@code ff-test-} prefix and are deleted after each test, so the suite never
 * leaves a switch behind for another one to read.
 */
class FeatureFlagApiTests extends AbstractIntegrationTest {

    private static final String PASSWORD = "a-long-enough-password";

    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static final String ROLE_FIXTURE_NOTE = "feature flag fixture";

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

    private Account moderator;

    @AfterEach
    void removeTestFlags() {
        clock.reset();
        jdbc().update("DELETE FROM feature_flags WHERE key LIKE 'ff-test-%'");
        jdbc().update("DELETE FROM staff_role_grants WHERE note = ?", ROLE_FIXTURE_NOTE);
    }

    // ------------------------------------------------------------------
    // The console
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a new flag is created at version nought and listed by name")
    void createAndList() {
        String key = key();

        Map<String, Object> created = save(key, body("The rebuilt checkout", false, 0, List.of(), null), HttpStatus.OK);

        assertThat(created)
                .containsEntry("key", key)
                .containsEntry("enabled", false)
                .containsEntry("rolloutPercentage", 0)
                .containsEntry("version", 0)
                .containsEntry("updatedBy", moderator().id().toString());
        assertThat(created.get("updatedAt")).isNotNull();

        Map<String, Object> list = exchange(HttpMethod.GET, "/v1/admin/feature-flags", moderator().accessToken(), null)
                .getBody();
        assertThat(field(list.get("flags"), "key")).contains(key);
    }

    @Test
    @DisplayName("creating a name that exists is refused, and the flag is left as it was")
    void aCreateNeverOverwrites() {
        String key = key();
        Map<String, Object> live = save(key, body("Live", false, 0, List.of(), null), HttpStatus.OK);
        save(key, body("Live", true, 100, List.of(), number(live.get("version"))), HttpStatus.OK);

        // What the "add a flag" form used to send for a name that was already taken: off, at
        // nought — which switched a live flag off for everybody.
        ResponseEntity<Map<String, Object>> refused =
                put(key, body("Typed again", false, 0, List.of(), null), moderator().accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "FEATURE_FLAG_EXISTS");
        Map<String, Object> row =
                jdbc().queryForMap("SELECT enabled, rollout_percentage, description FROM feature_flags WHERE key = ?", key);
        assertThat(row).containsEntry("enabled", true).containsEntry("description", "Live");
        assertThat(((Number) row.get("rollout_percentage")).intValue()).isEqualTo(100);
    }

    @Test
    @DisplayName("an edit from a stale version is refused, and the newer edit stands")
    void staleEditsAreRefused() {
        String key = key();
        long read = number(save(key, body("Shared", false, 0, List.of(), null), HttpStatus.OK).get("version"));

        // Two people opened the list at the same version. The first one's save lands.
        Map<String, Object> first = save(key, body("Shared", true, 25, List.of(), read), HttpStatus.OK);
        assertThat(number(first.get("version"))).isEqualTo(read + 1);

        // The second one's would have put the percentage back to nought.
        ResponseEntity<Map<String, Object>> second = put(key, body("Shared", true, 0, List.of(), read), moderator().accessToken());

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(second.getBody()).containsEntry("code", "FEATURE_FLAG_CHANGED");
        assertThat(jdbc().queryForObject("SELECT rollout_percentage FROM feature_flags WHERE key = ?", Integer.class, key))
                .isEqualTo(25);
    }

    @Test
    @DisplayName("an edit of a flag that does not exist is a 404, not a create")
    void editingNothingIsNotFound() {
        ResponseEntity<Map<String, Object>> refused = put(key(), body("Nothing", true, 0, List.of(), 0L), moderator().accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "FEATURE_FLAG_NOT_FOUND");
    }

    @Test
    @DisplayName("every save moves the time it was last changed")
    void savesMoveUpdatedAt() {
        String key = key();
        Map<String, Object> created = save(key, body("Timed", false, 0, List.of(), null), HttpStatus.OK);

        clock.advance(Duration.ofHours(3));
        Map<String, Object> edited = save(key, body("Timed", true, 0, List.of(), number(created.get("version"))), HttpStatus.OK);

        Instant before = Instant.parse((String) created.get("updatedAt"));
        Instant after = Instant.parse((String) edited.get("updatedAt"));
        assertThat(Duration.between(before, after)).isGreaterThanOrEqualTo(Duration.ofHours(3));
    }

    @Test
    @DisplayName("a name the schema refuses is a 400 with a code, not a 500")
    void badNamesAreTheCallersMistake() {
        for (String name : List.of("Checkout", "ab", "-starts-with-hyphen", "ends-with-hyphen-")) {
            ResponseEntity<Map<String, Object>> refused =
                    put(name, body("Bad name", false, 0, List.of(), null), moderator().accessToken());

            assertThat(refused.getStatusCode()).as(name).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(refused.getBody()).as(name).containsEntry("code", "FEATURE_FLAG_KEY_INVALID");
        }
    }

    @Test
    @DisplayName("a null account is refused and a repeated one is kept once")
    void theAccountListIsClean() {
        String key = key();
        UUID insider = UUID.randomUUID();
        List<Object> withNull = new ArrayList<>();
        withNull.add(insider.toString());
        withNull.add(null);

        ResponseEntity<Map<String, Object>> refused = put(key, body("Accounts", true, 0, withNull, null), moderator().accessToken());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        Map<String, Object> saved = save(
                key, body("Accounts", true, 0, List.of(insider.toString(), insider.toString()), null), HttpStatus.OK);
        assertThat(saved.get("enabledAccounts")).isEqualTo(List.of(insider.toString()));
    }

    @Test
    @DisplayName("the audit row has the flag before and after, and the accounts that came and went")
    void savesAreAuditedWithBeforeAndAfter() {
        String key = key();
        UUID kept = UUID.randomUUID();
        UUID dropped = UUID.randomUUID();
        UUID added = UUID.randomUUID();
        Map<String, Object> created = save(
                key, body("Audited", false, 0, List.of(kept.toString(), dropped.toString()), null), HttpStatus.OK);
        save(key,
                body("Audited again", true, 50, List.of(kept.toString(), added.toString()), number(created.get("version"))),
                HttpStatus.OK);

        List<String> details = jdbc().queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'feature.flag_changed' AND detail LIKE ? ORDER BY occurred_at",
                String.class,
                "key=" + key + ";%");

        assertThat(details).hasSize(2);
        assertThat(details.get(0)).contains("before: none").contains("after: enabled=false, rollout=0, accounts=2");
        assertThat(details.get(1))
                .contains("before: enabled=false, rollout=0, accounts=2, description=\"Audited\"")
                .contains("after: enabled=true, rollout=50, accounts=2, description=\"Audited again\"")
                .contains("accounts added=[" + added + "]")
                .contains("accounts removed=[" + dropped + "]");
    }

    @Test
    @DisplayName("the console's reads and writes need CONFIGURE_PLATFORM")
    void theConsoleNeedsTheCapability() {
        Account curator = staffWith(StaffRole.CURATOR);

        assertThat(exchange(HttpMethod.GET, "/v1/admin/feature-flags", curator.accessToken(), null).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        String key = key();
        assertThat(put(key, body("Nope", true, 100, List.of(), null), curator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM feature_flags WHERE key = ?", Integer.class, key))
                .isZero();
    }

    // ------------------------------------------------------------------
    // The public answer
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a visitor gets the answer that does not depend on who is asking")
    void visitorsGetTheRolloutIndependentAnswer() {
        String everybody = key();
        String half = key();
        String off = key();
        enable(everybody, 100, List.of());
        enable(half, 50, List.of());
        save(off, body("Off", false, 0, List.of(), null), HttpStatus.OK);

        ResponseEntity<Map<String, Object>> answer = exchange(HttpMethod.GET, "/v1/feature-flags", null, null);

        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(answer.getHeaders().getCacheControl()).contains("private").contains("max-age=");
        assertThat(answer.getHeaders().getVary()).contains(HttpHeaders.AUTHORIZATION);
        Map<?, ?> flags = (Map<?, ?>) answer.getBody().get("flags");
        assertThat(flags.get(everybody)).isEqualTo(true);
        assertThat(flags.get(half)).isEqualTo(false);
        assertThat(flags.get(off)).isEqualTo(false);
    }

    @Test
    @DisplayName("a signed-in reader named on a flag sees it, and switching it off takes it away at once")
    void readersGetTheirOwnAnswer() {
        Account reader = reader();
        String key = key();
        Map<String, Object> on = enable(key, 0, List.of(reader.id().toString()));

        Map<?, ?> flags = (Map<?, ?>) exchange(HttpMethod.GET, "/v1/feature-flags", reader.accessToken(), null)
                .getBody()
                .get("flags");
        assertThat(flags.get(key)).isEqualTo(true);

        save(key, body("Enabled", false, 0, List.of(reader.id().toString()), number(on.get("version"))), HttpStatus.OK);

        Map<?, ?> after = (Map<?, ?>) exchange(HttpMethod.GET, "/v1/feature-flags", reader.accessToken(), null)
                .getBody()
                .get("flags");
        assertThat(after.get(key)).isEqualTo(false);
    }

    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Map<String, Object> enable(String key, int rollout, List<Object> accounts) {
        Map<String, Object> created = save(key, body("Enabled", false, 0, accounts, null), HttpStatus.OK);
        return save(key, body("Enabled", true, rollout, accounts, number(created.get("version"))), HttpStatus.OK);
    }

    private static String key() {
        return "ff-test-" + SEQUENCE.incrementAndGet() + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static Map<String, Object> body(
            String description, boolean enabled, int rollout, List<?> accounts, Long version) {
        Map<String, Object> body = new HashMap<>();
        body.put("description", description);
        body.put("enabled", enabled);
        body.put("rolloutPercentage", rollout);
        body.put("enabledAccounts", accounts);
        if (version != null) {
            body.put("version", version);
        }
        return body;
    }

    private Map<String, Object> save(String key, Map<String, Object> body, HttpStatus expected) {
        ResponseEntity<Map<String, Object>> response = put(key, body, moderator().accessToken());
        assertThat(response.getStatusCode()).as("PUT %s answered %s", key, response.getBody()).isEqualTo(expected);
        return response.getBody();
    }

    private ResponseEntity<Map<String, Object>> put(String key, Map<String, Object> body, String accessToken) {
        return exchange(HttpMethod.PUT, "/v1/admin/feature-flags/" + key, accessToken, body);
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

    private static long number(Object value) {
        return ((Number) value).longValue();
    }

    private static List<Object> field(Object array, String name) {
        return ((List<?>) array).stream().map(row -> ((Map<?, ?>) row).get(name)).map(Object.class::cast).toList();
    }

    private void register(String email) {
        ResponseEntity<Map<String, Object>> registered = exchange(
                HttpMethod.POST,
                "/v1/auth/register",
                null,
                Map.of("email", email, "password", PASSWORD, "name", "Flag Fixture"));
        assertThat(registered.getStatusCode().is2xxSuccessful()).as("registration: %s", registered).isTrue();
    }

    private UUID idOf(String email) {
        return users.findByEmailAndDeletedAtIsNull(EmailAddress.of(email)).orElseThrow().getId();
    }

    private Account reader() {
        String email = "ff-reader-" + UUID.randomUUID() + "@example.com";
        register(email);
        UUID id = idOf(email);
        return new Account(issue(id), id);
    }

    private Account staffWith(StaffRole role) {
        String email = "ff-" + role.name().toLowerCase() + "-" + UUID.randomUUID() + "@ideanest.test";
        register(email);
        UUID id = idOf(email);
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """,
                id,
                role.name(),
                moderator().id(),
                ROLE_FIXTURE_NOTE);
        return new Account(issue(id), id);
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

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
