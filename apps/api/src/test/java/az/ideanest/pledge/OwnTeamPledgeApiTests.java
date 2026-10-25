package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
import az.ideanest.support.RecordingCollaboratorInvitationNotifier;
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
 * #575: a campaign's own team may not pledge to it.
 *
 * <p>What the rule protects is §6.1's two thresholds read off {@code pledged_amount} — 80% to
 * withdraw early, 50% to extend — which a creator could otherwise reach with their own card.
 * So the assertions that matter are the ones that show nothing was counted: no pledge row and
 * no place held after a refused draft, and the total untouched after a refused raise.
 *
 * <p>Each refusal is also checked against the account it must <em>not</em> catch. A rule that
 * refused everybody would pass every "the creator is refused" assertion in this file, so an
 * ordinary backer, and a collaborator whose grant was revoked, pledge to the same campaign in
 * the same test.
 */
class OwnTeamPledgeApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private RecordingCollaboratorInvitationNotifier invitations;

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }

    @AfterEach
    void clear() {
        // PledgeApiTests' order, with the grants before the campaigns they belong to. Audit rows
        // from the invitations stay: audit_logs refuses DELETE.
        jdbc().update("DELETE FROM outbox_events");
        // Nothing here should have written a raise or a supplement — the tests assert as much —
        // and a regression that did would otherwise fail the cleanup instead of the test.
        jdbc().update("DELETE FROM pledge_raise_lines");
        jdbc().update("DELETE FROM pledge_raises");
        jdbc().update("DELETE FROM supplement_addons");
        jdbc().update("DELETE FROM pledge_supplements");
        jdbc().update("DELETE FROM pledge_addons");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM idempotency_keys");
        jdbc().update("DELETE FROM reward_tiers");
        jdbc().update("DELETE FROM collaborators");
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
        invitations.clear();
    }

    // ------------------------------------------------------------------
    // The draft
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the creator cannot draft a pledge to their own campaign, and nothing is held for them")
    void theCreatorIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId);
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<Map<String, Object>> refused = draft(creator, projectId, rewardId);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "OWN_PROJECT_PLEDGE");
        // Refused before the reservation, so there is no place to give back and no draft for the
        // sweep to find: the stock is as the creator left it.
        assertThat(pledgesOn(projectId)).isZero();
        assertThat(reserved(rewardId)).isZero();

        // And the campaign takes pledges from everybody else exactly as before.
        assertThat(draft(account("backer"), projectId, rewardId).getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(reserved(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("an active collaborator cannot draft a pledge either, whatever they were granted")
    void anActiveCollaboratorIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId);
        // A grant with nothing to do with money. The rule is about being on the team, not about
        // what the grant allows: it is the creator's interest a self-pledge serves.
        Account collaborator = collaborator(projectId, creator, "RESPOND_TO_COMMENTS");
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<Map<String, Object>> refused = draft(collaborator, projectId, rewardId);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "OWN_PROJECT_PLEDGE");
        assertThat(pledgesOn(projectId)).isZero();
        assertThat(reserved(rewardId)).isZero();
    }

    @Test
    @DisplayName("a revoked collaborator is a backer like anybody else again")
    void aRevokedCollaboratorMayPledge() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId);
        Account former = collaborator(projectId, creator, "EDIT_STORY");
        Campaigns.launch(dataSource, projectId);

        UUID grantId = jdbc().queryForObject(
                "SELECT id FROM collaborators WHERE project_id = ? AND account_id = ?", UUID.class, projectId, former.id());
        assertThat(rest.exchange(
                                "/v1/collaborators/" + grantId,
                                HttpMethod.DELETE,
                                new HttpEntity<>(bearer(creator.accessToken())),
                                String.class)
                        .getStatusCode()
                        .is2xxSuccessful())
                .isTrue();

        // ProjectAccess's line: a revoked grant is a stranger, for this question as for every other.
        assertThat(draft(former, projectId, rewardId).getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    @Test
    @DisplayName("a campaign that is not taking pledges is still answered as before, to its creator too")
    void theCampaignIsAskedFirst() {
        Account creator = account("creator");
        UUID unlaunched = project(creator);

        // A draft campaign is a 404 to everybody, its creator included: the team check comes after
        // the campaign's and does not turn "there is nothing here" into "you work here".
        ResponseEntity<Map<String, Object>> refused = draft(creator, unlaunched, null);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // Joining the team after pledging
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a draft taken before joining the team cannot be paid for after joining it")
    void aDraftCannotBePaidAfterJoining() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId);
        Campaigns.launch(dataSource, projectId);

        EmailAddress email = nextEmail("joiner");
        Account joiner = account(email);
        ResponseEntity<Map<String, Object>> drafted = draft(joiner, projectId, rewardId);
        assertThat(drafted.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        UUID pledgeId = UUID.fromString((String) drafted.getBody().get("id"));

        join(projectId, creator, joiner, email, "VIEW_FINANCES");

        // The payment is what would count the pledge, so it is the payment that asks again.
        ResponseEntity<Map<String, Object>> refused =
                post(joiner, "/v1/pledges/" + pledgeId + "/payment", newKey(), Map.of("language", "en"));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "OWN_PROJECT_PLEDGE");
        assertThat(stateOf(pledgeId)).isEqualTo("DRAFT");

        // And they can still let go of the place they hold: abandoning a checkout moves no money.
        assertThat(rest.exchange(
                                "/v1/pledges/" + pledgeId,
                                HttpMethod.DELETE,
                                new HttpEntity<>(headers(joiner, newKey())),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(reserved(rewardId)).isZero();
    }

    @Test
    @DisplayName("a paid pledge cannot be raised once its backer has joined the team")
    void aPaidPledgeCannotBeRaisedAfterJoining() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        EmailAddress email = nextEmail("joiner");
        Account joiner = account(email);
        UUID pledgeId = Pledges.confirmedFor(dataSource, projectId, joiner.id(), "25.00");
        join(projectId, creator, joiner, email, "EDIT_REWARDS");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contribution", azn("40.00"));
        body.put("expectedAmount", azn("15.00"));
        body.put("language", "en");
        body.put("successUrl", "https://ideanest.az/en/pledges/" + pledgeId + "?payment=returned");
        ResponseEntity<Map<String, Object>> refused = post(joiner, "/v1/pledges/" + pledgeId + "/raise", newKey(), body);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "OWN_PROJECT_PLEDGE");
        assertThat(jdbc().queryForObject("SELECT count(*) FROM pledge_raises WHERE pledge_id = ?", Integer.class, pledgeId))
                .isZero();
    }

    @Test
    @DisplayName("the pledge manager refuses the team too, after the campaign closed")
    void thePledgeManagerRefusesTheTeam() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID addonId = reward(creator, projectId, true);
        Campaigns.launch(dataSource, projectId);

        EmailAddress email = nextEmail("joiner");
        Account joiner = account(email);
        UUID pledgeId = Pledges.confirmedFor(dataSource, projectId, joiner.id(), "25.00");
        join(projectId, creator, joiner, email, "EDIT_REWARDS");
        jdbc().update(
                """
                UPDATE projects
                   SET state = 'SUCCESSFUL',
                       launched_at = now() - interval '31 days',
                       deadline = now() - interval '1 day'
                 WHERE id = ?
                """,
                projectId);

        ResponseEntity<Map<String, Object>> refused = post(
                joiner,
                "/v1/pledges/" + pledgeId + "/addons",
                newKey(),
                Map.of("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 1))));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "OWN_PROJECT_PLEDGE");
        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM pledge_supplements WHERE pledge_id = ?", Integer.class, pledgeId))
                .isZero();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private static EmailAddress nextEmail(String prefix) {
        return EmailAddress.of("own-team-" + prefix + "-" + SEQUENCE.incrementAndGet() + "@example.com");
    }

    private Account account(String prefix) {
        return account(nextEmail(prefix));
    }

    private Account account(EmailAddress email) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                OBJECT);

        UUID id = jdbc().queryForObject("SELECT id FROM users WHERE email = ?::citext", UUID.class, email.value());
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private UUID project(Account creator) {
        ResponseEntity<Map<String, Object>> created =
                post(creator, "/v1/projects", null, Map.of("title", "A campaign " + SEQUENCE.incrementAndGet()));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID reward(Account creator, UUID projectId) {
        return reward(creator, projectId, false);
    }

    /** A tier with ten places, before launch, for §5.3's reason given in {@code PledgeApiTests}. */
    private UUID reward(Account creator, UUID projectId, boolean isAddon) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", isAddon ? "A mug" : "A boxed set");
        body.put("description", "Something to receive.");
        body.put("price", azn(isAddon ? "10.00" : "25.00"));
        body.put("shippingType", "NONE");
        body.put("isAddon", isAddon);
        body.put("limitQuantity", 10);
        ResponseEntity<Map<String, Object>> created = post(creator, "/v1/projects/" + projectId + "/rewards", null, body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** An accepted grant conferring exactly the capabilities named, for a new account. */
    private Account collaborator(UUID projectId, Account creator, String... capabilities) {
        EmailAddress email = nextEmail("collaborator");
        Account invitee = account(email);
        join(projectId, creator, invitee, email, capabilities);
        return invitee;
    }

    /** Invites an existing account onto the team and accepts on its behalf. */
    private void join(UUID projectId, Account creator, Account invitee, EmailAddress email, String... capabilities) {
        ResponseEntity<Map<String, Object>> invited = post(
                creator,
                "/v1/projects/" + projectId + "/collaborators",
                null,
                Map.of("email", email.value(), "capabilities", List.of(capabilities)));
        assertThat(invited.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        String token = invitations.tokenSentTo(email).orElseThrow();
        assertThat(post(invitee, "/v1/collaborators/invitations/" + token + "/accept", null, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    private ResponseEntity<Map<String, Object>> draft(Account backer, UUID projectId, UUID rewardTierId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        if (rewardTierId != null) {
            body.put("rewardTierId", rewardTierId.toString());
        }
        body.put("contribution", azn("25.00"));
        return post(backer, "/v1/pledges/draft", newKey(), body);
    }

    private static Map<String, Object> azn(String amount) {
        return Map.of("amount", amount, "currency", "AZN");
    }

    private static String newKey() {
        return UUID.randomUUID().toString();
    }

    private ResponseEntity<Map<String, Object>> post(Account caller, String path, String key, Object body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers(caller, key)), OBJECT);
    }

    private static HttpHeaders headers(Account caller, String key) {
        HttpHeaders headers = bearer(caller.accessToken());
        if (key != null) {
            headers.set("Idempotency-Key", key);
        }
        return headers;
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

    private int pledgesOn(UUID projectId) {
        return jdbc().queryForObject("SELECT count(*) FROM pledges WHERE project_id = ?", Integer.class, projectId);
    }

    private int reserved(UUID rewardTierId) {
        return jdbc().queryForObject(
                "SELECT reserved_quantity FROM reward_tiers WHERE id = ?", Integer.class, rewardTierId);
    }

    private String stateOf(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }
}
