package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
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
 * When a campaign takes pledges — IDN-EXT-01 (#36), which switched §4.5's PL-16 off.
 *
 * <p>A campaign takes pledges while it is {@code LIVE} and before its first deadline, in
 * {@code CLOSING_WINDOW} for the seven days after it, and {@code EXTENDED} until its extension
 * ends — and at no other time. Every pledge in those periods counts towards the goal the
 * campaign is judged on, so none is stamped {@code is_late_pledge}.
 *
 * <p>Late pledges (#81) are switched off: no state has an edge into {@code LATE_PLEDGE}, so
 * opening a window is refused, and a campaign already in that state takes no pledge but can
 * still start delivering. Stage 4 (#45) removes the routes, the state and the columns.
 *
 * <p><strong>The fixtures write the row</strong> for the states past {@code LIVE}: the edges
 * into them are the finaliser's and the extension's, which have their own tests, and what is
 * asserted here is only what a backer is told.
 */
class LatePledgeApiTests extends AbstractIntegrationTest {

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
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Late pledges are switched off
    // ------------------------------------------------------------------

    @Test
    @DisplayName("IDN-EXT-01: opening a late-pledge window is refused, even for a campaign that enabled them")
    void openingALatePledgeWindowIsRefused() {
        Account creator = account("late-open");
        UUID project = collectingCampaign(creator, true);

        ResponseEntity<Map<String, Object>> refused = open(project, creator, Instant.now().plus(Duration.ofDays(7)));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_TRANSITION_NOT_ALLOWED");
        assertThat(state(project)).isEqualTo("COLLECTING");
    }

    @Test
    @DisplayName("somebody who is not the creator is still answered 404, not told the campaign's state")
    void aStrangerIsStillNotFound() {
        Account creator = account("late-owner");
        UUID project = collectingCampaign(creator, true);

        ResponseEntity<Map<String, Object>> refused =
                open(project, account("late-stranger"), Instant.now().plus(Duration.ofDays(7)));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("a campaign already in LATE_PLEDGE takes no pledge")
    void aCampaignAlreadyInLatePledgeTakesNoPledge() {
        Account creator = account("late-already");
        UUID project = alreadyInLatePledge(creator);

        ResponseEntity<Map<String, Object>> refused = draft(project, account("late-already-backer"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_LIVE");
        assertThat(meta(refused.getBody())).containsEntry("state", "LATE_PLEDGE");
    }

    @Test
    @DisplayName("a campaign already in LATE_PLEDGE can still start delivering")
    void aCampaignAlreadyInLatePledgeCanStillClose() {
        Account creator = account("late-close");
        UUID project = alreadyInLatePledge(creator);

        ResponseEntity<Map<String, Object>> closed = exchange(
                "/v1/projects/" + project + "/late-pledges/close", HttpMethod.POST, creator.accessToken(), null);

        assertThat(closed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(closed.getBody()).containsEntry("state", "FULFILLING");
    }

    // ------------------------------------------------------------------
    // The three periods that take pledges
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a live campaign before its deadline takes a pledge, and it is not a late one")
    void aLiveCampaignTakesAPledge() {
        Account creator = account("late-normal");
        UUID project = project(creator);
        Campaigns.launch(dataSource, project);

        ResponseEntity<Map<String, Object>> created = draft(project, account("late-normal-backer"));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(isLate(UUID.fromString((String) created.getBody().get("id")))).isFalse();
    }

    @Test
    @DisplayName("a campaign in its seven days after the deadline takes a pledge, and it is not a late one")
    void theClosingWindowTakesAPledge() {
        Account creator = account("window-open");
        UUID project = inClosingWindow(creator, Duration.ofDays(1));

        ResponseEntity<Map<String, Object>> created = draft(project, account("window-open-backer"));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(isLate(UUID.fromString((String) created.getBody().get("id")))).isFalse();
    }

    @Test
    @DisplayName("once the seven days have ended a pledge is refused, naming the window's end")
    void anEndedClosingWindowRefusesAPledge() {
        Account creator = account("window-over");
        // Eight days past the deadline: the window ended a day ago, and the finaliser has not
        // reached the campaign yet.
        UUID project = inClosingWindow(creator, Duration.ofDays(8));

        ResponseEntity<Map<String, Object>> refused = draft(project, account("window-over-backer"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_LIVE");
        assertThat(meta(refused.getBody())).containsEntry("state", "CLOSING_WINDOW");
        Instant ends = Instant.parse((String) meta(refused.getBody()).get("deadline"));
        assertThat(ends)
                .as("the window's end, a day ago, and not the deadline eight days ago")
                .isBetween(Instant.now().minus(Duration.ofDays(1)).minus(Duration.ofMinutes(5)), Instant.now());
    }

    @Test
    @DisplayName("an extended campaign takes a pledge until its extension ends")
    void anExtendedCampaignTakesAPledge() {
        Account creator = account("extended-open");
        UUID project = extended(creator, Instant.now().plus(Duration.ofDays(10)));

        ResponseEntity<Map<String, Object>> created = draft(project, account("extended-open-backer"));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(isLate(UUID.fromString((String) created.getBody().get("id")))).isFalse();
    }

    @Test
    @DisplayName("after the extension ends a pledge is refused, naming the extension's end")
    void anEndedExtensionRefusesAPledge() {
        Account creator = account("extended-over");
        Instant until = Instant.now().minus(Duration.ofHours(1));
        UUID project = extended(creator, until);

        ResponseEntity<Map<String, Object>> refused = draft(project, account("extended-over-backer"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_LIVE");
        assertThat(meta(refused.getBody())).containsEntry("state", "EXTENDED");
        Instant ends = Instant.parse((String) meta(refused.getBody()).get("deadline"));
        assertThat(ends).isBetween(until.minus(Duration.ofSeconds(1)), until.plus(Duration.ofSeconds(1)));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id, String slug) {
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

        var user = users.findByEmailAndDeletedAtIsNull(email).orElseThrow();
        return new Account((String) signedIn.getBody().get("accessToken"), user.getId(), user.getSlug());
    }

    private UUID project(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign with a second wind " + SEQUENCE.incrementAndGet()));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** A campaign that closed above goal and is being collected — see {@code Campaigns.collecting}. */
    private UUID collectingCampaign(Account creator, boolean latePledgesEnabled) {
        UUID project = project(creator);
        if (latePledgesEnabled) {
            enableLatePledges(project, creator);
        }
        Campaigns.collecting(dataSource, project);
        return project;
    }

    private void enableLatePledges(UUID project, Account creator) {
        patch(project, creator, Map.of("latePledgeEnabled", true));
    }

    /** A campaign that entered LATE_PLEDGE before #36, with its window still open — written by hand. */
    private UUID alreadyInLatePledge(Account creator) {
        UUID project = collectingCampaign(creator, true);
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE projects SET state = 'LATE_PLEDGE', late_pledge_ends_at = now() + interval '7 days'"
                                + " WHERE id = ?",
                        project);
        return project;
    }

    /** A launched campaign whose first deadline was {@code sinceDeadline} ago, in CLOSING_WINDOW. */
    private UUID inClosingWindow(Account creator, Duration sinceDeadline) {
        UUID project = project(creator);
        Campaigns.launch(dataSource, project);
        new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects
                           SET state = 'CLOSING_WINDOW',
                               launched_at = now() - interval '40 days',
                               deadline = now() - make_interval(secs => ?)
                         WHERE id = ?
                        """,
                        sinceDeadline.toSeconds(),
                        project);
        return project;
    }

    /** A launched campaign extended until {@code until}, its first deadline twelve days ago. */
    private UUID extended(Account creator, Instant until) {
        UUID project = project(creator);
        Campaigns.launch(dataSource, project);
        new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects
                           SET state = 'EXTENDED',
                               launched_at = now() - interval '40 days',
                               deadline = now() - interval '12 days',
                               extended_until = ?,
                               extension_used_at = now() - interval '6 days'
                         WHERE id = ?
                        """,
                        java.sql.Timestamp.from(until),
                        project);
        return project;
    }

    private ResponseEntity<Map<String, Object>> patch(UUID project, Account creator, Map<String, Object> body) {
        return exchange("/v1/projects/" + project, HttpMethod.PATCH, creator.accessToken(), body);
    }

    private ResponseEntity<Map<String, Object>> open(UUID project, Account caller, Instant endsAt) {
        return exchange(
                "/v1/projects/" + project + "/late-pledges",
                HttpMethod.POST,
                caller.accessToken(),
                Map.of("endsAt", endsAt.toString()));
    }

    private ResponseEntity<Map<String, Object>> draft(UUID project, Account backer) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", project.toString());
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));

        HttpHeaders headers = bearer(backer.accessToken());
        headers.set("Idempotency-Key", UUID.randomUUID().toString());
        return rest.exchange(
                "/v1/pledges/draft",
                HttpMethod.POST,
                new HttpEntity<>(body, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private boolean isLate(UUID pledgeId) {
        return Boolean.TRUE.equals(new JdbcTemplate(dataSource)
                .queryForObject("SELECT is_late_pledge FROM pledges WHERE id = ?", Boolean.class, pledgeId));
    }

    private String state(UUID project) {
        return new JdbcTemplate(dataSource).queryForObject("SELECT state FROM projects WHERE id = ?", String.class, project);
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> body) {
        return (Map<String, Object>) body.get("meta");
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
