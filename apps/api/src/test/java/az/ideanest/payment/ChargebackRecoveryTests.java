package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.payment.application.CreatorDebts;
import az.ideanest.payment.application.DisputeService;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.PayoutResult;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payout.application.WithdrawalPayouts;
import az.ideanest.shared.money.Money;
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
 * A chargeback lost after the creator was paid — IDN-EXT-01 (#43), §9.8.
 *
 * <p>From money really paid through the payment page. The payout itself is recorded as a settled
 * {@code PAYOUT} transaction rather than sent, because sending needs signatures and a verified
 * destination that are other suites' subject; what matters here is that money left for the campaign.
 * The chargeback arrives through {@code DisputeService#notified} — the intake a provider's webhook would
 * call — and an administrator resolves it through the API.
 */
class ChargebackRecoveryTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private DisputeService disputes;

    @Autowired
    private PaymentTransactionRepository transactions;

    @Autowired
    private CreatorDebts debts;

    @Autowired
    private WithdrawalPayouts withdrawalPayouts;

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
        PaymentRows.clearProjects(dataSource, projects);
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        // `granted_by` is RESTRICT, so a grant left behind stops IdentitySchemaTests emptying `users`.
        jdbc().update("DELETE FROM staff_role_grants WHERE note = '#43 fixture'");
    }

    @Test
    @DisplayName("a chargeback lost after the payout becomes the creator's debt, and blocks their account")
    void lostAfterThePayout() {
        Funded funded = aFundedCampaign("chargeback-after", "25.00");
        paidOut(funded.projectId(), "21.25");
        Account admin = admin();

        ResponseEntity<Map<String, Object>> resolved = resolve(chargeback(funded, "25.00", "5.00"), "LOST", admin);

        assertThat(resolved.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> debt = jdbc().queryForMap(
                "SELECT amount, recovered, settled_at FROM creator_debts WHERE creator_id = ?", funded.creator().id());
        assertThat((BigDecimal) debt.get("amount")).isEqualByComparingTo("30.00");
        assertThat((BigDecimal) debt.get("recovered")).isEqualByComparingTo("0.00");
        Map<String, Object> creator = jdbc().queryForMap(
                "SELECT suspended_at, suspended_by FROM users WHERE id = ?", funded.creator().id());
        assertThat(creator.get("suspended_at")).isNotNull();
        assertThat(creator.get("suspended_by")).isEqualTo(admin.id());
    }

    @Test
    @DisplayName("lost before any payout, the loss comes off the payout instead: no debt, and nobody is blocked")
    void lostBeforeThePayout() {
        Funded funded = aFundedCampaign("chargeback-before", "25.00");

        assertThat(resolve(chargeback(funded, "25.00", "5.00"), "LOST", admin()).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(debtCount(funded.creator().id())).isZero();
        assertThat(jdbc().queryForObject("SELECT suspended_at FROM users WHERE id = ?", Object.class, funded.creator().id()))
                .isNull();
    }

    @Test
    @DisplayName("won after the payout, nothing is owed")
    void wonAfterThePayout() {
        Funded funded = aFundedCampaign("chargeback-won", "25.00");
        paidOut(funded.projectId(), "21.25");

        assertThat(resolve(chargeback(funded, "25.00", "0.00"), "WON", admin()).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(debtCount(funded.creator().id())).isZero();
    }

    @Test
    @DisplayName("the creator's next payout withholds what they owe, and sending it recovers the debt")
    void theNextPayoutWithholdsTheDebt() {
        Funded first = aFundedCampaign("chargeback-debtor", "25.00");
        paidOut(first.projectId(), "21.25");
        resolve(chargeback(first, "10.00", "0.00"), "LOST", admin());

        UUID second = aSecondCampaign(first.creator(), "chargeback-next", "25.00");
        UUID payoutId = withdrawalPayouts.request(second, false).orElseThrow().id();

        Map<String, Object> payout = jdbc().queryForMap(
                "SELECT gross_amount, platform_fee, processing_fee, refunded_amount, debt_withheld, net_amount"
                        + " FROM payouts WHERE id = ?",
                payoutId);
        assertThat((BigDecimal) payout.get("debt_withheld")).isEqualByComparingTo("10.00");
        BigDecimal accounted = ((BigDecimal) payout.get("net_amount"))
                .add((BigDecimal) payout.get("debt_withheld"))
                .add((BigDecimal) payout.get("platform_fee"))
                .add((BigDecimal) payout.get("processing_fee"))
                .add((BigDecimal) payout.get("refunded_amount"));
        assertThat(accounted).isEqualByComparingTo((BigDecimal) payout.get("gross_amount"));

        // What the payout's send applies once the money has left.
        debts.recover(first.creator().id(), Money.of(new BigDecimal("10.00"), "AZN"), java.time.Instant.now());
        assertThat(jdbc().queryForObject(
                        "SELECT settled_at FROM creator_debts WHERE creator_id = ?", Object.class, first.creator().id()))
                .isNotNull();
    }

    @Test
    @DisplayName("a debt as large as the next payout takes all of it, and no payout is requested")
    void aLargeDebtTakesTheWholePayout() {
        Funded first = aFundedCampaign("chargeback-large", "25.00");
        paidOut(first.projectId(), "21.25");
        resolve(chargeback(first, "25.00", "20.00"), "LOST", admin());

        UUID second = aSecondCampaign(first.creator(), "chargeback-large-next", "25.00");

        assertThat(withdrawalPayouts.request(second, false)).isEmpty();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM payouts WHERE project_id = ?", Long.class, second)).isZero();
        assertThat(jdbc().queryForObject(
                        "SELECT recovered FROM creator_debts WHERE creator_id = ?", BigDecimal.class, first.creator().id()))
                .isPositive();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Funded(Account creator, UUID projectId, UUID pledgeId, UUID chargeId) {
    }

    private Funded aFundedCampaign(String prefix, String amount) {
        Account creator = account(prefix + "-creator");
        UUID projectId = newCampaign(creator, amount);
        return paidInto(creator, projectId, account(prefix + "-backer"), amount);
    }

    private UUID aSecondCampaign(Account creator, String prefix, String amount) {
        UUID projectId = newCampaign(creator, amount);
        paidInto(creator, projectId, account(prefix + "-backer"), amount);
        return projectId;
    }

    private UUID newCampaign(Account creator, String goal) {
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects", creator.accessToken(), null, Map.of("title", "A charged-back campaign " + SEQUENCE.incrementAndGet()))
                .getBody()
                .get("id"));
        projects.add(projectId);
        Campaigns.launch(dataSource, projectId);
        return projectId;
    }

    private Funded paidInto(Account creator, UUID projectId, Account backer, String amount) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", amount, "currency", "AZN"));
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
        UUID chargeId = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'", UUID.class, pledgeId);
        return new Funded(creator, projectId, pledgeId, chargeId);
    }

    /** Money left for the campaign: a settled payout transaction, as a sent payout records one. */
    private void paidOut(UUID projectId, String amount) {
        transactions.save(PaymentTransaction.payout(
                projectId,
                Money.of(new BigDecimal(amount), "AZN"),
                ProviderName.PAYRIFF,
                new PayoutResult(ProviderOutcome.APPROVED, "scripted-payout-" + UUID.randomUUID(), null, null, "{}"),
                "payout-sent-" + UUID.randomUUID()));
    }

    private UUID chargeback(Funded funded, String amount, String fee) {
        return disputes.notified(
                        ProviderName.PAYRIFF,
                        "case-" + UUID.randomUUID(),
                        funded.chargeId(),
                        Money.of(new BigDecimal(amount), "AZN"),
                        Money.of(new BigDecimal(fee), "AZN"),
                        "fraudulent",
                        null)
                .id();
    }

    private ResponseEntity<Map<String, Object>> resolve(UUID disputeId, String outcome, Account admin) {
        return post("/v1/admin/disputes/" + disputeId + "/resolve", admin.accessToken(), null, Map.of("outcome", outcome));
    }

    private long debtCount(UUID creatorId) {
        return jdbc().queryForObject("SELECT count(*) FROM creator_debts WHERE creator_id = ?", Long.class, creatorId);
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
        UUID id = Campaigns.creator(dataSource, "chargeback-administrator");
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

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
