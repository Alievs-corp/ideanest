package az.ideanest.admin;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
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
 * §4.11's AD-04 (#104): searching, inspecting, and stopping accounts.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aBannedAccountCannotSignInAndItsSessionsAreGone()} — the ban is two
 *       writes and either alone is a hole. An account marked suspended whose refresh
 *       tokens still work is an account that can still be used.
 *   <li>{@link #aBannedAccountIsToldWhyRatherThanBeingRefusedAsWrong()} — 403 with a code,
 *       not the usual 401: a client must stop offering a password that is correct.
 *   <li>{@link #aBanIsReversible()} — a campaign's suspension is terminal and an
 *       account's must not be, or the first mistake is permanent.
 *   <li>{@link #onlyStaffMayLookAccountsUp()} — the list hands somebody else's email
 *       address to a caller with no relationship to them.
 *   <li>{@link #everyReadIsAudited()} — which is the only reason "who looked up whom" can
 *       be asked afterwards.
 * </ul>
 *
 * <p><strong>Accounts are not deleted between tests.</strong> This suite's assertions are
 * about finding accounts by search, so it filters on markers of its own rather than
 * assuming an empty table — every other suite in the build leaves accounts behind, and one
 * that assumed otherwise would fail depending on the order the suites ran in.
 */
class AdminUserApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

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

    // ------------------------------------------------------------------
    // Search and inspect
    // ------------------------------------------------------------------

    @Test
    @DisplayName("staff find an account by part of its email address")
    void staffFindAnAccountByAddress() {
        Account person = account("admin-find");

        ResponseEntity<Map<String, Object>> found = search("query=" + emailOf(person.id()));

        assertThat(found.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(found.getHeaders().getCacheControl())
                .as("other people's email addresses are not something a shared cache should hold")
                .contains("no-store");
        assertThat(idsOf(found.getBody())).contains(person.id().toString());
    }

    @Test
    @DisplayName("staff find an account by its display name or its profile slug")
    void staffFindAnAccountByNameOrSlug() {
        String marker = "Sevinc" + SEQUENCE.incrementAndGet();
        Account person = account("admin-name", marker);

        // Staff arrive holding whatever the complaint gave them, so all three columns
        // are matched rather than the address alone.
        assertThat(idsOf(search("query=" + marker.toLowerCase()).getBody()))
                .contains(person.id().toString());
        assertThat(idsOf(search("query=" + slugOf(person.id())).getBody()))
                .contains(person.id().toString());
    }

    @Test
    @DisplayName("a search term's wildcards are matched literally")
    void wildcardsInTheTermAreEscaped() {
        account("admin-wild");

        // Without escaping, "%" is "everything" -- and the endpoint that hands out email
        // addresses is the last one that should have a way to ask for all of them.
        assertThat(idsOf(search("query=%").getBody())).isEmpty();
    }

    @Test
    @DisplayName("the next page continues the list rather than repeating the first")
    void theCursorContinuesTheList() {
        String marker = "Pager" + SEQUENCE.incrementAndGet();
        Account oldest = account("admin-page", marker);
        Account middle = account("admin-page", marker);
        Account newest = account("admin-page", marker);
        String term = "query=" + marker.toLowerCase();

        Map<String, Object> first = search(term + "&limit=2").getBody();
        assertThat(idsOf(first)).containsExactly(newest.id().toString(), middle.id().toString());
        assertThat(first.get("nextCursor")).as("a full page may have more behind it").isNotNull();

        Map<String, Object> second = search(term + "&limit=2&after=" + first.get("nextCursor")).getBody();
        assertThat(idsOf(second)).containsExactly(oldest.id().toString());
        assertThat(second.get("nextCursor")).as("a short page is the end").isNull();

        // The unfiltered list pages through its own query, and repeated its first page on
        // the console's "load more" when the cursor was not applied.
        Map<String, Object> top = search("limit=1").getBody();
        Map<String, Object> next = search("limit=1&after=" + top.get("nextCursor")).getBody();
        assertThat(idsOf(next)).doesNotContainAnyElementsOf(idsOf(top));
    }

    @Test
    @DisplayName("the suspended filter answers only the accounts that were stopped")
    void theSuspendedFilterIsTheStoppedList() {
        Account quiet = account("admin-quiet");
        Account stopped = account("admin-stopped");
        ban(stopped, "Repeated abuse of the report form.");

        List<String> suspended = idsOf(search("suspended=true&limit=100").getBody());

        assertThat(suspended).contains(stopped.id().toString());
        assertThat(suspended).doesNotContain(quiet.id().toString());
    }

    @Test
    @DisplayName("inspecting one account answers its verification status and its suspension")
    void inspectingOneAccount() {
        Account person = account("admin-inspect");

        ResponseEntity<Map<String, Object>> inspected =
                exchange("/v1/admin/users/" + person.id(), HttpMethod.GET, staff().accessToken(), null);

        assertThat(inspected.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(inspected.getBody())
                .containsEntry("emailVerified", false)
                .containsEntry("suspended", false);
        assertThat(inspected.getBody().get("email")).isEqualTo(emailOf(person.id()));
    }

    @Test
    @DisplayName("an account that does not exist is a 404")
    void anUnknownAccountIsNotFound() {
        ResponseEntity<Map<String, Object>> missing = exchange(
                "/v1/admin/users/" + UUID.randomUUID(), HttpMethod.GET, staff().accessToken(), null);

        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missing.getBody()).containsEntry("code", "ACCOUNT_NOT_FOUND");
    }

    @Test
    @DisplayName("only staff may look accounts up")
    void onlyStaffMayLookAccountsUp() {
        Account outsider = account("admin-outsider");

        ResponseEntity<Map<String, Object>> refused =
                exchange("/v1/admin/users", HttpMethod.GET, outsider.accessToken(), null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "NOT_A_MODERATOR");
    }

    // ------------------------------------------------------------------
    // The ban
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a banned account cannot sign in and its sessions are gone")
    void aBannedAccountCannotSignInAndItsSessionsAreGone() {
        Account person = account("admin-ban");
        assertThat(activeSessions(person.id())).isPositive();

        ResponseEntity<Map<String, Object>> banned = ban(person, "Counterfeit goods.");

        assertThat(banned.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(banned.getBody())
                .containsEntry("suspended", true)
                .containsEntry("suspensionReason", "Counterfeit goods.");
        assertThat(banned.getBody().get("suspendedBy")).isEqualTo(staff().id().toString());

        // Either write alone is a hole: a suspended account whose refresh tokens still
        // work is an account that can go on being used.
        assertThat(activeSessions(person.id())).isZero();
    }

    @Test
    @DisplayName("a ban stops the access token the account already holds, at its next request")
    void aBanEndsTheAccessTokenAlreadyIssued() {
        Account person = account("admin-ban-token");
        // Used once before the ban, so the session's "still open" verdict is cached --
        // the case where a cache that was not cleared on revocation would let it through.
        assertThat(exchange("/v1/me", HttpMethod.GET, person.accessToken(), null).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        ban(person, "Counterfeit goods.");

        // #587. It used to keep working for up to fifteen minutes: long enough to pledge,
        // post and message on a token issued before trust and safety stopped the account.
        assertThat(exchange("/v1/me", HttpMethod.GET, person.accessToken(), null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a banned account is told why rather than refused as though the password were wrong")
    void aBannedAccountIsToldWhyRatherThanBeingRefusedAsWrong() {
        Account person = account("admin-refused");
        ban(person, "Counterfeit goods.");

        ResponseEntity<Map<String, Object>> signIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of(
                                "email", emailOf(person.id()),
                                "password", PASSWORD,
                                "tokenDelivery", "body"),
                        jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        // 403 rather than 401: the password is right, so a client must stop offering to
        // sign them in again. Raised only after the password is verified, which is what
        // keeps it from being an oracle.
        assertThat(signIn.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(signIn.getBody()).containsEntry("code", "ACCOUNT_SUSPENDED");
    }

    @Test
    @DisplayName("a ban is reversible")
    void aBanIsReversible() {
        Account person = account("admin-unban");
        ban(person, "Counterfeit goods.");

        ResponseEntity<Map<String, Object>> reinstated = exchange(
                "/v1/admin/users/" + person.id() + "/reinstate", HttpMethod.POST, staff().accessToken(), null);

        assertThat(reinstated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(reinstated.getBody()).containsEntry("suspended", false);
        assertThat(reinstated.getBody().get("suspensionReason")).isNull();

        // The sessions are not restored, and could not be. Signing in again is the way
        // back, and it works.
        assertThat(signInStatus(person)).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("banning twice keeps the first decision")
    void banningTwiceKeepsTheFirstDecision() {
        Account person = account("admin-twice");
        ban(person, "The first reason.");

        ResponseEntity<Map<String, Object>> second = ban(person, "A different reason.");

        // The reason and the author are what an appeal is about, and a retry must not
        // rewrite them under the conversation.
        assertThat(second.getBody()).containsEntry("suspensionReason", "The first reason.");
    }

    @Test
    @DisplayName("staff cannot ban themselves")
    void staffCannotBanThemselves() {
        ResponseEntity<Map<String, Object>> refused = exchange(
                "/v1/admin/users/" + staff().id() + "/ban",
                HttpMethod.POST,
                staff().accessToken(),
                Map.of("reason", "A moment of doubt."));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "ACCOUNT_SUSPENSION_REFUSED");
    }

    @Test
    @DisplayName("a ban without a reason is refused")
    void aBanNeedsAReason() {
        Account person = account("admin-noreason");

        ResponseEntity<Map<String, Object>> refused = exchange(
                "/v1/admin/users/" + person.id() + "/ban",
                HttpMethod.POST,
                staff().accessToken(),
                Map.of("reason", "   "));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(signInStatus(person)).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("only staff may ban")
    void onlyStaffMayBan() {
        Account person = account("admin-ban-guard");
        Account outsider = account("admin-ban-outsider");

        ResponseEntity<Map<String, Object>> refused = exchange(
                "/v1/admin/users/" + person.id() + "/ban",
                HttpMethod.POST,
                outsider.accessToken(),
                Map.of("reason", "I do not like them."));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(signInStatus(person)).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // The audit trail
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every read is audited, with counts and no addresses")
    void everyReadIsAudited() {
        Account person = account("admin-audit");
        String marker = emailOf(person.id());

        search("query=" + marker);

        List<AuditEntry> rows = auditRows(AuditAction.ACCOUNTS_SEARCHED).stream()
                .filter(entry -> staff().id().equals(entry.getEntityId()))
                .toList();
        assertThat(rows).isNotEmpty();
        assertThat(rows.getLast().getDetail()).contains("results=", "filtered=true");
        assertThat(rows.getLast().getDetail())
                .as("staff search by address, and audit_logs has no retention rule")
                .doesNotContain(marker);
    }

    @Test
    @DisplayName("a ban is audited with the sessions it revoked")
    void aBanIsAudited() {
        Account person = account("admin-ban-audit");
        ban(person, "Counterfeit goods.");

        List<AuditEntry> rows = auditRows(AuditAction.ACCOUNT_SUSPENDED).stream()
                .filter(entry -> person.id().equals(entry.getEntityId()))
                .toList();

        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().getDetail()).contains("sessionsRevoked=");
        assertThat(rows.getFirst().getDetail())
                .as("the reason is prose about a person, and this table cannot be corrected")
                .doesNotContain("Counterfeit");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account(String prefix) {
        return account(prefix, "Test Person");
    }

    private Account account(String prefix, String name) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", name),
                String.class);
        return signIn(email);
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

        staff = new Account(accessToken, id);
        return staff;
    }

    private Account signIn(EmailAddress email) {
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private HttpStatus signInStatus(Account person) {
        ResponseEntity<String> response = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of(
                                "email", emailOf(person.id()),
                                "password", PASSWORD,
                                "tokenDelivery", "body"),
                        jsonHeaders()),
                String.class);
        return HttpStatus.valueOf(response.getStatusCode().value());
    }

    private ResponseEntity<Map<String, Object>> search(String query) {
        return exchange("/v1/admin/users?" + query, HttpMethod.GET, staff().accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> ban(Account person, String reason) {
        return exchange(
                "/v1/admin/users/" + person.id() + "/ban",
                HttpMethod.POST,
                staff().accessToken(),
                Map.of("reason", reason));
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private String emailOf(UUID userId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT email::text FROM users WHERE id = ?", String.class, userId);
    }

    private String slugOf(UUID userId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT slug FROM users WHERE id = ?", String.class, userId);
    }

    private int activeSessions(UUID userId) {
        Integer value = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL",
                        Integer.class,
                        userId);
        return value == null ? 0 : value;
    }

    /**
     * The rows for one action, oldest first.
     *
     * <p>Sorted, because {@code findAll()} promises no order and the tests read
     * {@code getLast()} as "the row this test just wrote". Other tests in the run write the same
     * action for the same staff account, and unsorted the last row was whichever one the
     * database returned last — a different test's search, some of the time.
     */
    private List<AuditEntry> auditRows(AuditAction action) {
        return auditEntries.findAll().stream()
                .filter(entry -> entry.getAction().equals(action.action()))
                .sorted(Comparator.comparing(AuditEntry::getOccurredAt))
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static List<String> idsOf(Map<String, Object> body) {
        return ((List<Map<String, Object>>) body.get("users"))
                .stream().map(user -> (String) user.get("id")).toList();
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
