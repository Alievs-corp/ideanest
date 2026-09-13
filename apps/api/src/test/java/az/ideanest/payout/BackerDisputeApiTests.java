package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
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
 * A backer disputes their payment during the payout hold — IDN-EXT-01 (#43), §6.3.
 *
 * <p>From money really paid: two backers pay through the payment page and a signed webhook, the
 * campaign is decided successful, the creator withdraws and the outbox requests the payout. Then a
 * backer disputes, and an administrator — the test profile's bootstrap administrator — decides.
 */
class BackerDisputeApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private AccessTokenIssuer tokens;

    private final List<UUID> paidPledges = new ArrayList<>();
    private final List<UUID> projects = new ArrayList<>();

    @BeforeEach
    void onlyThisSuitesEvents() {
        jdbc().update("DELETE FROM outbox_events");
    }

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM provider_webhook_events");
        for (UUID project : projects) {
            jdbc().update("DELETE FROM backer_disputes WHERE project_id = ?", project);
            jdbc().update("DELETE FROM payout_approvals WHERE payout_id IN (SELECT id FROM payouts WHERE project_id = ?)", project);
            jdbc().update("DELETE FROM payouts WHERE project_id = ?", project);
        }
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        // `granted_by` is RESTRICT, so a grant left behind stops IdentitySchemaTests emptying `users`.
        jdbc().update("DELETE FROM staff_role_grants WHERE note = '#43 fixture'");
    }

    @Test
    @DisplayName("a backer disputes while the payout is held, and asking again answers the same dispute")
    void aBackerDisputesDuringTheHold() {
        Campaign campaign = aWithdrawnCampaign("dispute-open");

        ResponseEntity<Map<String, Object>> opened = dispute(campaign.first());
        assertThat(opened.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(opened.getBody()).containsEntry("state", "OPEN");

        ResponseEntity<Map<String, Object>> again = dispute(campaign.first());
        assertThat(again.getBody().get("id")).isEqualTo(opened.getBody().get("id"));
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM backer_disputes WHERE pledge_id = ?", Long.class, campaign.first().pledgeId()))
                .isEqualTo(1L);

        List<Map<String, Object>> queue = get("/v1/admin/backer-disputes", admin().accessToken());
        assertThat(queue).extracting(item -> item.get("id")).contains(opened.getBody().get("id"));
    }

    @Test
    @DisplayName("before a payout is requested there is nothing to dispute yet, and a stranger is not found")
    void theWindowAndTheOwner() {
        Campaign campaign = aPaidCampaign("dispute-early");

        ResponseEntity<Map<String, Object>> early = dispute(campaign.first());
        assertThat(early.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(early.getBody()).containsEntry("code", "DISPUTE_WINDOW_CLOSED");

        Backer stranger = new Backer(account("dispute-stranger"), campaign.first().pledgeId());
        assertThat(dispute(stranger).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("upheld: the backer is refunded in full and the payout is recalculated without them, keeping its hold")
    void anUpheldDisputeRefundsAndRecalculates() {
        Campaign campaign = aWithdrawnCampaign("dispute-upheld");
        Map<String, Object> held = jdbc().queryForMap(
                "SELECT id, payable_at FROM payouts WHERE project_id = ? AND state = 'CALCULATED'", campaign.projectId());
        Object disputeId = dispute(campaign.first()).getBody().get("id");

        ResponseEntity<Map<String, Object>> decided = decide(disputeId, "UPHOLD");

        assertThat(decided.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(decided.getBody()).containsEntry("state", "UPHELD");
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM refunds WHERE pledge_id = ? AND reason = 'DISPUTE_CONCEDED'",
                        String.class,
                        campaign.first().pledgeId()))
                .isEqualTo("SUCCEEDED");
        assertThat(jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, campaign.first().pledgeId()))
                .isEqualTo("REFUNDED");

        assertThat(jdbc().queryForObject("SELECT state FROM payouts WHERE id = ?", String.class, held.get("id")))
                .isEqualTo("CANCELLED");
        Map<String, Object> recalculated = jdbc().queryForMap(
                "SELECT refunded_amount, payable_at FROM payouts WHERE project_id = ? AND state = 'CALCULATED'",
                campaign.projectId());
        assertThat((BigDecimal) recalculated.get("refunded_amount")).isEqualByComparingTo("25.00");
        assertThat(recalculated.get("payable_at")).isEqualTo(held.get("payable_at"));
        // The campaign stays closed by withdrawal, whatever the remainder is.
        assertThat(jdbc().queryForObject("SELECT state FROM projects WHERE id = ?", String.class, campaign.projectId()))
                .isEqualTo("WITHDRAWN");
    }

    @Test
    @DisplayName("rejected: nothing moves, and a decided dispute cannot be decided again")
    void aRejectedDisputeMovesNothing() {
        Campaign campaign = aWithdrawnCampaign("dispute-rejected");
        Object payout = jdbc().queryForObject(
                "SELECT id FROM payouts WHERE project_id = ? AND state = 'CALCULATED'", UUID.class, campaign.projectId());
        Object disputeId = dispute(campaign.first()).getBody().get("id");

        assertThat(decide(disputeId, "REJECT").getBody()).containsEntry("state", "REJECTED");

        assertThat(jdbc().queryForObject("SELECT count(*) FROM refunds WHERE pledge_id = ?", Long.class, campaign.first().pledgeId()))
                .isZero();
        assertThat(jdbc().queryForObject("SELECT state FROM payouts WHERE id = ?", String.class, payout))
                .isEqualTo("CALCULATED");

        ResponseEntity<Map<String, Object>> again = decide(disputeId, "UPHOLD");
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "DISPUTE_ALREADY_DECIDED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Backer(Account account, UUID pledgeId) {
    }

    private record Campaign(Account creator, UUID projectId, Backer first, Backer second) {
    }

    private Campaign aWithdrawnCampaign(String prefix) {
        Campaign campaign = aPaidCampaign(prefix);
        assertThat(post("/v1/projects/" + campaign.projectId() + "/withdrawal", campaign.creator().accessToken(), null, null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        relay.run();
        relay.run();
        return campaign;
    }

    /** Two backers of 25.00 AZN each, paid through the payment page; the campaign decided successful. */
    private Campaign aPaidCampaign(String prefix) {
        Account creator = account(prefix + "-creator");
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects",
                        creator.accessToken(),
                        null,
                        Map.of("title", "A campaign somebody disputes " + SEQUENCE.incrementAndGet()))
                .getBody()
                .get("id"));
        projects.add(projectId);
        Campaigns.launch(dataSource, projectId);

        Backer first = paid(projectId, account(prefix + "-first"));
        Backer second = paid(projectId, account(prefix + "-second"));

        jdbc().update(
                """
                UPDATE projects
                   SET state = 'SUCCESSFUL', goal_amount = 50.00, deadline = now() - interval '9 days',
                       launched_at = now() - interval '40 days', finalized_at = now(),
                       outcome_goal_amount = 50.00, outcome_pledged_amount = pledged_amount,
                       outcome_backers_count = backers_count
                 WHERE id = ?
                """,
                projectId);
        return new Campaign(creator, projectId, first, second);
    }

    private Backer paid(UUID projectId, Account backer) {
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
        return new Backer(backer, pledgeId);
    }

    private ResponseEntity<Map<String, Object>> dispute(Backer backer) {
        return post(
                "/v1/pledges/" + backer.pledgeId() + "/disputes",
                backer.account().accessToken(),
                null,
                Map.of("reason", "The reward was described differently when I backed it."));
    }

    private ResponseEntity<Map<String, Object>> decide(Object disputeId, String outcome) {
        return post(
                "/v1/admin/backer-disputes/" + disputeId + "/decision",
                admin().accessToken(),
                null,
                Map.of("outcome", outcome, "note", "Checked against the campaign page as it stood."));
    }

    /**
     * An administrator of this suite's own: a user row holding a V48 grant.
     *
     * <p>Not the test profile's bootstrap address. {@code IdentitySchemaTests} empties {@code users}, so
     * every suite that needs {@code moderator@ideanest.test} registers it again, and registration is
     * limited to three per address for the whole run: a suite that spends one of those leaves a later
     * suite without its administrator.
     */
    private Account admin() {
        UUID id = Campaigns.creator(dataSource, "backer-dispute-administrator");
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, 'ADMINISTRATOR', ?, '#43 fixture')
                ON CONFLICT DO NOTHING
                """,
                id,
                id);
        return tokenFor(id);
    }

    /** An account written straight into {@code users}, for the same reason: nothing here is about registering. */
    private Account account(String prefix) {
        return tokenFor(Campaigns.creator(dataSource, prefix + "-" + SEQUENCE.incrementAndGet()));
    }

    private Account tokenFor(UUID id) {
        String token = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, java.time.Instant.now())
                .value();
        return new Account(token, id);
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

    private List<Map<String, Object>> get(String path, String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return rest.exchange(
                        path,
                        HttpMethod.GET,
                        new HttpEntity<>(headers),
                        new ParameterizedTypeReference<List<Map<String, Object>>>() {})
                .getBody();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
