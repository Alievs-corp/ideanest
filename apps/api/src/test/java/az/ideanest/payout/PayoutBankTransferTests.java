package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.payout.application.WithdrawalPayouts;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.BankDetailsKeys;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
 * A payout paid by bank transfer, from IdeyaNest's own account — #397, epic #392.
 *
 * <p>End to end from money a backer really paid, as {@code WithdrawalPayoutTests} does it: the pledge is
 * paid through the payment page and a signed webhook, the campaign is decided successful and withdrawn,
 * and the payout it requests is approved. The creator's destination is an IBAN sealed under the test
 * key ({@code Destinations.bankAccount}), which the service can open while {@code BankDetailsKeys} has
 * the key installed.
 *
 * <p>Every case is a state transition, an idempotency rule or a gate in front of money, which CLAUDE.md
 * names as not optional to test. The one that matters most is the first: a transfer recorded once is one
 * transaction and one posting, however many times the record is replayed.
 */
@DisplayName("A payout paid by bank transfer")
class PayoutBankTransferTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final ZoneId BAKU = ZoneId.of("Asia/Baku");

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private WithdrawalPayouts withdrawals;

    @Autowired
    private CreatorPayoutDestinations destinations;

    private BankDetailsKeys.Installed keys;

    private final List<UUID> paidPledges = new ArrayList<>();
    private final List<UUID> projects = new ArrayList<>();

    @BeforeEach
    void setUp() {
        jdbc().update("DELETE FROM outbox_events");
        keys = BankDetailsKeys.install(destinations);
    }

    @AfterEach
    void clear() {
        keys.close();
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM provider_webhook_events");
        for (UUID project : projects) {
            jdbc().update("DELETE FROM backer_disputes WHERE project_id = ?", project);
        }
        PaymentRows.clearProjects(dataSource, projects);
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        Destinations.clear(dataSource);
        // `granted_by` is RESTRICT, so a grant left behind stops IdentitySchemaTests emptying `users`.
        jdbc().update("DELETE FROM staff_role_grants WHERE note = '#397 fixture'");
    }

    // ------------------------------------------------------------------
    // The route
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a transfer is started, recorded from the statement, posted once, and replayed without a second row")
    void aTransferIsStartedRecordedAndPostedOnce() {
        Funded funded = aFundedCampaign("bank-paid");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        BigDecimal net = jdbc().queryForObject("SELECT net_amount FROM payouts WHERE id = ?", BigDecimal.class, payout);

        ResponseEntity<Map<String, Object>> started = post(bankTransfer(payout, "start"), admin.accessToken(), null);

        assertThat(started.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(started.getHeaders().getCacheControl()).contains("no-store");
        assertThat(started.getBody())
                .containsEntry("iban", Destinations.IBAN)
                .containsEntry("holderName", "Test Person")
                .containsEntry("accountHint", Destinations.IBAN_HINT)
                .containsEntry("description", "IdeyaNest payout " + payout);
        @SuppressWarnings("unchecked")
        Map<String, Object> amount = (Map<String, Object>) started.getBody().get("amount");
        assertThat(new BigDecimal((String) amount.get("amount"))).isEqualByComparingTo(net);
        assertThat(amount).containsEntry("currency", "AZN");
        assertThat(state(payout)).isEqualTo("APPROVED");
        assertThat(jdbc().queryForObject("SELECT bank_transfer_started_by FROM payouts WHERE id = ?", UUID.class, payout))
                .isEqualTo(admin.id());

        // Starting again is a retry, not an error, and the second opening is audited like the first.
        assertThat(post(bankTransfer(payout, "start"), admin.accessToken(), null).getBody())
                .containsEntry("iban", Destinations.IBAN);
        assertThat(get("/v1/admin/payouts/" + payout + "/bank-transfer", admin.accessToken()).getBody())
                .containsEntry("iban", Destinations.IBAN);
        assertThat(jdbc().queryForObject(
                        """
                        SELECT count(*) FROM audit_logs
                         WHERE action = 'compliance.payout_destination_account_revealed' AND entity_id = ?
                        """,
                        Long.class,
                        funded.creator().id()))
                .isEqualTo(3L);

        String reference = "BANK-" + UUID.randomUUID();
        LocalDate today = LocalDate.now(BAKU);
        Map<String, Object> badFee = new HashMap<>(record(reference, today, "On today's statement."));
        badFee.put("bankFee", "1.234");
        assertThat(post(bankTransfer(payout, "record"), admin.accessToken(), badFee).getStatusCode())
                .as("money crosses the API as a decimal string of at most two places")
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(state(payout)).isEqualTo("APPROVED");

        Map<String, Object> recordWithFee = new HashMap<>(record(reference, today, "On today's statement."));
        recordWithFee.put("bankFee", "1.20");
        ResponseEntity<Map<String, Object>> recorded =
                post(bankTransfer(payout, "record"), admin.accessToken(), recordWithFee);

        assertThat(recorded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(recorded.getBody())
                .containsEntry("state", "PAID")
                .containsEntry("bankTransferredOn", today.toString())
                .containsEntry("destinationKind", "BANK_TRANSFER");
        Map<String, Object> transaction = jdbc().queryForMap(
                """
                SELECT t.id, t.type, t.status, t.provider, t.provider_transaction_id, t.idempotency_key, t.amount
                  FROM transactions t JOIN payouts p ON p.payout_transaction_id = t.id
                 WHERE p.id = ?
                """,
                payout);
        assertThat(transaction)
                .containsEntry("type", "PAYOUT")
                .containsEntry("status", "SUCCEEDED")
                .containsEntry("provider", "BANK_TRANSFER")
                .containsEntry("provider_transaction_id", reference)
                .containsEntry("idempotency_key", key(payout) + "-bank");
        assertThat((BigDecimal) transaction.get("amount")).isEqualByComparingTo(net);

        // #401: the payout closes the campaign. The gross off the creator's account, the net out of escrow,
        // the fees to the platform, and the bank's charge out of escrow as the platform's own cost.
        Map<String, Object> priced = jdbc().queryForMap(
                "SELECT gross_amount, platform_fee, processing_fee FROM payouts WHERE id = ?", payout);
        BigDecimal gross = (BigDecimal) priced.get("gross_amount");
        BigDecimal fees = ((BigDecimal) priced.get("platform_fee")).add((BigDecimal) priced.get("processing_fee"));
        assertThat(fees).isPositive();
        List<Map<String, Object>> postings = jdbc().queryForList(
                "SELECT account, direction, amount FROM ledger_entries WHERE transaction_id = ? ORDER BY direction",
                transaction.get("id"));
        assertThat(postings).hasSize(5);
        assertThat(postings).anySatisfy(entry -> assertPosting(entry, "creator:" + funded.creator().id(), "DEBIT", gross));
        assertThat(postings).anySatisfy(entry -> assertPosting(entry, "escrow", "CREDIT", net));
        assertThat(postings).anySatisfy(entry -> assertPosting(entry, "platform_fee", "CREDIT", fees));
        assertThat(postings).anySatisfy(entry -> assertPosting(entry, "platform_expense", "DEBIT", new BigDecimal("1.20")));
        assertThat(postings).anySatisfy(entry -> assertPosting(entry, "escrow", "CREDIT", new BigDecimal("1.20")));
        assertThat(jdbc().queryForObject(
                        """
                        SELECT coalesce(sum(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END), 0)
                          FROM ledger_entries WHERE project_id = ? AND account = ?
                        """,
                        BigDecimal.class,
                        funded.projectId(),
                        "creator:" + funded.creator().id()))
                .as("the creator's account is closed by the payout")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(auditDetail("payout.sent", payout)).contains("bankFee=1.20 AZN");

        // Replayed with the same reference: the payout as it stands, and still one row.
        ResponseEntity<Map<String, Object>> replayed = post(
                bankTransfer(payout, "record"), admin.accessToken(), record(reference, today, "Pressed twice."));
        assertThat(replayed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replayed.getBody()).containsEntry("state", "PAID");
        assertThat(payoutTransactions(funded.projectId())).isEqualTo(1L);

        // Replayed with another: refused, because the payout was paid once.
        ResponseEntity<Map<String, Object>> other = post(
                bankTransfer(payout, "record"), admin.accessToken(), record("BANK-OTHER-" + UUID.randomUUID(), today, "x"));
        assertThat(other.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(other.getBody()).containsEntry("code", "PAYOUT_BANK_TRANSFER_ALREADY_RECORDED");
        assertThat(payoutTransactions(funded.projectId())).isEqualTo(1L);

        assertThat(auditDetail("payout.sent", payout)).contains("bankTransfer").contains(reference);
        assertThat(auditDetail("payout.bank_transfer_started", payout)).contains(Destinations.IBAN_HINT);
        // §17.4 and RedactingEncoder's rule, for the trail: the hint, never the number.
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE detail LIKE ?", Long.class, "%" + Destinations.IBAN.substring(4) + "%"))
                .isZero();

        // The campaign is paid out, and the payment log lists the bank's row like any other.
        assertThat(post("/v1/admin/payouts", admin.accessToken(), Map.of("projectId", funded.projectId().toString()))
                        .getBody())
                .containsEntry("code", "CAMPAIGN_ALREADY_PAID_OUT");
        ResponseEntity<Map<String, Object>> log = get("/v1/admin/payments?projectId=" + funded.projectId(), admin.accessToken());
        assertThat(log.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(log.toString()).contains("BANK_TRANSFER").contains(reference);
    }

    @Test
    @DisplayName("#418: the creator is told once, with the amount, the bank's value date and the masked account")
    void theCreatorIsToldOnce() {
        Funded funded = aFundedCampaign("bank-told");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        post(bankTransfer(payout, "start"), admin.accessToken(), null);
        assertThat(accountHint(payout)).isEqualTo(Destinations.IBAN_HINT);
        assertThat(paidEvents(payout)).as("nothing is announced when a transfer only starts").isEmpty();

        String reference = "BANK-" + UUID.randomUUID();
        LocalDate valueDate = LocalDate.now(BAKU);
        post(bankTransfer(payout, "record"), admin.accessToken(), record(reference, valueDate, "On the statement."));
        post(bankTransfer(payout, "record"), admin.accessToken(), record(reference, valueDate, "Pressed twice."));
        post(bankTransfer(payout, "record"), admin.accessToken(), record("BANK-OTHER-" + UUID.randomUUID(), valueDate, "x"));

        List<String> events = paidEvents(payout);
        assertThat(events).as("one announcement, however often the transfer is recorded").hasSize(1);
        assertThat(events.getFirst())
                .contains(funded.creator().id().toString())
                .contains("\"paidOn\":\"" + valueDate + "\"")
                .contains(Destinations.IBAN_HINT)
                .doesNotContain(Destinations.IBAN)
                .doesNotContain(reference);

        relay.run();
        List<Map<String, Object>> told = jdbc().queryForList(
                """
                SELECT recipient_id, params->>'sentOn' AS sent_on, params->>'accountHint' AS hint,
                       params->'amount'->>'amount' AS amount, params->'amount'->>'currency' AS currency
                  FROM notifications WHERE type = 'PAYOUT_SENT' AND subject_id = ?
                """,
                funded.projectId());
        assertThat(told).isNotEmpty().allSatisfy(row -> assertThat(row)
                .containsEntry("recipient_id", funded.creator().id())
                .containsEntry("sent_on", valueDate.toString())
                .containsEntry("hint", Destinations.IBAN_HINT)
                .containsEntry("currency", "AZN"));
        BigDecimal net = jdbc().queryForObject("SELECT net_amount FROM payouts WHERE id = ?", BigDecimal.class, payout);
        assertThat(new BigDecimal((String) told.getFirst().get("amount"))).isEqualByComparingTo(net);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM notifications WHERE params::text LIKE ?",
                        Long.class,
                        "%" + Destinations.IBAN.substring(4) + "%"))
                .as("no notification carries the number")
                .isZero();
    }

    @Test
    @DisplayName("a payout to a bank account is not sent through the provider")
    void sendIsRefusedForABankAccount() {
        Funded funded = aFundedCampaign("bank-send");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);

        ResponseEntity<Map<String, Object>> sent = post("/v1/admin/payouts/" + payout + "/send", admin.accessToken(), null);

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(sent.getBody()).containsEntry("code", "PAYOUT_SETTLES_BY_BANK_TRANSFER");
        assertThat(state(payout)).isEqualTo("APPROVED");
        assertThat(payoutTransactions(funded.projectId())).isZero();
    }

    @Test
    @DisplayName("a transfer is not started to an account nobody confirmed, nor to a provider's token")
    void theDestinationDecidesWhetherATransferStarts() {
        Funded funded = aFundedCampaign("bank-destination");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        jdbc().update("DELETE FROM payout_destinations WHERE user_id = ?", funded.creator().id());
        Destinations.bankAccount(dataSource, funded.creator().id(), null, "Test Person", "AWAITING_VERIFICATION");

        ResponseEntity<Map<String, Object>> unconfirmed = post(bankTransfer(payout, "start"), admin.accessToken(), null);
        assertThat(unconfirmed.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(unconfirmed.getBody()).containsEntry("code", "PAYOUT_DESTINATION_NOT_VERIFIED");

        jdbc().update("DELETE FROM payout_destinations WHERE user_id = ?", funded.creator().id());
        Destinations.verifiedWith(dataSource, funded.creator().id(), admin.id(), "AZERICARD", "Test Person");
        ResponseEntity<Map<String, Object>> token = post(bankTransfer(payout, "start"), admin.accessToken(), null);
        assertThat(token.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(token.getBody()).containsEntry("code", "PAYOUT_SETTLES_THROUGH_PROVIDER");
        assertThat(jdbc().queryForObject("SELECT bank_transfer_started_at FROM payouts WHERE id = ?", Object.class, payout))
                .isNull();
    }

    // ------------------------------------------------------------------
    // While the money may be on its way
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a started transfer cannot be cancelled, unsigned or recalculated, until it is abandoned")
    void aStartedTransferHoldsThePayoutUntilAbandoned() {
        Funded funded = aFundedCampaign("bank-abandon");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        post(bankTransfer(payout, "start"), admin.accessToken(), null);

        assertThat(post("/v1/admin/payouts/" + payout + "/cancel", admin.accessToken(), null).getBody())
                .containsEntry("code", "PAYOUT_BANK_TRANSFER_IN_PROGRESS");
        assertThat(exchange(HttpMethod.DELETE, "/v1/admin/payouts/" + payout + "/approvals", admin.accessToken(), null)
                        .getBody())
                .containsEntry("code", "PAYOUT_BANK_TRANSFER_IN_PROGRESS");
        assertThat(withdrawals.recalculate(funded.projectId())).map(held -> held.id()).contains(payout);
        assertThat(state(payout)).isEqualTo("APPROVED");

        assertThat(post(bankTransfer(payout, "abandon"), admin.accessToken(), Map.of()).getStatusCode())
                .as("the note is required")
                .isEqualTo(HttpStatus.BAD_REQUEST);
        ResponseEntity<Map<String, Object>> abandoned = post(
                bankTransfer(payout, "abandon"), admin.accessToken(), Map.of("note", "Never sent: the bank was closed."));

        assertThat(abandoned.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(abandoned.getBody()).doesNotContainKey("bankTransferStartedAt");
        assertThat(accountHint(payout)).as("#418: the account is forgotten with the transfer").isNull();
        assertThat(auditDetail("payout.bank_transfer_abandoned", payout)).contains("the bank was closed");
        assertThat(post(bankTransfer(payout, "record"), admin.accessToken(), record("BANK-1", LocalDate.now(BAKU), "x"))
                        .getBody())
                .containsEntry("code", "PAYOUT_BANK_TRANSFER_NOT_STARTED");
        assertThat(post("/v1/admin/payouts/" + payout + "/cancel", admin.accessToken(), null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(payout)).isEqualTo("CANCELLED");
    }

    @Test
    @DisplayName("an open backer dispute holds the start, and the start closes the dispute window")
    void aBackerDisputeHoldsTheStartAndTheStartClosesTheWindow() {
        Funded funded = aFundedCampaign("bank-dispute");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        UUID pledge = jdbc().queryForObject("SELECT id FROM pledges WHERE project_id = ?", UUID.class, funded.projectId());

        ResponseEntity<Map<String, Object>> dispute = post(
                "/v1/pledges/" + pledge + "/disputes", funded.backer().accessToken(), Map.of("reason", "Never arrived"));
        assertThat(dispute.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ResponseEntity<Map<String, Object>> held = post(bankTransfer(payout, "start"), admin.accessToken(), null);
        assertThat(held.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(held.getBody()).containsEntry("code", "PAYOUT_BACKER_DISPUTE_OPEN");
        assertThat(jdbc().queryForObject("SELECT bank_transfer_started_at FROM payouts WHERE id = ?", Object.class, payout))
                .isNull();

        post("/v1/admin/backer-disputes/" + dispute.getBody().get("id") + "/decision",
                admin.accessToken(),
                Map.of("outcome", "REJECT", "note", "Delivered, with a signature."));
        assertThat(post(bankTransfer(payout, "start"), admin.accessToken(), null).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        ResponseEntity<Map<String, Object>> late = post(
                "/v1/pledges/" + pledge + "/disputes", funded.backer().accessToken(), Map.of("reason", "Still nothing"));
        assertThat(late.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(late.getBody()).containsEntry("code", "DISPUTE_WINDOW_CLOSED");
    }

    // ------------------------------------------------------------------
    // What cannot be recorded
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a bank reference another transaction carries is refused, and the payout stays started")
    void aReferenceAlreadyRecordedIsRefused() {
        Account admin = administrator();
        Funded first = aFundedCampaign("bank-ref-first");
        UUID firstPayout = approvedToABankAccount(first, admin);
        Funded second = aFundedCampaign("bank-ref-second");
        UUID secondPayout = approvedToABankAccount(second, admin);
        String reference = "BANK-" + UUID.randomUUID();
        LocalDate today = LocalDate.now(BAKU);

        post(bankTransfer(firstPayout, "start"), admin.accessToken(), null);
        assertThat(post(bankTransfer(firstPayout, "record"), admin.accessToken(), record(reference, today, "first"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        post(bankTransfer(secondPayout, "start"), admin.accessToken(), null);
        ResponseEntity<Map<String, Object>> taken = post(
                bankTransfer(secondPayout, "record"), admin.accessToken(), record(reference, today, "copied"));

        assertThat(taken.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(taken.getBody()).containsEntry("code", "PAYOUT_REFERENCE_TAKEN");
        assertThat(state(secondPayout)).isEqualTo("APPROVED");
        assertThat(payoutTransactions(second.projectId())).isZero();
        assertThat(jdbc().queryForObject("SELECT bank_transfer_started_at FROM payouts WHERE id = ?", Object.class, secondPayout))
                .isNotNull();
    }

    @Test
    @DisplayName("a value date after today, or before the transfer was started, is refused")
    void aDateTheTransferCannotHaveIsRefused() {
        Funded funded = aFundedCampaign("bank-date");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        post(bankTransfer(payout, "start"), admin.accessToken(), null);
        LocalDate today = LocalDate.now(BAKU);

        for (LocalDate impossible : List.of(today.plusDays(2), today.minusDays(2))) {
            ResponseEntity<Map<String, Object>> refused = post(
                    bankTransfer(payout, "record"), admin.accessToken(), record("BANK-" + UUID.randomUUID(), impossible, "x"));
            assertThat(refused.getStatusCode()).as(impossible.toString()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(refused.getBody()).containsEntry("code", "BANK_TRANSFER_DATE_OUT_OF_RANGE");
        }
        assertThat(state(payout)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("nobody pays their own campaign's payout by hand")
    void nobodyPaysTheirOwnPayout() {
        Funded funded = aFundedCampaign("bank-self");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        grantSuperAdmin(funded.creator(), admin);

        ResponseEntity<Map<String, Object>> own = post(bankTransfer(payout, "start"), funded.creator().accessToken(), null);

        assertThat(own.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(own.getBody()).containsEntry("code", "SELF_PAID_PAYOUT");
        assertThat(jdbc().queryForObject("SELECT bank_transfer_started_at FROM payouts WHERE id = ?", Object.class, payout))
                .isNull();
    }

    @Test
    @DisplayName("nobody signs or sends their own campaign's payout either, and the attempt is audited")
    void nobodySignsOrSendsTheirOwnPayout() {
        Funded funded = aFundedCampaign("self-sign");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        grantSuperAdmin(funded.creator(), admin);

        ResponseEntity<Map<String, Object>> send = post("/v1/admin/payouts/" + payout + "/send", funded.creator().accessToken(), null);
        assertThat(send.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(send.getBody()).containsEntry("code", "SELF_PAID_PAYOUT");
        assertThat(state(payout)).isEqualTo("APPROVED");
        assertThat(auditDetail("payout.sent", payout)).isEqualTo("ownPayout");

        jdbc().update("DELETE FROM payout_approvals WHERE payout_id = ?", payout);
        jdbc().update("UPDATE payouts SET state = 'PENDING_APPROVAL' WHERE id = ?", payout);
        ResponseEntity<Map<String, Object>> sign = post(
                "/v1/admin/payouts/" + payout + "/approvals", funded.creator().accessToken(), Map.of("note", "mine"));
        assertThat(sign.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(sign.getBody()).containsEntry("code", "SELF_PAID_PAYOUT");
        assertThat(jdbc().queryForObject("SELECT count(*) FROM payout_approvals WHERE payout_id = ?", Long.class, payout))
                .isZero();
        assertThat(auditDetail("payout.approved", payout)).isEqualTo("ownPayout");

        // The rule is about the creator, not the payout: a colleague is not refused as the payee, whatever
        // else the fixture's creator still owes the identity gate.
        assertThat(post("/v1/admin/payouts/" + payout + "/approvals", admin.accessToken(), Map.of()).getBody())
                .doesNotContainEntry("code", "SELF_PAID_PAYOUT");
    }

    @Test
    @DisplayName("a withdrawn signature and a cancellation are audited as what they are, and the file carries the debt")
    void withdrawalAndCancellationAreAuditedAsThemselves() {
        Funded funded = aFundedCampaign("audit-words");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);

        ResponseEntity<Map<String, Object>> file = get("/v1/admin/payouts/" + payout, admin.accessToken());
        @SuppressWarnings("unchecked")
        Map<String, Object> summary = (Map<String, Object>) file.getBody().get("payout");
        assertThat(summary).containsKey("debtWithheld").doesNotContainKey("sendUnconfirmedAt");

        assertThat(exchange(HttpMethod.DELETE, "/v1/admin/payouts/" + payout + "/approvals", admin.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(auditDetail("payout.approval_withdrawn", payout)).startsWith("withdrawn=true");

        assertThat(post("/v1/admin/payouts/" + payout + "/cancel", admin.accessToken(), null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(payout)).isEqualTo("CANCELLED");
        assertThat(auditDetail("payout.cancelled", payout)).isEqualTo("cancelled before sending");
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE action = 'payout.sent' AND entity_id = ?", Long.class, payout))
                .as("a cancellation is no longer written as a refused send")
                .isZero();
    }

    @Test
    @DisplayName("an unanswered send is on the payout's file, so the console can offer its resolution")
    void anUnconfirmedSendIsSerialised() {
        Funded funded = aFundedCampaign("unconfirmed-file");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        jdbc().update("UPDATE payouts SET send_unconfirmed_at = now() WHERE id = ?", payout);

        ResponseEntity<Map<String, Object>> file = get("/v1/admin/payouts/" + payout, admin.accessToken());

        @SuppressWarnings("unchecked")
        Map<String, Object> summary = (Map<String, Object>) file.getBody().get("payout");
        assertThat(summary.get("sendUnconfirmedAt")).isInstanceOf(String.class);
    }

    @Test
    @DisplayName("a start after the figures moved cancels the payout, and the cancellation is kept")
    void aStartAfterTheFiguresMovedCancels() {
        Funded funded = aFundedCampaign("bank-moved");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        // As if a refund had gone out since it was priced: the frozen gross no longer matches the collections.
        jdbc().update("UPDATE payouts SET gross_amount = gross_amount + 1 WHERE id = ?", payout);

        ResponseEntity<Map<String, Object>> moved = post(bankTransfer(payout, "start"), admin.accessToken(), null);

        assertThat(moved.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(moved.getBody()).containsEntry("code", "PAYOUT_NOT_SENDABLE");
        assertThat(state(payout)).isEqualTo("CANCELLED");
        assertThat(jdbc().queryForObject(
                        """
                        SELECT count(*) FROM audit_logs
                         WHERE action = 'compliance.payout_destination_account_revealed' AND entity_id = ?
                        """,
                        Long.class,
                        funded.creator().id()))
                .as("the account is not opened for a payout that will not be paid")
                .isZero();
    }

    @Test
    @DisplayName("V98 refuses a started transfer outside APPROVED or PAID, whatever writes it")
    void theSchemaHoldsTheMarkToApprovedOrPaid() {
        Funded funded = aFundedCampaign("bank-schema");
        Account admin = administrator();
        UUID payout = approvedToABankAccount(funded, admin);
        post(bankTransfer(payout, "start"), admin.accessToken(), null);

        // What a previous-release node would write: it does not know the mark and cancels the row anyway.
        assertThatThrownBy(() -> jdbc().update("UPDATE payouts SET state = 'CANCELLED' WHERE id = ?", payout))
                .hasMessageContaining("payouts_bank_transfer_started_while_approved_or_paid");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Funded(Account creator, Account backer, UUID projectId) {
    }

    private static String bankTransfer(UUID payout, String verb) {
        return "/v1/admin/payouts/" + payout + "/bank-transfer/" + verb;
    }

    private static void assertPosting(Map<String, Object> entry, String account, String direction, BigDecimal amount) {
        assertThat(entry).containsEntry("account", account).containsEntry("direction", direction);
        assertThat((BigDecimal) entry.get("amount")).isEqualByComparingTo(amount);
    }

    private static Map<String, Object> record(String reference, LocalDate on, String note) {
        return Map.of("bankReference", reference, "transferredOn", on.toString(), "note", note);
    }

    /**
     * The campaign's withdrawal payout, past its hold and signed, with a confirmed bank account on file:
     * what a bank transfer needs to start.
     */
    private UUID approvedToABankAccount(Funded funded, Account signer) {
        post("/v1/projects/" + funded.projectId() + "/withdrawal", funded.creator().accessToken(), null);
        relay.run();
        UUID payout = jdbc().queryForObject("SELECT id FROM payouts WHERE project_id = ?", UUID.class, funded.projectId());
        jdbc().update("UPDATE payouts SET state = 'APPROVED', approvals_required = 1 WHERE id = ?", payout);
        jdbc().update("INSERT INTO payout_approvals (payout_id, approver_id) VALUES (?, ?)", payout, signer.id());
        Destinations.bankAccount(dataSource, funded.creator().id(), signer.id(), "Test Person", "VERIFIED");
        return payout;
    }

    /** A campaign with one pledge of 25.00 AZN paid through the payment page, decided successful. */
    private Funded aFundedCampaign(String prefix) {
        Account creator = account(prefix + "-creator");
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects", creator.accessToken(), Map.of("title", "A campaign paid by bank " + SEQUENCE.incrementAndGet()))
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

    /** A member of staff who may approve and send payouts: an account holding a V48 grant. */
    private Account administrator() {
        Account admin = account("bank-administrator");
        grantSuperAdmin(admin, admin);
        return admin;
    }

    private void grantSuperAdmin(Account account, Account grantor) {
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, 'SUPER_ADMIN', ?, '#397 fixture')
                ON CONFLICT DO NOTHING
                """,
                account.id(),
                grantor.id());
    }

    private String key(UUID payout) {
        return jdbc().queryForObject("SELECT idempotency_key FROM payouts WHERE id = ?", String.class, payout);
    }

    private String state(UUID payout) {
        return jdbc().queryForObject("SELECT state FROM payouts WHERE id = ?", String.class, payout);
    }

    private String accountHint(UUID payout) {
        return jdbc().queryForObject("SELECT bank_transfer_account_hint FROM payouts WHERE id = ?", String.class, payout);
    }

    /** The {@code payout.paid} events recorded for this payout, as their payloads (#418). */
    private List<String> paidEvents(UUID payout) {
        return jdbc().queryForList(
                "SELECT payload FROM outbox_events WHERE event_type = 'payout.paid' AND aggregate_id = ?",
                String.class,
                payout);
    }

    private long payoutTransactions(UUID projectId) {
        return jdbc().queryForObject(
                "SELECT count(*) FROM transactions WHERE project_id = ? AND type = 'PAYOUT'", Long.class, projectId);
    }

    private String auditDetail(String action, UUID entity) {
        return jdbc().queryForObject(
                "SELECT detail FROM audit_logs WHERE action = ? AND entity_id = ? ORDER BY occurred_at DESC LIMIT 1",
                String.class,
                action,
                entity);
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
        return new Account((String) signedIn.getBody().get("accessToken"), user.getId());
    }

    private ResponseEntity<Map<String, Object>> post(String path, String token, Object body) {
        return post(path, token, null, body);
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

    private ResponseEntity<Map<String, Object>> get(String path, String token) {
        return exchange(HttpMethod.GET, path, token, null);
    }

    private ResponseEntity<Map<String, Object>> exchange(HttpMethod method, String path, String token, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
