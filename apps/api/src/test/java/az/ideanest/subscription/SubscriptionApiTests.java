package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
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
 * Buying, holding and administering a plan, over HTTP.
 *
 * <p>The tests that carry the design are {@link #aPricedPlanWaitsForStaffToRecordPayment()}
 * — the two-step purchase that exists because no payment provider is integrated (#60) —
 * and {@link #anExpiredSubscriptionDoesNotBlockBuyingAgain()}, which is the one thing V62's
 * clock-blind unique index cannot do for itself.
 */
class SubscriptionApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The address {@code application-test.yml} bootstraps as an administrator. */
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    private Account admin;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @AfterEach
    void clearSubscriptions() {
        // Subscriptions cascade from users, and this suite does not delete users -- the
        // auth module's own cleanup does. Clearing them here keeps V62's one-open-per-
        // account index from carrying a row into a later test in the same class.
        new JdbcTemplate(dataSource).update("DELETE FROM subscriptions");
        // And any plan this suite added. The three seeded rows have a null created_by and
        // are left alone, because every other suite's fixtures buy PRO.
        new JdbcTemplate(dataSource).update("DELETE FROM subscription_plans WHERE created_by IS NOT NULL");
        // `subscription_payments` is NOT cleared, because V73 refuses DELETE and TRUNCATE
        // alike. Every assertion about it is scoped to a subscription this test created,
        // which is how a reader of that table has to work anyway.
    }

    @Test
    @DisplayName("the catalogue is public, so somebody deciding whether to sign up can read it")
    void theCatalogueNeedsNoAccount() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/plans", HttpMethod.GET, new HttpEntity<>(jsonHeaders()), mapType());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(plansIn(response.getBody())).extracting(plan -> plan.get("code")).contains("STARTER", "GROWTH", "PRO");
    }

    @Test
    @DisplayName("prices travel as strings, because a JSON number is a double")
    void pricesAreStrings() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/plans", HttpMethod.GET, new HttpEntity<>(jsonHeaders()), mapType());

        assertThat(plansIn(response.getBody())).allSatisfy(plan -> assertThat(plan.get("price")).isInstanceOf(String.class));
    }

    @Test
    @DisplayName("says a limitless plan has no limit rather than sending a very large number")
    void unlimitedIsNullOnTheWire() {
        Map<String, Object> pro = planNamed("PRO");

        assertThat(pro.get("maxActiveCampaigns")).isNull();
        assertThat(pro.get("goalCeiling")).isNull();
    }

    @Test
    @DisplayName("an account with nothing gets a 200 and an empty answer, not a 404")
    void holdingNothingIsNotAnError() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> response = get("/v1/me/subscription", creator.accessToken());

        // A signed-in visitor opening the pricing page is the ordinary case, and a 404
        // would put a line in the log for every one of them.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().get("subscription")).isNull();
    }

    @Test
    @DisplayName("a priced plan waits for a member of staff to record the payment")
    void aPricedPlanWaitsForStaffToRecordPayment() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> bought =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));

        assertThat(bought.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map<String, Object> held = subscriptionIn(bought.getBody());
        assertThat(held.get("state")).isEqualTo("PENDING_PAYMENT");
        // Choosing a plan is not paying for one. Nothing here charges a card, because
        // §9.2 ships no provider adapter while #60 is unanswered.
        assertThat(held.get("entitled")).isEqualTo(false);
        assertThat(held.get("currentPeriodEnd")).isNull();
    }

    @Test
    @DisplayName("staff recording the payment starts the entitlement, and only staff can")
    void activationOpensThePeriod() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");

        // The creator cannot activate their own subscription: that is the point of the
        // second step.
        assertThat(post(
                                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                                creator.accessToken(),
                                Map.of("note", "I paid, honestly"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        ResponseEntity<Map<String, Object>> activated = post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin().accessToken(),
                Map.of("note", "transfer 44"));

        assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(activated.getBody().get("state")).isEqualTo("ACTIVE");
        assertThat(activated.getBody().get("entitled")).isEqualTo(true);
        assertThat(activated.getBody().get("currentPeriodEnd")).isNotNull();
    }

    @Test
    @DisplayName("recording the payment writes it to the journal, with the plan as it stood")
    void activationWritesTheJournal() {
        UUID plan = addPlan("JOURNAL", "49.00", 3, null);
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", plan.toString()));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");

        post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin().accessToken(),
                Map.of("method", "CASH", "reference", "receipt 7", "note", "handed over at the office"));

        Map<String, Object> payment = paymentFor(subscriptionId);
        assertThat(payment.get("amount")).isEqualTo(new java.math.BigDecimal("49.00"));
        assertThat(payment.get("currency")).isEqualTo("AZN");
        assertThat(payment.get("method")).isEqualTo("CASH");
        assertThat(payment.get("reference")).isEqualTo("receipt 7");
        assertThat(payment.get("account_id")).isEqualTo(creator.id());
        assertThat(payment.get("recorded_by")).isEqualTo(admin().id());
        // The plan, copied onto the row rather than referred to.
        assertThat(payment.get("plan_code")).isEqualTo("JOURNAL");
        assertThat(payment.get("plan_name")).isEqualTo("JOURNAL");

        // And the reason it is copied: V62 makes a plan editable on purpose, so a report
        // that read the name and price through `subscription_plans` would be retitled by a
        // rename and re-priced by a repricing. A report about March must not change in
        // April.
        patchPlan(plan, Map.of("name", "Renamed", "price", "99.00"));

        Map<String, Object> unchanged = paymentFor(subscriptionId);
        assertThat(unchanged.get("plan_name")).isEqualTo("JOURNAL");
        assertThat(unchanged.get("amount")).isEqualTo(new java.math.BigDecimal("49.00"));
    }

    @Test
    @DisplayName("an activation that says nothing about the payment records a transfer received now")
    void thePaymentFieldsAreOptional() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");

        // The console's dialogue asked for a note and nothing else. An endpoint that began
        // refusing those requests would stop a member of staff recording a transfer that
        // has already arrived, over fields the platform can default correctly.
        ResponseEntity<Map<String, Object>> activated = post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin().accessToken(),
                Map.of("note", "transfer 44"));

        assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> payment = paymentFor(subscriptionId);
        assertThat(payment.get("method")).isEqualTo("BANK_TRANSFER");
        assertThat(payment.get("reference")).isNull();
        assertThat((java.sql.Timestamp) payment.get("received_at")).isCloseTo(new java.util.Date(), 60_000L);
    }

    @Test
    @DisplayName("a payment may be backdated to the day it cleared, but not into the future")
    void aPaymentIsDatedWhenTheMoneyArrived() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");

        // A typed year puts a payment in a period nobody reconciles for twelve months and
        // takes it out of the one it belonged to, and the row cannot be edited afterwards.
        ResponseEntity<Map<String, Object>> refused = post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin().accessToken(),
                Map.of("receivedAt", Instant.now().plusSeconds(86_400).toString()));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("PAYMENT_NOT_YET_RECEIVED");

        // Backwards is the ordinary case: a transfer that cleared on the 31st and was
        // recorded on the 3rd belongs in the month it cleared, or the report disagrees
        // with the bank statement it is checked against.
        Instant cleared = Instant.now().minusSeconds(5 * 86_400);
        ResponseEntity<Map<String, Object>> activated = post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin().accessToken(),
                Map.of("receivedAt", cleared.toString()));

        assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> payment = paymentFor(subscriptionId);
        assertThat(((java.sql.Timestamp) payment.get("received_at")).toInstant())
                .isCloseTo(cleared, within(2, java.time.temporal.ChronoUnit.SECONDS));
        // The entitlement still starts now, not five days ago: a creator who waited for a
        // transfer to clear gets the month they paid for.
        assertThat(activated.getBody().get("entitled")).isEqualTo(true);
    }

    @Test
    @DisplayName("a free plan writes no payment, because no money arrived")
    void aFreePlanLeavesTheJournalAlone() {
        UUID freePlan = addPlan("GRATIS", "0.00", 1, null);
        Account creator = account();

        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", freePlan.toString()));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");

        // A zero row would sit in the account's history as a payment, and V73's CHECK
        // refuses it at the statement.
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT count(*) FROM subscription_payments WHERE subscription_id = ?::uuid",
                                Integer.class,
                                subscriptionId))
                .isZero();
    }

    @Test
    @DisplayName("a second activation is refused, so a colleague cannot extend a period by accident")
    void activationIsRefusedTwice() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");

        post("/v1/admin/subscriptions/" + subscriptionId + "/activate", admin().accessToken(), Map.of());
        ResponseEntity<Map<String, Object>> again =
                post("/v1/admin/subscriptions/" + subscriptionId + "/activate", admin().accessToken(), Map.of());

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody().get("code")).isEqualTo("SUBSCRIPTION_NOT_PENDING");
        // The state is on the body because "already active" and "cancelled" mean opposite
        // things to the person holding the bank statement.
        assertThat(again.getBody().get("state")).isEqualTo("ACTIVE");
    }

    @Test
    @DisplayName("a free plan entitles at once, because there is no payment to wait for")
    void aFreePlanNeedsNoSecondStep() {
        UUID freePlan = addPlan("COMMUNITY", "0.00", 1, null);
        Account creator = account();

        ResponseEntity<Map<String, Object>> bought =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", freePlan.toString()));

        assertThat(subscriptionIn(bought.getBody()).get("state")).isEqualTo("ACTIVE");
        assertThat(subscriptionIn(bought.getBody()).get("entitled")).isEqualTo(true);
    }

    @Test
    @DisplayName("buying twice is refused, because an account holds one subscription")
    void oneOpenSubscriptionPerAccount() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));

        ResponseEntity<Map<String, Object>> again =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("PRO")));

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody().get("code")).isEqualTo("ALREADY_SUBSCRIBED");
        // The two cases send a creator to different places, so they are distinguishable.
        assertThat(again.getBody().get("awaitingPayment")).isEqualTo(true);
    }

    @Test
    @DisplayName("an expired subscription does not block buying again")
    void anExpiredSubscriptionDoesNotBlockBuyingAgain() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");
        post("/v1/admin/subscriptions/" + subscriptionId + "/activate", admin().accessToken(), Map.of());

        // Wind the period back past now. V62's unique index cannot consult a clock, so an
        // ACTIVE row whose period has ended would otherwise stop this account for ever.
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE subscriptions SET started_at = now() - interval '40 days',"
                                + " current_period_end = now() - interval '10 days' WHERE id = ?::uuid",
                        subscriptionId);

        ResponseEntity<Map<String, Object>> again =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("PRO")));

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        // The row that was in the way is retired by the person it was in the way of.
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject("SELECT state FROM subscriptions WHERE id = ?::uuid", String.class, subscriptionId))
                .isEqualTo("EXPIRED");
    }

    @Test
    @DisplayName("a creator cancelling keeps the period they paid for")
    void cancellingKeepsWhatWasPaidFor() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", idOf("GROWTH")));
        String subscriptionId = (String) subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                .get("id");
        post("/v1/admin/subscriptions/" + subscriptionId + "/activate", admin().accessToken(), Map.of());

        ResponseEntity<Map<String, Object>> cancelled = rest.exchange(
                "/v1/me/subscription",
                HttpMethod.DELETE,
                new HttpEntity<>(authorised(creator.accessToken())),
                mapType());

        Map<String, Object> held = subscriptionIn(cancelled.getBody());
        assertThat(held.get("cancelAtPeriodEnd")).isEqualTo(true);
        // Still entitled: they bought the month, and taking it back on the click would be
        // charging for something and then withdrawing it.
        assertThat(held.get("entitled")).isEqualTo(true);
        assertThat(held.get("state")).isEqualTo("ACTIVE");
    }

    @Test
    @DisplayName("cancelling nothing is a 404 rather than a quiet success")
    void cancellingNothingIsRefused() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> cancelled = rest.exchange(
                "/v1/me/subscription",
                HttpMethod.DELETE,
                new HttpEntity<>(authorised(creator.accessToken())),
                mapType());

        assertThat(cancelled.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(cancelled.getBody().get("code")).isEqualTo("NO_SUBSCRIPTION");
    }

    @Test
    @DisplayName("an unlisted plan cannot be bought, and says so distinguishably from a missing one")
    void anUnlistedPlanIsNotOnSale() {
        UUID plan = addPlan("RETIRED", "10.00", 1, null);
        patchPlan(plan, Map.of("listed", false));
        Account creator = account();

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", plan.toString()));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("PLAN_NOT_ON_SALE");
        // And it is gone from the public catalogue, which is what unlisting means.
        assertThat(plansIn(get("/v1/plans", null).getBody()))
                .extracting(entry -> entry.get("code"))
                .doesNotContain("RETIRED");
    }

    @Test
    @DisplayName("editing a plan does not change what an existing subscriber was charged")
    void thePriceASubscriberPaidIsNotRewritten() {
        UUID plan = addPlan("SNAPSHOT", "10.00", 1, null);
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", plan.toString()));

        patchPlan(plan, Map.of("price", "99.00"));

        // The plan is dearer; the bill somebody already agreed to is not.
        assertThat(subscriptionIn(get("/v1/me/subscription", creator.accessToken()).getBody())
                        .get("price"))
                .isEqualTo("10.00");
    }

    @Test
    @DisplayName("the console needs CONFIGURE_PLATFORM for every write")
    void theConsoleIsNotOpenToAnybody() {
        Account creator = account();

        assertThat(get("/v1/admin/plans", creator.accessToken()).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/v1/admin/subscriptions", creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(post(
                                "/v1/admin/plans",
                                creator.accessToken(),
                                Map.of(
                                        "code", "SNEAKY",
                                        "name", "Sneaky",
                                        "price", "0.00",
                                        "currency", "AZN",
                                        "billingPeriod", "MONTHLY"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("the console sees unlisted plans, which the pricing page does not")
    void theConsoleSeesRetiredPlans() {
        UUID plan = addPlan("HIDDEN", "5.00", 1, null);
        patchPlan(plan, Map.of("listed", false));

        assertThat(plansIn(get("/v1/admin/plans", admin().accessToken()).getBody()))
                .extracting(entry -> entry.get("code"))
                .contains("HIDDEN");
    }

    @Test
    @DisplayName("two plans cannot share a code")
    void codesAreUnique() {
        addPlan("TWICE", "5.00", 1, null);

        ResponseEntity<Map<String, Object>> second = post(
                "/v1/admin/plans",
                admin().accessToken(),
                Map.of(
                        "code", "TWICE",
                        "name", "Twice",
                        "price", "5.00",
                        "currency", "AZN",
                        "billingPeriod", "MONTHLY"));

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(second.getBody().get("code")).isEqualTo("PLAN_CODE_TAKEN");
    }

    @Test
    @DisplayName("removing a limit needs its own flag, because null already means leave it alone")
    void clearingALimitIsDistinctFromOmittingIt() {
        UUID plan = addPlan("LIMITED", "5.00", 2, "5000.00");

        // Omitting the limit leaves it where it was.
        patchPlan(plan, Map.of("name", "Renamed"));
        assertThat(planById(plan).get("maxActiveCampaigns")).isEqualTo(2);

        // Saying so removes it.
        patchPlan(plan, Map.of("clearMaxActiveCampaigns", true));
        assertThat(planById(plan).get("maxActiveCampaigns")).isNull();
    }

    /* ------------------------------------------------------------------
     * Fixtures
     * --------------------------------------------------------------- */

    private record Account(String accessToken, UUID id) {
    }

    /**
     * The one journal row for a subscription, read straight from V73's table.
     *
     * <p>Through SQL rather than an endpoint because there is no endpoint yet: the revenue
     * report is the next task, and the property worth pinning now is that activating writes
     * the row at all.
     */
    private Map<String, Object> paymentFor(String subscriptionId) {
        return new JdbcTemplate(dataSource)
                .queryForMap(
                        "SELECT * FROM subscription_payments WHERE subscription_id = ?::uuid", subscriptionId);
    }

    private Account account() {
        return signIn(EmailAddress.of("subscriber" + SEQUENCE.incrementAndGet() + "@example.com"), "Test Creator");
    }

    /**
     * The bootstrapped administrator, with a token issued rather than signed in for.
     *
     * <p>{@code ConsoleReadApiTests}'s arrangement, and for its reason: the address is
     * fixed by {@code application-test.yml}, {@code sign-ins-per-email} is deliberately
     * realistic at five, and a dozen suites in this build sign in as this one account. A
     * suite that took a sign-in would exhaust the limiter for whichever suite ran after
     * it, and the symptom would be a 401 several assertions away from anything about
     * subscriptions.
     *
     * <p>Registered only if the row is not there. Another suite may have created it, and
     * another may have deleted it.
     */
    private Account admin() {
        if (admin != null) {
            return admin;
        }
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        admin = new Account(accessToken, id);
        return admin;
    }

    private Account signIn(EmailAddress email, String name) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", name),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                mapType());

        return new Account(
                (String) signedIn.getBody().get("accessToken"),
                users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    private UUID addPlan(String code, String price, Integer maxActive, String goalCeiling) {
        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("code", code);
        body.put("name", code);
        body.put("price", price);
        body.put("currency", "AZN");
        body.put("billingPeriod", "MONTHLY");
        body.put("maxActiveCampaigns", maxActive);
        body.put("goalCeiling", goalCeiling);

        ResponseEntity<Map<String, Object>> created = post("/v1/admin/plans", admin().accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private void patchPlan(UUID planId, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> changed = rest.exchange(
                "/v1/admin/plans/" + planId,
                HttpMethod.PATCH,
                new HttpEntity<>(body, authorised(admin().accessToken())),
                mapType());
        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private Map<String, Object> planById(UUID planId) {
        return plansIn(get("/v1/admin/plans", admin().accessToken()).getBody()).stream()
                .filter(plan -> planId.toString().equals(plan.get("id")))
                .findFirst()
                .orElseThrow();
    }

    private Map<String, Object> planNamed(String code) {
        return plansIn(get("/v1/plans", null).getBody()).stream()
                .filter(plan -> code.equals(plan.get("code")))
                .findFirst()
                .orElseThrow();
    }

    private String idOf(String code) {
        return (String) planNamed(code).get("id");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> plansIn(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("plans");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> subscriptionIn(Map<String, Object> body) {
        return (Map<String, Object>) body.get("subscription");
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(accessToken == null ? jsonHeaders() : authorised(accessToken)),
                mapType());
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, authorised(accessToken)), mapType());
    }

    private static ParameterizedTypeReference<Map<String, Object>> mapType() {
        return new ParameterizedTypeReference<>() {};
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders authorised(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
