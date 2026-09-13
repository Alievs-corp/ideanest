package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
 * §5.1's one extension over HTTP — IDN-EXT-01 (#34).
 *
 * <p><strong>The tests that carry the rule are the refusals</strong>, one per condition, because
 * each sends a creator somewhere different and a client branches on the reason: below half the
 * goal, outside seven days either side of the deadline, a second extension, and a date past D+60.
 *
 * <p>Campaigns are created over the API and then placed with SQL: the deadline and the amounts are
 * what the rule is about, and moving a real clock a week to reach them is not a test anybody runs.
 */
class CampaignExtensionApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Extending
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a creator at half the goal extends a live campaign a few days before its deadline")
    void aCreatorExtendsOnce() {
        Account creator = account("extend-ok");
        Instant deadline = now().plus(Duration.ofDays(3));
        UUID project = live(creator, "10000.00", "5000.00", deadline);
        Instant until = deadline.plus(Duration.ofDays(20));

        ResponseEntity<Map<String, Object>> extended = extend(project, creator, until);

        assertThat(extended.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(extended.getBody()).containsEntry("state", "EXTENDED");

        Map<String, Object> row = new JdbcTemplate(dataSource)
                .queryForMap("SELECT deadline, extended_until, extension_used_at FROM projects WHERE id = ?", project);
        // The first deadline is kept: the window and the D+60 limit are both measured from it.
        assertThat(((Timestamp) row.get("deadline")).toInstant()).isEqualTo(deadline);
        assertThat(((Timestamp) row.get("extended_until")).toInstant()).isEqualTo(until);
        assertThat(row.get("extension_used_at")).isNotNull();

        // Backers are told, not asked: the event is recorded in the same transaction.
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT count(*) FROM outbox_events WHERE aggregate_id = ? AND event_type = 'project.extended'",
                                Integer.class,
                                project))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a campaign in its seven-day window can still be extended")
    void theWindowAfterTheDeadlineCounts() {
        Account creator = account("extend-window");
        Instant deadline = now().minus(Duration.ofDays(5));
        UUID project = campaign(creator, "CLOSING_WINDOW", "10000.00", "6000.00", deadline);

        ResponseEntity<Map<String, Object>> extended = extend(project, creator, deadline.plus(Duration.ofDays(30)));

        assertThat(extended.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(extended.getBody()).containsEntry("state", "EXTENDED");
    }

    // ------------------------------------------------------------------
    // The refusals, one per condition
    // ------------------------------------------------------------------

    @Test
    @DisplayName("below half the goal is refused with BELOW_THRESHOLD")
    void belowHalfIsRefused() {
        Account creator = account("extend-below");
        Instant deadline = now().plus(Duration.ofDays(2));
        UUID project = live(creator, "10000.00", "4999.99", deadline);

        assertRefused(extend(project, creator, deadline.plus(Duration.ofDays(10))), "BELOW_THRESHOLD");
    }

    @Test
    @DisplayName("more than seven days before the deadline is refused with OUTSIDE_WINDOW")
    void tooEarlyIsRefused() {
        Account creator = account("extend-early");
        Instant deadline = now().plus(Duration.ofDays(10));
        UUID project = live(creator, "10000.00", "9000.00", deadline);

        assertRefused(extend(project, creator, deadline.plus(Duration.ofDays(10))), "OUTSIDE_WINDOW");
    }

    @Test
    @DisplayName("after the seven-day window has ended is refused with OUTSIDE_WINDOW")
    void tooLateIsRefused() {
        Account creator = account("extend-late");
        Instant deadline = now().minus(Duration.ofDays(8));
        // Still CLOSING_WINDOW because no sweep has run in this test; the rule reads the clock.
        UUID project = campaign(creator, "CLOSING_WINDOW", "10000.00", "9000.00", deadline);

        assertRefused(extend(project, creator, deadline.plus(Duration.ofDays(20))), "OUTSIDE_WINDOW");
    }

    @Test
    @DisplayName("a second extension is refused with ALREADY_EXTENDED")
    void onceIsOnce() {
        Account creator = account("extend-twice");
        Instant deadline = now().plus(Duration.ofDays(1));
        UUID project = live(creator, "10000.00", "8000.00", deadline);
        assertThat(extend(project, creator, deadline.plus(Duration.ofDays(10))).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertRefused(extend(project, creator, deadline.plus(Duration.ofDays(20))), "ALREADY_EXTENDED");
    }

    @Test
    @DisplayName("an end beyond sixty days after the first deadline is refused on the field")
    void beyondSixtyDaysIsRefused() {
        Account creator = account("extend-far");
        Instant deadline = now().minus(Duration.ofDays(6));
        UUID project = campaign(creator, "CLOSING_WINDOW", "10000.00", "7000.00", deadline);

        // Measured from the FIRST deadline even when extending on day six after it, so sixty-one
        // days from the deadline is refused although it is only fifty-five days from now.
        ResponseEntity<Map<String, Object>> refused = extend(project, creator, deadline.plus(Duration.ofDays(61)));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_FIELD_INVALID");
        assertThat(meta(refused.getBody())).containsEntry("field", "until");

        assertThat(extend(project, creator, deadline.plus(Duration.ofDays(60))).getStatusCode())
                .as("exactly sixty days is allowed")
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("an end that is not after the first deadline is refused on the field")
    void anEndBeforeTheDeadlineIsRefused() {
        Account creator = account("extend-short");
        Instant deadline = now().plus(Duration.ofDays(2));
        UUID project = live(creator, "10000.00", "7000.00", deadline);

        ResponseEntity<Map<String, Object>> refused = extend(project, creator, deadline.minus(Duration.ofHours(1)));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(meta(refused.getBody())).containsEntry("field", "until");
    }

    @Test
    @DisplayName("somebody who is not the creator cannot extend the campaign")
    void onlyTheCreatorExtends() {
        Account creator = account("extend-owner");
        Account stranger = account("extend-stranger");
        Instant deadline = now().plus(Duration.ofDays(2));
        UUID project = live(creator, "10000.00", "7000.00", deadline);

        ResponseEntity<Map<String, Object>> refused = extend(project, stranger, deadline.plus(Duration.ofDays(10)));

        // Not found rather than forbidden, as every project endpoint answers a stranger: whether a
        // campaign exists is not something its non-owners are told by this route.
        assertThat(refused.getStatusCode().is4xxClientError()).isTrue();
        assertThat(state(project)).isEqualTo("LIVE");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private UUID live(Account creator, String goal, String pledged, Instant deadline) {
        return campaign(creator, "LIVE", goal, pledged, deadline);
    }

    /** A campaign created over the API, launched, then placed at the deadline and amounts the rule reads. */
    private UUID campaign(Account creator, String state, String goal, String pledged, Instant deadline) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign that may run longer " + SEQUENCE.incrementAndGet()));
        UUID project = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, project);
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE projects SET state = ?, goal_amount = ?::numeric, pledged_amount = ?::numeric,"
                                + " launched_at = ?, deadline = ?, duration_days = 30 WHERE id = ?",
                        state,
                        goal,
                        pledged,
                        Timestamp.from(deadline.minus(Duration.ofDays(30))),
                        Timestamp.from(deadline),
                        project);
        return project;
    }

    private ResponseEntity<Map<String, Object>> extend(UUID project, Account caller, Instant until) {
        return exchange(
                "/v1/projects/" + project + "/extension",
                HttpMethod.POST,
                caller.accessToken(),
                Map.of("until", until.toString()));
    }

    private void assertRefused(ResponseEntity<Map<String, Object>> response, String reason) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).containsEntry("code", "EXTENSION_NOT_AVAILABLE");
        assertThat(meta(response.getBody())).containsEntry("reason", reason);
    }

    private String state(UUID project) {
        return new JdbcTemplate(dataSource).queryForObject("SELECT state FROM projects WHERE id = ?", String.class, project);
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        return new Account(
                (String) signedIn.getBody().get("accessToken"),
                users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(token);
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> body) {
        return (Map<String, Object>) body.get("meta");
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        return headers;
    }
}
