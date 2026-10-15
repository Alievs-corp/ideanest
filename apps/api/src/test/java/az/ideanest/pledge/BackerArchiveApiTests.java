package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.math.BigDecimal;
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
import tools.jackson.databind.ObjectMapper;

/**
 * What somebody has backed, over HTTP — §4.2's P-04 archive and §4.8's own pledge list.
 *
 * <p><strong>Two endpoints over one table, and everything that differs between them is a
 * privacy rule.</strong> Each of them is asserted here rather than described:
 *
 * <ul>
 *   <li>{@link #theArchiveNamesCampaignsAndNeverAnAmount()} — P-04 makes the backed tab a
 *       list of campaigns. How much somebody gave is between them, the creator and the
 *       platform, and a profile that published it would let anyone who could guess a slug
 *       read a stranger's spending. Asserted against the response text, because the failure
 *       this guards against is a field appearing somewhere nobody thought to look.
 *   <li>{@link #anAnonymousPledgeIsAbsentFromTheArchive()} — §4.5's PL-12. A backer who
 *       asked not to be named on a campaign has not agreed to be named on their own profile
 *       instead, which is the same fact one link away.
 *   <li>{@link #aCampaignTheProfileMayNotShowIsAbsent()} — §6.1's nine, applied to a list
 *       the pledge module pages and the project module filters. The card is dropped and the
 *       page is not backfilled, which is the visible consequence of paging over pledges.
 *   <li>{@link #myPledgesAreOnlyEverMine()} — the other list carries every amount, so the
 *       account it is keyed on comes from the token and from nowhere else.
 * </ul>
 */
class BackerArchiveApiTests extends AbstractIntegrationTest {

