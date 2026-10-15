package az.ideanest.admin;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
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
import org.springframework.http.ResponseEntity;

/**
 * What one account has backed — {@code GET /v1/admin/users/{id}/pledges}, issue #404.
 *
 * <h2>The context a suspension was being decided without</h2>
 *
 * <p>{@code /admin/users} listed accounts and offered one control per row: suspend. The
 * screen's own copy told a moderator that suspending somebody "changes nothing about the
 * campaigns they created or the pledges they made" — which is exactly the context needed to
 * decide — and there was no way to see either from anywhere in the console.
 *
 * <p>This endpoint is the pledges half. The campaigns half is the campaign directory's
 * {@code creatorId} filter, covered by {@code CampaignDirectoryApiTests}; the standing was
 * already served by {@code GET /v1/admin/users/{id}}, which #104 shipped and nothing called.
 *
 * <p>The tests that carry the design are
 * {@link #anAccountThatDoesNotExistIsNotFound()} — "has backed nothing" and "is not a person"
 * are different answers, and a moderator acting on the first when the second is true is
 * acting on a typo — and {@link #everyReadIsAudited()}, which is the only reason "who read
 * whose funding history" can be asked afterwards.
 */
class AdminUserPledgesApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static Account staffAccount;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clearCampaigns() {
        /*
         * The shared helper rather than deletes of this suite's own, which is what
         * `ConsoleReadApiTests` does two files over and for reasons worth repeating: campaigns
         * reference users without cascading, so rows left behind break the identity suites'
         * cleanup three frames from the cause — and `projects` has neighbours (curation events,
         * collections, non-Azerbaijani locations) that have to go first or in a particular
         * order. Pledges need no line of their own: V17 gives `pledges.project_id` an
         * `ON DELETE CASCADE`, so they go with the campaign they are on.
         */
        Campaigns.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // What it answers
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a moderator can see what an account has backed before deciding anything about it")
    void theListCarriesThePersonsPledges() {
        Account backer = account("pledges-list");
        UUID projectId = campaign("A campaign with a backer");
        Pledges.confirmedFor(dataSource, projectId, backer.id(), "45.00");

        List<Map<String, Object>> pledges = pledgesIn(read(backer.id(), ""));

        assertThat(pledges).hasSize(1);
        assertThat(pledges.get(0).get("pledgeId")).isNotNull();
        assertThat(pledges.get(0)).containsEntry("state", "COLLECTED");

        @SuppressWarnings("unchecked")
        Map<String, Object> campaign = (Map<String, Object>) pledges.get(0).get("project");
        // A row saying only "45,00 ₼, CONFIRMED" is a row nobody can act on. Which campaign
        // it was is the whole point of reading somebody's pledges before stopping them.
        assertThat(campaign).containsEntry("id", projectId.toString());
        assertThat(campaign).containsEntry("title", "A campaign with a backer");
    }

    @Test
    @DisplayName("the amount crosses as a string, never as a JSON number")
    void theAmountIsAString() {
        Account backer = account("pledges-money");
        UUID projectId = campaign("A campaign somebody backed");
        Pledges.confirmedFor(dataSource, projectId, backer.id(), "1234.50");

        @SuppressWarnings("unchecked")
        Map<String, Object> amounts = (Map<String, Object>) pledgesIn(read(backer.id(), ""))
                .get(0)
                .get("amounts");
        @SuppressWarnings("unchecked")
        Map<String, Object> total = (Map<String, Object>) amounts.get("total");

        // §10.3. A moderator reads this beside the payment log, and a figure that has been
        // through an IEEE 754 double eventually disagrees with it by a qapik.
        assertThat(total.get("amount")).isInstanceOf(String.class);
        assertThat(total).containsEntry("amount", "1234.50");
    }

    @Test
    @DisplayName("somebody else's pledges are not on this account's list")
    void oneAccountsPledgesAreItsOwn() {
        Account backer = account("pledges-mine");
        Account other = account("pledges-theirs");
        UUID projectId = campaign("One campaign, two backers");
        Pledges.confirmedFor(dataSource, projectId, backer.id(), "10.00");
        Pledges.confirmedFor(dataSource, projectId, other.id(), "20.00");

        assertThat(pledgesIn(read(backer.id(), ""))).hasSize(1);
        assertThat(pledgesIn(read(other.id(), ""))).hasSize(1);
    }

    @Test
    @DisplayName("an account that has backed nothing is an empty list rather than a refusal")
    void anAccountWithNoPledgesIsAnEmptyList() {
        Account backer = account("pledges-none");

        Map<String, Object> body = read(backer.id(), "");

        assertThat(pledgesIn(body)).isEmpty();
        assertThat(body.get("nextCursor")).isNull();
    }

