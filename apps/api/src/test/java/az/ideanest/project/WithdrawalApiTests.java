package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
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
 * The creator withdraws the funds — IDN-EXT-01 (#41), §5.1.
 *
 * <p>At the success threshold or above, at any time, and the campaign closes: live, in its seven-day
 * window, extended, or already decided successful. Below the threshold there is nothing to withdraw
 * yet — a creator can still extend — and a campaign that is closed another way has nothing to decide.
 */
class WithdrawalApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("a creator at 80% withdraws a live campaign, which closes it and freezes what it raised")
    void aCreatorWithdrawsAtTheThreshold() {
        Account creator = account("withdraw-live");
        UUID project = campaign(creator, "LIVE", "800.00");

        ResponseEntity<Map<String, Object>> withdrawn = withdraw(project, creator);

        assertThat(withdrawn.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> row = row(project);
        assertThat(row.get("state")).isEqualTo("WITHDRAWN");
        assertThat(row.get("finalized_at")).isNotNull();
        assertThat((BigDecimal) row.get("outcome_pledged_amount")).isEqualByComparingTo("800.00");
    }

    @Test
    @DisplayName("below the threshold the funds cannot be withdrawn, and the campaign stays live")
    void belowTheThresholdIsRefused() {
        Account creator = account("withdraw-below");
        UUID project = campaign(creator, "LIVE", "799.99");

        ResponseEntity<Map<String, Object>> refused = withdraw(project, creator);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "WITHDRAWAL_NOT_AVAILABLE");
        assertThat(meta(refused)).containsEntry("reason", "BELOW_THRESHOLD");
        assertThat(row(project).get("state")).isEqualTo("LIVE");
    }

    @Test
    @DisplayName("a campaign in its seven-day window, or extended, can be withdrawn too")
    void theWindowAndTheExtensionCanBeWithdrawn() {
        Account creator = account("withdraw-window");
        UUID window = campaign(creator, "CLOSING_WINDOW", "900.00");
        UUID extended = campaign(creator, "EXTENDED", "1200.00");

        assertThat(withdraw(window, creator).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(withdraw(extended, creator).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(row(window).get("state")).isEqualTo("WITHDRAWN");
        assertThat(row(extended).get("state")).isEqualTo("WITHDRAWN");
    }

    @Test
    @DisplayName("a successful campaign is withdrawn without its outcome being frozen a second time")
    void aSuccessfulCampaignKeepsItsOutcome() {
        Account creator = account("withdraw-successful");
        UUID project = campaign(creator, "SUCCESSFUL", "900.00");
        Instant decided = Instant.now().minus(Duration.ofDays(3)).truncatedTo(ChronoUnit.MICROS);
        jdbc().update(
                """
                UPDATE projects SET finalized_at = ?, outcome_goal_amount = goal_amount,
                       outcome_pledged_amount = pledged_amount, outcome_backers_count = backers_count,
                       pledged_amount = 500.00
                 WHERE id = ?
                """,
                java.sql.Timestamp.from(decided),
                project);

        // The live total fell below 80% after the decision — a dispute refund — and the campaign stays
        // successful, so it can still be withdrawn.
        assertThat(withdraw(project, creator).getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> row = row(project);
        assertThat(row.get("state")).isEqualTo("WITHDRAWN");
        assertThat((BigDecimal) row.get("outcome_pledged_amount")).isEqualByComparingTo("900.00");
    }

    @Test
    @DisplayName("an unsuccessful campaign, or one already withdrawn, has nothing to withdraw")
    void closedCampaignsAreRefused() {
        Account creator = account("withdraw-closed");
        UUID unsuccessful = campaign(creator, "UNSUCCESSFUL", "900.00");
        UUID live = campaign(creator, "LIVE", "900.00");

        ResponseEntity<Map<String, Object>> refused = withdraw(unsuccessful, creator);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(meta(refused)).containsEntry("reason", "WRONG_STATE");

        assertThat(withdraw(live, creator).getStatusCode()).isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> again = withdraw(live, creator);
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(meta(again)).containsEntry("reason", "WRONG_STATE");
    }

    @Test
    @DisplayName("somebody who is not the creator cannot withdraw, and is not told the campaign exists")
    void aStrangerCannotWithdraw() {
        Account creator = account("withdraw-owner");
        UUID project = campaign(creator, "LIVE", "900.00");

        assertThat(withdraw(project, account("withdraw-stranger")).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(row(project).get("state")).isEqualTo("LIVE");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id, String slug) {
    }

    private UUID campaign(Account creator, String state, String pledged) {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        Campaigns.Seed seed = Campaigns.seed(dataSource, creator.id(), "withdraw-" + SEQUENCE.incrementAndGet())
                .state(state)
                .goal("1000.00")
                .pledged(pledged)
                .backers(3)
                .launchedAt(now.minus(Duration.ofDays(40)))
                .deadline("LIVE".equals(state) ? now.plus(Duration.ofDays(5)) : now.minus(Duration.ofDays(2)));
        if ("EXTENDED".equals(state)) {
            seed.extendedUntil(now.plus(Duration.ofDays(10)));
        }
        return seed.insert();
    }

    private ResponseEntity<Map<String, Object>> withdraw(UUID project, Account caller) {
        return post("/v1/projects/" + project + "/withdrawal", caller.accessToken(), null, null);
    }

    private Map<String, Object> row(UUID project) {
        return jdbc().queryForMap(
                "SELECT state, finalized_at, outcome_pledged_amount FROM projects WHERE id = ?", project);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(ResponseEntity<Map<String, Object>> response) {
        return (Map<String, Object>) response.getBody().get("meta");
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), json),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        var user = users.findByEmailAndDeletedAtIsNull(email).orElseThrow();
        return new Account((String) signedIn.getBody().get("accessToken"), user.getId(), user.getSlug());
    }

    private ResponseEntity<Map<String, Object>> post(String path, String token, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, HttpMethod.POST, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