    /**
     * What this class's fixture accounts are called, so that they cannot be another
     * suite's. See {@link #account(String)} for what goes wrong without it.
     */
    private static final String HANDLE_PREFIX = "archive-";

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
        // In dependency order rather than by cascade, because this is the cleanup and not
        // the assertion -- PledgeSchemaTests is where the cascades are checked.
        jdbc().update("DELETE FROM pledge_addons");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM reward_tiers");
        Campaigns.clear(dataSource);
    }

    // -----------------------------------------------------------------------
    // §4.2's P-04, and §4.5's PL-12
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the archive names the campaign and never an amount")
    void theArchiveNamesCampaignsAndNeverAnAmount() {
        UUID creator = account("creator");
        UUID project = Campaigns.seed(dataSource, creator, "a-boxed-set")
                .state("LIVE")
                .title("A boxed set")
                .insert();
        UUID backer = account("open");
        confirmed(project, backer, "137.00", null, false);

        ResponseEntity<String> response = backed(slugOf(backer), null, null);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        List<Map<String, Object>> cards = cards(parse(response));
        assertThat(cards).hasSize(1);
        assertThat(cards.get(0).get("slug")).isEqualTo("a-boxed-set");
        assertThat(cards.get(0).get("title")).isEqualTo("A boxed set");

        // Not "there is no `amounts` key" -- the whole body, because the failure this
        // guards against is somebody's contribution appearing on a public page under a
        // field name nobody thought to check for.
        assertThat(response.getBody()).doesNotContain("137.00");
        // And the shape is the created tab's, exactly. One grid on one page: a reader
        // switching tabs must not find the cover image called something else.
        assertThat(cards.get(0))
                .containsOnlyKeys(
                        "id",
                        "title",
                        "slug",
                        "creatorSlug",
                        "blurb",
                        "state",
                        "goal",
                        "pledged",
                        "backersCount",
                        "deadline",
                        "launchedAt",
                        "coverImage");
    }

    @Test
    @DisplayName("an anonymous pledge is absent from the archive, and the pledge row still names its backer")
    void anAnonymousPledgeIsAbsentFromTheArchive() {
        UUID creator = account("creator");
        UUID open = Campaigns.seed(dataSource, creator, "named-one").state("LIVE").insert();
        UUID hidden = Campaigns.seed(dataSource, creator, "hidden-one").state("LIVE").insert();

        UUID backer = account("mixed");
        confirmed(open, backer, "20.00", null, false);
        UUID anonymousPledge = confirmed(hidden, backer, "20.00", null, true);

        List<Map<String, Object>> cards = cards(parse(backed(slugOf(backer), null, null)));

        // PL-12 hides who, and this is the surface where "who" is the page itself.
        assertThat(cards.stream().map(card -> card.get("slug")).toList()).containsExactly("named-one");

        // And the ledger keeps the backer, which is §7.2 and §17.4: "pledge #123 was made by
        // user X" has to stay true. Anonymity is a decision about what is rendered, never a
        // redaction of the row.
        assertThat(jdbc().queryForObject("SELECT backer_id FROM pledges WHERE id = ?", UUID.class, anonymousPledge))
                .isEqualTo(backer);
    }

    @Test
    @DisplayName("a draft is a reservation, not yet a backing")
    void aDraftIsNotYetABacking() {
        UUID creator = account("creator");
        UUID project = Campaigns.seed(dataSource, creator, "browsed-one").state("LIVE").insert();
        UUID backer = account("browsing");
        pledge(project, backer, "DRAFT", "45.00", null, false);

        // §4.5's PL-13 gives a draft five minutes. An archive that counted one would list a
        // campaign somebody opened a checkout on and wandered away from.
        assertThat(cards(parse(backed(slugOf(backer), null, null)))).isEmpty();
    }

    @Test
    @DisplayName("a campaign the public may not see is absent, and the page is not backfilled")
    void aCampaignTheProfileMayNotShowIsAbsent() {
        UUID creator = account("creator");
        UUID live = Campaigns.seed(dataSource, creator, "still-live").state("LIVE").insert();
        UUID stopped = Campaigns.seed(dataSource, creator, "stopped-one").state("SUSPENDED").insert();

        UUID backer = account("unlucky");
        confirmed(live, backer, "10.00", null, false);
        confirmed(stopped, backer, "10.00", null, false);

        List<Map<String, Object>> cards = cards(parse(backed(slugOf(backer), null, null)));

        // Trust and safety stopped it, frequently while an investigation is open, and the
        // campaign's own page answers 404. An archive that named it would publish through a
        // profile what the campaign page withholds.
        assertThat(cards.stream().map(card -> card.get("slug")).toList()).containsExactly("still-live");
    }

    @Test
    @DisplayName("a private profile has no backed tab, and says so the way the profile itself does")
    void aPrivateProfileHasNoBackedTab() {
        UUID creator = account("creator");
        UUID project = Campaigns.seed(dataSource, creator, "backed-one").state("LIVE").insert();
        UUID backer = account("withdrawn");
        confirmed(project, backer, "15.00", null, false);
        assertThat(backed(slugOf(backer), null, null).getStatusCode()).isEqualTo(HttpStatus.OK);

        jdbc().update("UPDATE users SET profile_visibility = 'PRIVATE' WHERE id = ?", backer);

        ResponseEntity<String> hidden = backed(slugOf(backer), null, null);
        ResponseEntity<String> absent = backed("nobody-is-called-this-" + SEQUENCE.incrementAndGet(), null, null);

        // The two against each other, as in the profile's own suite: any difference confirms
        // that a particular person has an account here and has chosen to hide it.
        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(hidden.getStatusCode()).isEqualTo(absent.getStatusCode());
        assertThat(withoutInstance(hidden)).isEqualTo(withoutInstance(absent));
        assertThat(parse(hidden).get("code")).isEqualTo("USER_NOT_FOUND");
    }

    @Test
    @DisplayName("somebody who has backed nothing has an empty tab rather than no profile")
    void anEmptyArchiveIsNotA404() {
        UUID backer = account("watching");

        Map<String, Object> body = parse(backed(slugOf(backer), null, null));

        // Answering 404 here would turn "I have backed nothing" and "every pledge I made was
        // anonymous" into statements about what somebody chose to hide.
        assertThat(cards(body)).isEmpty();
        assertThat(body.get("nextCursor")).isNull();
    }

    @Test
    @DisplayName("the archive pages on a cursor")
    void theArchivePagesOnACursor() {
        UUID creator = account("creator");
        UUID backer = account("busy");
        for (int index = 1; index <= 3; index++) {
            UUID project = Campaigns.seed(dataSource, creator, "campaign-" + index)
                    .state("LIVE")
                    .insert();
            confirmed(project, backer, "10.00", null, false);
        }

        Map<String, Object> firstPage = parse(backed(slugOf(backer), null, 2));
        assertThat(cards(firstPage)).hasSize(2);
        String cursor = (String) firstPage.get("nextCursor");
        assertThat(cursor).isNotNull();

        Map<String, Object> secondPage = parse(backed(slugOf(backer), cursor, 2));
        assertThat(cards(secondPage)).hasSize(1);
        assertThat(secondPage.get("nextCursor")).isNull();
        assertThat(slugsOf(cards(firstPage))).doesNotContainAnyElementsOf(slugsOf(cards(secondPage)));
    }

    // -----------------------------------------------------------------------
    // §4.8: the backer's own list
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("my pledges are only ever mine, and never anybody else's")
    void myPledgesAreOnlyEverMine() {
        UUID creator = account("creator");
        UUID project = Campaigns.seed(dataSource, creator, "shared-campaign")
                .state("LIVE")
                .insert();

        Account mine = registered("mine");
        Account theirs = registered("theirs");
        confirmed(project, mine.id(), "31.00", null, false);
        confirmed(project, theirs.id(), "72.00", null, false);

        String body = myPledges(mine, null, null).getBody();

        assertThat(rows(parse(myPledges(mine, null, null)))).hasSize(1);
        assertThat(body).contains("31.00");
        // The account comes from the signature we made and from nothing the caller could
        // choose. Asserted against the other backer's amount, because that is the value that
        // would appear if the endpoint ever took its account from a parameter.
        assertThat(body).doesNotContain("72.00");

        // And there is no unauthenticated form of it. This endpoint is not named in the
        // security configuration and falls through to the catch-all.
        assertThat(rest.getForEntity("/v1/me/pledges", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a row carries all six amounts, the tier's title, and the campaign")
    void aRowCarriesEveryAmountAndTheCampaign() {
        UUID creator = account("creator");
        UUID project = Campaigns.seed(dataSource, creator, "illustrated-one")
                .state("LIVE")
                .title("An illustrated edition")
                .insert();
        UUID tier = rewardTier(project, "The boxed set", "45.00");

        Account backer = registered("collector");
        confirmed(project, backer.id(), "45.00", tier, false);

        Map<String, Object> row = rows(parse(myPledges(backer, null, null))).get(0);

        assertThat(row.get("state")).isEqualTo("COLLECTED");
        assertThat(row.get("rewardTierId")).isEqualTo(tier.toString());
        // From the reward module rather than from a join: reward_tiers is that module's
        // table, and a list showing "b1f2-..." beside a pledge is a list nobody can use.
        assertThat(row.get("rewardTitle")).isEqualTo("The boxed set");

        // All six, always. A response carrying only the total is one a backer cannot
        // reconcile and a support agent cannot explain -- and every one is a string.
        assertThat(amounts(row))
                .containsOnlyKeys("base", "addons", "bonus", "shipping", "tax", "total");
        assertThat(amounts(row).get("base")).isEqualTo(Map.of("amount", "45.00", "currency", "AZN"));
        assertThat(amounts(row).get("total")).isEqualTo(Map.of("amount", "45.00", "currency", "AZN"));

        Map<String, Object> campaign = campaign(row);
        assertThat(campaign.get("title")).isEqualTo("An illustrated edition");
        assertThat(campaign.get("slug")).isEqualTo("illustrated-one");
        // Both halves of the public path, because one of them alone addresses nothing.
        assertThat(campaign.get("creatorSlug")).isEqualTo(slugOf(creator));
        // Deliberately less than the profile card: this is a line beside somebody's own
        // pledge, and the campaign's funding total is one tap away on its own page.
        assertThat(campaign).containsOnlyKeys("id", "title", "slug", "creatorSlug", "state", "deadline", "coverImage");
    }

    @Test
    @DisplayName("my own list shows the pledge I cancelled, on a campaign the public can no longer see")
    void myOwnListShowsWhatThePublicListsCannot() {
        UUID creator = account("creator");
        UUID stopped = Campaigns.seed(dataSource, creator, "stopped-one").state("SUSPENDED").insert();

        Account backer = registered("affected");
        pledge(stopped, backer.id(), "CANCELED_BY_PROJECT", "60.00", null, false);

        Map<String, Object> row = rows(parse(myPledges(backer, null, null))).get(0);

        // Both halves of the argument in one row. A state filter would hide the pledge that
        // most needs explaining, and a campaign filter would leave it attached to nothing --
        // at the exact moment the backer needs to know which campaign it was.
        assertThat(row.get("state")).isEqualTo("CANCELED_BY_PROJECT");
        assertThat(campaign(row).get("state")).isEqualTo("SUSPENDED");
        assertThat(campaign(row).get("slug")).isEqualTo("stopped-one");
    }

    @Test
    @DisplayName("the caller's own pledge list is never stored by a cache")
    void myPledgesAreNeverStored() {
        Account backer = registered("private");

        HttpHeaders headers = myPledges(backer, null, null).getHeaders();

        // no-store and private. This body carries every amount one person has committed on
        // this platform, and "revalidate before reuse" would still let a shared proxy hold
        // it in the meantime.
        assertThat(headers.getCacheControl()).contains("no-store").contains("private");
        // And no validator: an ETag on a private list is a key a shared cache could hold it
        // by. §10.3 asks for one on a public read, which this is not.
        assertThat(headers.getETag()).isNull();
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** An account with no password, for everything the reads need. */
    /**
     * A fixture account with no password, under a handle only this class uses.
     *
     * <p><strong>The prefix is the whole point and it is not decoration.</strong>
     * {@code Campaigns.creator} inserts a {@code users} row and no
     * {@code user_credentials} row, {@code clearCheckouts} does not delete users, and the
     * `role + "-" + counter` convention is shared with {@code PledgeApiTests} and
     * {@code PublicBackerApiTests} — whose own counters also start at one. Without a
     * prefix this class registers {@code creator-1@example.com} first, those suites then
     * find the address taken, {@code RegistrationService} returns without creating a
     * credential, their sign-in answers 401, and their next call goes out with
     * {@code Authorization: Bearer null}. The failure surfaces as an empty response body
     * in a fixture three frames away from the cause, and only when the whole suite runs.
     */
    private UUID account(String role) {
        return Campaigns.creator(dataSource, HANDLE_PREFIX + role + "-" + SEQUENCE.incrementAndGet());
    }

    /** A registered, signed-in account: its token and its identifier. */
    private record Account(String accessToken, UUID id) {
    }

    private Account registered(String role) {
        // Prefixed for the reason `account` above gives at length: an address this class
        // takes first is an address another suite cannot register a password against.
        String email = HANDLE_PREFIX + role + "-" + SEQUENCE.incrementAndGet() + "@example.com";

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

    private String slugOf(UUID accountId) {
        return jdbc().queryForObject("SELECT slug FROM users WHERE id = ?", String.class, accountId);
    }

    private UUID rewardTier(UUID projectId, String title, String amount) {
        UUID id = UUID.randomUUID();
        jdbc().update(
                        "INSERT INTO reward_tiers (id, project_id, title, amount) VALUES (?, ?, ?, ?)",
                        id,
                        projectId,
                        title,
                        new BigDecimal(amount));
        return id;
    }

    private UUID confirmed(UUID projectId, UUID backerId, String amount, UUID rewardTierId, boolean anonymous) {
        return pledge(projectId, backerId, "COLLECTED", amount, rewardTierId, anonymous);
    }

    /**
     * A pledge written straight into the table, in whatever state a test needs.
     *
     * <p>{@code Pledges.confirmedFor} does not take the two columns these suites are about —
     * {@code is_anonymous} and {@code reward_tier_id} — and this is a read suite rather than
     * a checkout one: driving each fixture through draft-and-confirm would make every test
     * here depend on the reservation TTL, the rate limiter and an idempotency key, for a
     * state that is a precondition rather than a subject. Every check constraint on
     * {@code pledges} still applies, so the rows are ones the application could have written.
     */
    private UUID pledge(
            UUID projectId, UUID backerId, String state, String amount, UUID rewardTierId, boolean anonymous) {

        UUID pledgeId = UUID.randomUUID();
        jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, reward_tier_id, state,
                                             base_amount, currency, is_anonymous,
                                             reservation_expires_at, confirmed_at, canceled_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'AZN', ?,
                                -- pledges_drafts_are_time_bounded: a draft is a reservation
                                -- and a reservation without an expiry is not one.
                                CASE WHEN ? = 'DRAFT' THEN now() + interval '5 minutes' END,
                                CASE WHEN ? = 'DRAFT' THEN NULL ELSE now() END,
                                CASE WHEN ? LIKE 'CANCELED%' THEN now() END)
                        """,
                        pledgeId,
                        projectId,
                        backerId,
                        rewardTierId,
                        state,
                        new BigDecimal(amount),
                        anonymous,
                        state,
                        state,
                        state);
        return pledgeId;
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    /** Deliberately without a bearer token. The archive has no caller to establish. */
    private ResponseEntity<String> backed(String slug, String cursor, Integer limit) {
        StringBuilder path = new StringBuilder("/v1/users/").append(slug).append("/backed?");
        if (cursor != null) {
            path.append("cursor=").append(cursor).append('&');
        }
        if (limit != null) {
            path.append("limit=").append(limit);
        }
        return rest.getForEntity(path.toString(), String.class);
    }

    private ResponseEntity<String> myPledges(Account caller, String cursor, Integer limit) {
        StringBuilder path = new StringBuilder("/v1/me/pledges?");
        if (cursor != null) {
            path.append("cursor=").append(cursor).append('&');
        }
        if (limit != null) {
            path.append("limit=").append(limit);
        }
        return rest.exchange(
                path.toString(), HttpMethod.GET, new HttpEntity<>(bearer(caller.accessToken())), String.class);
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

    /**
     * A problem detail with RFC 9457's {@code instance} removed.
     *
     * <p><strong>Excluded on purpose, and it must stay excluded.</strong> {@code instance}
     * is the path that was asked for, so a private profile and an absent one differ in it
     * necessarily — they are different URLs. A stricter assertion would be demanding that
     * the response not say which request it is answering, which is neither true nor
     * desirable, and it would fail for a reason that has nothing to do with the property
     * under test. What must not differ is everything else: {@code status}, {@code type},
     * {@code title}, {@code detail} and {@code code}, because any of those differing is the
     * oracle these tests exist to prevent.
     */
    private Map<String, Object> withoutInstance(ResponseEntity<String> response) {
        Map<String, Object> body = new LinkedHashMap<>(parse(response));
        body.remove("instance");
        return body;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(ResponseEntity<String> response) {
        try {
            return json.readValue(response.getBody(), Map.class);
        } catch (Exception e) {
            throw new IllegalStateException("Not a JSON object: " + response.getBody(), e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> cards(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("projects");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("pledges");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> amounts(Map<String, Object> row) {
        return (Map<String, Object>) row.get("amounts");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> campaign(Map<String, Object> row) {
        return (Map<String, Object>) row.get("project");
    }

    private static List<Object> slugsOf(List<Map<String, Object>> cards) {
        return cards.stream().map(card -> card.get("slug")).toList();
    }
}
