package az.ideanest.admin;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.Campaigns;
import az.ideanest.support.StaffGrants;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
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

/**
 * {@code GET /v1/admin/directory}: what the console's identifiers are called — issue #402.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aCampaignIsNamedInEveryState()} — the reason this is not
 *       {@code PublicProjects}. A moderation queue holds campaigns that are deliberately
 *       not public, and they are exactly the ones somebody is being asked to decide about.
 *   <li>{@link #theDirectoryHandsOverNoEmailAddress()} — the boundary that lets this
 *       endpoint be staff-wide and unaudited. If an address could be learned here, both of
 *       those would have to change.
 *   <li>{@link #anUnknownIdentifierIsAbsentRatherThanNull()} — §17.4 leaves rows behind
 *       whose author has been anonymised, so this is an ordinary answer and not an error.
 *   <li>{@link #theDirectoryIsNotAudited()} — every other console read is recorded. This
 *       one is called on every render of every screen that holds identifiers, and rows for
 *       it would bury the ones an investigation is looking for.
 *   <li>{@link #tooManyIdentifiersAreRefusedRatherThanTruncated()} — a screen answered
 *       about fewer rows than it asked about renders the remainder as bare identifiers with
 *       no name and no reason, which is the defect this endpoint exists to remove. The
 *       ceiling counts both lists together because the constraint is the eight-kilobyte
 *       header block Tomcat accepts, not either list on its own.
 * </ul>
 */
class ConsoleDirectoryApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** The note this suite's staff grants carry, so the cleanup removes exactly those. */
    private static final String STAFF_FIXTURE_NOTE = "console directory fixture";

    private static Account staff;

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
        Campaigns.clear(dataSource);
        StaffGrants.clear(dataSource, STAFF_FIXTURE_NOTE);
    }

    @Test
    @DisplayName("an account identifier comes back as a name and a profile path")
    void anAccountIsNamed() {
        UUID creatorId = Campaigns.creator(dataSource, handle("named"), "Kamran Əliyev");

        List<Map<String, Object>> accounts = accountsIn(get("?account=" + creatorId, staff().accessToken()));

        assertThat(accounts).hasSize(1);
        assertThat(accounts.get(0)).containsEntry("id", creatorId.toString());
        assertThat(accounts.get(0)).containsEntry("name", "Kamran Əliyev");
        // The slug is what turns the name into a link. A console row that could name
        // somebody and not open them is half of #402's fix.
        assertThat(accounts.get(0).get("slug")).isNotNull();
    }

    @Test
    @DisplayName("a campaign is named in every state, including the ones that are not public")
    void aCampaignIsNamedInEveryState() {
        String unique = handle("submitted");
        UUID creatorId = Campaigns.creator(dataSource, unique);
        UUID projectId = Campaigns.seed(dataSource, creatorId, unique)
                .title("Kiçik Səhnə")
                .state("SUBMITTED")
                .insert();

        List<Map<String, Object>> projects = projectsIn(get("?project=" + projectId, staff().accessToken()));

        /*
         * `PublicProjects` refuses anything §6.1 does not publish, and is right to — it
         * serves a public page. The submission queue asks a moderator to approve exactly
         * the campaigns that endpoint will not answer about, so a directory built on it
         * would leave the queue unable to name the thing it is asking about.
         */
        assertThat(projects).hasSize(1);
        assertThat(projects.get(0)).containsEntry("title", "Kiçik Səhnə");
        assertThat(projects.get(0)).containsEntry("creatorId", creatorId.toString());
    }

    @Test
    @DisplayName("the directory hands over no email address")
    void theDirectoryHandsOverNoEmailAddress() {
        UUID creatorId = Campaigns.creator(dataSource, handle("no-email"));

        ResponseEntity<Map<String, Object>> answer = get("?account=" + creatorId, staff().accessToken());

        /*
         * The whole argument for this endpoint being unaudited is that it
         * discloses nothing a profile page does not. `GET /v1/admin/users` serves the
         * address, needs ADMINISTER_ACCOUNTS and is recorded; if an address could be
         * learned here, this endpoint would need both and would not be worth having.
         */
        assertThat(accountsIn(answer).get(0)).doesNotContainKey("email");
        assertThat(String.valueOf(answer.getBody())).doesNotContain("@example.com");
    }

    @Test
    @DisplayName("an identifier with nothing behind it is absent rather than null")
    void anUnknownIdentifierIsAbsentRatherThanNull() {
        UUID creatorId = Campaigns.creator(dataSource, handle("half-known"));

        List<Map<String, Object>> accounts = accountsIn(
                get("?account=" + creatorId + "&account=" + UUID.randomUUID(), staff().accessToken()));

        // Not positional and not padded. A caller that could not tell "no such account"
        // from "an account with no name" would render one as the other, and §17.4 leaves
        // rows behind whose author has been anonymised.
        assertThat(accounts).hasSize(1);
        assertThat(accounts.get(0)).containsEntry("id", creatorId.toString());
    }

    @Test
    @DisplayName("people and campaigns are answered in one request")
    void bothKindsComeBackTogether() {
        String unique = handle("both");
        UUID creatorId = Campaigns.creator(dataSource, unique);
        UUID projectId = Campaigns.seed(dataSource, creatorId, unique).state("LIVE").insert();

        ResponseEntity<Map<String, Object>> answer =
                get("?account=" + creatorId + "&project=" + projectId, staff().accessToken());

        // A row on the payout queue names both a campaign and the person being paid. Two
        // round trips for one row would be two chances for one of them to be missing.
        assertThat(accountsIn(answer)).hasSize(1);
        assertThat(projectsIn(answer)).hasSize(1);
    }

    @Test
    @DisplayName("an empty question is an empty answer, not the whole platform")
    void anEmptyQuestionIsAnEmptyAnswer() {
        ResponseEntity<Map<String, Object>> answer = get("", staff().accessToken());

        // Otherwise this is an endpoint that enumerates every account on the platform to
        // anybody who works here, which is not what a lookup is.
        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(accountsIn(answer)).isEmpty();
        assertThat(projectsIn(answer)).isEmpty();
    }

    @Test
    @DisplayName("too many identifiers are refused rather than quietly truncated")
    void tooManyIdentifiersAreRefusedRatherThanTruncated() {
        String query = IntStream.range(0, 101)
                .mapToObj(index -> "account=" + UUID.randomUUID())
                .collect(Collectors.joining("&", "?", ""));

        ResponseEntity<Map<String, Object>> refused = get(query, staff().accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "TOO_MANY_IDENTIFIERS");
        // The client's only useful response is to split the request, and it cannot size
        // the pieces without being told what it sent and what the ceiling is.
        assertThat(String.valueOf(refused.getBody().get("meta"))).contains("limit");
    }

    @Test
    @DisplayName("the directory is not audited, unlike every other console read")
    void theDirectoryIsNotAudited() {
        UUID creatorId = Campaigns.creator(dataSource, handle("unaudited"));
        long before = auditEntries.count();

        get("?account=" + creatorId, staff().accessToken());

        /*
         * Called once per render of every console screen that holds identifiers. A row per
         * call would put several per page view into the one table with no retention rule,
         * burying the rows somebody opens the trail to find. `SystemHealthService` declines
         * to record itself for the same reason.
         */
        assertThat(auditEntries.count()).isEqualTo(before);
    }

    @Test
    @DisplayName("only staff may look anything up")
    void onlyStaffMayLookUp() {
        UUID creatorId = Campaigns.creator(dataSource, handle("outsider-target"));
        Account outsider = account("directory-outsider");

        ResponseEntity<Map<String, Object>> refused = get("?account=" + creatorId, outsider.accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "NOT_A_MODERATOR");
    }

    @Test
    @DisplayName("a moderator may look identifiers up")
    void aModeratorMayLookUp() {
        UUID creatorId = Campaigns.creator(dataSource, handle("moderated"));
        Account moderator = account("directory-moderator");
        StaffGrants.grant(dataSource, moderator.id(), StaffRole.MODERATOR, STAFF_FIXTURE_NOTE);

        ResponseEntity<Map<String, Object>> answer = get("?account=" + creatorId, moderator.accessToken());

        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(accountsIn(answer)).hasSize(1);
    }

    @Test
    @DisplayName("finance and compliance staff may look identifiers up")
    void financeAndComplianceMayLookUp() {
        UUID creatorId = Campaigns.creator(dataSource, handle("paid-out"));

        for (StaffRole role : List.of(StaffRole.FINANCE, StaffRole.COMPLIANCE)) {
            Account member = account("directory-" + role.name().toLowerCase(java.util.Locale.ROOT));
            StaffGrants.grant(dataSource, member.id(), role, STAFF_FIXTURE_NOTE);

            ResponseEntity<Map<String, Object>> answer = get("?account=" + creatorId, member.accessToken());

            // The payment log and the payout queue already name these people, bank details
            // beside them; a directory that refused would only cost the screen its names.
            assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(accountsIn(answer)).hasSize(1);
        }
    }

    @Test
    @DisplayName("staff whose work names nobody are refused")
    void staffWithoutEitherAuthorityAreRefused() {
        String unique = handle("draft-title");
        UUID creatorId = Campaigns.creator(dataSource, unique);
        UUID projectId = Campaigns.seed(dataSource, creatorId, unique).title("Not public yet").insert();

        for (StaffRole role : List.of(StaffRole.PARTNER, StaffRole.CURATOR)) {
            Account member = account("directory-" + role.name().toLowerCase(java.util.Locale.ROOT));
            StaffGrants.grant(dataSource, member.id(), role, STAFF_FIXTURE_NOTE);

            ResponseEntity<Map<String, Object>> refused =
                    get("?account=" + creatorId + "&project=" + projectId, member.accessToken());

            // The lookup answers about any identifier, including a draft's title, which none of
            // these roles' own screens would show them (#587).
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(refused.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
            assertThat(String.valueOf(refused.getBody())).doesNotContain("Not public yet");
        }
    }

    @Test
    @DisplayName("the lookup is not cached anywhere")
    void theLookupIsNotCached() {
        UUID creatorId = Campaigns.creator(dataSource, handle("cache"));

        ResponseEntity<Map<String, Object>> answer = get("?account=" + creatorId, staff().accessToken());

        assertThat(answer.getHeaders().getCacheControl()).contains("no-store");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private static String handle(String prefix) {
        return "directory-" + prefix + SEQUENCE.incrementAndGet();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> accountsIn(ResponseEntity<Map<String, Object>> answer) {
        return (List<Map<String, Object>>) answer.getBody().get("accounts");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> projectsIn(ResponseEntity<Map<String, Object>> answer) {
        return (List<Map<String, Object>>) answer.getBody().get("projects");
    }

    private ResponseEntity<Map<String, Object>> get(String query, String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return rest.exchange(
                "/v1/admin/directory" + query,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
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
     * The one account this suite's configuration treats as platform staff.
     *
     * <p>Its token is minted rather than signed in for, as {@code ConsoleReadApiTests} and
     * {@code AdminUserApiTests} do: a dozen suites share this address and
     * {@code sign-ins-per-email} is left at its real value of five, so a suite that signs
     * in as it makes somebody else's tests fail with a 401 that has nothing to do with them.
     */
    private Account staff() {
        if (staff != null) {
            return staff;
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
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        staff = new Account(accessToken, id);
        return staff;
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
