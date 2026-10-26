package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.application.CampaignRefundJob;
import az.ideanest.payment.application.HostedChargeSweepJob;
import az.ideanest.payment.application.PaymentProviderStatus;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.observability.ProviderStatusSource.ProviderStatus;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.PaymentRows;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import io.micrometer.core.instrument.MeterRegistry;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
 * Charged at confirmation — IDN-EXT-01 (#39), §6.2's {@code DRAFT → COLLECTED}.
 *
 * <p>End to end through the two requests that make it: the backer's
 * {@code POST /v1/pledges/{id}/payment}, and the provider's webhook saying the payment went through
 * or did not. The scripted provider opens the page; a scripted delivery settles it.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aSuccessfulPaymentCollectsAndCounts()} — the money, the pledge and the campaign's
 *       total move together, and the total moves for the first time in the platform's life.
 *   <li>{@link #aSecondDeliveryMovesNothingTwice()} — a payment is counted once however often the
 *       provider says so.
 *   <li>{@link #aFailedPaymentLeavesTheDraft()} — nothing is counted for money nobody took.
 * </ul>
 */
class HostedPaymentApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private HostedChargeSweepJob sweep;

    @Autowired
    private MeterRegistry meters;

    @Autowired
    private PaymentProviderStatus providerStatus;

    @Autowired
    private CampaignRefundJob campaignRefunds;

    @Autowired
    private PayoutGateway payouts;

    /**
     * The deliveries this suite made. ProviderWebhookApiTests reads that table as its own, and a row
     * left here would be the first one it finds. Transactions and ledger rows are append-only by
     * trigger and stay, as every payment suite's do.
     */
    /** The pledges this suite paid for, whose payment rows it removes — see {@code PaymentRows}. */
    private final List<UUID> paidPledges = new ArrayList<>();

    @AfterEach
    void clearDeliveries() {
        jdbc().update("DELETE FROM provider_webhook_events");
        PaymentRows.clearPledges(dataSource, paidPledges);
        paidPledges.clear();
    }

    @Test
    @DisplayName("opening the payment page holds the draft and records a pending charge, and moves no money")
    void openingThePageHoldsTheDraft() {
        Checkout checkout = aDraft("hosted-open");
        String key = UUID.randomUUID().toString();

        ResponseEntity<Map<String, Object>> page = pay(checkout, key);

        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((String) page.getBody().get("redirectUrl")).startsWith("https://");
        String transaction = (String) page.getBody().get("providerTransactionId");
        assertThat(transaction).startsWith("scripted-hosted-");

        HostedPaymentRequest asked = provider.hostedPayments().getLast();
        assertThat(asked.reference()).isEqualTo(checkout.pledgeId());
        assertThat(asked.amount().amount()).isEqualByComparingTo("25.00");
        assertThat(asked.idempotencyKey()).isEqualTo(key);

        // Still a draft, held for the payment window rather than the five minutes.
        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(reservationExpiresAt(checkout.pledgeId()))
                .isAfter(Instant.now().plus(Duration.ofMinutes(10)));
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("a successful payment collects the pledge, posts the ledger and counts towards the campaign")
    void aSuccessfulPaymentCollectsAndCounts() {
        Checkout checkout = aDraft("hosted-paid");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(state(checkout.pledgeId())).isEqualTo("COLLECTED");
        Map<String, Object> pledge = jdbc().queryForMap(
                "SELECT confirmed_at, collected_at FROM pledges WHERE id = ?", checkout.pledgeId());
        assertThat(pledge.get("confirmed_at")).isNotNull();
        assertThat(pledge.get("collected_at")).isNotNull();

        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        UUID settled = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND status = 'SUCCEEDED'", UUID.class, checkout.pledgeId());
        assertThat(jdbc().queryForObject("SELECT count(*) FROM ledger_entries WHERE transaction_id = ?", Long.class, settled))
                .isEqualTo(2L);

        // The first time anything in production has moved these two columns.
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
    }

    @Test
    @DisplayName("a second delivery about the same payment moves nothing twice")
    void aSecondDeliveryMovesNothingTwice() {
        Checkout checkout = aDraft("hosted-twice");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        String eventId = "evt-" + UUID.randomUUID();
        deliver(eventId, transaction, "charge_succeeded");
        // The same event again, which the webhook table refuses, and a different event about the
        // same payment, which the settled row refuses.
        deliver(eventId, transaction, "charge_succeeded");
        deliver(transaction, "charge_succeeded");

        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
    }

    @Test
    @DisplayName("a failed payment leaves the draft to its hold and counts nothing")
    void aFailedPaymentLeavesTheDraft() {
        Checkout checkout = aDraft("hosted-failed");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        assertThat(deliver(transaction, "charge_failed").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "FAILED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    // ------------------------------------------------------------------
    // #353: the callback that never came
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#353: a paid page whose callback never came is collected by the sweep, once")
    void theSweepCollectsAPaymentWithNoCallback() {
        Checkout checkout = aDraft("hosted-swept");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.willLookUp(transaction, PaymentLookup.State.SUCCEEDED);
        double before = swept("collected");

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(state(checkout.pledgeId())).isEqualTo("COLLECTED");
        // #356: a callback that never came is counted, so a wrong callback address shows up.
        assertThat(swept("collected") - before).isGreaterThanOrEqualTo(1d);
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));

        // The callback arriving late, and the next pass, move nothing twice.
        assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
        sweep.sweep(Instant.now().plus(Duration.ofMinutes(25)));
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
    }

    @Test
    @DisplayName("#353: a page the provider calls failed is failed by the sweep, and the draft keeps its hold")
    void theSweepFailsAFailedPayment() {
        Checkout checkout = aDraft("hosted-swept-failed");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.willLookUp(transaction, PaymentLookup.State.FAILED);
        double before = swept("failed");

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(swept("failed") - before).isGreaterThanOrEqualTo(1d);
        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "FAILED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    @Test
    @DisplayName("#353: a page is asked about only after the callback has had its time, and only within the window")
    void theSweepWaitsAndThenStops() {
        Checkout checkout = aDraft("hosted-swept-pending");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.willLookUp(transaction, PaymentLookup.State.PENDING);
        UUID charge = pendingCharge(checkout.pledgeId());

        sweep.sweep(Instant.now());
        assertThat(lastCheck(charge)).isEmpty();

        Instant asked = Instant.now().plus(Duration.ofMinutes(20)).truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        sweep.sweep(asked);
        assertThat(lastCheck(charge)).containsExactly("PENDING");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");

        // Past the window the page is not asked about again, even though it is still pending.
        provider.willLookUp(transaction, PaymentLookup.State.SUCCEEDED);
        sweep.sweep(Instant.now().plus(Duration.ofDays(8)));
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        assertThat(jdbc().queryForObject(
                        "SELECT checked_at FROM hosted_charge_checks WHERE transaction_id = ?", Instant.class, charge))
                .isEqualTo(asked);
    }

    @Test
    @DisplayName("#353: a page paid and already returned is left for a person, not settled either way")
    void theSweepLeavesAReturnedPayment() {
        Checkout checkout = aDraft("hosted-swept-returned");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.willLookUp(transaction, PaymentLookup.State.RETURNED);

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        assertThat(lastCheck(pendingCharge(checkout.pledgeId()))).containsExactly("RETURNED");
        // #356: and the gauge the alert reads says so.
        assertThat(attention("returned")).isGreaterThanOrEqualTo(1d);
    }

    @Test
    @DisplayName("#356: a page whose provider cannot be asked is published as needing attention")
    void anUnanswerablePageIsPublished() {
        Checkout checkout = aDraft("hosted-swept-unanswered");
        pay(checkout, UUID.randomUUID().toString());
        // A charge taken through a provider with no adapter here — a primary switched away from.
        UUID charge = pendingCharge(checkout.pledgeId());
        jdbc().execute("ALTER TABLE transactions DISABLE TRIGGER USER");
        try {
            jdbc().update("UPDATE transactions SET provider = 'EPOINT' WHERE id = ?", charge);
        } finally {
            jdbc().execute("ALTER TABLE transactions ENABLE TRIGGER USER");
        }

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(lastCheck(charge)).containsExactly("UNANSWERED");
        assertThat(attention("unanswered")).isGreaterThanOrEqualTo(1d);
    }

    @Test
    @DisplayName("#470: a provider that stops answering opens the breaker, and the next page is refused without asking it")
    void anOpenBreakerRefusesThePageWithoutAskingTheProvider() {
        Checkout checkout = aDraft("hosted-breaker");
        provider.willRefuseHostedPayments();
        try {
            // The test profile's threshold is two.
            for (int attempt = 0; attempt < 2; attempt++) {
                ResponseEntity<Map<String, Object>> refused = pay(checkout, UUID.randomUUID().toString());
                assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            }
            assertThat(azericard().available()).as("reported out of service").isFalse();
            assertThat(azericard().configured()).isTrue();

            provider.willOpenHostedPayments();
            int asked = provider.hostedPayments().size();
            ResponseEntity<Map<String, Object>> refused = pay(checkout, UUID.randomUUID().toString());

            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(refused.getBody()).containsEntry("code", "PAYMENT_UNAVAILABLE");
            assertThat(provider.hostedPayments()).as("the provider was not asked").hasSize(asked);
            assertThat(charges(checkout.pledgeId())).isEmpty();
        } finally {
            provider.willOpenHostedPayments();
        }
    }

    @Test
    @DisplayName("only a draft can be paid for")
    void onlyADraftCanBePaidFor() {
        Checkout checkout = aDraft("hosted-again");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        deliver(transaction, "charge_succeeded");

        ResponseEntity<Map<String, Object>> again = pay(checkout, UUID.randomUUID().toString());

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "PLEDGE_NOT_DRAFT");
    }

    @Test
    @DisplayName("a retried request answers the page it opened rather than opening a second")
    void aRetryReplaysThePage() {
        Checkout checkout = aDraft("hosted-retry");
        String key = UUID.randomUUID().toString();

        Object first = pay(checkout, key).getBody().get("providerTransactionId");
        Object second = pay(checkout, key).getBody().get("providerTransactionId");

        assertThat(second).isEqualTo(first);
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
    }

    @Test
    @DisplayName("paying needs an Idempotency-Key, and somebody else's pledge is not found")
    void keyAndOwnership() {
        Checkout checkout = aDraft("hosted-guard");

        assertThat(pay(checkout.backer(), checkout.pledgeId(), null).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(pay(account("hosted-stranger"), checkout.pledgeId(), UUID.randomUUID().toString()).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(provider.hostedPayments()).noneMatch(request -> request.reference().equals(checkout.pledgeId()));
    }

    @Test
    @DisplayName("the web's own return addresses pass, and the pending charge records where the backer goes back to")
    void theWebsReturnAddressesPass() {
        Checkout checkout = aDraft("hosted-return");
        // What apps/web/src/lib/pledges/payment.ts sends, on the suite's production-shaped origin.
        String page = "https://ideanest.az/ru/pledges/" + checkout.pledgeId();

        ResponseEntity<Map<String, Object>> opened = pay(
                checkout,
                UUID.randomUUID().toString(),
                Map.of("language", "ru", "successUrl", page + "?payment=returned", "errorUrl", page + "?payment=failed"));

        assertThat(opened.getStatusCode()).isEqualTo(HttpStatus.OK);
        HostedPaymentRequest asked = provider.hostedPayments().getLast();
        assertThat(asked.successUrl()).hasToString(page + "?payment=returned");
        assertThat(asked.errorUrl()).hasToString(page + "?payment=failed");
        Map<String, Object> recorded = jdbc().queryForMap(
                "SELECT provider_response->>'successUrl' AS success, provider_response->>'errorUrl' AS error"
                        + " FROM transactions WHERE pledge_id = ? AND status = 'PENDING'",
                checkout.pledgeId());
        assertThat(recorded.get("success")).isEqualTo(page + "?payment=returned");
        assertThat(recorded.get("error")).isEqualTo(page + "?payment=failed");
    }

    @ParameterizedTest
    @DisplayName("a return address off the site is refused with 400, and nothing is held, opened or recorded")
    @ValueSource(strings = {
        "https://evil.example/ru/pledges/p?payment=failed",
        "http://ideanest.az/ru/pledges/p?payment=failed",
        "javascript:alert(document.cookie)",
        "/ru/pledges/p?payment=failed",
    })
    void anAddressOffTheSiteIsRefused(String address) {
        Checkout checkout = aDraft("hosted-offsite");
        String good = "https://ideanest.az/ru/pledges/" + checkout.pledgeId() + "?payment=returned";
        Instant heldUntil = reservationExpiresAt(checkout.pledgeId());

        ResponseEntity<Map<String, Object>> asSuccess = pay(
                checkout, UUID.randomUUID().toString(), Map.of("successUrl", address, "errorUrl", good));
        ResponseEntity<Map<String, Object>> asError = pay(
                checkout, UUID.randomUUID().toString(), Map.of("successUrl", good, "errorUrl", address));

        assertThat(asSuccess.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(asSuccess.getBody())
                .containsEntry("code", "INVALID_RETURN_URL")
                .containsEntry("type", "https://ideanest.az/problems/invalid-return-url")
                .containsEntry("meta", Map.of("field", "successUrl"));
        assertThat(asError.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(asError.getBody()).containsEntry("meta", Map.of("field", "errorUrl"));
        // The refusal does not repeat the address it refused.
        assertThat(asSuccess.getBody().toString()).doesNotContain(address);

        assertThat(provider.hostedPayments()).noneMatch(request -> request.reference().equals(checkout.pledgeId()));
        assertThat(charges(checkout.pledgeId())).isEmpty();
        // Refused before the draft was held for the payment window.
        assertThat(reservationExpiresAt(checkout.pledgeId())).isEqualTo(heldUntil);
    }

    // ------------------------------------------------------------------
    // #587: one page per draft, and a second payment returned
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#587: a second key while the draft's page is open is sent back to that page, and no second order opens")
    void aSecondKeyReturnsTheOpenPage() {
        Checkout checkout = aDraft("hosted-one-page");
        ResponseEntity<Map<String, Object>> first = pay(checkout, UUID.randomUUID().toString());
        int asked = provider.hostedPayments().size();

        ResponseEntity<Map<String, Object>> second = pay(checkout, UUID.randomUUID().toString());

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(second.getBody().get("providerTransactionId")).isEqualTo(first.getBody().get("providerTransactionId"));
        assertThat(second.getBody().get("redirectUrl")).isEqualTo(first.getBody().get("redirectUrl"));
        assertThat(provider.hostedPayments()).as("the provider was not asked again").hasSize(asked);
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
    }

    @Test
    @DisplayName("#587: the same language and return addresses are sent back to the open page")
    void theSameReturnIsSentBackToTheOpenPage() {
        Checkout checkout = aDraft("hosted-same-return");
        Map<String, Object> web = returnTo(checkout, "ru", "");
        Object first = pay(checkout, UUID.randomUUID().toString(), web).getBody().get("providerTransactionId");
        int asked = provider.hostedPayments().size();

        Object second = pay(checkout, UUID.randomUUID().toString(), web).getBody().get("providerTransactionId");

        assertThat(second).isEqualTo(first);
        assertThat(provider.hostedPayments()).hasSize(asked);
        assertThat(jdbc().queryForObject(
                        "SELECT provider_response->>'language' FROM transactions WHERE pledge_id = ? AND status = 'PENDING'",
                        String.class,
                        checkout.pledgeId()))
                .isEqualTo("ru");
    }

    /**
     * The review's case. The return addresses are part of the provider's order, so the website's page
     * sends its backer back to the website: handed to the application, it would take the backer out of
     * the app (the app's addresses carry {@code via=app}). A page of its own, as before pages were reused.
     */
    @Test
    @DisplayName("#587: another return address or language opens a page of its own, and each is sent back to its own")
    void anotherReturnOpensItsOwnPage() {
        Checkout checkout = aDraft("hosted-other-return");
        Map<String, Object> web = returnTo(checkout, "ru", "");
        Map<String, Object> app = returnTo(checkout, "ru", "&via=app");
        Object fromWeb = pay(checkout, UUID.randomUUID().toString(), web).getBody().get("providerTransactionId");

        Object fromApp = pay(checkout, UUID.randomUUID().toString(), app).getBody().get("providerTransactionId");

        assertThat(fromApp).isNotEqualTo(fromWeb);
        assertThat(provider.hostedPayments().getLast().successUrl()).hasToString((String) app.get("successUrl"));
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "PENDING");

        // The website asking again finds its own page, not the newer one opened for the app.
        assertThat(pay(checkout, UUID.randomUUID().toString(), web).getBody().get("providerTransactionId"))
                .isEqualTo(fromWeb);
        assertThat(pay(checkout, UUID.randomUUID().toString(), app).getBody().get("providerTransactionId"))
                .isEqualTo(fromApp);

        // Another language is another page: the provider's page answers in the one it was opened in.
        Object inEnglish = pay(checkout, UUID.randomUUID().toString(), returnTo(checkout, "en", ""))
                .getBody()
                .get("providerTransactionId");
        assertThat(inEnglish).isNotEqualTo(fromWeb).isNotEqualTo(fromApp);
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "PENDING", "PENDING");
    }

    @Test
    @DisplayName("#587: once the page is old enough for the sweep to ask after it, a new one may be opened")
    void anOldPageIsNotReturned() {
        Checkout checkout = aDraft("hosted-old-page");
        Object first = pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        backdate(pendingCharge(checkout.pledgeId()), Duration.ofMinutes(20));

        Object second = pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        assertThat(second).isNotEqualTo(first);
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "PENDING");
    }

    /**
     * Both pages of one draft paid. The first collects the pledge; the second was posted and dropped
     * without a word before #587 — money taken that nothing returned. Now it is recorded, counted, kept
     * out of the payout and returned in full by campaign-refunds, once.
     */
    @Test
    @DisplayName("#587: a second payment for a collected pledge is recorded, kept out of the payout and refunded once")
    void aSecondPaymentIsRefunded() {
        Checkout checkout = aDraft("hosted-paid-twice");
        String first = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        backdate(pendingCharge(checkout.pledgeId()), Duration.ofMinutes(20));
        String second = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        double before = anomalies("duplicate");

        assertThat(deliver(first, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(deliver(second, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

        UUID duplicate = jdbc().queryForObject(
                "SELECT id FROM transactions WHERE provider_transaction_id = ? AND status = 'SUCCEEDED'", UUID.class, second);
        assertThat(jdbc().queryForList(
                        "SELECT charge_transaction_id FROM duplicate_charges WHERE pledge_id = ?", UUID.class, checkout.pledgeId()))
                .containsExactly(duplicate);
        assertThat(anomalies("duplicate") - before).isEqualTo(1d);
        assertThat(state(checkout.pledgeId())).isEqualTo("COLLECTED");
        assertThat(totals(checkout.projectId())).as("counted once").isEqualTo(new Totals(new BigDecimal("25.00"), 1));
        assertThat(payouts.fundsOf(checkout.projectId(), "AZN").collected().amount())
                .as("never the creator's")
                .isEqualByComparingTo("25.00");

        campaignRefunds.refundDue(Instant.now());
        campaignRefunds.refundDue(Instant.now());
        // And a redelivery of the second payment's news moves nothing either.
        deliver(second, "charge_succeeded");

        List<Map<String, Object>> refunds = jdbc().queryForList(
                "SELECT charge_transaction_id, amount, reason, state, requested_by, full_refund FROM refunds WHERE pledge_id = ?",
                checkout.pledgeId());
        assertThat(refunds).singleElement().satisfies(refund -> {
            assertThat(refund.get("charge_transaction_id")).isEqualTo(duplicate);
            assertThat((BigDecimal) refund.get("amount")).isEqualByComparingTo("25.00");
            assertThat(refund.get("reason")).isEqualTo("DUPLICATE_CHARGE");
            assertThat(refund.get("state")).isEqualTo("SUCCEEDED");
            assertThat(refund.get("requested_by")).isNull();
            assertThat(refund.get("full_refund")).isEqualTo(false);
        });
        assertThat(state(checkout.pledgeId())).as("the pledge keeps the payment that collected it").isEqualTo("COLLECTED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("25.00"), 1));
        assertThat(payouts.fundsOf(checkout.projectId(), "AZN").net().amount()).isEqualByComparingTo("25.00");
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM duplicate_charges WHERE pledge_id = ?", Long.class, checkout.pledgeId()))
                .isEqualTo(1L);
    }

    // ------------------------------------------------------------------
    // #587: the provider's amount
    // ------------------------------------------------------------------

    @ParameterizedTest
    @DisplayName("#587: a payment reported for another amount or currency is recorded failed and collects nothing")
    @ValueSource(strings = {"30.00 AZN", "25.00 USD"})
    void aDifferentAmountIsFailed(String reported) {
        Checkout checkout = aDraft("hosted-mismatch");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        double before = anomalies("amount_mismatch");
        String[] parts = reported.split(" ");

        assertThat(deliver(transaction, "charge_succeeded", parts[0], parts[1]).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "FAILED");
        assertThat(jdbc().queryForObject(
                        "SELECT failure_code FROM transactions WHERE pledge_id = ? AND status = 'FAILED'",
                        String.class,
                        checkout.pledgeId()))
                .isEqualTo("amount_mismatch");
        assertThat(anomalies("amount_mismatch") - before).isEqualTo(1d);
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM ledger_entries e JOIN transactions t ON t.id = e.transaction_id"
                                + " WHERE t.pledge_id = ?",
                        Long.class,
                        checkout.pledgeId()))
                .as("nothing posted")
                .isZero();
    }

    @Test
    @DisplayName("#587: the same amount, however it is written, collects")
    void theSameAmountCollects() {
        Checkout checkout = aDraft("hosted-amount-matches");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");

        deliver(transaction, "charge_succeeded", "25", "AZN");

        assertThat(state(checkout.pledgeId())).isEqualTo("COLLECTED");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
    }

    @Test
    @DisplayName("#587: the sweep checks the amount the provider's lookup reports, as a callback's is checked")
    void theSweepChecksTheAmount() {
        Checkout checkout = aDraft("hosted-swept-mismatch");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.willLookUp(transaction, PaymentLookup.State.SUCCEEDED, ScriptedPaymentProvider.azn("30.00"));

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "FAILED");
        assertThat(totals(checkout.projectId())).isEqualTo(new Totals(new BigDecimal("0.00"), 0));
    }

    // ------------------------------------------------------------------
    // #587: the sweep's horizon
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#587: a page still pending when the sweep stops asking about it is reported once, and settled never")
    void anAgedOutPageIsReportedOnce() {
        Checkout checkout = aDraft("hosted-aged-out");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.willLookUp(transaction, PaymentLookup.State.PENDING);
        UUID charge = pendingCharge(checkout.pledgeId());
        // Other suites' pages ahead of this one in the queue are not this test's to report.
        jdbc().update(
                """
                INSERT INTO hosted_charge_checks (transaction_id, checked_at, last_state, aged_out_at)
                SELECT id, now(), 'UNANSWERED', now() FROM transactions
                 WHERE type = 'CHARGE' AND status = 'PENDING' AND id <> ?
                ON CONFLICT (transaction_id) DO UPDATE SET aged_out_at = EXCLUDED.aged_out_at
                """,
                charge);
        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));
        double before = anomalies("aged_out");

        Instant aged = Instant.now().plus(Duration.ofDays(8)).truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        sweep.sweep(aged);
        sweep.sweep(aged.plus(Duration.ofMinutes(5)));

        assertThat(anomalies("aged_out") - before).isEqualTo(1d);
        assertThat(jdbc().queryForObject(
                        "SELECT aged_out_at FROM hosted_charge_checks WHERE transaction_id = ?", Instant.class, charge))
                .isEqualTo(aged);
        assertThat(lastCheck(charge)).as("what the provider last said is kept").containsExactly("PENDING");
        assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        assertThat(state(checkout.pledgeId())).isEqualTo("DRAFT");
    }

    // ------------------------------------------------------------------
    // #587: an unsigned callback is asked about only when a page waits on it
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#587: a callback naming an order nothing waits on is answered 200, recorded nowhere, and nobody is asked")
    void anUnknownOrderIsNotConfirmed() {
        provider.confirmCallbacksByAsking();
        try {
            int asked = provider.callbackConfirmations();
            long recorded = jdbc().queryForObject("SELECT count(*) FROM provider_webhook_events", Long.class);

            ResponseEntity<String> response = deliver("not-an-order-" + UUID.randomUUID(), "charge_succeeded");

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(provider.callbackConfirmations()).isEqualTo(asked);
            assertThat(jdbc().queryForObject("SELECT count(*) FROM provider_webhook_events", Long.class))
                    .isEqualTo(recorded);
        } finally {
            provider.verifyCallbacksBySignature();
        }
    }

    @Test
    @DisplayName("#587: a callback for an open page is confirmed with the provider once; one for a settled page is not")
    void anOpenPageIsConfirmedAndASettledOneIsNot() {
        Checkout checkout = aDraft("hosted-confirmed");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.confirmCallbacksByAsking();
        try {
            int asked = provider.callbackConfirmations();

            assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(provider.callbackConfirmations()).isEqualTo(asked + 1);
            assertThat(state(checkout.pledgeId())).isEqualTo("COLLECTED");

            // Settled now: the same news again is answered alike, and the provider is not asked.
            assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(provider.callbackConfirmations()).isEqualTo(asked + 1);
            assertThat(charges(checkout.pledgeId())).containsExactly("PENDING", "SUCCEEDED");
        } finally {
            provider.verifyCallbacksBySignature();
        }
    }

    @Test
    @DisplayName("#587: confirmations go through the circuit breaker, and an open one refuses without asking")
    void confirmationsGoThroughTheBreaker() {
        Checkout checkout = aDraft("hosted-confirm-breaker");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.confirmCallbacksByAsking();
        provider.willLeaveConfirmationsUnanswered();
        try {
            // The test profile's threshold is two.
            assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(azericard().available()).isFalse();
            int asked = provider.callbackConfirmations();

            ResponseEntity<String> refused = deliver(transaction, "charge_succeeded");

            assertThat(refused.getStatusCode()).as("retried by the provider").isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(provider.callbackConfirmations()).isEqualTo(asked);
            assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        } finally {
            provider.verifyCallbacksBySignature();
        }
    }

    /**
     * Anybody holding an open page's order — the backer, from the page's own address — can post its
     * callback. Were "still pending" an outage, a few posts would open the breaker and refuse every
     * backer's payment for the cooldown.
     */
    @Test
    @DisplayName("#587: a payment still undecided is retried by the provider, and never opens the breaker")
    void anUndecidedPaymentDoesNotOpenTheBreaker() {
        Checkout checkout = aDraft("hosted-confirm-undecided");
        String transaction = (String) pay(checkout, UUID.randomUUID().toString()).getBody().get("providerTransactionId");
        provider.confirmCallbacksByAsking();
        provider.willAnswerConfirmationsUndecided();
        try {
            for (int attempt = 0; attempt < 4; attempt++) {
                assertThat(deliver(transaction, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            }

            assertThat(azericard().available()).isTrue();
            assertThat(charges(checkout.pledgeId())).containsExactly("PENDING");
        } finally {
            provider.verifyCallbacksBySignature();
        }
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Checkout(Account backer, UUID projectId, UUID pledgeId) {
    }

    private record Totals(BigDecimal pledged, int backers) {
    }

    private Checkout aDraft(String prefix) {
        Account creator = account(prefix + "-creator");
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                null,
                Map.of("title", "A campaign paid for on a page " + SEQUENCE.incrementAndGet()));
        UUID projectId = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, projectId);

        Account backer = account(prefix + "-backer");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));
        ResponseEntity<Map<String, Object>> draft = exchange(
                "/v1/pledges/draft", HttpMethod.POST, backer.accessToken(), UUID.randomUUID().toString(), body);
        assertThat(draft.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        UUID pledgeId = UUID.fromString((String) draft.getBody().get("id"));
        paidPledges.add(pledgeId);
        return new Checkout(backer, projectId, pledgeId);
    }

    private ResponseEntity<Map<String, Object>> pay(Checkout checkout, String key) {
        return pay(checkout.backer(), checkout.pledgeId(), key);
    }

    private ResponseEntity<Map<String, Object>> pay(Account caller, UUID pledgeId, String key) {
        return exchange(
                "/v1/pledges/" + pledgeId + "/payment",
                HttpMethod.POST,
                caller.accessToken(),
                key,
                Map.of("language", "en", "successUrl", "https://ideanest.az/en/pledges/" + pledgeId + "?payment=returned"));
    }

    /** What a client sends: its language, and the pledge page on the site, with {@code suffix} on both queries. */
    private static Map<String, Object> returnTo(Checkout checkout, String language, String suffix) {
        String page = "https://ideanest.az/" + language + "/pledges/" + checkout.pledgeId();
        return Map.of(
                "language", language,
                "successUrl", page + "?payment=returned" + suffix,
                "errorUrl", page + "?payment=failed" + suffix);
    }

    private ResponseEntity<Map<String, Object>> pay(Checkout checkout, String key, Map<String, Object> body) {
        return exchange(
                "/v1/pledges/" + checkout.pledgeId() + "/payment",
                HttpMethod.POST,
                checkout.backer().accessToken(),
                key,
                body);
    }

    private ResponseEntity<String> deliver(String transaction, String type) {
        return deliver("evt-" + UUID.randomUUID(), transaction, type);
    }

    private ResponseEntity<String> deliver(String eventId, String transaction, String type) {
        return post("""
                {"id":"%s","type":"%s","providerTransactionId":"%s"}"""
                .formatted(eventId, type, transaction));
    }

    /** #587: a delivery that says how much was paid. */
    private ResponseEntity<String> deliver(String transaction, String type, String amount, String currency) {
        return post("""
                {"id":"evt-%s","type":"%s","providerTransactionId":"%s","amount":"%s","currency":"%s"}"""
                .formatted(UUID.randomUUID(), type, transaction, amount, currency));
    }

    private ResponseEntity<String> post(String body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        return rest.exchange(
                "/v1/webhooks/psp/azericard", HttpMethod.POST, new HttpEntity<>(body.getBytes(), headers), String.class);
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

    private ResponseEntity<Map<String, Object>> exchange(
            String path, HttpMethod method, String token, String idempotencyKey, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private String state(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    private Instant reservationExpiresAt(UUID pledgeId) {
        return jdbc().queryForObject("SELECT reservation_expires_at FROM pledges WHERE id = ?", Instant.class, pledgeId);
    }

    private List<String> charges(UUID pledgeId) {
        return jdbc().queryForList(
                "SELECT status FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' ORDER BY created_at, status DESC",
                String.class,
                pledgeId);
    }

    private Totals totals(UUID projectId) {
        return jdbc().queryForObject(
                "SELECT pledged_amount, backers_count FROM projects WHERE id = ?",
                (row, index) -> new Totals(row.getBigDecimal("pledged_amount"), row.getInt("backers_count")),
                projectId);
    }

    private UUID pendingCharge(UUID pledgeId) {
        return jdbc().queryForObject(
                "SELECT id FROM transactions WHERE pledge_id = ? AND type = 'CHARGE' AND status = 'PENDING'",
                UUID.class,
                pledgeId);
    }

    private List<String> lastCheck(UUID charge) {
        return jdbc().queryForList(
                "SELECT last_state FROM hosted_charge_checks WHERE transaction_id = ?", String.class, charge);
    }

    private ProviderStatus azericard() {
        return providerStatus.providerStatuses().stream()
                .filter(status -> status.name().equals("AZERICARD"))
                .findFirst()
                .orElseThrow();
    }

    private double swept(String outcome) {
        return meters.get("ideanest.payment.hosted.sweep.settled").tag("outcome", outcome).counter().count();
    }

    private double anomalies(String reason) {
        return meters.get("ideanest.payment.hosted.anomalies").tag("reason", reason).counter().count();
    }

    /** Moves a pending charge's opening back, past the window a second request is sent back to it in. */
    private void backdate(UUID charge, Duration by) {
        jdbc().execute("ALTER TABLE transactions DISABLE TRIGGER USER");
        try {
            jdbc().update(
                    "UPDATE transactions SET created_at = created_at - CAST(? AS interval) WHERE id = ?",
                    by.toMinutes() + " minutes",
                    charge);
        } finally {
            jdbc().execute("ALTER TABLE transactions ENABLE TRIGGER USER");
        }
    }

    private double attention(String reason) {
        return meters.get("ideanest.payment.hosted.attention").tag("reason", reason).gauge().value();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
