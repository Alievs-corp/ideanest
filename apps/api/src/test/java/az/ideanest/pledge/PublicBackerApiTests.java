package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
import tools.jackson.databind.ObjectMapper;
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
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The public backer counts, over HTTP. §4.4's header and Rewards tab.
 *
 * <p><strong>The counting rule is the substance of what this endpoint promises</strong>,
 * and three of these pin it:
 *
 * <ul>
 *   <li>{@link #anAnonymousBackerIsCountedLikeAnybodyElse()} — §4.5's PL-12 hides who,
 *       never how many. A count that excluded the people who asked not to be named
 *       would understate the campaign to everybody, including the creator reading their
 *       own page, and would turn a privacy preference into a funding penalty.
 *   <li>{@link #theLedgerKeepsTheBackerOnAnAnonymousPledge()} — the other half of the
 *       issue's sentence. §7.2 and §17.4 both require "pledge #123 was made by user X"
 *       to stay true, so it is asserted against the column rather than described in a
 *       comment.
 *   <li>{@link #anAnonymisedAccountKeepsItsPlaceInTheCount()} — §17.4 severs the
 *       identity and keeps the financial row, so closing an account does not retract
 *       the money it pledged.
 * </ul>
 *
 * <p>What a <em>named</em> backer would look like is not tested here, because this
 * endpoint publishes nobody: §4.4 makes backer data public only in aggregate, and
 * whether a campaign should list individuals is #209. The projection that would carry
 * them is exercised directly by {@code PublicBackerProjectionTests}.
 *
 * <p>Every read here is made without a bearer token, because that is what a visitor
 * has. A suite that authenticated would be testing a different endpoint from the one
 * the security matcher opens.
 */
class PublicBackerApiTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts these tests create; a counter, as elsewhere in this package. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    @AfterEach
    void clearCheckouts() {
        // In dependency order rather than by cascade, because this is the cleanup and
        // not the assertion -- PledgeSchemaTests is where the cascades are checked.
        //
        // outbox_events is first and is not a cascade at all: since #235 a confirmation
        // records `pledge.confirmed`, and V19 deliberately gives that table no foreign
        // key to the aggregate it describes, so nothing else here removes the row. See
        // PledgeApiTests for the suite that fails when they are left behind.
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM pledge_addons");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM idempotency_keys");
        jdbc().update("DELETE FROM shipping_rules");
        jdbc().update("DELETE FROM reward_tiers");
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
    }

    // -----------------------------------------------------------------------
    // PL-12
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("an anonymous backer is counted like anybody else")
    void anAnonymousBackerIsCountedLikeAnybodyElse() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00");
        Campaigns.launch(dataSource, projectId);

        back(account("open"), projectId, rewardId, "45.00", false);
        back(account("hidden"), projectId, rewardId, "45.00", true);

        Map<String, Object> body = parse(publicBackers(projectId));

        // Both halves in one body: the count is two, and there is nowhere in it for a
        // name to be. A count of one would be an implementation that read PL-12 as
        // "hide the backer" rather than "hide who the backer is".
        assertThat(body.get("backerCount")).isEqualTo(2);
        assertThat(body).containsOnlyKeys("backerCount", "rewardTiers");
        assertThat(body.toString()).doesNotContain("Test hidden");
        assertThat(body.toString()).doesNotContain("Test open");
    }

    @Test
    @DisplayName("the ledger keeps the backer on an anonymous pledge")
    void theLedgerKeepsTheBackerOnAnAnonymousPledge() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account hidden = account("hidden");
        UUID pledgeId = back(hidden, projectId, null, "25.00", true);

        // §7.2 and §17.4: "pledge #123 was made by user X" has to stay true, because
        // every financial row referring to users.id is retained and the alternative
        // breaks the ledger. Anonymity is a rendering decision on the way out; it is
        // emphatically not a redaction of the row.
        assertThat(jdbc().queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, pledgeId))
                .isEqualTo(hidden.id());
        assertThat(jdbc().queryForObject("SELECT is_anonymous FROM pledges WHERE id = ?", Boolean.class, pledgeId))
                .isTrue();
    }

    @Test
    @DisplayName("an anonymised account keeps its place in the count")
    void anAnonymisedAccountKeepsItsPlaceInTheCount() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account leaving = account("leaving");
        back(leaving, projectId, null, "25.00", false);
        assertThat(parse(publicBackers(projectId)).get("backerCount")).isEqualTo(1);

        // What §17.4's anonymisation leaves behind: the pledge row intact, and an
        // account no finder in the user module will return. Written directly rather
        // than driven through the deletion endpoint and the job, because the grace
        // period is thirty days and this suite is about what the campaign page shows
        // afterwards. Every check constraint still applies, which is why the request
        // that the anonymisation follows is stamped too, thirty days before the date it
        // came due -- users_deletion_request_is_complete,
        // users_deletion_is_scheduled_after_request, users_anonymisation_follows_a_request
        // and users_anonymisation_implies_deletion together are what makes this a row
        // the application could have produced rather than one only a test can write.
        jdbc().update(
                        """
                        UPDATE users
                           SET deletion_requested_at = now() - interval '31 days',
                               deletion_scheduled_at = now() - interval '1 day',
                               anonymised_at = now(),
                               deleted_at = now()
                         WHERE id = ?
                        """,
                        leaving.id());

        // Still a backer -- closing an account does not retract the money it pledged,
        // and the campaign's total is not a count of people who still have accounts.
        assertThat(parse(publicBackers(projectId)).get("backerCount")).isEqualTo(1);
    }

    // -----------------------------------------------------------------------
    // What counts as a backing
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a draft that has not been confirmed is not yet a backing")
    void aDraftIsNotYetABacking() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00");
        Campaigns.launch(dataSource, projectId);

        // Drafted and deliberately not confirmed: a reservation with a five-minute
        // life (PL-13), not a commitment.
        draft(account("browsing"), projectId, rewardId, "45.00", false);

        Map<String, Object> body = parse(publicBackers(projectId));

        // Counting it would make the public number rise every time somebody opened a
        // checkout and fall again when they wandered off.
        assertThat(body.get("backerCount")).isEqualTo(0);
        assertThat(rewardTiers(body)).isEmpty();
    }

    @Test
    @DisplayName("the campaign's count is not the sum of its tiers, because a pledge may take no reward")
    void theCampaignsCountIsNotTheSumOfItsTiers() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00");
        Campaigns.launch(dataSource, projectId);

        back(account("open"), projectId, rewardId, "45.00", false);
        back(account("hidden"), projectId, rewardId, "45.00", true);
        // §4.5's PL-02: support with no reward. Counted on the campaign, and belonging
        // to no tier.
        back(account("supporter"), projectId, null, "10.00", false);

        Map<String, Object> body = parse(publicBackers(projectId));

        // Three on the campaign and two on the tier. This is why the header's count is
        // its own query rather than a sum of the Rewards tab: deriving it would drop
        // every backer who gave without taking anything.
        assertThat(body.get("backerCount")).isEqualTo(3);
        // §4.4's Rewards tab, and the anonymous backer is in it -- an aggregate says
        // "this tier is popular" without saying it about anybody.
        assertThat(rewardTiers(body)).containsExactly(Map.of("rewardTierId", rewardId.toString(), "backerCount", 2));
    }

    // -----------------------------------------------------------------------
    // The endpoint
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the counts are public, and a campaign that is not public is answered as one that does not exist")
    void theCountsArePublicAndHideTheCampaignsNobodyMayRead() {
        Account creator = account("creator");
        UUID projectId = project(creator);

        // Still a DRAFT campaign: it has a public page for nobody.
        ResponseEntity<String> hidden = publicBackers(projectId);
        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        // 404 and not 403. This endpoint takes no credential, so a 403 would be an
        // oracle any stranger could ask about what somebody is still preparing.
        assertThat(parse(hidden).get("code")).isEqualTo("PROJECT_NOT_FOUND");

        Campaigns.launch(dataSource, projectId);
        // No bearer token anywhere in this suite: a visitor deciding whether to
        // register is the audience the matcher opens this for.
        assertThat(publicBackers(projectId).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("the response carries an ETag and revalidates to 304")
    void theResponseRevalidates() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);
        back(account("open"), projectId, null, "25.00", false);

        ResponseEntity<String> first = publicBackers(projectId);
        String etag = first.getHeaders().getETag();
        assertThat(etag).isNotNull();
        // §10.3 asks for both on a public read. This body is two integers and a list of
        // integers, so there is nothing in it a shared cache should not hold.
        assertThat(first.getHeaders().getCacheControl()).contains("public").contains("max-age=60");

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<String> revalidated = rest.exchange(
                "/v1/projects/" + projectId + "/backers/public",
                HttpMethod.GET,
                new HttpEntity<>(conditional),
                String.class);

        assertThat(revalidated.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        // The policy survives the revalidation. A 304 that dropped it would leave a
        // cache deciding for itself how long the stored body stays fresh.
        assertThat(revalidated.getHeaders().getCacheControl()).contains("max-age=60");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Account(String accessToken, UUID id) {
    }

    private Account account(String role) {
        String marker = role + "-" + SEQUENCE.incrementAndGet();
        String email = marker + "@example.com";

        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email, "password", PASSWORD, "name", "Test " + role),
                String.class);

        Map<String, Object> signedIn = parse(rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                String.class));

        UUID id = jdbc().queryForObject("SELECT id FROM users WHERE email = ?::citext", UUID.class, email);
        return new Account((String) signedIn.get("accessToken"), id);
    }

    private UUID project(Account creator) {
        return id(parse(post("/v1/projects", creator, null, Map.of("title", "A campaign"))));
    }

    /** A reward tier, before the campaign launches — §5.3 freezes the price once it is live. */
    private UUID reward(Account creator, UUID projectId, String title, String price) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("price", Map.of("amount", price, "currency", "AZN"));
        return id(parse(post("/v1/projects/" + projectId + "/rewards", creator, null, body)));
    }

    /**
     * A backer, through §4.5's draft and then confirmed.
     *
     * <p>The draft through HTTP rather than by writing the row, because the property under
     * test is that the flag a client sends to {@code POST /v1/pledges/draft} is the flag
     * these counts are taken over — a fixture that wrote {@code is_anonymous} itself
     * would prove the count works on data the application never produced. The payment is
     * written by hand, because no provider runs in this suite.
     */
    private UUID back(Account backer, UUID projectId, UUID rewardTierId, String contribution, boolean anonymous) {
        UUID pledgeId = draft(backer, projectId, rewardTierId, contribution, anonymous);
        Pledges.payDraft(dataSource, pledgeId);
        return pledgeId;
    }

    private UUID draft(Account backer, UUID projectId, UUID rewardTierId, String contribution, boolean anonymous) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        if (rewardTierId != null) {
            body.put("rewardTierId", rewardTierId.toString());
        }
        body.put("contribution", Map.of("amount", contribution, "currency", "AZN"));
        body.put("isAnonymous", anonymous);

        ResponseEntity<String> created = post("/v1/pledges/draft", backer, newKey(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return id(parse(created));
    }

    /** A fresh {@code Idempotency-Key}. §10.3 makes it a UUID. */
    private static String newKey() {
        return UUID.randomUUID().toString();
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    /** Deliberately without a bearer token. This endpoint has no caller to establish. */
    private ResponseEntity<String> publicBackers(UUID projectId) {
        return rest.getForEntity("/v1/projects/" + projectId + "/backers/public", String.class);
    }

    private ResponseEntity<String> post(String path, Account account, String idempotencyKey, Object body) {
        HttpHeaders headers = bearer(account.accessToken());
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
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

    // -----------------------------------------------------------------------
    // Readings
    // -----------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(ResponseEntity<String> response) {
        try {
            return json.readValue(response.getBody(), Map.class);
        } catch (Exception e) {
            throw new IllegalStateException("Not a JSON object: " + response.getBody(), e);
        }
    }

    private static UUID id(Map<String, Object> resource) {
        return UUID.fromString((String) resource.get("id"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rewardTiers(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("rewardTiers");
    }
}
