package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payout.application.PayoutDestinationReminderJob;
import az.ideanest.payout.application.WithdrawalPayouts;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
 * A withdrawal's payout and what it tells people — IDN-EXT-01 (#41), §6.3.
 *
 * <p>End to end from money a backer really paid: the pledge is paid through the payment page and a
 * signed webhook, the campaign is decided successful, and the creator withdraws through the API. The
 * outbox is relayed by hand, twice — the withdrawal requests the payout, and the request tells the
 * backers — because each is its own delivery.
 */
class WithdrawalPayoutTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private WithdrawalPayouts payouts;

    @Autowired
    private PayoutDestinationReminderJob reminders;

    private final List<UUID> paidPledges = new ArrayList<>();
    private final List<UUID> projects = new ArrayList<>();

    /**
     * Only this suite's events are relayed. {@code relay.run()} delivers everything pending, and an
     * earlier suite can leave a {@code pledge.confirmed} whose campaign another suite has since deleted
     * — delivering it here would fail a listener on a foreign key this suite has nothing to do with.
     * {@code CampaignExtendedNotificationTests} clears the table for the same reason.
     */
    @BeforeEach
    void onlyThisSuitesEvents() {
        jdbc().update("DELETE FROM outbox_events");
    }

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM provider_webhook_events");
        for (UUID project : projects) {
            jdbc().update("DELETE FROM payout_approvals WHERE payout_id IN (SELECT id FROM payouts WHERE project_id = ?)", project);
            jdbc().update("DELETE FROM payouts WHERE project_id = ?", project);
        }
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
    }

    @Test
    @DisplayName("a withdrawal requests the payout with its fourteen-day hold, and tells every backer but the creator")
    void aWithdrawalRequestsThePayoutAndTellsTheBackers() {
        Funded funded = aFundedCampaign("payout-withdrawn");

        assertThat(post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        relay.run();
        relay.run();

        Map<String, Object> payout = jdbc().queryForMap(
                "SELECT id, state, payable_at, gross_amount FROM payouts WHERE project_id = ?", funded.projectId());
        assertThat(payout.get("state")).isEqualTo("CALCULATED");
        assertThat((BigDecimal) payout.get("gross_amount")).isEqualByComparingTo("25.00");
        Instant payableAt = ((java.sql.Timestamp) payout.get("payable_at")).toInstant();
        assertThat(payableAt).isBetween(
                Instant.now().plus(Duration.ofDays(14)).minus(Duration.ofMinutes(10)),
                Instant.now().plus(Duration.ofDays(14)).plus(Duration.ofMinutes(1)));

        List<UUID> told = jdbc().queryForList(
                "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'WITHDRAWAL_REQUESTED' AND subject_id = ?",
                UUID.class,
                funded.projectId());
        assertThat(told).containsExactly(funded.backer().id());
    }

    @Test
    @DisplayName("a withdrawal delivered twice requests one payout")
    void aRedeliveryRequestsOnePayout() {
        Funded funded = aFundedCampaign("payout-twice");
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();

        UUID first = payouts.request(funded.projectId(), false).orElseThrow().id();
        UUID second = payouts.request(funded.projectId(), true).orElseThrow().id();

        assertThat(second).isEqualTo(first);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM payouts WHERE project_id = ?", Long.class, funded.projectId()))
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("a payout waiting for the creator's details reminds them on whole weeks after the hold, and not between")
    void remindersAreWeekly() {
        Funded funded = aFundedCampaign("payout-remind");
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();
        relay.run();
        UUID payoutId = jdbc().queryForObject("SELECT id FROM payouts WHERE project_id = ?", UUID.class, funded.projectId());
        Instant payableAt = ((java.sql.Timestamp) jdbc().queryForMap("SELECT payable_at FROM payouts WHERE id = ?", payoutId)
                        .get("payable_at"))
                .toInstant();

        reminders.remind(payableAt.plus(Duration.ofDays(8)).plus(Duration.ofHours(1)));
        relay.run();
        assertThat(detailsNeeded(funded)).isZero();

        reminders.remind(payableAt.plus(Duration.ofDays(7)).plus(Duration.ofHours(1)));
        relay.run();
        assertThat(detailsNeeded(funded)).isPositive();
        assertThat(jdbc().queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'PAYOUT_DETAILS_NEEDED' AND subject_id = ?",
                        UUID.class,
                        funded.projectId()))
                .containsExactly(funded.creator().id());
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id, String slug) {
    }

    private record Funded(Account creator, Account backer, UUID projectId) {
    }

    /** A campaign with one pledge of 25.00 AZN paid through the payment page, decided successful. */
    private Funded aFundedCampaign(String prefix) {
        Account creator = account(prefix + "-creator");
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects", creator.accessToken(), null, Map.of("title", "A campaign that pays out " + SEQUENCE.incrementAndGet()))
                .getBody()
                .get("id"));
        projects.add(projectId);
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));
        UUID pledgeId = UUID.fromString((String) post("/v1/pledges/draft", backer.accessToken(), UUID.randomUUID().toString(), body)
                .getBody()
                .get("id"));
        paidPledges.add(pledgeId);
        String transaction = (String) post(
                        "/v1/pledges/" + pledgeId + "/payment", backer.accessToken(), UUID.randomUUID().toString(), Map.of())
                .getBody()
                .get("providerTransactionId");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        String delivery = """
                {"id":"evt-%s","type":"charge_succeeded","providerTransactionId":"%s"}"""
                .formatted(UUID.randomUUID(), transaction);
        rest.exchange("/v1/webhooks/psp/payriff", HttpMethod.POST, new HttpEntity<>(delivery.getBytes(), headers), String.class);

        // Decided successful at 80% or more: 25.00 of a 25.00 goal.
        jdbc().update(
                """
                UPDATE projects
                   SET state = 'SUCCESSFUL', goal_amount = 25.00, deadline = now() - interval '9 days',
                       launched_at = now() - interval '40 days', finalized_at = now(),
                       outcome_goal_amount = 25.00, outcome_pledged_amount = pledged_amount,
                       outcome_backers_count = backers_count
                 WHERE id = ?
                """,
                projectId);
        return new Funded(creator, backer, projectId);
    }

    private long detailsNeeded(Funded funded) {
        return jdbc().queryForObject(
                "SELECT count(*) FROM notifications WHERE type = 'PAYOUT_DETAILS_NEEDED' AND subject_id = ?",
                Long.class,
                funded.projectId());
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