    @Test
    @DisplayName("the list pages, and the second page continues rather than repeating")
    void theListPages() {
        Account backer = account("pledges-paging");
        UUID first = campaign("First campaign");
        UUID second = campaign("Second campaign");
        Pledges.confirmedFor(dataSource, first, backer.id(), "10.00");
        Pledges.confirmedFor(dataSource, second, backer.id(), "20.00");

        Map<String, Object> page = read(backer.id(), "?limit=1");
        assertThat(pledgesIn(page)).hasSize(1);
        assertThat(page.get("nextCursor")).isNotNull();

        Map<String, Object> next = read(backer.id(), "?limit=1&cursor=" + page.get("nextCursor"));
        assertThat(pledgesIn(next)).hasSize(1);
        assertThat(pledgesIn(next).get(0).get("pledgeId"))
                .as("the second page continues rather than repeating")
                .isNotEqualTo(pledgesIn(page).get(0).get("pledgeId"));
    }

    // ------------------------------------------------------------------
    // Who may read it, and what is recorded
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account that does not exist is a 404 rather than an empty list")
    void anAccountThatDoesNotExistIsNotFound() {
        ResponseEntity<Map<String, Object>> missing = get(path(UUID.randomUUID(), ""), staff().accessToken());

        // "Has backed nothing" and "is not a person" are different answers, and a moderator
        // acting on the first when the second is true is acting on a typo.
        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missing.getBody()).containsEntry("code", "ACCOUNT_NOT_FOUND");
    }

    @Test
    @DisplayName("an account that is not staff is refused its neighbour's funding history")
    void onlyStaffMayRead() {
        Account backer = account("pledges-subject");
        Account outsider = account("pledges-outsider");

        ResponseEntity<Map<String, Object>> refused = get(path(backer.id(), ""), outsider.accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("a request with no credentials at all is refused")
    void anonymousIsRefused() {
        Account backer = account("pledges-anonymous");

        assertThat(get(path(backer.id(), ""), null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("reading somebody's whole funding history writes a row saying who read it")
    void everyReadIsAudited() {
        Account backer = account("pledges-audited");
        UUID projectId = campaign("A campaign somebody backed");
        Pledges.confirmedFor(dataSource, projectId, backer.id(), "45.00");

        read(backer.id(), "");

        List<AuditEntry> recorded =
                auditEntries.findByEntityTypeAndEntityIdOrderByOccurredAtDesc("account", backer.id());

        // Recorded against the account rather than the reader, following ACCOUNTS_SEARCHED,
        // and the detail says which read it was — the trail can tell "looked them up" from
        // "read everything they have ever paid for".
        assertThat(recorded).isNotEmpty();
        assertThat(recorded.get(0).getAction()).isEqualTo(AuditAction.ACCOUNTS_SEARCHED.action());
        assertThat(recorded.get(0).getDetail()).isEqualTo("pledges=1");
        assertThat(recorded.get(0).getActorId()).isEqualTo(staff().id());
    }

    @Test
    @DisplayName("the list is not cached anywhere")
    void theListIsNotCached() {
        Account backer = account("pledges-cache");

        ResponseEntity<Map<String, Object>> page = get(path(backer.id(), ""), staff().accessToken());

        // This carries every amount one person has committed on the platform. A browser
        // disk cache holding it is a disclosure that survives signing out.
        assertThat(page.getHeaders().getCacheControl()).contains("no-store");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private static String path(UUID userId, String query) {
        return "/v1/admin/users/" + userId + "/pledges" + query;
    }

    private Map<String, Object> read(UUID userId, String query) {
        ResponseEntity<Map<String, Object>> response = get(path(userId, query), staff().accessToken());
        assertThat(response.getStatusCode())
                .as("reading an account's pledges: %s", response.getBody())
                .isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> pledgesIn(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("pledges");
    }

    /** A campaign in a state a pledge can be taken against. */
    private UUID campaign(String title) {
        String unique = "pledges-creator" + SEQUENCE.incrementAndGet();
        return Campaigns.seed(dataSource, Campaigns.creator(dataSource, unique), unique)
                .title(title)
                .state("FULFILLING")
                .goal("100.00")
                .insert();
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Backer"),
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

    /**
     * The staff account, with a minted token rather than a sign-in.
     *
     * <p>A dozen suites share this address and {@code sign-ins-per-email} is left at its real
     * value of five, so signing in here spends one of those five and fails somebody else's
     * suite with a 401 that has nothing to do with them.
     */
    private Account staff() {
        if (staffAccount != null) {
            return staffAccount;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();

        staffAccount = new Account(accessToken, id);
        return staffAccount;
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        if (accessToken != null) {
            headers.setBearerAuth(accessToken);
        }

        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
        return headers;
    }
}
