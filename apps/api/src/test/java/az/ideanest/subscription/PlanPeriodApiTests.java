package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.ScriptedPaymentProvider;
import az.ideanest.user.infrastructure.UserRepository;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
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
 * Plans sold for one, six and twelve months, and the student plan's gate — #655, over HTTP.
 *
 * <p>The money tests: the subscription copies the chosen period's price, a period the plan is not
 * sold for is refused, the console's prices replace the whole set and are checked, and a
 * student-only plan is refused — when chosen, when its first period is paid and when it is renewed
 * — to an account without an approved, unexpired student verification.
 */
class PlanPeriodApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";
    private static final String STARTER = "7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e01";
    private static final String STUDENT = "7c0d4f8e-6a1b-4c2d-9e3f-1a2b3c4d5e04";

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

    @AfterEach
    void clear() {
        jdbc().update("DELETE FROM subscription_charges");
        jdbc().update("DELETE FROM subscriptions");
        jdbc().update("DELETE FROM subscription_plans WHERE created_by IS NOT NULL");
        jdbc().update("DELETE FROM student_verifications");
        provider.willOpenHostedPayments();
    }

    // ------------------------------------------------------------------
    // The catalogue
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every seeded monthly plan is sold for six and twelve months at six and twelve times the month")
    void theSeedPricesEveryPeriod() {
        Map<String, Object> starter = planNamed("STARTER");

        assertThat(starter.get("price")).isEqualTo("19.00");
        assertThat(starter.get("billingPeriod")).isEqualTo("MONTHLY");
        assertThat(starter.get("studentOnly")).isEqualTo(false);
        assertThat(pricesOf(starter))
                .containsExactly(
                        Map.of("billingPeriod", "MONTHLY", "price", "19.00", "currency", "AZN"),
                        Map.of("billingPeriod", "SEMIANNUAL", "price", "114.00", "currency", "AZN"),
                        Map.of("billingPeriod", "YEARLY", "price", "228.00", "currency", "AZN"));
    }

    @Test
    @DisplayName("the student plan is Starter's limits at 10 AZN a month, for students, drawn before Starter")
    void theStudentPlanIsSeeded() {
        Map<String, Object> student = planNamed("STUDENT");
        Map<String, Object> starter = planNamed("STARTER");

        assertThat(student.get("id")).isEqualTo(STUDENT);
        assertThat(student.get("studentOnly")).isEqualTo(true);
        assertThat(student.get("maxActiveCampaigns")).isEqualTo(starter.get("maxActiveCampaigns"));
        assertThat(student.get("goalCeiling")).isEqualTo(starter.get("goalCeiling"));
        assertThat(pricesOf(student))
                .extracting(price -> price.get("price"))
                .containsExactly("10.00", "60.00", "120.00");
        assertThat((Integer) student.get("sortOrder")).isLessThan((Integer) starter.get("sortOrder"));
        assertThat(planIn("STUDENT", "en").get("name")).isEqualTo("Student");
        assertThat(planIn("STUDENT", "ru").get("name")).isEqualTo("Студент");
        assertThat(planIn("STUDENT", "tr").get("name")).isEqualTo("Öğrenci");
        assertThat(planIn("STUDENT", "az").get("name")).isEqualTo("Tələbə");
    }

    @Test
    @DisplayName("the seeded plans read in every language: Azerbaijani first, and English, Russian and Turkish beside it")
    void theSeededPlansAreTranslated() {
        assertThat(planIn("STARTER", "az")).containsEntry("name", "Başlanğıc");
        assertThat(planIn("STARTER", "ru")).containsEntry("name", "Старт");
        assertThat(planIn("STARTER", "en"))
                .containsEntry("name", "Starter")
                .containsEntry("description", "One campaign at a time, up to a 10,000 AZN goal. For a first project.");
        assertThat(planIn("STARTER", "tr")).containsEntry("name", "Başlangıç");
        assertThat(planIn("GROWTH", "az")).containsEntry("name", "İnkişaf");
        assertThat(planIn("GROWTH", "ru")).containsEntry("name", "Рост");
        assertThat(planIn("PRO", "ru")).containsEntry("name", "Про");
        assertThat(planIn("PRO", "tr"))
                .containsEntry("description", "İstediğiniz kadar kampanya, hedef sınırı yok.");
        assertThat(planIn("STUDENT", "en"))
                .containsEntry("description", "For verified students: one campaign at a time, up to a 10,000 AZN goal.");
    }

    @Test
    @DisplayName("V128 translates only a row still holding V62's seed, never one an operator has edited")
    void theTranslationLeavesAnEditedPlanAlone() {
        Map<String, Object> before = jdbc().queryForMap(
                "SELECT name, description, translations::text AS translations FROM subscription_plans WHERE code = 'STARTER'");
        String seed = "One campaign at a time, up to a 10,000 AZN goal. For a first project.";
        try {
            // An operator kept the English name but reworded the description.
            jdbc().update(
                    "UPDATE subscription_plans SET name = 'Starter', description = 'Operator wording',"
                            + " translations = '{}'::jsonb WHERE code = 'STARTER'");
            runV128();
            assertThat(jdbc().queryForMap(
                            "SELECT name, description FROM subscription_plans WHERE code = 'STARTER'"))
                    .containsEntry("name", "Starter")
                    .containsEntry("description", "Operator wording");

            // The untouched seed is what it does translate.
            jdbc().update(
                    "UPDATE subscription_plans SET name = 'Starter', description = ?, translations = '{}'::jsonb"
                            + " WHERE code = 'STARTER'",
                    seed);
            runV128();
            assertThat(jdbc().queryForObject(
                            "SELECT name FROM subscription_plans WHERE code = 'STARTER'", String.class))
                    .isEqualTo("Başlanğıc");
        } finally {
            jdbc().update(
                    "UPDATE subscription_plans SET name = ?, description = ?, translations = ?::jsonb WHERE code = 'STARTER'",
                    before.get("name"),
                    before.get("description"),
                    before.get("translations"));
        }
    }

    private void runV128() {
        new org.springframework.jdbc.datasource.init.ResourceDatabasePopulator(
                        new org.springframework.core.io.ClassPathResource("db/migration/V128__translate_seeded_plans.sql"))
                .execute(dataSource);
    }

    // ------------------------------------------------------------------
    // Buying a period
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a subscription copies the price of the period chosen, and the period")
    void theChosenPeriodsPriceIsCopied() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> bought =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER, "billingPeriod", "YEARLY"));

        assertThat(bought.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map<String, Object> held = subscriptionIn(bought.getBody());
        assertThat(held.get("price")).isEqualTo("228.00");
        assertThat(held.get("billingPeriod")).isEqualTo("YEARLY");
        assertThat(held.get("paymentDue")).isEqualTo("FIRST_PERIOD");
    }

    @Test
    @DisplayName("no period means the shortest the plan is sold for, as before plans had several")
    void noPeriodMeansTheShortest() {
        Account creator = account();

        Map<String, Object> held = subscriptionIn(
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER)).getBody());

        assertThat(held.get("price")).isEqualTo("19.00");
        assertThat(held.get("billingPeriod")).isEqualTo("MONTHLY");
    }

    @Test
    @DisplayName("a period the plan is not sold for is refused with PERIOD_NOT_OFFERED")
    void anUnsoldPeriodIsRefused() {
        UUID plan = addPlan("MONTHONLY", List.of(price("MONTHLY", "5.00")));
        Account creator = account();

        ResponseEntity<Map<String, Object>> refused = post(
                "/v1/me/subscription", creator.accessToken(), Map.of("planId", plan.toString(), "billingPeriod", "SEMIANNUAL"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("PERIOD_NOT_OFFERED");
        assertThat(refused.getBody().get("billingPeriod")).isEqualTo("SEMIANNUAL");
        assertThat(get("/v1/me/subscription", creator.accessToken()).getBody().get("subscription")).isNull();
    }

    @Test
    @DisplayName("choosing another period of the same plan replaces an unpaid choice")
    void anotherPeriodReplacesAnUnpaidChoice() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER, "billingPeriod", "MONTHLY"));

        ResponseEntity<Map<String, Object>> changed = post(
                "/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER, "billingPeriod", "SEMIANNUAL"));

        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(subscriptionIn(changed.getBody()).get("price")).isEqualTo("114.00");
        assertThat(jdbc().queryForList(
                        "SELECT state FROM subscriptions WHERE account_id = ? ORDER BY created_at", String.class, creator.id()))
                .containsExactly("CANCELED", "PENDING_PAYMENT");

        // The same plan and the same period again is still "you already chose this".
        ResponseEntity<Map<String, Object>> again = post(
                "/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER, "billingPeriod", "SEMIANNUAL"));
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody().get("code")).isEqualTo("ALREADY_SUBSCRIBED");
    }

    @Test
    @DisplayName("the provider's page is opened for the chosen period's price")
    void thePageAsksForTheChosenPrice() {
        Account creator = account();
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STARTER, "billingPeriod", "SEMIANNUAL"));

        assertThat(pay(creator).getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(provider.hostedPayments().getLast().amount().amount()).isEqualByComparingTo("114.00");
    }

    // ------------------------------------------------------------------
    // The console's prices
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the console adds a plan with every period's price and its student flag")
    void theConsoleAddsPricesAndTheFlag() {
        Map<String, Object> body = planBody("PRICED");
        body.put("prices", List.of(price("YEARLY", "100.00"), price("MONTHLY", "10.00")));
        body.put("studentOnly", true);

        ResponseEntity<Map<String, Object>> created = post("/v1/admin/plans", admin().accessToken(), body);

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody().get("studentOnly")).isEqualTo(true);
        assertThat(created.getBody().get("price")).isEqualTo("10.00");
        assertThat(created.getBody().get("billingPeriod")).isEqualTo("MONTHLY");
        assertThat(pricesOf(created.getBody()))
                .extracting(entry -> entry.get("billingPeriod"))
                .containsExactly("MONTHLY", "YEARLY");
    }

    @Test
    @DisplayName("a plan added with one price and no list is sold for that one period, as before")
    void oneAddedPriceIsOnePeriod() {
        UUID plan = addLegacyPlan("LEGACY", "7.00");

        assertThat(pricesOf(planById(plan))).containsExactly(
                Map.of("billingPeriod", "MONTHLY", "price", "7.00", "currency", "AZN"));
    }

    @Test
    @DisplayName("PATCH prices replaces the whole set, and the plan's one price follows the shortest")
    void patchingPricesReplacesTheSet() {
        UUID plan = addPlan("REPRICE", List.of(price("MONTHLY", "10.00"), price("YEARLY", "120.00")));

        ResponseEntity<Map<String, Object>> changed =
                patch(plan, Map.of("prices", List.of(price("SEMIANNUAL", "50.00"), price("YEARLY", "90.00"))));

        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(pricesOf(changed.getBody()))
                .extracting(entry -> entry.get("billingPeriod") + "=" + entry.get("price"))
                .containsExactly("SEMIANNUAL=50.00", "YEARLY=90.00");
        assertThat(changed.getBody().get("price")).isEqualTo("50.00");
        assertThat(changed.getBody().get("billingPeriod")).isEqualTo("SEMIANNUAL");
        // And a monthly purchase is no longer possible.
        Account creator = account();
        assertThat(post("/v1/me/subscription", creator.accessToken(), Map.of("planId", plan.toString(), "billingPeriod", "MONTHLY"))
                        .getBody()
                        .get("code"))
                .isEqualTo("PERIOD_NOT_OFFERED");
    }

    @Test
    @DisplayName("a PATCH that leaves prices out leaves every period's price where it was")
    void omittingPricesLeavesThem() {
        UUID plan = addPlan("KEEP", List.of(price("MONTHLY", "10.00"), price("YEARLY", "120.00")));

        patch(plan, Map.of("name", "Renamed", "studentOnly", true));

        Map<String, Object> after = planById(plan);
        assertThat(pricesOf(after)).hasSize(2);
        assertThat(after.get("studentOnly")).isEqualTo(true);
    }

    @Test
    @DisplayName("the console's prices are checked: one per period, at least one, never negative, in the plan's currency")
    void consolePricesAreChecked() {
        UUID plan = addPlan("CHECKED", List.of(price("MONTHLY", "10.00")));

        assertThat(patch(plan, Map.of("prices", List.of(price("MONTHLY", "1.00"), price("MONTHLY", "2.00"))))
                        .getBody()
                        .get("code"))
                .isEqualTo("INVALID_PLAN");
        assertThat(patch(plan, Map.of("prices", List.of())).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(patch(plan, Map.of("prices", List.of(price("MONTHLY", "-1.00")))).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        Map<String, Object> elsewhere = new LinkedHashMap<>(price("MONTHLY", "1.00"));
        elsewhere.put("currency", "USD");
        assertThat(patch(plan, Map.of("prices", List.of(elsewhere))).getBody().get("code"))
                .isEqualTo("INVALID_PLAN");

        // None of the refusals touched it.
        assertThat(pricesOf(planById(plan))).containsExactly(
                Map.of("billingPeriod", "MONTHLY", "price", "10.00", "currency", "AZN"));
    }

    @Test
    @DisplayName("a POST with neither prices nor a price is refused")
    void aPlanNeedsAPrice() {
        Map<String, Object> body = planBody("PRICELESS");
        body.remove("price");
        body.remove("billingPeriod");

        ResponseEntity<Map<String, Object>> refused = post("/v1/admin/plans", admin().accessToken(), body);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("INVALID_PLAN");
    }

    // ------------------------------------------------------------------
    // The student plan's gate
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a student plan is refused to an account that is not a verified student")
    void theStudentPlanNeedsAVerifiedStudent() {
        Account creator = account();

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STUDENT));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("STUDENT_VERIFICATION_REQUIRED");

        // Pending is not approved.
        verification(creator, "PENDING", null);
        assertThat(post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STUDENT)).getBody().get("code"))
                .isEqualTo("STUDENT_VERIFICATION_REQUIRED");
    }

    @Test
    @DisplayName("an expired approval does not buy a student plan")
    void anExpiredApprovalDoesNotQualify() {
        Account creator = account();
        verification(creator, "APPROVED", Instant.now().minus(Duration.ofMinutes(1)));

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STUDENT, "billingPeriod", "YEARLY"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("STUDENT_VERIFICATION_REQUIRED");
    }

    @Test
    @DisplayName("an approved student buys the student plan at its own price")
    void anApprovedStudentBuysIt() {
        Account creator = account();
        verification(creator, "APPROVED", Instant.now().plus(Duration.ofDays(300)));

        ResponseEntity<Map<String, Object>> bought =
                post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STUDENT, "billingPeriod", "SEMIANNUAL"));

        assertThat(bought.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(subscriptionIn(bought.getBody()).get("price")).isEqualTo("60.00");
        assertThat(pay(creator).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("the first period of a student plan is not paid once the approval has run out")
    void theFirstPaymentIsGated() {
        Account creator = account();
        verification(creator, "APPROVED", Instant.now().plus(Duration.ofDays(1)));
        post("/v1/me/subscription", creator.accessToken(), Map.of("planId", STUDENT));
        jdbc().update(
                "UPDATE student_verifications SET valid_until = ? WHERE account_id = ?",
                Timestamp.from(Instant.now().minusSeconds(5)),
                creator.id());
        int pagesBefore = provider.hostedPayments().size();

        ResponseEntity<Map<String, Object>> refused = pay(creator);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("STUDENT_VERIFICATION_REQUIRED");
        assertThat(provider.hostedPayments()).hasSize(pagesBefore);
    }

    @Test
    @DisplayName("a student plan is not renewed for an account whose approval has run out, and is for one whose has not")
    void theRenewalIsGated() {
        Account lapsed = account();
        verification(lapsed, "APPROVED", Instant.now().minus(Duration.ofDays(1)));
        heldInRenewalWindow(lapsed);

        ResponseEntity<Map<String, Object>> refused = pay(lapsed);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("STUDENT_VERIFICATION_REQUIRED");
        // The period already paid for is not taken away.
        assertThat(subscriptionIn(get("/v1/me/subscription", lapsed.accessToken()).getBody()).get("entitled"))
                .isEqualTo(true);

        Account current = account();
        verification(current, "APPROVED", Instant.now().plus(Duration.ofDays(100)));
        heldInRenewalWindow(current);
        assertThat(subscriptionIn(get("/v1/me/subscription", current.accessToken()).getBody()).get("paymentDue"))
                .isEqualTo("RENEWAL");
        assertThat(pay(current).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A running STUDENT subscription whose period ends in three days, inside the renewal window. */
    private void heldInRenewalWindow(Account creator) {
        Instant end = Instant.now().plus(Duration.ofDays(3));
        jdbc().update(
                """
                INSERT INTO subscriptions
                    (id, account_id, plan_id, state, price, currency, billing_period, started_at, current_period_end)
                VALUES (?, ?, ?, 'ACTIVE', 10.00, 'AZN', 'MONTHLY', ?, ?)
                """,
                UUID.randomUUID(),
                creator.id(),
                UUID.fromString(STUDENT),
                Timestamp.from(end.minus(Duration.ofDays(30))),
                Timestamp.from(end));
    }

    /** A student verification row as the service would leave it, written directly. */
    private void verification(Account creator, String state, Instant validUntil) {
        boolean decided = !"PENDING".equals(state);
        jdbc().update(
                """
                INSERT INTO student_verifications
                    (id, account_id, institution, card_number, state, submitted_at, decided_at, valid_until)
                VALUES (?, ?, 'Test University', ?, ?, now(), ?, ?)
                """,
                UUID.randomUUID(),
                creator.id(),
                "PLANCARD" + SEQUENCE.incrementAndGet(),
                state,
                decided ? Timestamp.from(Instant.now().minus(Duration.ofDays(400))) : null,
                validUntil == null ? null : Timestamp.from(validUntil));
    }

    private UUID addPlan(String code, List<Map<String, Object>> prices) {
        Map<String, Object> body = planBody(code + SEQUENCE.incrementAndGet());
        body.put("prices", prices);
        ResponseEntity<Map<String, Object>> created = post("/v1/admin/plans", admin().accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID addLegacyPlan(String code, String price) {
        Map<String, Object> body = planBody(code + SEQUENCE.incrementAndGet());
        body.put("price", price);
        ResponseEntity<Map<String, Object>> created = post("/v1/admin/plans", admin().accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private static Map<String, Object> planBody(String code) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("name", code);
        body.put("price", "1.00");
        body.put("currency", "AZN");
        body.put("billingPeriod", "MONTHLY");
        body.put("maxActiveCampaigns", 1);
        return body;
    }

    private static Map<String, Object> price(String period, String amount) {
        return Map.of("billingPeriod", period, "price", amount);
    }

    private ResponseEntity<Map<String, Object>> patch(UUID planId, Map<String, Object> body) {
        return rest.exchange(
                "/v1/admin/plans/" + planId,
                HttpMethod.PATCH,
                new HttpEntity<>(body, authorised(admin().accessToken())),
                mapType());
    }

    private ResponseEntity<Map<String, Object>> pay(Account creator) {
        HttpHeaders headers = authorised(creator.accessToken());
        headers.set("Idempotency-Key", UUID.randomUUID().toString());
        return rest.exchange(
                "/v1/me/subscription/payment",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("language", "az", "successUrl", "https://ideanest.az/az/pricing?payment=returned"), headers),
                mapType());
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

    private Map<String, Object> planIn(String code, String language) {
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.ACCEPT_LANGUAGE, language);
        return plansIn(rest.exchange("/v1/plans", HttpMethod.GET, new HttpEntity<>(headers), mapType()).getBody())
                .stream()
                .filter(plan -> code.equals(plan.get("code")))
                .findFirst()
                .orElseThrow();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> plansIn(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("plans");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> pricesOf(Map<String, Object> plan) {
        return (List<Map<String, Object>>) plan.get("prices");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> subscriptionIn(Map<String, Object> body) {
        return (Map<String, Object>) body.get("subscription");
    }

    private record Account(String accessToken, UUID id) {
    }

    /** A registered creator with an issued token, so no suite's sign-in limit is spent. */
    private Account account() {
        EmailAddress email = EmailAddress.of("plan-period-" + SEQUENCE.incrementAndGet() + "@example.com");
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

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        HttpHeaders headers = accessToken == null ? new HttpHeaders() : authorised(accessToken);
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), mapType());
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
