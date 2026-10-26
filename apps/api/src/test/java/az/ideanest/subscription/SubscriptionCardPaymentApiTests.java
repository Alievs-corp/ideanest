package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.payment.application.HostedChargeSweepJob;
import az.ideanest.payment.application.ProviderCircuitBreaker;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.support.ScriptedWebhooks;
import az.ideanest.user.infrastructure.UserRepository;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
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
 * A creator plan paid by card on the provider's page — issue #449, epic #448.
 *
 * <p>End to end through the creator's {@code POST /v1/me/subscription/payment} and the provider's
 * webhook. The money tests: the first period opens on payment, a renewal extends from the old end
 * and not from now, a renewal paid late starts from now, a payment is counted once however often
 * it is reported, and money for a subscription that has ended moves nothing.
 */
class SubscriptionCardPaymentApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";
    private static final String STARTER = "7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e01";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private ScriptedPaymentProvider provider;

    @Autowired
    private HostedChargeSweepJob sweep;

    @Autowired
    private ProviderCircuitBreaker breaker;

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM provider_webhook_events");
        jdbc().update("DELETE FROM subscription_charges");
        jdbc().update("DELETE FROM subscriptions");
        jdbc().update("DELETE FROM subscription_plans WHERE created_by IS NOT NULL");
        provider.willOpenHostedPayments();
        provider.willRefund();
    }

    @Test
    @DisplayName("a pending plan opens the provider's page for its own price and moves nothing yet")
    void openingThePageMovesNothing() {
        Account creator = subscribed();
        assertThat(mine(creator).get("paymentDue")).isEqualTo("FIRST_PERIOD");

        ResponseEntity<Map<String, Object>> page = pay(creator, UUID.randomUUID().toString());

        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat((String) page.getBody().get("redirectUrl")).startsWith("https://");
        HostedPaymentRequest asked = provider.hostedPayments().getLast();
        assertThat(asked.amount().amount()).isEqualByComparingTo("19.00");
        assertThat(asked.description()).contains("Starter");
        assertThat(chargeStates(creator)).containsExactly("PENDING");
        assertThat(mine(creator).get("state")).isEqualTo("PENDING_PAYMENT");
        assertThat(mine(creator).get("entitled")).isEqualTo(false);
    }

    @Test
    @DisplayName("a paid first period activates the plan, writes a card receipt and announces it")
    void aPaidFirstPeriodActivates() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));

        assertThat(deliver(order, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> held = mine(creator);
        assertThat(held.get("state")).isEqualTo("ACTIVE");
        assertThat(held.get("entitled")).isEqualTo(true);
        assertThat(held.get("paymentDue")).isNull();
        Instant end = Instant.parse((String) held.get("currentPeriodEnd"));
        assertThat(end).isAfter(Instant.now().plus(Duration.ofDays(27)));

        List<Map<String, Object>> receipts = receipts(creator);
        assertThat(receipts).hasSize(1);
        assertThat(receipts.getFirst().get("method")).isEqualTo("CARD");
        assertThat(receipts.getFirst().get("recorded_by")).isNull();
        assertThat((String) receipts.getFirst().get("reference")).contains(order);
        assertThat(jdbc().queryForObject(
                        "SELECT activated_by FROM subscriptions WHERE account_id = ?", UUID.class, creator.id()))
                .isNull();
        assertThat(chargeStates(creator)).containsExactly("PAID");
        assertThat(paidEvents(creator)).isEqualTo(1);
    }

    /**
     * #587: an unsigned callback is confirmed with the provider only when a page waits on its order, and a
     * plan's page is such a page as much as a pledge's is.
     */
    @Test
    @DisplayName("#587: a callback for a plan's open page is confirmed with an unsigned provider and activates the plan")
    void aPlanPageIsAwaitedByAnUnsignedProvider() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));
        provider.confirmCallbacksByAsking();
        try {
            int asked = provider.callbackConfirmations();

            assertThat(deliver(order, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

            assertThat(provider.callbackConfirmations()).isEqualTo(asked + 1);
            assertThat(chargeStates(creator)).containsExactly("PAID");
            assertThat(mine(creator).get("state")).isEqualTo("ACTIVE");
        } finally {
            provider.verifyCallbacksBySignature();
        }
    }

    @Test
    @DisplayName("a payment reported twice, or by the callback and the sweep, is counted once")
    void aPaymentIsCountedOnce() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));
        String eventId = "evt-" + UUID.randomUUID();

        deliver(eventId, order, "charge_succeeded");
        deliver(eventId, order, "charge_succeeded");
        deliver(order, "charge_succeeded");
        provider.willLookUp(order, PaymentLookup.State.SUCCEEDED);
        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(receipts(creator)).hasSize(1);
        assertThat(paidEvents(creator)).isEqualTo(1);
    }

    @Test
    @DisplayName("a failed payment leaves the plan waiting, and the creator may pay again")
    void aFailedPaymentLeavesThePlanWaiting() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));

        deliver(order, "charge_failed");

        assertThat(mine(creator).get("state")).isEqualTo("PENDING_PAYMENT");
        assertThat(chargeStates(creator)).containsExactly("FAILED");
        assertThat(receipts(creator)).isEmpty();
        assertThat(order(pay(creator, UUID.randomUUID().toString()))).isNotEqualTo(order);
    }

    @Test
    @DisplayName("a second click while the page is open returns to it instead of opening a second order")
    void aSecondClickReturnsToTheOpenPage() {
        Account creator = subscribed();
        int before = provider.hostedPayments().size();

        String first = order(pay(creator, UUID.randomUUID().toString()));
        String second = order(pay(creator, UUID.randomUUID().toString()));

        assertThat(second).isEqualTo(first);
        assertThat(provider.hostedPayments()).hasSize(before + 1);
        assertThat(chargeStates(creator)).containsExactly("PENDING");
    }

    @Test
    @DisplayName("a retried request under the same key answers the page it opened")
    void aRetryIsIdempotent() {
        Account creator = subscribed();
        String key = UUID.randomUUID().toString();
        int before = provider.hostedPayments().size();

        ResponseEntity<Map<String, Object>> first = pay(creator, key);
        ResponseEntity<Map<String, Object>> replay = pay(creator, key);

        assertThat(replay.getBody()).isEqualTo(first.getBody());
        assertThat(provider.hostedPayments()).hasSize(before + 1);
    }

    @Test
    @DisplayName("a running period cannot be renewed before the window opens")
    void renewalWaitsForTheWindow() {
        Account creator = active();

        ResponseEntity<Map<String, Object>> refused = pay(creator, UUID.randomUUID().toString());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("SUBSCRIPTION_PAYMENT_NOT_DUE");
        assertThat(refused.getBody().get("reason")).isEqualTo("RENEWAL_NOT_OPEN");
        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        assertThat(Instant.parse((String) mine(creator).get("renewalOpensAt"))).isEqualTo(end.minus(Duration.ofDays(7)));
    }

    @Test
    @DisplayName("a renewal inside the window extends from the old end, not from now, and lifts a cancellation")
    void aRenewalExtendsFromTheOldEnd() {
        Account creator = active();
        Instant end = Instant.now().plus(Duration.ofDays(3)).truncatedTo(ChronoUnit.SECONDS);
        endsAt(creator, end);
        assertThat(cancel(creator).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mine(creator).get("paymentDue")).isEqualTo("RENEWAL");

        String order = order(pay(creator, UUID.randomUUID().toString()));
        deliver(order, "charge_succeeded");

        Map<String, Object> held = mine(creator);
        Instant renewedTo = Instant.parse((String) held.get("currentPeriodEnd"));
        assertThat(renewedTo).isEqualTo(end.atOffset(ZoneOffset.UTC).plusMonths(1).toInstant());
        assertThat(held.get("cancelAtPeriodEnd")).isEqualTo(false);
        assertThat(receipts(creator)).extracting(row -> row.get("method")).containsExactly("CARD", "CARD");
        assertThat(audited(creator, "subscription.renewed")).isEqualTo(1);
    }

    @Test
    @DisplayName("a renewal paid after the period ran out starts from the payment, not the old end")
    void aLateRenewalStartsFromNow() {
        Account creator = active();
        endsAt(creator, Instant.now().plus(Duration.ofDays(1)));
        String order = order(pay(creator, UUID.randomUUID().toString()));
        endsAt(creator, Instant.now().minus(Duration.ofDays(2)));

        deliver(order, "charge_succeeded");

        Instant renewedTo = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        assertThat(renewedTo).isAfter(Instant.now().plus(Duration.ofDays(27)));
        assertThat(mine(creator).get("entitled")).isEqualTo(true);
    }

    @Test
    @DisplayName("a lapsed plan is bought again rather than renewed")
    void aLapsedPlanIsNotRenewed() {
        Account creator = active();
        endsAt(creator, Instant.now().minus(Duration.ofHours(1)));

        ResponseEntity<Map<String, Object>> refused = pay(creator, UUID.randomUUID().toString());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("reason")).isEqualTo("LAPSED");
    }

    @Test
    @DisplayName("money for a subscription staff have ended moves nothing and is left for a refund")
    void moneyForAnEndedSubscriptionIsUnapplied() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));
        jdbc().update("UPDATE subscriptions SET state = 'CANCELED', canceled_at = now() WHERE account_id = ?", creator.id());

        assertThat(deliver(order, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(chargeStates(creator)).containsExactly("UNAPPLIED");
        assertThat(receipts(creator)).isEmpty();
        assertThat(paidEvents(creator)).isZero();
    }

    @Test
    @DisplayName("a paid page whose callback never came is settled by the sweep")
    void theSweepSettlesAPlanPage() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));
        provider.willLookUp(order, PaymentLookup.State.SUCCEEDED);

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(mine(creator).get("state")).isEqualTo("ACTIVE");
        assertThat(chargeStates(creator)).containsExactly("PAID");
    }

    @Test
    @DisplayName("a page the provider still calls pending is left for the next pass")
    void thePendingPageWaits() {
        Account creator = subscribed();
        String order = order(pay(creator, UUID.randomUUID().toString()));
        provider.willLookUp(order, PaymentLookup.State.PENDING);

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(chargeStates(creator)).containsExactly("PENDING");
        assertThat(jdbc().queryForObject(
                        "SELECT checked_at FROM subscription_charges WHERE account_id = ?", Timestamp.class, creator.id()))
                .isNotNull();
    }

    @Test
    @DisplayName("nothing to pay: no subscription is 404, a free plan is 409, no provider is 503")
    void refusals() {
        Account nobody = account();
        assertThat(pay(nobody, UUID.randomUUID().toString()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        Account free = account();
        UUID freePlan = addFreePlan();
        assertThat(post("/v1/me/subscription", free.accessToken(), Map.of("planId", freePlan.toString()))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        ResponseEntity<Map<String, Object>> freeRefused = pay(free, UUID.randomUUID().toString());
        assertThat(freeRefused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(freeRefused.getBody().get("reason")).isEqualTo("FREE_PLAN");

        Account creator = subscribed();
        provider.willRefuseHostedPayments();
        ResponseEntity<Map<String, Object>> unavailable = pay(creator, UUID.randomUUID().toString());
        assertThat(unavailable.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(unavailable.getBody().get("code")).isEqualTo("PAYMENT_UNAVAILABLE");
        assertThat(chargeStates(creator)).isEmpty();
    }

    // ------------------------------------------------------------------
    // #457: returning a payment that could not be applied
    // ------------------------------------------------------------------

    @Test
    @DisplayName("#457: an unapplied payment is listed for finance and returned to the card, once")
    void anUnappliedPaymentIsReturnedToTheCard() {
        Account creator = subscribed();
        String order = unappliedPayment(creator);
        UUID charge = chargeId(creator);

        ResponseEntity<Map<String, Object>> listed = get("/v1/admin/plan-payments/unapplied", admin().accessToken());
        assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> payments = (List<Map<String, Object>>) listed.getBody().get("payments");
        assertThat(payments).anySatisfy(row -> {
            assertThat(row.get("id")).isEqualTo(charge.toString());
            assertThat(row.get("amount")).isEqualTo("19.00");
            assertThat(row.get("providerTransactionId")).isEqualTo(order);
        });

        int before = provider.refunds().size();
        ResponseEntity<Map<String, Object>> refunded =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());

        assertThat(refunded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.refunds()).hasSize(before + 1);
        assertThat(provider.refunds().getLast().reference()).isEqualTo(charge);
        assertThat(provider.refunds().getLast().amount().amount()).isEqualByComparingTo("19.00");
        Map<String, Object> row = jdbc().queryForMap(
                "SELECT status, refund_method, refunded_by FROM subscription_charges WHERE id = ?", charge);
        assertThat(row.get("status")).isEqualTo("REFUNDED");
        assertThat(row.get("refund_method")).isEqualTo("CARD");
        assertThat(row.get("refunded_by")).isEqualTo(admin().id());
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM audit_logs WHERE action = 'subscription.payment_refunded' AND entity_id = ?",
                        Long.class,
                        charge))
                .isEqualTo(1L);

        ResponseEntity<Map<String, Object>> again =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody().get("code")).isEqualTo("PLAN_REFUND_NOT_UNAPPLIED");
        assertThat(provider.refunds()).hasSize(before + 1);
    }

    @Test
    @DisplayName("#457: past the card window it is refused, and the bank transfer that returned it is recorded")
    void pastTheWindowItGoesBackByBank() {
        Account creator = subscribed();
        unappliedPayment(creator);
        UUID charge = chargeId(creator);
        provider.willRefuseRefundsAsTooOld();

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("PLAN_REFUND_CARD_WINDOW_CLOSED");
        assertThat(jdbc().queryForObject("SELECT status FROM subscription_charges WHERE id = ?", String.class, charge))
                .isEqualTo("UNAPPLIED");

        ResponseEntity<Map<String, Object>> recorded = post(
                "/v1/admin/plan-payments/" + charge + "/bank-transfer",
                admin().accessToken(),
                Map.of("bankReference", "KAP-2026-118", "note", "returned to the creator's IBAN"));

        assertThat(recorded.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> row = jdbc().queryForMap(
                "SELECT status, refund_method, refund_reference FROM subscription_charges WHERE id = ?", charge);
        assertThat(row.get("status")).isEqualTo("REFUNDED");
        assertThat(row.get("refund_method")).isEqualTo("BANK_TRANSFER");
        assertThat(row.get("refund_reference")).isEqualTo("KAP-2026-118");
    }

    @Test
    @DisplayName("#457: a provider refusal leaves the payment waiting, and a creator cannot reach the console")
    void refusalsLeaveItWaiting() {
        Account creator = subscribed();
        unappliedPayment(creator);
        UUID charge = chargeId(creator);

        assertThat(get("/v1/admin/plan-payments/unapplied", creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(post("/v1/admin/plan-payments/" + charge + "/refund", creator.accessToken(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        provider.willRefuseRefunds("do_not_honour");
        ResponseEntity<Map<String, Object>> refused =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("PLAN_REFUND_PROVIDER_REFUSED");
        assertThat(jdbc().queryForObject("SELECT status FROM subscription_charges WHERE id = ?", String.class, charge))
                .isEqualTo("UNAPPLIED");
        assertThat(jdbc().queryForObject(
                        "SELECT card_refund_started_at FROM subscription_charges WHERE id = ?", Object.class, charge))
                .as("a definite refusal clears the claim, so the bank transfer is open again")
                .isNull();

        // A paid page is not unapplied money, and is not returned from here.
        Account paid = active();
        UUID paidCharge = chargeId(paid);
        assertThat(post("/v1/admin/plan-payments/" + paidCharge + "/refund", admin().accessToken(), Map.of())
                        .getBody()
                        .get("code"))
                .isEqualTo("PLAN_REFUND_NOT_UNAPPLIED");
    }

    @Test
    @DisplayName("a card refund whose answer was lost is confirmed from the provider on retry, never sent twice")
    void anUnansweredRefundIsSettledFromTheProvider() {
        breaker.reset();
        Account creator = subscribed();
        unappliedPayment(creator);
        UUID charge = chargeId(creator);
        int before = provider.refunds().size();
        provider.nextRefundAppliedButUnreachable();

        ResponseEntity<Map<String, Object>> lost =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());
        assertThat(lost.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(lost.getBody().get("code")).isEqualTo("PLAN_REFUND_UNCONFIRMED");
        assertThat(jdbc().queryForObject("SELECT status FROM subscription_charges WHERE id = ?", String.class, charge))
                .isEqualTo("UNAPPLIED");

        // The list says a refund may be on its way, and the bank transfer -- the second payment -- is refused.
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> listed = (List<Map<String, Object>>)
                get("/v1/admin/plan-payments/unapplied", admin().accessToken()).getBody().get("payments");
        assertThat(listed).anySatisfy(row -> {
            assertThat(row.get("id")).isEqualTo(charge.toString());
            assertThat(row.get("cardRefundStartedAt")).isInstanceOf(String.class);
        });
        ResponseEntity<Map<String, Object>> byBank = post(
                "/v1/admin/plan-payments/" + charge + "/bank-transfer",
                admin().accessToken(),
                Map.of("bankReference", "KAP-2026-119"));
        assertThat(byBank.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(byBank.getBody().get("code")).isEqualTo("PLAN_REFUND_CARD_REFUND_UNSETTLED");

        // A press while the attempt may still be running is turned away rather than sent alongside it.
        assertThat(post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of())
                        .getBody()
                        .get("code"))
                .isEqualTo("PLAN_REFUND_IN_PROGRESS");

        jdbc().update(
                "UPDATE subscription_charges SET card_refund_started_at = card_refund_started_at - interval '5 minutes'"
                        + " WHERE id = ?",
                charge);
        ResponseEntity<Map<String, Object>> settled =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());

        assertThat(settled.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.refunds()).as("the provider already returned it; nothing is sent again").hasSize(before + 1);
        Map<String, Object> row = jdbc().queryForMap(
                "SELECT status, refund_method FROM subscription_charges WHERE id = ?", charge);
        assertThat(row.get("status")).isEqualTo("REFUNDED");
        assertThat(row.get("refund_method")).isEqualTo("CARD");
    }

    @Test
    @DisplayName("a card refund that never reached the provider is sent again under the same key")
    void anUnansweredRefundThatDidNotHappenIsSentAgain() {
        breaker.reset();
        Account creator = subscribed();
        unappliedPayment(creator);
        UUID charge = chargeId(creator);
        int before = provider.refunds().size();
        provider.nextRefundUnreachableAndNotApplied();

        assertThat(post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of())
                        .getBody()
                        .get("code"))
                .isEqualTo("PLAN_REFUND_UNCONFIRMED");
        jdbc().update(
                "UPDATE subscription_charges SET card_refund_started_at = card_refund_started_at - interval '5 minutes'"
                        + " WHERE id = ?",
                charge);

        ResponseEntity<Map<String, Object>> sent =
                post("/v1/admin/plan-payments/" + charge + "/refund", admin().accessToken(), Map.of());

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.refunds()).hasSize(before + 2);
        assertThat(provider.refunds().get(before).idempotencyKey())
                .isEqualTo(provider.refunds().get(before + 1).idempotencyKey());
        assertThat(jdbc().queryForObject("SELECT status FROM subscription_charges WHERE id = ?", String.class, charge))
                .isEqualTo("REFUNDED");
    }

    private String unappliedPayment(Account creator) {
        String order = order(pay(creator, UUID.randomUUID().toString()));
        jdbc().update("UPDATE subscriptions SET state = 'CANCELED', canceled_at = now() WHERE account_id = ?", creator.id());
        deliver(order, "charge_succeeded");
        assertThat(chargeStates(creator)).containsExactly("UNAPPLIED");
        return order;
    }

    private UUID chargeId(Account creator) {
        return jdbc().queryForObject(
                "SELECT id FROM subscription_charges WHERE account_id = ? ORDER BY opened_at LIMIT 1", UUID.class, creator.id());
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(authorised(accessToken)), mapType());
    }

    private record Account(String accessToken, UUID id) {
    }

    private Account subscribed() {
        Account creator = account();
        assertThat(post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER)).getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        return creator;
    }

    private Account active() {
        Account creator = subscribed();
        deliver(order(pay(creator, UUID.randomUUID().toString())), "charge_succeeded");
        assertThat(mine(creator).get("state")).isEqualTo("ACTIVE");
        return creator;
    }

    private void endsAt(Account creator, Instant end) {
        jdbc().update(
                "UPDATE subscriptions SET current_period_end = ?, started_at = ? WHERE account_id = ? AND state = 'ACTIVE'",
                Timestamp.from(end),
                Timestamp.from(end.minus(Duration.ofDays(30))),
                creator.id());
    }

    private ResponseEntity<Map<String, Object>> pay(Account creator, String key) {
        HttpHeaders headers = authorised(creator.accessToken());
        headers.set("Idempotency-Key", key);
        return rest.exchange(
                "/v1/me/subscription/payment",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("language", "az", "successUrl", "https://ideanest.az/az/pricing?payment=returned"), headers),
                mapType());
    }

    private ResponseEntity<Map<String, Object>> cancel(Account creator) {
        return rest.exchange(
                "/v1/me/subscription", HttpMethod.DELETE, new HttpEntity<>(authorised(creator.accessToken())), mapType());
    }

    private static String order(ResponseEntity<Map<String, Object>> page) {
        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (String) page.getBody().get("providerTransactionId");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mine(Account creator) {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/me/subscription", HttpMethod.GET, new HttpEntity<>(authorised(creator.accessToken())), mapType());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (Map<String, Object>) response.getBody().get("subscription");
    }

    private ResponseEntity<String> deliver(String order, String type) {
        return deliver("evt-" + UUID.randomUUID(), order, type);
    }

    private ResponseEntity<String> deliver(String eventId, String order, String type) {
        String body = """
                {"id":"%s","type":"%s","providerTransactionId":"%s"}"""
                .formatted(eventId, type, order);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ScriptedWebhooks.headers().forEach(headers::add);
        return rest.exchange(
                "/v1/webhooks/psp/azericard", HttpMethod.POST, new HttpEntity<>(body.getBytes(), headers), String.class);
    }

    private List<String> chargeStates(Account creator) {
        return jdbc().queryForList(
                "SELECT status FROM subscription_charges WHERE account_id = ? ORDER BY opened_at", String.class, creator.id());
    }

    private List<Map<String, Object>> receipts(Account creator) {
        return jdbc().queryForList(
                "SELECT method, recorded_by, reference FROM subscription_payments WHERE account_id = ? ORDER BY received_at",
                creator.id());
    }

    private long paidEvents(Account creator) {
        return jdbc().queryForObject(
                """
                SELECT count(*) FROM outbox_events
                WHERE event_type = 'subscription.paid'
                  AND aggregate_id IN (SELECT id FROM subscriptions WHERE account_id = ?)
                """,
                Long.class,
                creator.id());
    }

    private long audited(Account creator, String action) {
        return jdbc().queryForObject(
                """
                SELECT count(*) FROM audit_logs
                WHERE action = ?
                  AND entity_id IN (SELECT id FROM subscriptions WHERE account_id = ?)
                """,
                Long.class,
                action,
                creator.id());
    }

    private UUID addFreePlan() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", "FREE_" + SEQUENCE.incrementAndGet());
        body.put("name", "Free");
        body.put("price", "0.00");
        body.put("currency", "AZN");
        body.put("billingPeriod", "MONTHLY");
        body.put("maxActiveCampaigns", 1);
        body.put("goalCeiling", null);
        ResponseEntity<Map<String, Object>> created = post("/v1/admin/plans", admin().accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("plan-card" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), json),
                mapType());
        return new Account(
                (String) signedIn.getBody().get("accessToken"),
                users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    /** {@code SubscriptionApiTests}' arrangement: a token issued, not a sign-in, for the shared limiter. */
    private Account admin() {
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, authorised(accessToken)), mapType());
    }

    private static HttpHeaders authorised(String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapType() {
        return new ParameterizedTypeReference<>() {};
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
