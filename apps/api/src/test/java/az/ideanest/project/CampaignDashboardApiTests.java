package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
 * §4.7's CD-01: what the creator's dashboard answers, and who may ask.
 *
 * <p>The ones that carry the design:
 *
 * <ul>
 *   <li>{@link #aStrangerIsToldTheCampaignDoesNotExist()} — the refusal is a 404 rather
 *       than a 403, so the endpoint cannot be used to find out which identifiers name
 *       real campaigns.
 *   <li>{@link #progressIsRoundedDownAndNotCapped()} — the one number on this screen a
 *       creator acts on. Rounding it up would say a campaign reached its goal when it
 *       has not.
 *   <li>{@link #theClockIsTwoInstantsRatherThanACountdown()} — the reason there is no
 *       {@code secondsRemaining}, checked as the absence of that field and the presence
 *       of the two that replace it.
 *   <li>{@link #aClosedCampaignReportsItsFrozenOutcome()} — #63's rule: a later
 *       collection failure reduces the payout and never the outcome.
 * </ul>
 */
class CampaignDashboardApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;
    private String creatorToken;

    @BeforeEach
    void aCreatorWithACampaign() {
        handle = "dashboard-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
        creatorToken = tokenFor(creatorId);
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects WHERE creator_id = ?", creatorId);
    }

    // ------------------------------------------------------------------
    // Who may read it
    // ------------------------------------------------------------------

    /**
     * A 404, not a 403.
     *
     * <p>{@code ProjectAccess} answers a caller who is not party to a campaign that it
     * does not exist, and the dashboard inherits that. The alternative confirms the
     * identifier is real, which turns the endpoint into an oracle for what other people
     * are preparing — the argument {@code ProjectExceptionHandler} already makes about
     * drafts.
     */
    @Test
    @DisplayName("a stranger is told the campaign does not exist")
    void aStrangerIsToldTheCampaignDoesNotExist() {
        UUID projectId = liveCampaign();
        String stranger = tokenFor(accountId("stranger"));

        ResponseEntity<Map<String, Object>> response = get(projectId, stranger);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
    }

    @Test
    @DisplayName("the finance summary refuses a stranger with the same 404")
    void theFinanceSummaryRefusesAStrangerWithTheSame404() {
        UUID projectId = liveCampaign();
        String stranger = tokenFor(accountId("finance-stranger"));

        ResponseEntity<Map<String, Object>> response = get(projectId, stranger, "/finance");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
    }

    @Test
    @DisplayName("an unauthenticated caller is refused")
    void anUnauthenticatedCallerIsRefused() {
        assertThat(get(liveCampaign(), null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("the creator may read it")
    void theCreatorMayReadIt() {
        assertThat(get(liveCampaign(), creatorToken).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // What it says
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the totals are the campaign's, and money crosses as a string")
    void theTotalsAreTheCampaigns() {
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle)
                .state("LIVE")
                .goal("10000.00")
                .pledged("2500.00")
                .backers(42)
                .launchedAt(Instant.now().minus(Duration.ofDays(3)))
                .deadline(Instant.now().plus(Duration.ofDays(27)))
                .insert();

        Map<String, Object> body = get(projectId, creatorToken).getBody();

        assertThat(body).containsEntry("state", "LIVE").containsEntry("backersCount", 42);
        assertThat(moneyIn(body, "goal")).containsEntry("amount", "10000.00").containsEntry("currency", "AZN");
        assertThat(moneyIn(body, "raised"))
                .as("§10.3: an amount is a string, never a JSON number")
                .containsEntry("amount", "2500.00");
    }

    /**
     * Down, and uncapped.
     *
     * <p>2500 of 10000 is exactly 25, which proves nothing about rounding — so the
     * campaign here is one where the ratio does not terminate, and one that is past its
     * goal.
     */
    @Test
    @DisplayName("progress is rounded down and is not capped at a hundred")
    void progressIsRoundedDownAndNotCapped() {
        UUID nearlyThere = Campaigns.seed(dataSource, creatorId, handle + "-a")
                .state("LIVE")
                .goal("3000.00")
                .pledged("2999.99")
                .insert();
        UUID overfunded = Campaigns.seed(dataSource, creatorId, handle + "-b")
                .state("LIVE")
                .goal("1000.00")
                .pledged("2400.00")
                .insert();

        assertThat(rawBodyOf(nearlyThere))
                .as("99.9996% is not a campaign that reached its goal, and must not round to 100")
                .contains("\"percentFunded\":99.99");
        assertThat(get(nearlyThere, creatorToken).getBody()).containsEntry("goalReached", false);

        assertThat(rawBodyOf(overfunded)).as("a campaign at 240% says so").contains("\"percentFunded\":240.00");
        assertThat(get(overfunded, creatorToken).getBody()).containsEntry("goalReached", true);
    }

    /**
     * A draft has asked for nothing, which is not the same as having raised none of it.
     *
     * <p>Zero would render as a progress bar at the far left; absent renders as no
     * progress bar at all, which is the truth about a campaign with no goal.
     */
    @Test
    @DisplayName("a campaign with no goal has no percentage rather than a zero one")
    void aCampaignWithNoGoalHasNoPercentage() {
        UUID draft = Campaigns.seed(dataSource, creatorId, handle).state("DRAFT").insert();

        Map<String, Object> body = get(draft, creatorToken).getBody();

        assertThat(body).doesNotContainKey("percentFunded").doesNotContainKey("goal");
        assertThat(body).containsEntry("goalReached", false);
    }

    /**
     * The reason there is no {@code secondsRemaining}.
     *
     * <p>A remainder computed here is wrong the moment it is sent and grows more wrong
     * for as long as the page stays open — and the creator watching the last hour of
     * their campaign is the reader most likely to leave it open. Two instants let a
     * client measure its own clock's offset once and count down correctly against it.
     */
    @Test
    @DisplayName("the clock is a deadline and a server time, not a countdown")
    void theClockIsTwoInstantsRatherThanACountdown() {
        Instant deadline = Instant.now().plus(Duration.ofDays(5)).truncatedTo(ChronoUnit.MICROS);
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle)
                .state("LIVE")
                .goal("500.00")
                .launchedAt(Instant.now().minus(Duration.ofDays(1)))
                .deadline(deadline)
                .insert();

        Map<String, Object> body = get(projectId, creatorToken).getBody();

        assertThat(body).doesNotContainKey("secondsRemaining").doesNotContainKey("timeRemaining");
        assertThat(Instant.parse((String) body.get("deadline"))).isEqualTo(deadline);
        assertThat(Instant.parse((String) body.get("serverTime")))
                .as("the instant the answer was computed, for the client to calibrate against")
                .isBetween(Instant.now().minus(Duration.ofMinutes(1)), Instant.now().plus(Duration.ofMinutes(1)));
    }

    /**
     * #63's rule, on this screen.
     *
     * <p>The outcome is what the campaign raised at the deadline. A later collection
     * failure reduces the payout and never the outcome, so the two figures may differ —
     * and a dashboard that reported only the live total would contradict the word
     * "successful" printed beside it.
     */
    @Test
    @DisplayName("a closed campaign reports its frozen outcome alongside the live total")
    void aClosedCampaignReportsItsFrozenOutcome() {
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle)
                .state("SUCCESSFUL")
                .goal("10000.00")
                .pledged("11500.00")
                .backers(80)
                .launchedAt(Instant.now().minus(Duration.ofDays(40)))
                .deadline(Instant.now().minus(Duration.ofDays(10)))
                .insert();
        freeze(projectId, "10000.00", "12500.00", 84);

        Map<String, Object> body = get(projectId, creatorToken).getBody();

        assertThat(moneyIn(body, "raised"))
                .as("the live total, which collections have since reduced")
                .containsEntry("amount", "11500.00");

        @SuppressWarnings("unchecked")
        Map<String, Object> outcome = (Map<String, Object>) body.get("outcome");
        assertThat(outcome).isNotNull();
        assertThat(moneyIn(outcome, "pledged"))
                .as("and what it actually raised at the deadline, which does not move")
                .containsEntry("amount", "12500.00");
        assertThat(outcome).containsEntry("backersCount", 84);
    }

    /** A running campaign has not been decided, so it has nothing to report. */
    @Test
    @DisplayName("a live campaign has no outcome")
    void aLiveCampaignHasNoOutcome() {
        assertThat(get(liveCampaign(), creatorToken).getBody()).doesNotContainKey("outcome");
    }

    /**
     * The body carries {@code serverTime}, whose entire value is that it was true when it
     * was sent. A cached copy is a stopped clock handed to a client that trusts it.
     */
    @Test
    @DisplayName("the dashboard is never stored by a cache")
    void theDashboardIsNeverCached() {
        assertThat(get(liveCampaign(), creatorToken).getHeaders().getCacheControl()).isEqualTo("no-store");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private UUID liveCampaign() {
        return Campaigns.seed(dataSource, creatorId, handle)
                .state("LIVE")
                .goal("5000.00")
                .pledged("1250.00")
                .backers(9)
                .launchedAt(Instant.now().minus(Duration.ofDays(2)))
                .deadline(Instant.now().plus(Duration.ofDays(28)))
                .insert();
    }

    /** V29's four columns, written directly: #63's finaliser is not what is under test. */
    private void freeze(UUID projectId, String goal, String pledged, int backers) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects
                           SET finalized_at = now(),
                               outcome_goal_amount = ?::numeric,
                               outcome_pledged_amount = ?::numeric,
                               outcome_backers_count = ?
                         WHERE id = ?
                        """,
                        goal,
                        pledged,
                        backers,
                        projectId);
    }

    private UUID accountId(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + "-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
    }

    /**
     * A token minted rather than signed in for, exactly as {@code ContentReportApiTests}
     * does: the per-address sign-in budget is shared by the whole suite, and a class that
     * spends it makes somebody else's tests fail with a 401 that has nothing to do with
     * them.
     */
    private String tokenFor(UUID accountId) {
        return tokens.issue(
                        accountId,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
    }

    private ResponseEntity<Map<String, Object>> get(UUID projectId, String token) {
        return get(projectId, token, "/dashboard");
    }

    private ResponseEntity<Map<String, Object>> get(UUID projectId, String token, String panel) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            headers.setBearerAuth(token);
        }
        return rest.exchange(
                "/v1/projects/" + projectId + panel,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> moneyIn(Map<String, Object> body, String field) {
        return (Map<String, Object>) body.get(field);
    }

    /**
     * The response as it went over the wire.
     *
     * <p>The percentage assertions read this rather than the parsed map, because parsing
     * is exactly what would hide the thing being asserted: a reader that turns 240.00 into
     * a double and back gives 240.0, and the scale is half of what the test is about.
     */
    private String rawBodyOf(UUID projectId) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(creatorToken);
        return rest.exchange(
                        "/v1/projects/" + projectId + "/dashboard",
                        HttpMethod.GET,
                        new HttpEntity<>(headers),
                        String.class)
                .getBody();
    }
}
