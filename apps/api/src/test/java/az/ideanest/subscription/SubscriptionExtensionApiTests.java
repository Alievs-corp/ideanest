package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.payment.application.HostedChargeSweepJob;
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
import java.util.HashMap;
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
 * Extending a running subscription — issue #660.
 *
 * <p>End to end through {@code POST /v1/me/subscription/payment} with a {@code billingPeriod} and the
 * provider's webhook. The money tests: the held period is renewed at its locked price and another at
 * the plan's current one, what settles is what the page was opened for even if the plan is repriced
 * in between, a settlement counts once, and the subscription holds the extension's period and price
 * afterwards.
 *
 * <p><strong>Step two.</strong> The release before this one recorded the page's period and settled
 * by it while offering only the held period; this one offers the others
 * ({@code SubscriptionCardPayments.OTHER_PERIODS_OFFERED}). Some settlement tests still build their
 * page with {@link #pageFor}, which is the same row a real page for that period is.
 */
class SubscriptionExtensionApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

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

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM provider_webhook_events");
        jdbc().update("DELETE FROM subscription_charges");
        jdbc().update("DELETE FROM subscriptions");
        jdbc().update("DELETE FROM subscription_plans WHERE created_by IS NOT NULL");
        jdbc().update("DELETE FROM student_verifications");
        provider.willOpenHostedPayments();
    }

    // ------------------------------------------------------------------
    // What the held subscription offers
    // ------------------------------------------------------------------

    @Test
    @DisplayName("renewalPrices lists every extension while a renewal is due: its own at its locked price, the others at today's")
    void renewalPricesWhileDue() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        reprice(plan, prices("15.00", "80.00", "150.00"));

        Map<String, Object> held = mine(creator);

        assertThat(held.get("paymentDue")).isEqualTo("RENEWAL");
        assertThat(renewalPricesOf(held))
                .extracting(entry -> entry.get("billingPeriod") + "=" + entry.get("price") + " " + entry.get("currency"))
                .containsExactly("MONTHLY=10.00 AZN", "SEMIANNUAL=80.00 AZN", "YEARLY=150.00 AZN");
    }

    @Test
    @DisplayName("an unlisted plan offers only the held period, and refuses another")
    void anUnlistedPlanOffersOnlyTheHeldPeriod() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        jdbc().update("UPDATE subscription_plans SET listed = false WHERE id = ?", plan);

        assertThat(renewalPricesOf(mine(creator)))
                .extracting(entry -> entry.get("billingPeriod") + "=" + entry.get("price"))
                .containsExactly("MONTHLY=10.00");
        ResponseEntity<Map<String, Object>> refused = pay(creator, "YEARLY");
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("PERIOD_NOT_OFFERED");
        assertThat(pay(creator, "MONTHLY").getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("renewalPrices is empty for a pending plan and for a running one whose last month has not begun")
    void renewalPricesOnlyWhileDue() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account pending = subscribedTo(plan, "MONTHLY");
        assertThat(mine(pending).get("paymentDue")).isEqualTo("FIRST_PERIOD");
        assertThat(renewalPricesOf(mine(pending))).isEmpty();

        Account yearly = activeOn(plan, "YEARLY");
        Map<String, Object> held = mine(yearly);
        assertThat(held.get("paymentDue")).isNull();
        assertThat(held).containsKey("renewalPrices");
        assertThat(renewalPricesOf(held)).isEmpty();
    }

    // ------------------------------------------------------------------
    // The window
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a yearly plan is refused before its last month with RENEWAL_NOT_OPEN, whatever period is asked for")
    void aYearIsRefusedBeforeItsLastMonth() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "YEARLY");
        int pagesBefore = provider.hostedPayments().size();

        for (String period : new String[] {null, "YEARLY", "MONTHLY"}) {
            ResponseEntity<Map<String, Object>> refused = pay(creator, period);
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(refused.getBody().get("code")).isEqualTo("SUBSCRIPTION_PAYMENT_NOT_DUE");
            assertThat(refused.getBody().get("reason")).isEqualTo("RENEWAL_NOT_OPEN");
        }
        assertThat(provider.hostedPayments()).hasSize(pagesBefore);

        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        assertThat(Instant.parse((String) mine(creator).get("renewalOpensAt")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).minusMonths(1).toInstant());

        // Inside its last month it is open.
        endsAt(creator, Instant.now().plus(Duration.ofDays(20)));
        assertThat(mine(creator).get("paymentDue")).isEqualTo("RENEWAL");
        assertThat(pay(creator, null).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a monthly plan is extended once, and the window shuts until the new end is a month away")
    void aMonthIsExtendedOnceThenTheWindowShuts() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));

        deliver(order(pay(creator, "MONTHLY")), "charge_succeeded");

        Map<String, Object> held = mine(creator);
        assertThat(Instant.parse((String) held.get("currentPeriodEnd")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).plusMonths(1).toInstant());
        assertThat(held.get("paymentDue")).isNull();
        assertThat(renewalPricesOf(held)).isEmpty();
        ResponseEntity<Map<String, Object>> again = pay(creator, "MONTHLY");
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody().get("reason")).isEqualTo("RENEWAL_NOT_OPEN");
    }

    // ------------------------------------------------------------------
    // What an extension costs
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the held period is charged at the locked price, with or without naming it")
    void theHeldPeriodIsLocked() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        reprice(plan, prices("15.00", "80.00", "150.00"));

        assertThat(pay(creator, null).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("10.00");
        assertThat(latestCharge(creator)).containsEntry("billing_period", "MONTHLY");

        jdbc().update("DELETE FROM subscription_charges WHERE account_id = ? AND status = 'PENDING'", creator.id());
        assertThat(pay(creator, "MONTHLY").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("10.00");
    }

    @Test
    @DisplayName("another period is charged at the plan's current price for it")
    void anotherPeriodIsTodaysPrice() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        reprice(plan, prices("15.00", "80.00", "150.00"));

        assertThat(pay(creator, "YEARLY").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("150.00");
        Map<String, Object> charge = latestCharge(creator);
        assertThat(charge).containsEntry("billing_period", "YEARLY").containsEntry("purpose", "RENEWAL");
        assertThat((java.math.BigDecimal) charge.get("amount")).isEqualByComparingTo("150.00");
    }

    @Test
    @DisplayName("a period the plan is not sold for is refused with PERIOD_NOT_OFFERED and opens no page")
    void anUnsoldPeriodIsRefused() {
        UUID plan = addPlan(prices("10.00", null, "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        int pagesBefore = provider.hostedPayments().size();

        ResponseEntity<Map<String, Object>> refused = pay(creator, "SEMIANNUAL");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("PERIOD_NOT_OFFERED");
        assertThat(refused.getBody().get("billingPeriod")).isEqualTo("SEMIANNUAL");
        assertThat(provider.hostedPayments()).hasSize(pagesBefore);
        assertThat(renewalPricesOf(mine(creator)))
                .extracting(entry -> entry.get("billingPeriod"))
                .containsExactly("MONTHLY", "YEARLY");
    }

    @Test
    @DisplayName("a first period is paid only for the period chosen; another is PERIOD_NOT_OFFERED")
    void aFirstPeriodIsForThePeriodChosen() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = subscribedTo(plan, "MONTHLY");
        int pagesBefore = provider.hostedPayments().size();

        ResponseEntity<Map<String, Object>> refused = pay(creator, "YEARLY");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("PERIOD_NOT_OFFERED");
        assertThat(provider.hostedPayments()).hasSize(pagesBefore);

        assertThat(pay(creator, "MONTHLY").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("10.00");
        assertThat(latestCharge(creator))
                .containsEntry("billing_period", "MONTHLY")
                .containsEntry("purpose", "FIRST_PERIOD");
    }

    @Test
    @DisplayName("a page open for one period is not returned to for another; the same period is")
    void anOpenPageIsReusedOnlyForTheSamePeriod() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");

        String year = order(pay(creator, "YEARLY"));
        String month = order(pay(creator, "MONTHLY"));
        String monthAgain = order(pay(creator, null));

        assertThat(month).isNotEqualTo(year);
        assertThat(monthAgain).isEqualTo(month);
        assertThat(jdbc().queryForList(
                        "SELECT billing_period FROM subscription_charges WHERE account_id = ? AND status = 'PENDING'"
                                + " ORDER BY opened_at",
                        String.class,
                        creator.id()))
                .containsExactly("YEARLY", "MONTHLY");
    }

    // ------------------------------------------------------------------
    // Settlement
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a paid extension runs from the old end by the period bought, and the subscription holds that period and price")
    void aPaidExtensionChangesThePeriodAndPrice() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        Instant end = Instant.now().plus(Duration.ofDays(10)).truncatedTo(ChronoUnit.SECONDS);
        endsAt(creator, end);

        String order = order(pay(creator, "YEARLY"));
        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("100.00");
        assertThat(deliver(order, "charge_succeeded").getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> held = mine(creator);
        assertThat(Instant.parse((String) held.get("currentPeriodEnd")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).plusYears(1).toInstant());
        assertThat(held.get("billingPeriod")).isEqualTo("YEARLY");
        assertThat(held.get("price")).isEqualTo("100.00");
        assertThat(held.get("paymentDue")).isNull();
        assertThat(renewalPricesOf(held)).isEmpty();

        Map<String, Object> receipt = jdbc().queryForMap(
                "SELECT amount, billing_period, method FROM subscription_payments WHERE account_id = ?"
                        + " ORDER BY received_at DESC LIMIT 1",
                creator.id());
        assertThat((java.math.BigDecimal) receipt.get("amount")).isEqualByComparingTo("100.00");
        assertThat(receipt).containsEntry("billing_period", "YEARLY").containsEntry("method", "CARD");
        assertThat(audited(creator, "subscription.renewed")).isEqualTo(1);
        assertThat(jdbc().queryForObject(
                        """
                        SELECT detail FROM audit_logs
                        WHERE action = 'subscription.renewed'
                          AND entity_id IN (SELECT id FROM subscriptions WHERE account_id = ?)
                        """,
                        String.class,
                        creator.id()))
                .contains("period=YEARLY")
                .contains("paid=100.00");

        // The next renewal defaults to the year, at the year's price as bought.
        endsAt(creator, Instant.now().plus(Duration.ofDays(10)));
        reprice(plan, prices("10.00", "54.00", "130.00"));
        assertThat(pay(creator, null).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("100.00");
    }

    @Test
    @DisplayName("a price change between the page and the callback does not change what was bought")
    void aRepricingInBetweenChangesNothing() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        String order = order(pay(creator, "SEMIANNUAL"));

        reprice(plan, prices("12.00", "70.00", null));
        deliver(order, "charge_succeeded");

        Map<String, Object> held = mine(creator);
        assertThat(Instant.parse((String) held.get("currentPeriodEnd")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).plusMonths(6).toInstant());
        assertThat(held.get("billingPeriod")).isEqualTo("SEMIANNUAL");
        assertThat(held.get("price")).isEqualTo("54.00");
    }

    @Test
    @DisplayName("an extension reported twice, or by the callback and the sweep, extends once")
    void anExtensionIsSettledOnce() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        String order = pageFor(creator, "YEARLY", "100.00");
        String eventId = "evt-" + UUID.randomUUID();

        deliver(eventId, order, "charge_succeeded");
        deliver(eventId, order, "charge_succeeded");
        deliver(order, "charge_succeeded");
        provider.willLookUp(order, PaymentLookup.State.SUCCEEDED);
        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        assertThat(Instant.parse((String) mine(creator).get("currentPeriodEnd")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).plusYears(1).toInstant());
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM subscription_payments WHERE account_id = ?", Long.class, creator.id()))
                .as("the first period and one extension")
                .isEqualTo(2L);
        assertThat(audited(creator, "subscription.renewed")).isEqualTo(1);
    }

    @Test
    @DisplayName("a page the sweep settles extends by its own period too")
    void theSweepExtendsByThePagesPeriod() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        String order = pageFor(creator, "SEMIANNUAL", "54.00");
        provider.willLookUp(order, PaymentLookup.State.SUCCEEDED);

        sweep.sweep(Instant.now().plus(Duration.ofMinutes(20)));

        Map<String, Object> held = mine(creator);
        assertThat(Instant.parse((String) held.get("currentPeriodEnd")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).plusMonths(6).toInstant());
        assertThat(held.get("billingPeriod")).isEqualTo("SEMIANNUAL");
    }

    @Test
    @DisplayName("a page opened before V129, with no period, renews the subscription's own period at its own price")
    void aPageWithoutAPeriodRenewsTheHeldOne() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account creator = activeOn(plan, "MONTHLY");
        Instant end = Instant.parse((String) mine(creator).get("currentPeriodEnd"));
        String order = order(pay(creator, "MONTHLY"));
        jdbc().update("UPDATE subscription_charges SET billing_period = NULL WHERE provider_transaction_id = ?", order);

        deliver(order, "charge_succeeded");

        Map<String, Object> held = mine(creator);
        assertThat(Instant.parse((String) held.get("currentPeriodEnd")))
                .isEqualTo(end.atOffset(ZoneOffset.UTC).plusMonths(1).toInstant());
        assertThat(held.get("billingPeriod")).isEqualTo("MONTHLY");
        assertThat(held.get("price")).isEqualTo("10.00");
    }

    // ------------------------------------------------------------------
    // Students
    // ------------------------------------------------------------------

    @Test
    @DisplayName("extending a student-rate subscription needs a valid student check, for any period")
    void aStudentExtensionIsGated() {
        UUID plan = addPlan(prices("10.00", "54.00", "100.00"));
        Account lapsed = account();
        verification(lapsed, Instant.now().minus(Duration.ofDays(1)));
        heldAtStudentRate(lapsed, plan);
        int pagesBefore = provider.hostedPayments().size();

        ResponseEntity<Map<String, Object>> refused = pay(lapsed, "YEARLY");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("STUDENT_VERIFICATION_REQUIRED");
        assertThat(provider.hostedPayments()).hasSize(pagesBefore);

        Account current = account();
        verification(current, Instant.now().plus(Duration.ofDays(100)));
        heldAtStudentRate(current, plan);
        assertThat(pay(current, "YEARLY").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("100.00");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account subscribedTo(UUID plan, String period) {
        Account creator = account();
        ResponseEntity<Map<String, Object>> bought = post(
                "/v1/me/subscription",
                creator.accessToken(),
                Map.of("planId", plan.toString(), "billingPeriod", period));
        assertThat(bought.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return creator;
    }

    private Account activeOn(UUID plan, String period) {
        Account creator = subscribedTo(plan, period);
        deliver(order(pay(creator, null)), "charge_succeeded");
        assertThat(mine(creator).get("state")).isEqualTo("ACTIVE");
        return creator;
    }

    /** A running MONTHLY subscription bought at the student rate, whose last month has begun. */
    private void heldAtStudentRate(Account creator, UUID plan) {
        Instant end = Instant.now().plus(Duration.ofDays(3));
        jdbc().update(
                """
                INSERT INTO subscriptions
                    (id, account_id, plan_id, state, price, currency, billing_period, started_at, current_period_end,
                     student_rate)
                VALUES (?, ?, ?, 'ACTIVE', 10.00, 'AZN', 'MONTHLY', ?, ?, true)
                """,
                UUID.randomUUID(),
                creator.id(),
                plan,
                Timestamp.from(end.minus(Duration.ofDays(30))),
                Timestamp.from(end));
    }

    private void verification(Account creator, Instant validUntil) {
        jdbc().update(
                """
                INSERT INTO student_verifications
                    (id, account_id, institution, card_number, state, submitted_at, decided_at, valid_until)
                VALUES (?, ?, 'Test University', ?, 'APPROVED', now(), ?, ?)
                """,
                UUID.randomUUID(),
                creator.id(),
                "EXTENDCARD" + SEQUENCE.incrementAndGet(),
                Timestamp.from(Instant.now().minus(Duration.ofDays(400))),
                Timestamp.from(validUntil));
    }

    private void endsAt(Account creator, Instant end) {
        jdbc().update(
                "UPDATE subscriptions SET current_period_end = ?, started_at = ?, current_period_start = ?"
                        + " WHERE account_id = ? AND state = 'ACTIVE'",
                Timestamp.from(end),
                Timestamp.from(end.minus(Duration.ofDays(30))),
                // A month's period that ends there began a calendar month before it.
                Timestamp.from(end.atOffset(ZoneOffset.UTC).minusMonths(1).toInstant()),
                creator.id());
    }

    private UUID addPlan(List<Map<String, Object>> prices) {
        Map<String, Object> body = new LinkedHashMap<>();
        String code = "EXTEND" + SEQUENCE.incrementAndGet();
        body.put("code", code);
        body.put("name", code);
        body.put("price", "1.00");
        body.put("currency", "AZN");
        body.put("billingPeriod", "MONTHLY");
        body.put("maxActiveCampaigns", 1);
        body.put("prices", prices);
        ResponseEntity<Map<String, Object>> created = post("/v1/admin/plans", admin().accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private void reprice(UUID plan, List<Map<String, Object>> prices) {
        ResponseEntity<Map<String, Object>> changed = rest.exchange(
                "/v1/admin/plans/" + plan,
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("prices", prices), authorised(admin().accessToken())),
                mapType());
        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private static List<Map<String, Object>> prices(String monthly, String semiannual, String yearly) {
        List<Map<String, Object>> prices = new java.util.ArrayList<>();
        if (monthly != null) {
            prices.add(Map.of("billingPeriod", "MONTHLY", "price", monthly));
        }
        if (semiannual != null) {
            prices.add(Map.of("billingPeriod", "SEMIANNUAL", "price", semiannual));
        }
        if (yearly != null) {
            prices.add(Map.of("billingPeriod", "YEARLY", "price", yearly));
        }
        return prices;
    }

    private ResponseEntity<Map<String, Object>> pay(Account creator, String period) {
        HttpHeaders headers = authorised(creator.accessToken());
        headers.set("Idempotency-Key", UUID.randomUUID().toString());
        Map<String, Object> body = new HashMap<>();
        body.put("language", "az");
        body.put("successUrl", "https://ideanest.az/az/pricing?payment=returned");
        if (period != null) {
            body.put("billingPeriod", period);
        }
        return rest.exchange("/v1/me/subscription/payment", HttpMethod.POST, new HttpEntity<>(body, headers), mapType());
    }

    /** A page for another period at another amount, written as {@code pay} writes one. */
    private String pageFor(Account creator, String period, String amount) {
        String order = order(pay(creator, null));
        jdbc().update(
                "UPDATE subscription_charges SET billing_period = ?, amount = ? WHERE provider_transaction_id = ?",
                period,
                new java.math.BigDecimal(amount),
                order);
        return order;
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

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> renewalPricesOf(Map<String, Object> held) {
        return (List<Map<String, Object>>) held.get("renewalPrices");
    }

    private Map<String, Object> latestCharge(Account creator) {
        return jdbc().queryForMap(
                "SELECT purpose, amount, billing_period FROM subscription_charges WHERE account_id = ?"
                        + " ORDER BY opened_at DESC LIMIT 1",
                creator.id());
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

    /** A registered creator with an issued token, so no suite's sign-in limit is spent. */
    private Account account() {
        EmailAddress email = EmailAddress.of("plan-extend-" + SEQUENCE.incrementAndGet() + "-"
                + UUID.randomUUID().toString().substring(0, 8) + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);
        return issued(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private Account admin() {
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        return issued(users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private Account issued(UUID id) {
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
