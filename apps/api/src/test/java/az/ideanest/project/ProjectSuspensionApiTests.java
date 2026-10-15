package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
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
 * §4.11's AD-02 (#103): stopping a campaign, and what that does to its pledges.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #suspendingACampaignEndsItsPledgesAndGivesBackTheirPlaces()} — the half
 *       that was missing. A campaign whose funding was taken down while holding four
 *       hundred places would hold them for ever, on a campaign nobody can back.
 *   <li>{@link #cancellingACampaignEndsItsPledgesTheSameWay()} — the creator's own halt
 *       had the same gap, and it is the same event with a different name.
 *   <li>{@link #aPledgeWhoseMoneyHasMovedIsLeftAlone()} — cancelling a collected pledge
 *       would say the money was never taken. That is a refund, and refunds are #67's.
 *   <li>{@link #aSecondDeliveryEndsNothingTwice()} — at-least-once is the outbox's
 *       stated contract, not an edge case.
 *   <li>{@link #onlyStaffMaySuspend()} — the endpoint exists to stop a creator's
 *       campaign, so the one thing it must never accept is the creator.
 * </ul>
 *
 * <p>The relay is run by hand, as every outbox suite here does: its timer is disabled in
 * the test profile so that a sweep does not act on rows a test is about to assert on.
 */
class ProjectSuspensionApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static Account moderator;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM reward_tiers");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // The halt
    // ------------------------------------------------------------------

    @Test
    @DisplayName("staff suspend a live campaign, and it is audited")
    void staffSuspendALiveCampaign() {
        Account creator = account("susp-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> suspended =
                suspend(project, moderator(), "Counterfeit product photographs.");

        assertThat(suspended.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(suspended.getBody()).containsEntry("state", "SUSPENDED");

        List<AuditEntry> rows = auditRows(project, AuditAction.PROJECT_SUSPENDED);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().getDetail()).isEqualTo("LIVE -> SUSPENDED");
        assertThat(rows.getFirst().getDetail())
                .as("the reason is prose about somebody's campaign, and audit_logs cannot be corrected")
                .doesNotContain("Counterfeit");
    }

    @Test
    @DisplayName("a suspension without a reason is refused")
    void aSuspensionNeedsAReason() {
        Account creator = account("susp-noreason");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = suspend(project, moderator(), "   ");

        // The reason is the only thing the creator, the backers, and whoever reviews
        // the decision later are ever told about why.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(state(project)).isEqualTo("LIVE");
    }

    @Test
    @DisplayName("only staff may suspend")
    void onlyStaffMaySuspend() {
        Account creator = account("susp-guard");
        UUID project = liveCampaign(creator);

        // The endpoint exists to stop a creator's campaign, so the one caller it must
        // never accept is its creator.
        ResponseEntity<Map<String, Object>> refused = suspend(project, creator, "Nothing wrong with it.");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "NOT_A_MODERATOR");
        assertThat(state(project)).isEqualTo("LIVE");
    }

    @Test
    @DisplayName("a campaign that has already closed cannot be suspended")
    void aClosedCampaignCannotBeSuspended() {
        Account creator = account("susp-closed");
        UUID project = liveCampaign(creator);
        new JdbcTemplate(dataSource).update("UPDATE projects SET state = 'SUCCESSFUL' WHERE id = ?", project);

        ResponseEntity<Map<String, Object>> refused = suspend(project, moderator(), "Too late.");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_TRANSITION_NOT_ALLOWED");
    }

    // ------------------------------------------------------------------
    // What it does to the pledges
    // ------------------------------------------------------------------

    @Test
    @DisplayName("suspending a campaign ends its pledges and gives back their places")
    void suspendingACampaignEndsItsPledgesAndGivesBackTheirPlaces() {
        Account creator = account("susp-pledges");
        UUID project = project(creator);
        UUID tier = reward(creator, project, "A boxed set", "25.00", 5);
        Campaigns.launch(dataSource, project);

        UUID first = draftPledge(project, account("susp-backer"), tier);
        UUID draft = draftPledge(project, account("susp-drafter"), tier);

        assertThat(committed(tier)).isEqualTo(2);

        suspend(project, moderator(), "Counterfeit product photographs.");
        relay.run();

        assertThat(pledgeState(first)).isEqualTo("CANCELED_BY_PROJECT");
        assertThat(pledgeState(draft))
                .as("a checkout in progress on a suspended campaign is not going to be finished")
                .isEqualTo("CANCELED_BY_PROJECT");
        assertThat(committed(tier))
                .as("places held by a campaign nobody can back are places nobody can ever buy")
                .isZero();
    }

    @Test
    @DisplayName("cancelling a campaign ends its pledges the same way")
    void cancellingACampaignEndsItsPledgesTheSameWay() {
        Account creator = account("canc-creator");
        UUID project = project(creator);
        UUID tier = reward(creator, project, "A boxed set", "25.00", 5);
        Campaigns.launch(dataSource, project);
        UUID pledge = draftPledge(project, account("canc-backer"), tier);

        ResponseEntity<Map<String, Object>> canceled = exchange(
                "/v1/projects/" + project + "/cancel",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("reason", "Our manufacturer withdrew."));
        relay.run();

        assertThat(canceled.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(canceled.getBody()).containsEntry("state", "CANCELED");
        assertThat(pledgeState(pledge)).isEqualTo("CANCELED_BY_PROJECT");
        assertThat(committed(tier)).isZero();
    }

    @Test
    @DisplayName("a pledge whose money has moved is left alone")
    void aPledgeWhoseMoneyHasMovedIsLeftAlone() {
        Account creator = account("susp-collected");
        UUID project = project(creator);
        UUID tier = reward(creator, project, "A boxed set", "25.00", 5);
        Campaigns.launch(dataSource, project);
        UUID pledge = paidPledge(project, account("susp-collected-backer"), tier);

        suspend(project, moderator(), "Counterfeit product photographs.");
        relay.run();

        assertThat(pledgeState(pledge))
                .as("cancelling a collected pledge would say the money was never taken; that is a refund (#67)")
                .isEqualTo("COLLECTED");
    }

    @Test
    @DisplayName("a second delivery ends nothing twice")
    void aSecondDeliveryEndsNothingTwice() {
        Account creator = account("susp-redeliver");
        UUID project = project(creator);
        UUID tier = reward(creator, project, "A boxed set", "25.00", 5);
        Campaigns.launch(dataSource, project);
        UUID pledge = draftPledge(project, account("susp-redeliver-backer"), tier);

        suspend(project, moderator(), "Counterfeit product photographs.");
        relay.run();

        // At-least-once is OutboxMessage's stated contract. Re-dispatching the event
        // must not release the place a second time and take the tier's count negative.
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE outbox_events SET state = 'PENDING', published_at = NULL, next_attempt_at = now()"
                                + " WHERE aggregate_id = ?",
                        project);
        relay.run();

        assertThat(pledgeState(pledge)).isEqualTo("CANCELED_BY_PROJECT");
        assertThat(committed(tier)).isZero();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account(String prefix) {
        return signIn(EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com"), "Test Person");
    }

    /**
     * The one account this suite's configuration treats as platform staff.
     *
     * <p><strong>Its token is minted rather than signed in for</strong>, exactly as
     * {@code ContentReportApiTests} does and for the reason that file argues at length:
     * one address is configured as a moderator, several suites share it, and
     * {@code sign-ins-per-email} is deliberately left at its real value of five — so a
     * suite that signs in as that address spends one of those five and makes
     * <em>somebody else's</em> moderation tests fail with a 401 that has nothing to do
     * with them. This suite learned that the same way.
     *
     * <p>The account is still registered through the endpoint when it is not already
     * there, so this works whichever suite JUnit happens to run first.
     */
    private Account moderator() {
        if (moderator != null) {
            return moderator;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        // A session identifier of its own, as a real sign-in would have. Nothing reads
        // it here -- the filter chain is stateless -- and inventing one is still better
        // than reusing the account's.
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        moderator = new Account(accessToken, id);
        return moderator;
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
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private UUID project(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign that may be stopped " + SEQUENCE.incrementAndGet()));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID liveCampaign(Account creator) {
        UUID project = project(creator);
        Campaigns.launch(dataSource, project);
        return project;
    }

    private UUID reward(Account creator, UUID project, String title, String price, int limit) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("description", "Something to receive.");
        body.put("price", Map.of("amount", price, "currency", "AZN"));
        body.put("shippingType", "NONE");
        body.put("limitQuantity", limit);

        ResponseEntity<Map<String, Object>> created =
                exchange("/v1/projects/" + project + "/rewards", HttpMethod.POST, creator.accessToken(), body);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID draftPledge(UUID project, Account backer, UUID tier) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", project.toString());
        body.put("rewardTierId", tier.toString());
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));

        HttpHeaders headers = bearer(backer.accessToken());
        headers.set("Idempotency-Key", UUID.randomUUID().toString());
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/pledges/draft",
                HttpMethod.POST,
                new HttpEntity<>(body, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID paidPledge(UUID project, Account backer, UUID tier) {
        UUID pledge = draftPledge(project, backer, tier);
        Pledges.payDraft(dataSource, pledge);
        return pledge;
    }

    private ResponseEntity<Map<String, Object>> suspend(UUID project, Account caller, String reason) {
        return exchange(
                "/v1/admin/projects/" + project + "/suspend",
                HttpMethod.POST,
                caller.accessToken(),
                Map.of("reason", reason));
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private List<AuditEntry> auditRows(UUID project, AuditAction action) {
        return auditEntries.findAll().stream()
                .filter(entry -> entry.getAction().equals(action.action()))
                .filter(entry -> project.equals(entry.getEntityId()))
                .toList();
    }

    private String state(UUID project) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT state FROM projects WHERE id = ?", String.class, project);
    }

    private String pledgeState(UUID pledge) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledge);
    }

    /** Reserved plus claimed: what the tier has promised, whichever column holds it. */
    private int committed(UUID tier) {
        Integer value = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT claimed_quantity + reserved_quantity FROM reward_tiers WHERE id = ?",
                        Integer.class,
                        tier);
        return value == null ? 0 : value;
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
