package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payment.domain.PayoutRequest;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payout.application.PayoutDestinationReminderJob;
import az.ideanest.payout.application.WithdrawalPayouts;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
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
import org.springframework.dao.DataIntegrityViolationException;
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

    @Autowired
    private ScriptedPaymentProvider provider;

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
        // Payouts, their approvals and the campaign-level PAYOUT transactions a send writes (#184's review):
        // those name no pledge, so clearing the pledges would leave them holding the campaign.
        PaymentRows.clearProjects(dataSource, projects);
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        Destinations.clear(dataSource);
        provider.reset();
        // `granted_by` is RESTRICT, so a grant left behind stops IdentitySchemaTests emptying `users`.
        jdbc().update("DELETE FROM staff_role_grants WHERE note = '#182 fixture'");
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
    @DisplayName("#182: a campaign paid out once is not priced again, by finance or by a redelivered withdrawal")
    void aPaidCampaignIsNotPricedAgain() {
        Funded funded = aFundedCampaign("payout-paid");
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();
        UUID paid = jdbc().queryForObject("SELECT id FROM payouts WHERE project_id = ?", UUID.class, funded.projectId());
        // Sent: `PayoutGateway.send` needs a provider that answers payouts, which the scripted one does not.
        // Any transaction row satisfies payouts_paid_has_transaction; the charge is the one at hand.
        jdbc().update(
                """
                UPDATE payouts
                   SET state = 'PAID', sent_at = now(),
                       payout_transaction_id = (SELECT id FROM transactions WHERE project_id = ? AND type = 'CHARGE' LIMIT 1)
                 WHERE id = ?
                """,
                funded.projectId(),
                paid);

        ResponseEntity<Map<String, Object>> again =
                post("/v1/admin/payouts", administrator().accessToken(), null, Map.of("projectId", funded.projectId().toString()));

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "CAMPAIGN_ALREADY_PAID_OUT");
        assertThat(again.getBody().get("meta")).isEqualTo(Map.of("payoutId", paid.toString()));
        assertThat(payouts.request(funded.projectId(), true)).isEmpty();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM payouts WHERE project_id = ?", Long.class, funded.projectId()))
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("#184's review: a payout left in flight for a campaign already paid is refused before the provider")
    void aPayoutInFlightForAPaidCampaignIsNotSent() {
        Funded funded = aFundedCampaign("payout-paid-in-flight");
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();
        UUID paid = markPaid(funded.projectId());
        // Priced before #182, or by a previous-release node during the deploy, and since approved.
        UUID approved = anotherPayout(funded.projectId(), "APPROVED");
        Account admin = administrator();
        jdbc().update("INSERT INTO payout_approvals (payout_id, approver_id) VALUES (?, ?)", approved, admin.id());

        ResponseEntity<Map<String, Object>> sent = post("/v1/admin/payouts/" + approved + "/send", admin.accessToken(), null, null);

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(sent.getBody()).containsEntry("code", "CAMPAIGN_ALREADY_PAID_OUT");
        assertThat(sent.getBody().get("meta")).isEqualTo(Map.of("payoutId", paid.toString()));
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM transactions WHERE project_id = ? AND type = 'PAYOUT'", Long.class, funded.projectId()))
                .isZero();
        assertThat(jdbc().queryForObject("SELECT state FROM payouts WHERE id = ?", String.class, approved))
                .isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("#352: a provider that cannot pay out is 503 NO_PAYOUT_PROVIDER, and the payout stays approved")
    void aProviderThatCannotPayOutIsUnavailable() {
        Funded funded = aFundedCampaign("payout-unsupported");
        UUID payout = approvedAndSendable(funded);
        Account admin = administrator();
        // Unscripted, the provider refuses with UnsupportedOperationException — as Payriff's adapter does.

        ResponseEntity<Map<String, Object>> sent = post("/v1/admin/payouts/" + payout + "/send", admin.accessToken(), null, null);

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(sent.getBody()).containsEntry("code", "NO_PAYOUT_PROVIDER");
        assertThat(state(payout)).isEqualTo("APPROVED");
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM transactions WHERE project_id = ? AND type = 'PAYOUT'", Long.class, funded.projectId()))
                .isZero();
    }

    @Test
    @DisplayName("#184's review: an unanswered send stays approved through a refused retry, until staff settle it as not sent")
    void anUnansweredSendIsSettledFromTheStatementAsNotSent() {
        Funded funded = aFundedCampaign("payout-unanswered-not-sent");
        UUID payout = approvedAndSendable(funded);
        Account admin = administrator();
        provider.nextPayoutUnreachable();
        // Epoint refuses an order_id it has already carried out, so the retry's refusal proves nothing.
        provider.nextPayout(ProviderOutcome.DECLINED);

        assertThat(post("/v1/admin/payouts/" + payout + "/send", admin.accessToken(), null, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(payout)).isEqualTo("APPROVED");
        assertThat(jdbc().queryForObject("SELECT send_unconfirmed_at FROM payouts WHERE id = ?", Object.class, payout))
                .isNotNull();

        assertThat(post("/v1/admin/payouts/" + payout + "/send", admin.accessToken(), null, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(payout)).as("refused on retry, still unconfirmed").isEqualTo("APPROVED");
        assertThat(provider.payouts()).extracting(PayoutRequest::idempotencyKey).hasSize(2).containsOnly(key(payout));

        UUID pledge = jdbc().queryForObject("SELECT id FROM pledges WHERE project_id = ?", UUID.class, funded.projectId());
        ResponseEntity<Map<String, Object>> dispute = post(
                "/v1/pledges/" + pledge + "/disputes", funded.backer().accessToken(), null, Map.of("reason", "Never arrived"));
        assertThat(dispute.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(dispute.getBody()).containsEntry("code", "DISPUTE_WINDOW_CLOSED");
        assertThat(post("/v1/admin/payouts/" + payout + "/cancel", admin.accessToken(), null, null).getBody())
                .containsEntry("code", "PAYOUT_SEND_UNCONFIRMED");

        ResponseEntity<Map<String, Object>> settled = post(
                "/v1/admin/payouts/" + payout + "/unconfirmed-send/not-sent",
                admin.accessToken(),
                null,
                Map.of("note", "Not on Epoint's statement for the day."));

        assertThat(settled.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(state(payout)).isEqualTo("FAILED");
        assertThat(jdbc().queryForObject("SELECT failure_code FROM payouts WHERE id = ?", String.class, payout))
                .isEqualTo("confirmed_not_sent");
        ResponseEntity<Map<String, Object>> again =
                post("/v1/admin/payouts", admin.accessToken(), null, Map.of("projectId", funded.projectId().toString()));
        assertThat(again.getStatusCode()).as("priced again only now").isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("#184's review: an unanswered send settled as sent is paid, from the statement's reference")
    void anUnansweredSendIsSettledFromTheStatementAsSent() {
        Funded funded = aFundedCampaign("payout-unanswered-sent");
        UUID payout = approvedAndSendable(funded);
        Account admin = administrator();
        provider.nextPayoutUnreachable();
        post("/v1/admin/payouts/" + payout + "/send", admin.accessToken(), null, null);

        ResponseEntity<Map<String, Object>> missing = post(
                "/v1/admin/payouts/" + payout + "/unconfirmed-send/sent", admin.accessToken(), null, Map.of("note", "Sent"));
        assertThat(missing.getStatusCode()).as("the statement's reference is required").isEqualTo(HttpStatus.BAD_REQUEST);

        ResponseEntity<Map<String, Object>> settled = post(
                "/v1/admin/payouts/" + payout + "/unconfirmed-send/sent",
                admin.accessToken(),
                null,
                Map.of("providerTransactionId", "EP-STATEMENT-" + UUID.randomUUID(), "note", "On the statement."));

        assertThat(settled.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(state(payout)).isEqualTo("PAID");
        assertThat(jdbc().queryForObject(
                        """
                        SELECT count(*) FROM transactions t JOIN payouts p ON p.payout_transaction_id = t.id
                         WHERE p.id = ? AND t.type = 'PAYOUT' AND t.status = 'SUCCEEDED'
                           AND t.provider_transaction_id LIKE 'EP-STATEMENT-%'
                        """,
                        Long.class,
                        payout))
                .isEqualTo(1L);
        assertThat(provider.payouts()).hasSize(1);
        assertThat(post("/v1/admin/payouts", admin.accessToken(), null, Map.of("projectId", funded.projectId().toString()))
                        .getBody())
                .containsEntry("code", "CAMPAIGN_ALREADY_PAID_OUT");
    }

    @Test
    @DisplayName("#184's review: a payout whose send went unanswered cannot be cancelled, so it is never priced again")
    void aPayoutWhoseSendWentUnansweredIsNotCancelled() {
        Funded funded = aFundedCampaign("payout-unanswered");
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();
        UUID payout = jdbc().queryForObject("SELECT id FROM payouts WHERE project_id = ?", UUID.class, funded.projectId());
        // Where `PayoutService.send` leaves it when the provider could not be reached.
        jdbc().update("UPDATE payouts SET state = 'APPROVED', send_unconfirmed_at = now() WHERE id = ?", payout);

        ResponseEntity<Map<String, Object>> cancelled =
                post("/v1/admin/payouts/" + payout + "/cancel", administrator().accessToken(), null, null);

        assertThat(cancelled.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(cancelled.getBody()).containsEntry("code", "PAYOUT_SEND_UNCONFIRMED");
        assertThat(jdbc().queryForObject("SELECT state FROM payouts WHERE id = ?", String.class, payout))
                .isEqualTo("APPROVED");
        assertThat(payouts.recalculate(funded.projectId())).map(p -> p.id()).contains(payout);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM payouts WHERE project_id = ?", Long.class, funded.projectId()))
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("#182: V86 refuses a second paid payout for a campaign whatever wrote it")
    void theSchemaRefusesASecondPaidPayout() {
        Funded funded = aFundedCampaign("payout-paid-twice");
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();
        String paidOut =
                """
                UPDATE payouts
                   SET state = 'PAID', sent_at = now(),
                       payout_transaction_id = (SELECT id FROM transactions WHERE project_id = ? AND type = 'CHARGE' LIMIT 1)
                 WHERE project_id = ? AND state = 'CALCULATED'
                """;
        jdbc().update(paidOut, funded.projectId(), funded.projectId());
        jdbc().update(
                """
                INSERT INTO payouts (id, project_id, creator_id, gross_amount, platform_fee, processing_fee, tax_withheld,
                                     refunded_amount, net_amount, currency, state, payable_at, approvals_required,
                                     idempotency_key)
                SELECT gen_random_uuid(), project_id, creator_id, gross_amount, platform_fee, processing_fee, tax_withheld,
                       refunded_amount, net_amount, currency, 'CALCULATED', payable_at, approvals_required,
                       'payout-again-' || gen_random_uuid()
                  FROM payouts WHERE project_id = ?
                """,
                funded.projectId());

        assertThatThrownBy(() -> jdbc().update(paidOut, funded.projectId(), funded.projectId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("payouts_one_paid_per_project");
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
        rest.exchange("/v1/webhooks/psp/azericard", HttpMethod.POST, new HttpEntity<>(delivery.getBytes(), headers), String.class);

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

    /**
     * Marks the campaign's payout sent. `PayoutGateway.send` needs a provider that answers payouts, which the
     * scripted one does not; any transaction row satisfies payouts_paid_has_transaction.
     */
    private UUID markPaid(UUID projectId) {
        UUID paid = jdbc().queryForObject("SELECT id FROM payouts WHERE project_id = ?", UUID.class, projectId);
        jdbc().update(
                """
                UPDATE payouts
                   SET state = 'PAID', sent_at = now(),
                       payout_transaction_id = (SELECT id FROM transactions WHERE project_id = ? AND type = 'CHARGE' LIMIT 1)
                 WHERE id = ?
                """,
                projectId,
                paid);
        return paid;
    }

    /** A second payout for the campaign, a copy of its first in the given in-flight state. */
    private UUID anotherPayout(UUID projectId, String state) {
        UUID id = UUID.randomUUID();
        jdbc().update(
                """
                INSERT INTO payouts (id, project_id, creator_id, gross_amount, platform_fee, processing_fee, tax_withheld,
                                     refunded_amount, net_amount, currency, state, payable_at, approvals_required,
                                     idempotency_key)
                SELECT ?, project_id, creator_id, gross_amount, platform_fee, processing_fee, tax_withheld,
                       refunded_amount, net_amount, currency, ?, payable_at, 1, 'payout-again-' || gen_random_uuid()
                  FROM payouts WHERE project_id = ? AND state = 'PAID'
                """,
                id,
                state,
                projectId);
        return id;
    }

    /**
     * The campaign's withdrawal payout, past its hold and signed, with a verified destination at the scripted
     * provider: what `send` needs to reach the provider.
     */
    private UUID approvedAndSendable(Funded funded) {
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null, null);
        relay.run();
        UUID payout = jdbc().queryForObject("SELECT id FROM payouts WHERE project_id = ?", UUID.class, funded.projectId());
        Account signer = administrator();
        jdbc().update("UPDATE payouts SET state = 'APPROVED', approvals_required = 1 WHERE id = ?", payout);
        jdbc().update("INSERT INTO payout_approvals (payout_id, approver_id) VALUES (?, ?)", payout, signer.id());
        Destinations.verifiedWith(dataSource, funded.creator().id(), signer.id(), "AZERICARD", "Test Person");
        return payout;
    }

    private String key(UUID payout) {
        return jdbc().queryForObject("SELECT idempotency_key FROM payouts WHERE id = ?", String.class, payout);
    }

    private String state(UUID payout) {
        return jdbc().queryForObject("SELECT state FROM payouts WHERE id = ?", String.class, payout);
    }

    /** A member of staff who may calculate payouts: an account holding a V48 grant. */
    private Account administrator() {
        Account admin = account("payout-administrator");
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, 'SUPER_ADMIN', ?, '#182 fixture')
                ON CONFLICT DO NOTHING
                """,
                admin.id(),
                admin.id());
        return admin;
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
