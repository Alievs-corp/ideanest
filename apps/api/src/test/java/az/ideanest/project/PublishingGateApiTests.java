package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
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
 * The publishing gate: what a subscription buys, at the boundary where it bites.
 *
 * <p>The suite that proves the gate exists at all is {@link #anUnsubscribedCreatorCannotSubmit()};
 * the ones that prove it is not a blunt instrument are the two limit tests, which check
 * the boundary rather than a value comfortably past it.
 *
 * <p><strong>Separate from {@code ProjectLifecycleApiTests} on purpose.</strong> That suite
 * gives every creator a plan through {@code Campaigns.subscribe}, because it is about the
 * state machine and a fixture that had to buy a subscription first would make every one of
 * its tests depend on this feature. This one buys plans deliberately, because the
 * entitlement is the subject.
 */
class PublishingGateApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";
    private static final String ROLE_FIXTURE_NOTE = "publishing gate fixture";

    private Account admin;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Campaigns do not cascade from users, so a suite that left rows here would break
        // the identity tests' own cleanup.
        jdbc.update("DELETE FROM collaborator_capabilities");
        jdbc.update("DELETE FROM collaborators");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
        jdbc.update("DELETE FROM subscriptions");
        jdbc.update("DELETE FROM subscription_plans WHERE created_by IS NOT NULL");
        jdbc.update("DELETE FROM staff_role_grants WHERE note = ?", ROLE_FIXTURE_NOTE);
    }

    @Test
    @DisplayName("a creator with no plan cannot submit, and is told where to get one")
    void anUnsubscribedCreatorCannotSubmit() {
        Account creator = account();
        UUID project = completeCampaign(creator);

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects/" + project + "/submit", creator.accessToken(), null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("SUBSCRIPTION_REQUIRED");
        // The client navigates on this rather than assembling the platform's own routes
        // out of a constant.
        assertThat(metaOf(refused)).containsEntry("pricingPath", "/pricing");
    }

    @Test
    @DisplayName("building a campaign is free; only sending it for review is not")
    void draftingNeedsNoPlan() {
        Account creator = account();

        // The whole campaign is written, edited and read back with no subscription
        // anywhere. A paywall in front of an empty form is a paywall in front of nothing.
        UUID project = completeCampaign(creator);

        assertThat(get("/v1/projects/" + project + "/edit", creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a plan that is only chosen and not paid for does not entitle anybody")
    void aPendingPlanDoesNotEntitle() {
        Account creator = account();
        UUID project = completeCampaign(creator);
        subscribeTo(creator, planNamed("GROWTH"));

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects/" + project + "/submit", creator.accessToken(), null);

        assertThat(refused.getBody().get("code")).isEqualTo("SUBSCRIPTION_REQUIRED");
    }

    @Test
    @DisplayName("an active plan lets the campaign through")
    void anActivePlanAllowsSubmission() {
        Account creator = account();
        UUID project = completeCampaign(creator);
        activate(creator, subscribeTo(creator, planNamed("GROWTH")));

        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + project + "/submit", creator.accessToken(), null);

        assertThat(submitted.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(submitted.getBody().get("state")).isEqualTo("SUBMITTED");
    }

    @Test
    @DisplayName("the campaign limit bites at the boundary and not below it")
    void theCampaignLimitBites() {
        UUID onlyOne = addPlan("ONEATATIME", "5.00", 1, null);
        Account creator = account();
        activate(creator, subscribeTo(creator, onlyOne));

        UUID first = completeCampaign(creator);
        assertThat(post("/v1/projects/" + first + "/submit", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        UUID second = completeCampaign(creator);
        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects/" + second + "/submit", creator.accessToken(), null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        // A different code from SUBSCRIPTION_REQUIRED, because this creator has paid and
        // the answer may be to withdraw a campaign rather than to buy anything.
        assertThat(refused.getBody().get("code")).isEqualTo("PLAN_LIMIT_EXCEEDED");
        assertThat(metaOf(refused)).containsEntry("limit", "ACTIVE_CAMPAIGNS").containsEntry("allowed", "1");
    }

    @Test
    @DisplayName("a resubmission does not count itself against a one-campaign plan")
    void resubmissionDoesNotCountItself() {
        UUID onlyOne = addPlan("ONEONLY", "5.00", 1, null);
        Account creator = account();
        activate(creator, subscribeTo(creator, onlyOne));

        UUID project = completeCampaign(creator);
        post("/v1/projects/" + project + "/submit", creator.accessToken(), null);

        // A moderator sends it back, and the creator fixes it and sends it again. Counting
        // the campaign being submitted would refuse every creator on the plan most of them
        // are on.
        new JdbcTemplate(dataSource)
                .update("UPDATE projects SET state = 'CHANGES_REQUESTED' WHERE id = ?", project);

        assertThat(post("/v1/projects/" + project + "/submit", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("the goal ceiling permits a goal equal to it and refuses one manat more")
    void theGoalCeilingBites() {
        UUID capped = addPlan("CAPPED", "5.00", null, "10000.00");
        Account creator = account();
        activate(creator, subscribeTo(creator, capped));

        UUID atTheLimit = completeCampaign(creator, "10000.00");
        assertThat(post("/v1/projects/" + atTheLimit + "/submit", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        UUID overIt = completeCampaign(creator, "10000.01");
        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects/" + overIt + "/submit", creator.accessToken(), null);

        assertThat(refused.getBody().get("code")).isEqualTo("PLAN_LIMIT_EXCEEDED");
        assertThat(metaOf(refused)).containsEntry("limit", "GOAL_CEILING");
    }

    @Test
    @DisplayName("raising a plan's limit reaches everybody already on it")
    void limitsAreReadLiveRatherThanSnapshotted() {
        UUID plan = addPlan("GROWABLE", "5.00", 1, null);
        Account creator = account();
        activate(creator, subscribeTo(creator, plan));

        post("/v1/projects/" + completeCampaign(creator) + "/submit", creator.accessToken(), null);
        UUID second = completeCampaign(creator);
        assertThat(post("/v1/projects/" + second + "/submit", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        // The operator raises what the plan allows. That is a gift to everybody on it,
        // which is what raising a limit means -- V62 has the argument for why limits are
        // read live where the price is snapshotted.
        rest.exchange(
                "/v1/admin/plans/" + plan,
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("maxActiveCampaigns", 2), authorised(admin().accessToken())),
                mapType());

        assertThat(post("/v1/projects/" + second + "/submit", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a lapsed plan stops entitling the moment its period ends")
    void aLapsedPlanStopsEntitling() {
        Account creator = account();
        UUID subscription = activate(creator, subscribeTo(creator, planNamed("PRO")));
        UUID project = completeCampaign(creator);

        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE subscriptions SET started_at = now() - interval '40 days',"
                                + " current_period_end = now() - interval '1 minute' WHERE id = ?",
                        subscription);

        assertThat(post("/v1/projects/" + project + "/submit", creator.accessToken(), null)
                        .getBody()
                        .get("code"))
                .isEqualTo("SUBSCRIPTION_REQUIRED");
    }

    @Test
    @DisplayName("the creator's plan is what counts, not the collaborator's who pressed the button")
    void theCreatorPays() {
        Account creator = account();
        Account helper = account();
        activate(helper, subscribeTo(helper, planNamed("PRO")));

        UUID project = completeCampaign(creator);
        grantSubmitCapability(project, creator, helper);

        // Otherwise a creator could publish for free by asking a friend with a plan to
        // press the button, and the friend would be billed for a favour.
        assertThat(post("/v1/projects/" + project + "/submit", helper.accessToken(), null)
                        .getBody()
                        .get("code"))
                .isEqualTo("SUBSCRIPTION_REQUIRED");
    }

    @Test
    @DisplayName("the bootstrapped super admin submits with no plan")
    void aBootstrappedSuperAdminNeedsNoPlan() {
        UUID project = completeCampaign(admin());

        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + project + "/submit", admin().accessToken(), null);

        assertThat(submitted.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(submitted.getBody().get("state")).isEqualTo("SUBMITTED");
    }

    @Test
    @DisplayName("a granted super admin submits with no plan and no plan limits")
    void aGrantedSuperAdminNeedsNoPlan() {
        Account operator = account();
        grantRole(operator, "SUPER_ADMIN");

        for (int i = 0; i < 2; i++) {
            UUID project = completeCampaign(operator);
            assertThat(post("/v1/projects/" + project + "/submit", operator.accessToken(), null)
                            .getStatusCode())
                    .isEqualTo(HttpStatus.OK);
        }
    }

    @Test
    @DisplayName("any other staff role still needs a plan")
    void aModeratorStillNeedsAPlan() {
        Account moderator = account();
        grantRole(moderator, "MODERATOR");
        UUID project = completeCampaign(moderator);

        assertThat(post("/v1/projects/" + project + "/submit", moderator.accessToken(), null)
                        .getBody()
                        .get("code"))
                .isEqualTo("SUBSCRIPTION_REQUIRED");
    }

    @Test
    @DisplayName("a super admin pressing the button does not publish a creator's campaign for free")
    void aSuperAdminCollaboratorDoesNotPayForTheCreator() {
        Account creator = account();
        Account operator = account();
        grantRole(operator, "SUPER_ADMIN");

        UUID project = completeCampaign(creator);
        grantSubmitCapability(project, creator, operator);

        assertThat(post("/v1/projects/" + project + "/submit", operator.accessToken(), null)
                        .getBody()
                        .get("code"))
                .isEqualTo("SUBSCRIPTION_REQUIRED");
    }

    /* ------------------------------------------------------------------
     * Fixtures
     * --------------------------------------------------------------- */

    private record Account(EmailAddress email, String accessToken, UUID id) {
    }

    private void grantRole(Account account, String role) {
        new JdbcTemplate(dataSource)
                .update(
                        "INSERT INTO staff_role_grants (account_id, role, granted_by, note) VALUES (?, ?, ?, ?)",
                        account.id(),
                        role,
                        account.id(),
                        ROLE_FIXTURE_NOTE);
    }

    private Account account() {
        return signIn(EmailAddress.of("gate" + SEQUENCE.incrementAndGet() + "@example.com"), "Test Creator");
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

        admin = new Account(email, accessToken, id);
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
                email,
                (String) signedIn.getBody().get("accessToken"),
                users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId());
    }

    /** A campaign §5.3 would accept, so that the gate is the only thing left to refuse it. */
    private UUID completeCampaign(Account creator) {
        return completeCampaign(creator, null);
    }

    private UUID completeCampaign(Account creator, String goal) {
        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects", creator.accessToken(), Map.of("title", "Gate " + SEQUENCE.incrementAndGet()));
        UUID id = UUID.fromString((String) created.getBody().get("id"));

        Map<String, Object> body = new LinkedHashMap<>(Campaigns.completeBasics(categories));
        if (goal != null) {
            body.put("goal", Map.of("amount", goal, "currency", "AZN"));
        }
        rest.exchange(
                "/v1/projects/" + id,
                HttpMethod.PATCH,
                new HttpEntity<>(body, authorised(creator.accessToken())),
                mapType());
        return id;
    }

    private UUID planNamed(String code) {
        return UUID.fromString(new JdbcTemplate(dataSource)
                .queryForObject("SELECT id::text FROM subscription_plans WHERE code = ?", String.class, code));
    }

    private UUID addPlan(String code, String price, Integer maxActive, String goalCeiling) {
        Map<String, Object> body = new LinkedHashMap<>();
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

    private UUID subscribeTo(Account account, UUID planId) {
        ResponseEntity<Map<String, Object>> bought =
                post("/v1/me/subscription", account.accessToken(), Map.of("planId", planId.toString()));
        assertThat(bought.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        return UUID.fromString(new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT id::text FROM subscriptions WHERE account_id = ?"
                                + " AND state IN ('PENDING_PAYMENT', 'ACTIVE')",
                        String.class,
                        account.id()));
    }

    /** Records the payment, which is the second of the two steps a priced plan takes. */
    private UUID activate(Account account, UUID subscriptionId) {
        ResponseEntity<Map<String, Object>> activated = post(
                "/v1/admin/subscriptions/" + subscriptionId + "/activate",
                admin().accessToken(),
                Map.of("note", "transfer for " + account.email().value()));
        assertThat(activated.getStatusCode()).isEqualTo(HttpStatus.OK);
        return subscriptionId;
    }

    /**
     * Grants somebody {@code SUBMIT_FOR_REVIEW} on a campaign they did not create.
     *
     * <p>Written rather than invited, following {@code Campaigns}: the honest route is an
     * invitation, an emailed token and an acceptance, and {@code CollaboratorApiTests}
     * takes it because that flow is what it is checking. This suite is checking whose
     * subscription is consulted, and driving three requests to arrive at a precondition
     * would make the test depend on the mail transport.
     */
    private void grantSubmitCapability(UUID projectId, Account creator, Account helper) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        UUID collaboratorId = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO collaborators
                    (id, project_id, account_id, invited_email, invitation_token_hash,
                     invited_by, expires_at, accepted_at)
                VALUES (?, ?, ?, ?, ?, ?, now() + interval '7 days', now())
                """,
                collaboratorId,
                projectId,
                helper.id(),
                helper.email().value(),
                // 32 bytes, because collaborators_token_hash_is_sha256 says so. The value
                // is never verified against anything -- this grant is accepted already.
                new byte[32],
                creator.id());
        jdbc.update(
                "INSERT INTO collaborator_capabilities (collaborator_id, capability) VALUES (?, ?)",
                collaboratorId,
                "SUBMIT_FOR_REVIEW");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> metaOf(ResponseEntity<Map<String, Object>> response) {
        return (Map<String, Object>) response.getBody().get("meta");
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(authorised(accessToken)), mapType());
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
