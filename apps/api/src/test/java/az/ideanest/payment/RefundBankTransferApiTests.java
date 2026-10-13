package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.application.DisputeService;
import az.ideanest.payment.application.LedgerReconciliation;
import az.ideanest.payment.application.ReconciliationFinding;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payment.application.RefundBankTransfers;
import az.ideanest.payment.application.RefundWindows;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.RefundBankTransfer;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.shared.crypto.Sealed;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.BankDetailsKeys;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * A refund past the provider's refund window goes back by bank transfer — #399.
 *
 * <p>Pledges are paid through the real flow, the campaign-refunds job and the staff endpoints are driven
 * as in production, and the provider's window is the test provider's: one day, with the clock moved two
 * days on, so every charge here is past it. Support and finance are two members of staff, because the
 * workflow requires two.
 */
@ExtendWith(OutputCaptureExtension.class)
class RefundBankTransferApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** A valid Azerbaijani IBAN (mod-97 checks). */
    private static final String IBAN = "AZ21NABZ00000000137010001944";

    /** A valid German one: a backer may bank anywhere. */
    private static final String FOREIGN_IBAN = "DE89 3704 0044 0532 0130 00";

    private static final String NOTE = "#399 fixture";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private CampaignRefundJob job;

    @Autowired
    private DisputeService disputes;

    @Autowired
    private PayoutGateway gateway;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private RefundWindows windows;

    @Autowired
    private RefundBankTransfers bankRefunds;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private LedgerReconciliation reconciliation;

    @Autowired
    private OutboxRelay relay;

    private final List<UUID> paidPledges = new ArrayList<>();
    private final List<UUID> projects = new ArrayList<>();
    private BankDetailsKeys.Installed keys;
    private Object unlimited;

    @BeforeEach
    void pastTheWindow() {
        provider.reset();
        unlimited = ReflectionTestUtils.getField(windows, "windows");
        keys = BankDetailsKeys.installCipher(bankRefunds);
    }

    @AfterEach
    void clear() {
        clock.reset();
        ReflectionTestUtils.setField(windows, "windows", unlimited);
        keys.close();
        provider.reset();
        jdbc().update("DELETE FROM provider_webhook_events");
        PaymentRows.clearProjects(dataSource, projects);
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
        projects.clear();
        jdbc().update("DELETE FROM support_tickets WHERE subject = ?", NOTE);
        jdbc().update("DELETE FROM staff_role_grants WHERE note = ?", NOTE);
    }

    // ------------------------------------------------------------------
    // Routing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("with no window configured a refund goes to the provider, however old the charge")
    void noWindowIsTodaysBehaviour() {
        Paid paid = aPaidPledge("bank-none", "25.00");
        clock.advance(Duration.ofDays(400));
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(refundStates(paid.pledgeId())).containsExactly("SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
    }

    @Test
    @DisplayName("a charge inside its window is still refunded through the provider")
    void insideTheWindowGoesToTheProvider() {
        windowOfOneDay();
        Paid paid = aPaidPledge("bank-inside", "25.00");
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());

        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(refundStates(paid.pledgeId())).containsExactly("SUCCEEDED");
    }

    @Test
    @DisplayName("past the window the sweep sends nothing, the refund waits for bank details, and nothing is offered twice")
    void pastTheWindowWaitsForBankDetails() {
        Paid paid = pastTheWindow("bank-sweep", "25.00");
        end(paid.projectId(), "UNSUCCESSFUL");

        job.refundDue(clock.instant());
        job.refundDue(clock.instant().plus(Duration.ofDays(1)));

        assertThat(sentFor(paid.pledgeId())).as("never sent to the provider").isEmpty();
        Map<String, Object> refund = jdbc().queryForMap(
                "SELECT id, state, settled_at, failure_code, amount FROM refunds WHERE pledge_id = ?", paid.pledgeId());
        assertThat(refund.get("state")).isEqualTo("AWAITING_BANK_DETAILS");
        assertThat(refund.get("settled_at")).isNull();
        assertThat(refund.get("failure_code")).isNull();
        assertThat(state(paid.pledgeId())).as("nothing has gone back yet").isEqualTo("COLLECTED");
        assertThat(gateway.fundsOf(paid.projectId(), "AZN").refunded().amount())
                .as("the payout does not pay out money owed back to a backer")
                .isEqualByComparingTo("25.00");
        assertThat(audits("refund.routed_to_bank_transfer", (UUID) refund.get("id"))).hasSize(1);
        assertThat(events(paid.pledgeId())).as("the backer is asked once").isEqualTo(1L);
    }

    @Test
    @DisplayName("a refund the provider refuses as too old waits for bank details instead of failing")
    void tooOldWaitsForBankDetails() {
        Paid paid = aPaidPledge("bank-too-old", "25.00");
        provider.willRefuseRefundsAsTooOld();

        ResponseEntity<Map<String, Object>> issued = staffRefund(paid.pledgeId(), null);

        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(issued.getBody()).containsEntry("state", "AWAITING_BANK_DETAILS");
        assertThat(sentFor(paid.pledgeId())).hasSize(1);
        assertThat(refundStates(paid.pledgeId())).containsExactly("AWAITING_BANK_DETAILS");
        assertThat(events(paid.pledgeId())).isEqualTo(1L);
    }

    @Test
    @DisplayName("two parts of one pledge waiting for a bank transfer ask the backer once")
    void oneRequestPerPledge() {
        Paid paid = pastTheWindow("bank-two-parts", "25.00");

        assertThat(staffRefund(paid.pledgeId(), azn("10.00")).getBody()).containsEntry("state", "AWAITING_BANK_DETAILS");
        assertThat(staffRefund(paid.pledgeId(), azn("15.00")).getBody()).containsEntry("state", "AWAITING_BANK_DETAILS");

        assertThat(refundStates(paid.pledgeId())).containsExactly("AWAITING_BANK_DETAILS", "AWAITING_BANK_DETAILS");
        assertThat(events(paid.pledgeId())).isEqualTo(1L);
        assertThat(staffRefund(paid.pledgeId(), azn("1.00")).getStatusCode())
                .as("nothing is left: both parts count as gone")
                .isEqualTo(HttpStatus.CONFLICT);
    }

    // ------------------------------------------------------------------
    // Support, then finance
    // ------------------------------------------------------------------

    @Test
    @DisplayName("support records the account, finance reveals it and records the transfer, and the pledge is refunded")
    void theWholeWay() {
        Paid paid = pastTheWindow("bank-whole", "25.00");
        UUID refundId = routed(paid);
        Account support = staff("bank-support", "MODERATOR");
        Account finance = staff("bank-finance", "FINANCE");

        ResponseEntity<Map<String, Object>> recorded =
                recordDetails(support, paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        assertThat(recorded.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> part = refundsOf(recorded).getFirst();
        assertThat(part).containsEntry("state", "AWAITING_TRANSFER");
        assertThat(asMap(part.get("bankTransfer"))).containsEntry("ibanHint", "AZ21…1944");
        assertThat(recorded.getBody().toString()).doesNotContain(IBAN);

        Map<String, Object> row = jdbc().queryForMap(
                "SELECT iban_ciphertext, iban_nonce, iban_key_id, holder_name FROM refund_bank_transfers WHERE refund_id = ?",
                refundId);
        byte[] ciphertext = (byte[]) row.get("iban_ciphertext");
        assertThat(new String(ciphertext, StandardCharsets.ISO_8859_1)).doesNotContain("NABZ");
        assertThat(new String(
                        BankDetailsKeys.cipher().open(
                                new Sealed(ciphertext, (byte[]) row.get("iban_nonce"), (String) row.get("iban_key_id")),
                                RefundBankTransfer.context(refundId)),
                        StandardCharsets.UTF_8))
                .isEqualTo(IBAN);

        ResponseEntity<Map<String, Object>> revealed = get("/v1/admin/refunds/" + refundId + "/bank-details", finance);
        assertThat(revealed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(revealed.getBody()).containsEntry("iban", IBAN).containsEntry("holderName", "Test Backer");
        assertThat(revealed.getHeaders().getCacheControl()).contains("no-store");
        assertThat(audits("refund.bank_details_revealed", refundId)).hasSize(1);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE detail LIKE ?", Long.class, "%" + IBAN.substring(4) + "%"))
                .as("no audit row carries the number")
                .isZero();

        String today = LocalDate.now(ZoneOffset.UTC).toString();
        Map<String, BigDecimal> gapsBefore = reconciliationGaps();
        ResponseEntity<Map<String, Object>> paidOut = recordTransfer(finance, refundId, "BANK-REF-" + paid.pledgeId(), today);
        assertThat(paidOut.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(paidOut.getBody()).containsEntry("state", "SUCCEEDED");
        assertThat(state(paid.pledgeId())).isEqualTo("REFUNDED");
        assertThat(reconciliationGaps())
                .as("escrow spans the bank account too: the ledger still agrees with the transactions")
                .isEqualTo(gapsBefore);

        String key = jdbc().queryForObject("SELECT idempotency_key FROM refunds WHERE id = ?", String.class, refundId);
        Map<String, Object> transaction = jdbc().queryForMap(
                "SELECT provider, provider_transaction_id, status, amount, provider_response::text AS response"
                        + " FROM transactions WHERE idempotency_key = ?",
                key + "-bank");
        assertThat(transaction.get("provider")).isEqualTo(ProviderName.BANK_TRANSFER.name());
        assertThat(transaction.get("provider_transaction_id")).isNull();
        assertThat(transaction.get("status")).isEqualTo("SUCCEEDED");
        assertThat((BigDecimal) transaction.get("amount")).isEqualByComparingTo("25.00");
        assertThat((String) transaction.get("response")).contains("BANK-REF-" + paid.pledgeId());
        assertThat(jdbc().queryForObject(
                        """
                        SELECT count(*) FROM ledger_entries e JOIN transactions t ON t.id = e.transaction_id
                         WHERE t.idempotency_key = ?
                        """,
                        Long.class,
                        key + "-bank"))
                .isEqualTo(2L);

        ResponseEntity<Map<String, Object>> replayed =
                recordTransfer(finance, refundId, "BANK-REF-" + paid.pledgeId(), today);
        assertThat(replayed.getStatusCode()).as("the same transfer, recorded twice").isEqualTo(HttpStatus.OK);
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM transactions WHERE idempotency_key = ?", Long.class, key + "-bank"))
                .isEqualTo(1L);
        ResponseEntity<Map<String, Object>> another = recordTransfer(finance, refundId, "ANOTHER-REF", today);
        assertThat(another.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(another.getBody()).containsEntry("code", "REFUND_NOT_AWAITING_TRANSFER");
    }

    @Test
    @DisplayName("#418: the backer is told once that the transfer was sent, with the amount, the value date and the masked account")
    void theBackerIsToldOnce() {
        Paid paid = pastTheWindow("bank-told", "25.00");
        UUID refundId = routed(paid);
        UUID backer = jdbc().queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, paid.pledgeId());
        recordDetails(staff("bank-support", "MODERATOR"), paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        assertThat(sentEvents(paid.pledgeId())).as("nothing is announced before the transfer").isEmpty();

        Account finance = staff("bank-finance", "FINANCE");
        String valueDate = LocalDate.now(ZoneOffset.UTC).toString();
        String reference = "TOLD-" + paid.pledgeId();
        assertThat(recordTransfer(finance, refundId, reference, valueDate).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(recordTransfer(finance, refundId, reference, valueDate).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(recordTransfer(finance, refundId, "TOLD-OTHER", valueDate).getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);

        List<String> events = sentEvents(paid.pledgeId());
        assertThat(events).as("one announcement, however often the transfer is recorded").hasSize(1);
        assertThat(events.getFirst())
                .contains(backer.toString())
                .contains(refundId.toString())
                .contains("\"amount\":\"25.00\"")
                .contains("\"transferredOn\":\"" + valueDate + "\"")
                .contains("AZ21…1944")
                .doesNotContain(IBAN)
                .doesNotContain(reference);

        // Only this event is delivered: an earlier suite's pending events name rows it has since removed.
        jdbc().update(
                "DELETE FROM outbox_events WHERE event_type <> 'refund.sent_by_bank' OR aggregate_id <> ?",
                paid.pledgeId());
        relay.run();
        List<Map<String, Object>> told = jdbc().queryForList(
                """
                SELECT DISTINCT recipient_id, params->>'pledgeId' AS pledge, params->>'sentOn' AS sent_on,
                       params->>'accountHint' AS hint, params->'amount'->>'amount' AS amount
                  FROM notifications WHERE type = 'REFUND_SENT_BY_BANK' AND subject_id = ?
                """,
                paid.pledgeId());
        assertThat(told).singleElement().satisfies(row -> assertThat(row)
                .containsEntry("recipient_id", backer)
                .containsEntry("pledge", paid.pledgeId().toString())
                .containsEntry("sent_on", valueDate)
                .containsEntry("hint", "AZ21…1944")
                .containsEntry("amount", "25.00"));
    }

    @Test
    @DisplayName("the backer's pledge says what waits for a bank transfer until the transfer is recorded")
    void theBackerSeesWhatIsOwed() {
        Paid paid = aPaidPledge("bank-backer", "25.00");
        Account backer = tokenFor(
                jdbc().queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, paid.pledgeId()));
        assertThat(get("/v1/pledges/" + paid.pledgeId(), backer).getBody())
                .containsEntry("refundAwaitingBankTransfer", null);

        UUID refundId = routed(paid);
        assertThat(asMap(get("/v1/pledges/" + paid.pledgeId(), backer).getBody().get("refundAwaitingBankTransfer")))
                .containsEntry("amount", "25.00")
                .containsEntry("currency", "AZN");

        recordDetails(staff("bank-support", "MODERATOR"), paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        assertThat(asMap(get("/v1/pledges/" + paid.pledgeId(), backer).getBody().get("refundAwaitingBankTransfer")))
                .as("the account is on file and the money has still not arrived")
                .containsEntry("amount", "25.00");

        recordTransfer(
                staff("bank-finance", "FINANCE"),
                refundId,
                "BANK-REF-" + paid.pledgeId(),
                LocalDate.now(ZoneOffset.UTC).toString());
        assertThat(get("/v1/pledges/" + paid.pledgeId(), backer).getBody())
                .containsEntry("refundAwaitingBankTransfer", null)
                .containsEntry("state", "REFUNDED");
    }

    @Test
    @DisplayName("the value date is Baku's day: one hour past midnight there is today, not the future")
    void theValueDateIsBakusDay() {
        Paid paid = pastTheWindow("bank-baku", "25.00");
        UUID refundId = routed(paid);
        recordDetails(staff("bank-support", "MODERATOR"), paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        ZoneId baku = ZoneId.of("Asia/Baku");
        ZonedDateTime oneInTheMorning =
                clock.instant().atZone(baku).toLocalDate().plusDays(1).atTime(1, 0).atZone(baku);
        clock.advance(Duration.between(clock.instant(), oneInTheMorning.toInstant()));
        LocalDate today = oneInTheMorning.toLocalDate();
        assertThat(today).as("still yesterday in UTC").isAfter(LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC));
        Account finance = staff("bank-finance", "FINANCE");

        ResponseEntity<Map<String, Object>> tomorrow =
                recordTransfer(finance, refundId, "BAKU-" + paid.pledgeId(), today.plusDays(1).toString());
        assertThat(tomorrow.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(tomorrow.getBody()).containsEntry("code", "TRANSFER_DATE_IN_FUTURE");

        ResponseEntity<Map<String, Object>> recorded =
                recordTransfer(finance, refundId, "BAKU-" + paid.pledgeId(), today.toString());
        assertThat(recorded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(recorded.getBody()).containsEntry("state", "SUCCEEDED");
    }

    @Test
    @DisplayName("whoever recorded the account does not record the transfer")
    void dutiesAreSeparate() {
        Paid paid = pastTheWindow("bank-duties", "25.00");
        UUID refundId = routed(paid);
        Account both = staff("bank-both", "SUPER_ADMIN");

        recordDetails(both, paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        ResponseEntity<Map<String, Object>> refused =
                recordTransfer(both, refundId, "REF-" + UUID.randomUUID(), LocalDate.now(ZoneOffset.UTC).toString());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "REFUND_DUTIES_NOT_SEPARATE");
        assertThat(refundStates(paid.pledgeId())).containsExactly("AWAITING_TRANSFER");
    }

    @Test
    @DisplayName("support may correct the account before the transfer, and the correction is audited")
    void theAccountCanBeReplaced() {
        Paid paid = pastTheWindow("bank-replace", "25.00");
        UUID refundId = routed(paid);
        Account support = staff("bank-support", "MODERATOR");
        Account finance = staff("bank-finance", "FINANCE");
        UUID ticket = ticketFromBacker(paid);

        recordDetails(support, paid.pledgeId(), IBAN, "Test Backer", ticket);
        ResponseEntity<Map<String, Object>> replaced = recordDetails(support, paid.pledgeId(), FOREIGN_IBAN, "Test Backer", ticket);

        assertThat(replaced.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(get("/v1/admin/refunds/" + refundId + "/bank-details", finance).getBody())
                .containsEntry("iban", "DE89370400440532013000");
        assertThat(audits("refund.bank_details_recorded", refundId))
                .hasSize(2)
                .anySatisfy(detail -> assertThat(detail).contains("replaced=AZ21…1944"));
    }

    @Test
    @DisplayName("an account is recorded only from the backer's own ticket, only as a real IBAN, and only when something waits")
    void whatSupportMayRecord() {
        Paid paid = pastTheWindow("bank-refusals", "25.00");
        Account support = staff("bank-support", "MODERATOR");
        Paid other = aPaidPledge("bank-refusals-other", "5.00");

        ResponseEntity<Map<String, Object>> nothingYet =
                recordDetails(support, paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        assertThat(nothingYet.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(nothingYet.getBody()).containsEntry("code", "NO_REFUND_AWAITING_BANK_DETAILS");

        routed(paid);
        ResponseEntity<Map<String, Object>> mistyped = recordDetails(
                support, paid.pledgeId(), IBAN.substring(0, 27) + "5", "Test Backer", ticketFromBacker(paid));
        assertThat(mistyped.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(mistyped.getBody()).containsEntry("code", "MALFORMED_IBAN");
        assertThat(asMap(mistyped.getBody().get("meta"))).containsEntry("defect", "CHECKSUM");
        assertThat(mistyped.getBody().toString()).doesNotContain("NABZ");

        ResponseEntity<Map<String, Object>> strangersTicket =
                recordDetails(support, paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(other));
        assertThat(strangersTicket.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(strangersTicket.getBody()).containsEntry("code", "SUPPORT_TICKET_NOT_FROM_BACKER");

        Account curator = staff("bank-curator", "CURATOR");
        assertThat(recordDetails(curator, paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid)).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refundStates(paid.pledgeId())).containsExactly("AWAITING_BANK_DETAILS");
    }

    @Test
    @DisplayName("support opens the backer's ticket from the pledge alone, and the account is recorded from it")
    void aTicketRaisedForThePledgesBacker() {
        Paid paid = pastTheWindow("bank-raised", "25.00");
        routed(paid);
        Account support = staff("bank-support", "MODERATOR");
        UUID backer = jdbc().queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, paid.pledgeId());

        ResponseEntity<Map<String, Object>> raised = raiseTicket(support, "PLEDGE", paid.pledgeId());
        assertThat(raised.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> ticket = asMap(raised.getBody().get("ticket"));
        assertThat(ticket).containsEntry("requesterId", backer.toString()).containsEntry("subjectType", "PLEDGE");
        UUID ticketId = UUID.fromString((String) ticket.get("id"));
        assertThat(audits("support.ticket_handled", ticketId))
                .singleElement()
                .asString()
                .contains("requester=" + backer + " (the pledge's backer)");

        assertThat(recordDetails(support, paid.pledgeId(), IBAN, "Test Backer", ticketId).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(refundStates(paid.pledgeId())).containsExactly("AWAITING_TRANSFER");
    }

    @Test
    @DisplayName("a ticket with no requester must be about a pledge that exists")
    void aTicketWithNoRequester() {
        Account support = staff("bank-support", "MODERATOR");

        ResponseEntity<Map<String, Object>> aboutNothing = raiseTicket(support, "NONE", null);
        assertThat(aboutNothing.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(aboutNothing.getBody()).containsEntry("code", "TICKET_REQUESTER_REQUIRED");

        ResponseEntity<Map<String, Object>> noSuchPledge = raiseTicket(support, "PLEDGE", UUID.randomUUID());
        assertThat(noSuchPledge.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(noSuchPledge.getBody()).containsEntry("code", "PLEDGE_NOT_FOUND");

        Account curator = staff("bank-curator", "CURATOR");
        assertThat(raiseTicket(curator, "PLEDGE", UUID.randomUUID()).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("nothing is revealed or paid by bank while the charge is in an open chargeback")
    void notDuringAChargeback() {
        Paid paid = pastTheWindow("bank-disputed", "25.00");
        UUID refundId = routed(paid);
        Account support = staff("bank-support", "MODERATOR");
        Account finance = staff("bank-finance", "FINANCE");
        recordDetails(support, paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        disputes.notified(
                ProviderName.AZERICARD,
                "case-" + UUID.randomUUID(),
                paid.chargeId(),
                Money.of(new BigDecimal("25.00"), "AZN"),
                Money.of(new BigDecimal("0.00"), "AZN"),
                "fraudulent",
                null);

        ResponseEntity<Map<String, Object>> reveal = get("/v1/admin/refunds/" + refundId + "/bank-details", finance);
        ResponseEntity<Map<String, Object>> record =
                recordTransfer(finance, refundId, "REF-" + UUID.randomUUID(), LocalDate.now(ZoneOffset.UTC).toString());

        assertThat(reveal.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(reveal.getBody()).containsEntry("code", "REFUND_CHARGE_DISPUTED");
        assertThat(record.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(record.getBody()).containsEntry("code", "REFUND_CHARGE_DISPUTED");
        assertThat(refundStates(paid.pledgeId())).containsExactly("AWAITING_TRANSFER");
    }

    @Test
    @DisplayName("a transfer is not recorded for a future day, nor under a reference another backer's refund has")
    void whatFinanceMayRecord() {
        Paid first = pastTheWindow("bank-ref-one", "25.00");
        Paid second = aPaidPledge("bank-ref-two", "10.00");
        UUID firstRefund = routed(first);
        UUID secondRefund = routed(second);
        Account support = staff("bank-support", "MODERATOR");
        Account finance = staff("bank-finance", "FINANCE");
        recordDetails(support, first.pledgeId(), IBAN, "Test Backer", ticketFromBacker(first));
        recordDetails(support, second.pledgeId(), FOREIGN_IBAN, "Other Backer", ticketFromBacker(second));
        String today = LocalDate.now(ZoneOffset.UTC).toString();
        String reference = "SHARED-" + UUID.randomUUID();

        ResponseEntity<Map<String, Object>> future = recordTransfer(
                finance, firstRefund, reference, LocalDate.now(ZoneOffset.UTC).plusDays(30).toString());
        assertThat(future.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(future.getBody()).containsEntry("code", "TRANSFER_DATE_IN_FUTURE");

        assertThat(recordTransfer(finance, firstRefund, reference, today).getStatusCode()).isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> taken = recordTransfer(finance, secondRefund, reference, today);
        assertThat(taken.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(taken.getBody()).containsEntry("code", "BANK_REFERENCE_TAKEN");
        assertThat(refundStates(second.pledgeId())).containsExactly("AWAITING_TRANSFER");
    }

    @Test
    @DisplayName("a chargeback on a charge already refunded by bank transfer is logged as an error for a person")
    void aChargebackAfterABankRefundIsAnError(CapturedOutput output) {
        Paid paid = pastTheWindow("bank-then-chargeback", "25.00");
        UUID refundId = routed(paid);
        recordDetails(staff("bank-support", "MODERATOR"), paid.pledgeId(), IBAN, "Test Backer", ticketFromBacker(paid));
        recordTransfer(staff("bank-finance", "FINANCE"), refundId, "CB-REF-" + refundId, LocalDate.now(ZoneOffset.UTC).toString());
        assertThat(refundStates(paid.pledgeId())).containsExactly("SUCCEEDED");

        UUID dispute = disputes.notified(
                        ProviderName.AZERICARD,
                        "case-" + UUID.randomUUID(),
                        paid.chargeId(),
                        Money.of(new BigDecimal("25.00"), "AZN"),
                        Money.of(new BigDecimal("0.00"), "AZN"),
                        "fraudulent",
                        null)
                .id();

        assertThat(output.getOut() + output.getErr())
                .contains("Dispute " + dispute + " is a chargeback on charge " + paid.chargeId())
                .contains("already refunded by bank transfer");
    }

    // ------------------------------------------------------------------
    // The fallback: a refusal the adapter did not recognise
    // ------------------------------------------------------------------

    @Test
    @DisplayName("staff route a refused refund to a bank transfer: a new refund for what is left, once")
    void aRefusalIsRoutedByHand() {
        Paid paid = aPaidPledge("bank-fallback", "25.00");
        provider.willRefuseRefunds("15400");
        ResponseEntity<Map<String, Object>> refused = staffRefund(paid.pledgeId(), null);
        assertThat(refused.getBody()).containsEntry("state", "FAILED");
        UUID refusedId = UUID.fromString((String) refused.getBody().get("id"));
        Account finance = staff("bank-finance", "FINANCE");

        ResponseEntity<Map<String, Object>> routed = post("/v1/admin/refunds/" + refusedId + "/bank-transfer", finance, null);
        ResponseEntity<Map<String, Object>> again = post("/v1/admin/refunds/" + refusedId + "/bank-transfer", finance, null);

        assertThat(routed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(routed.getBody()).containsEntry("state", "AWAITING_BANK_DETAILS");
        assertThat(again.getBody().get("id")).as("a replay finds the same refund").isEqualTo(routed.getBody().get("id"));
        assertThat(jdbc().queryForObject(
                        "SELECT idempotency_key FROM refunds WHERE id = ?",
                        String.class,
                        UUID.fromString((String) routed.getBody().get("id"))))
                .isEqualTo("bank-refund:" + refusedId);
        assertThat(refundStates(paid.pledgeId())).containsExactly("FAILED", "AWAITING_BANK_DETAILS");
        assertThat(events(paid.pledgeId())).isEqualTo(1L);

        ResponseEntity<Map<String, Object>> notRefused = post(
                "/v1/admin/refunds/" + routed.getBody().get("id") + "/bank-transfer", finance, null);
        assertThat(notRefused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(notRefused.getBody()).containsEntry("code", "REFUND_NOT_FAILED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Paid(UUID projectId, UUID pledgeId, UUID chargeId, String providerTransactionId) {
    }

    private void windowOfOneDay() {
        ReflectionTestUtils.setField(windows, "windows", Map.of(ProviderName.AZERICARD, Duration.ofDays(1)));
    }

    /** A pledge paid now, with the clock then moved past the test provider's one-day window. */
    private Paid pastTheWindow(String prefix, String amount) {
        windowOfOneDay();
        Paid paid = aPaidPledge(prefix, amount);
        clock.advance(Duration.ofDays(2));
        return paid;
    }

    /** The pledge's whole refund, issued by staff past the window: one part, waiting for bank details. */
    private UUID routed(Paid paid) {
        windowOfOneDay();
        if (clock.instant().isBefore(Instant.now().plus(Duration.ofDays(1)))) {
            clock.advance(Duration.ofDays(2));
        }
        ResponseEntity<Map<String, Object>> issued = staffRefund(paid.pledgeId(), null);
        assertThat(issued.getBody()).containsEntry("state", "AWAITING_BANK_DETAILS");
        return UUID.fromString((String) issued.getBody().get("id"));
    }

    private UUID ticketFromBacker(Paid paid) {
        UUID backer = jdbc().queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, paid.pledgeId());
        UUID id = UUID.randomUUID();
        jdbc().update(
                "INSERT INTO support_tickets (id, requester_id, subject, subject_type, subject_ref) VALUES (?, ?, ?, 'PLEDGE', ?)",
                id,
                backer,
                NOTE,
                paid.pledgeId());
        return id;
    }

    private Paid aPaidPledge(String prefix, String amount) {
        Account creator = account(prefix + "-creator");
        UUID projectId = UUID.fromString((String) post(
                        "/v1/projects",
                        creator,
                        Map.of("title", "A campaign that pays back by bank " + SEQUENCE.incrementAndGet()))
                .getBody()
                .get("id"));
        projects.add(projectId);
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", amount, "currency", "AZN"));
        UUID pledgeId = UUID.fromString((String) post("/v1/pledges/draft", backer, UUID.randomUUID().toString(), body)
                .getBody()
                .get("id"));
        paidPledges.add(pledgeId);
        String transaction = (String) post(
                        "/v1/pledges/" + pledgeId + "/payment", backer, UUID.randomUUID().toString(), Map.of("language", "en"))
                .getBody()
                .get("providerTransactionId");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        String delivery = """
                {"id":"evt-%s","type":"charge_succeeded","providerTransactionId":"%s"}"""
                .formatted(UUID.randomUUID(), transaction);
        assertThat(rest.exchange(
                                "/v1/webhooks/psp/azericard",
                                HttpMethod.POST,
                                new HttpEntity<>(delivery.getBytes(), headers),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(state(pledgeId)).isEqualTo("COLLECTED");
        UUID chargeId = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'SUCCEEDED'",
                UUID.class,
                pledgeId);
        return new Paid(projectId, pledgeId, chargeId, transaction);
    }

    private void end(UUID projectId, String state) {
        jdbc().update(
                """
                UPDATE projects
                   SET state = ?,
                       finalized_at = now(),
                       outcome_goal_amount = goal_amount,
                       outcome_pledged_amount = pledged_amount,
                       outcome_backers_count = backers_count
                 WHERE id = ?
                """,
                state,
                projectId);
    }

    private ResponseEntity<Map<String, Object>> staffRefund(UUID pledgeId, Map<String, Object> amount) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pledgeId", pledgeId.toString());
        body.put("amount", amount);
        body.put("reason", "BACKER_REQUEST");
        body.put("detail", "The backer asked, in a test.");
        return post("/v1/admin/refunds", staff("bank-issuer", "FINANCE"), "refund-" + UUID.randomUUID(), body);
    }

    private ResponseEntity<Map<String, Object>> recordDetails(
            Account staff, UUID pledgeId, String iban, String holder, UUID ticket) {
        return exchange(
                HttpMethod.PUT,
                "/v1/admin/pledges/" + pledgeId + "/refund-bank-details",
                staff,
                null,
                Map.of("iban", iban, "holderName", holder, "ticketId", ticket.toString()));
    }

    /** #416: a ticket raised without naming its requester. */
    private ResponseEntity<Map<String, Object>> raiseTicket(Account staff, String subjectType, UUID subjectRef) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("subject", NOTE);
        body.put("subjectType", subjectType);
        body.put("subjectRef", subjectRef == null ? null : subjectRef.toString());
        body.put("body", "Sent on WhatsApp: please refund my pledge to my bank account.");
        return post("/v1/admin/tickets", staff, body);
    }

    private ResponseEntity<Map<String, Object>> recordTransfer(Account staff, UUID refundId, String reference, String on) {
        return post(
                "/v1/admin/refunds/" + refundId + "/bank-transfer/record",
                staff,
                Map.of("bankReference", reference, "transferredOn", on));
    }

    private static Map<String, Object> azn(String amount) {
        return Map.of("amount", amount, "currency", "AZN");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> refundsOf(ResponseEntity<Map<String, Object>> page) {
        return (List<Map<String, Object>>) page.getBody().get("refunds");
    }

    /**
     * What the ledger reconciliation finds wrong, as a gap per check and currency. The suites share one
     * database, so the test compares the gaps before and after rather than asking for none.
     */
    private Map<String, BigDecimal> reconciliationGaps() {
        Map<String, BigDecimal> gaps = new TreeMap<>();
        for (ReconciliationFinding finding : reconciliation.reconcile().findings()) {
            if (finding.code() == ReconciliationFinding.Code.DISAGREES_WITH_PAYMENTS) {
                gaps.put(finding.code() + ":" + finding.currency(), finding.amount().subtract(finding.otherAmount()));
            } else if (finding.code() == ReconciliationFinding.Code.LEDGER_NOT_ZERO) {
                gaps.put(finding.code() + ":" + finding.currency(), finding.amount());
            }
        }
        return gaps;
    }

    private List<RefundRequest> sentFor(UUID pledgeId) {
        return provider.refunds().stream().filter(request -> request.pledgeId().equals(pledgeId)).toList();
    }

    private List<String> refundStates(UUID pledgeId) {
        return jdbc().queryForList(
                "SELECT state FROM refunds WHERE pledge_id = ? ORDER BY requested_at, id", String.class, pledgeId);
    }

    private List<String> audits(String action, UUID entity) {
        return jdbc().queryForList(
                "SELECT detail FROM audit_logs WHERE action = ? AND entity_id = ?", String.class, action, entity);
    }

    private long events(UUID pledgeId) {
        return jdbc().queryForObject(
                "SELECT count(*) FROM outbox_events WHERE event_type = 'refund.needs_bank_details' AND aggregate_id = ?",
                Long.class,
                pledgeId);
    }

    /** The {@code refund.sent_by_bank} events recorded for this pledge, as their payloads (#418). */
    private List<String> sentEvents(UUID pledgeId) {
        return jdbc().queryForList(
                "SELECT payload FROM outbox_events WHERE event_type = 'refund.sent_by_bank' AND aggregate_id = ?",
                String.class,
                pledgeId);
    }

    private String state(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    /** A member of staff holding one V48 role. */
    private Account staff(String handle, String role) {
        UUID id = Campaigns.creator(dataSource, handle);
        jdbc().update(
                """
                INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                VALUES (?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """,
                id,
                role,
                id,
                NOTE);
        return tokenFor(id);
    }

    private Account account(String prefix) {
        return tokenFor(Campaigns.creator(dataSource, prefix + "-" + SEQUENCE.incrementAndGet()));
    }

    private Account tokenFor(UUID id) {
        String token = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(token, id);
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account account) {
        return exchange(HttpMethod.GET, path, account, null, null);
    }

    private ResponseEntity<Map<String, Object>> post(String path, Account account, Object body) {
        return exchange(HttpMethod.POST, path, account, null, body);
    }

    private ResponseEntity<Map<String, Object>> post(String path, Account account, String idempotencyKey, Object body) {
        return exchange(HttpMethod.POST, path, account, idempotencyKey, body);
    }

    private ResponseEntity<Map<String, Object>> exchange(
            HttpMethod method, String path, Account account, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(account.accessToken());
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
