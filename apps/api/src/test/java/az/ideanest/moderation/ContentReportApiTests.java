package az.ideanest.moderation;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
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
 * Reporting content, and clearing the queue it lands in, over HTTP.
 *
 * <p>The tests that carry the issue are
 * {@link #reportingTheSameCampaignTwiceDoesNotMultiplyIt()} — the requirement a
 * service-layer check cannot keep — and
 * {@link #decidingAReportWritesExactlyOneAuditRow()}, which is CLAUDE.md's "every
 * privileged action is audited" being true rather than intended.
 *
 * <p>Every test uses its own reporter, because the per-account report budget is
 * deliberately reachable and because two tests sharing an account would make the
 * duplicate-suppression assertions depend on the order they happened to run in.
 */
class ContentReportApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** Shared across the class. See {@link #moderator()} for why it is cached. */
    private static Account MODERATOR;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    /** See {@link #moderator()} for why this suite mints a token instead of signing in. */
    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clearReports() {
        // Reports deliberately reference nothing that cascades -- a report outlives
        // what it was about -- so they go first and by hand. Audit rows are left
        // where they are: V21 refuses a DELETE, which is the whole point of that
        // table, so every assertion here is scoped to its own report identifier.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM content_reports");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /**
     * A registered, signed-in account: its access token, its identifier, and the public
     * slug an account is reported by since #143.
     */
    private record Account(String accessToken, UUID id, String slug) {
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return signIn(email);
    }

    /**
     * The one account this suite's configuration treats as platform staff.
     *
     * <p><strong>Its token is minted rather than signed in for, and that is not a
     * shortcut.</strong> {@code application-test.yml} names exactly one moderator
     * address, and five suites already share it — {@code ProjectLifecycleApiTests},
     * {@code ProjectChecklistApiTests}, {@code PrelaunchApiTests},
     * {@code CurationApiTests} and {@code RankingApiTests}. The auth module's
     * {@code sign-ins-per-email} is deliberately left at its real value of five, so a
     * sixth suite signing in as that address is a sixth sign-in inside one window:
     * the limiter refuses it, that suite gets no token, and — because the limiter
     * does not care which suite was last — <em>somebody else's</em> moderation tests
     * fail with a 401 that has nothing to do with them. Which is exactly what
     * happened the first time this file signed in.
     *
     * <p>So this asks {@code AccessTokenIssuer} for the same token a sign-in would
     * have produced. What is given up is coverage of the sign-in path, which is
     * {@code TokenApiTests}' subject and not this file's; what is bought is a suite
     * that cannot break a different module's by existing.
     *
     * <p>The account itself is still registered through the endpoint when it is not
     * already there, so this suite works whichever of the six JUnit happens to run
     * first. Every other account in this file is a non-moderator, which is what makes
     * {@link #theQueueRefusesAnAccountThatIsNotStaff()} the default case rather than
     * a special one.
     */
    private Account moderator() {
        if (MODERATOR != null) {
            return MODERATOR;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        // A session identifier of its own, as a real sign-in would have. Nothing
        // reads it here -- the filter chain is stateless -- and inventing one is
        // still better than reusing the account's, which would make the token claim
        // something untrue about which sign-in produced it.
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        MODERATOR = new Account(
                accessToken, id, users.findById(id).orElseThrow().getSlug());
        return MODERATOR;
    }

    private Account signIn(EmailAddress email) {
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"),
                        jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        var user = users.findByEmailAndDeletedAtIsNull(email).orElseThrow();
        return new Account((String) signedIn.getBody().get("accessToken"), user.getId(), user.getSlug());
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

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(body, accessToken == null ? jsonHeaders() : bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(accessToken == null ? jsonHeaders() : bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /** A campaign anybody can see, which is the precondition for reporting one. */
    private UUID liveCampaign(Account creator) {
        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects", creator.accessToken(), Map.of("title", "A Campaign " + SEQUENCE.incrementAndGet()));
        UUID id = UUID.fromString((String) created.getBody().get("id"));
        // Written directly rather than driven through moderation: this suite is not
        // testing the campaign lifecycle, and driving every fixture through the
        // approval path would make each of these tests depend on it.
        Campaigns.launch(dataSource, id);
        return id;
    }

    /** A campaign that exists and that nobody outside it may see. */
    private UUID draftCampaign(Account creator) {
        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects", creator.accessToken(), Map.of("title", "A Draft " + SEQUENCE.incrementAndGet()));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private static Map<String, Object> reportBody(String reason, String detail) {
        return detail == null ? Map.of("reason", reason) : Map.of("reason", reason, "detail", detail);
    }

    private static UUID idOf(Map<String, Object> body) {
        return UUID.fromString((String) body.get("id"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> reportsIn(Map<String, Object> queue) {
        return (List<Map<String, Object>>) queue.get("reports");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> targetOf(Map<String, Object> report) {
        return (Map<String, Object>) report.get("target");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> metaOf(Map<String, Object> problem) {
        return (Map<String, Object>) problem.get("meta");
    }

    private long reportsOn(UUID targetId) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM content_reports WHERE target_id = ?", Long.class, targetId);
    }

    private List<AuditEntry> auditRowsAbout(UUID reportId) {
        return auditEntries.findByEntityTypeAndEntityIdOrderByOccurredAtDesc("report", reportId);
    }

    // ------------------------------------------------------------------
    // Making a report
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a signed-in account can report a campaign, and is told the platform has it")
    void reportingACampaign() {
        Account reporter = account("reporter");
        UUID campaign = liveCampaign(account("creator"));

        ResponseEntity<Map<String, Object>> response = post(
                "/v1/projects/" + campaign + "/report",
                reporter.accessToken(),
                reportBody("PROHIBITED_ITEM", "It is selling raffle tickets."));

        // 202 rather than 201: nothing addressable by the reporter was created, and
        // "a person will look at this" is what actually happened.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(response.getBody()).containsEntry("state", "OPEN").containsEntry("reason", "PROHIBITED_ITEM");
        assertThat(metaOfTarget(response.getBody()))
                .containsEntry("type", "PROJECT")
                .containsEntry("id", campaign.toString());
        assertThat(reportsOn(campaign)).isEqualTo(1);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> metaOfTarget(Map<String, Object> body) {
        return (Map<String, Object>) body.get("target");
    }

    @Test
    @DisplayName("reporting the same campaign twice does not multiply the report")
    void reportingTheSameCampaignTwiceDoesNotMultiplyIt() {
        Account reporter = account("reporter");
        UUID campaign = liveCampaign(account("creator"));

        UUID first = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        reporter.accessToken(),
                        reportBody("SPAM", null))
                .getBody());

        ResponseEntity<Map<String, Object>> again = post(
                "/v1/projects/" + campaign + "/report",
                reporter.accessToken(),
                reportBody("FRAUD", "Now I think it is worse."));

        // Success, not a 409: the reporter did what they meant to do, and telling
        // them otherwise trains people to report from a second account. What comes
        // back is the report already on file -- same identifier, and the reason it
        // was filed under, because rewriting the row would let somebody move their
        // own report up a queue ordered by arrival.
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(idOf(again.getBody())).isEqualTo(first);
        assertThat(again.getBody()).containsEntry("reason", "SPAM");
        assertThat(reportsOn(campaign)).isEqualTo(1);
    }

    @Test
    @DisplayName("two people reporting one campaign are two reports")
    void twoReportersAreTwoReports() {
        UUID campaign = liveCampaign(account("creator"));

        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));

        // The count is the queue's whole triage signal. Suppressing the second
        // person would make a campaign fifty people reported look like one nobody
        // did.
        assertThat(reportsOn(campaign)).isEqualTo(2);
    }

    @Test
    @DisplayName("an account can be reported")
    void reportingAnAccount() {
        Account reporter = account("reporter");
        Account subject = account("subject");

        ResponseEntity<Map<String, Object>> response = post(
                "/v1/users/" + subject.slug() + "/report",
                reporter.accessToken(),
                reportBody("OFFENSIVE", "Abusive messages."));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(metaOfTarget(response.getBody())).containsEntry("type", "USER");
        // Addressed by slug, filed against the identifier: the queue names the
        // account by what survives a change of slug (#143).
        assertThat(metaOfTarget(response.getBody())).containsEntry("id", subject.id().toString());
        assertThat(reportsOn(subject.id())).isEqualTo(1);
    }

    @Test
    @DisplayName("an account is addressed by its slug, not by its identifier")
    void anAccountIsNotReportedByIdentifier() {
        Account subject = account("subject");

        ResponseEntity<Map<String, Object>> response =
                post("/v1/users/" + subject.id() + "/report", account("reporter").accessToken(), reportBody("SPAM", null));

        // #143 moved the route onto the slug the public profile carries. An
        // identifier is not a slug, so it names nobody.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("code", "REPORT_TARGET_NOT_FOUND");
        assertThat(reportsOn(subject.id())).isZero();
    }

    @Test
    @DisplayName("reporting an account requires an account")
    void reportingAnAccountRequiresAnAccount() {
        Account subject = account("subject");

        ResponseEntity<Map<String, Object>> response =
                post("/v1/users/" + subject.slug() + "/report", null, reportBody("SPAM", null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(reportsOn(subject.id())).isZero();
    }

    @Test
    @DisplayName("reporting requires an account")
    void reportingRequiresAnAccount() {
        UUID campaign = liveCampaign(account("creator"));

        ResponseEntity<Map<String, Object>> response =
                post("/v1/projects/" + campaign + "/report", null, reportBody("FRAUD", null));

        // Not friction for its own sake: duplicate suppression is unstateable
        // without an identity to compare, and an unauthenticated form would make
        // the open-report count a number one script chooses.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a campaign nobody can see cannot be reported, and is not confirmed to exist")
    void aDraftCannotBeReported() {
        UUID draft = draftCampaign(account("creator"));

        ResponseEntity<Map<String, Object>> response =
                post("/v1/projects/" + draft + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));

        // 404 and not 403. Distinguishing "not visible" from "not there" would turn
        // this endpoint into an oracle for what other people are preparing.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("code", "REPORT_TARGET_NOT_FOUND");
        assertThat(reportsOn(draft)).isZero();
    }

    @Test
    @DisplayName("an identifier that names nothing cannot be reported")
    void anInventedTargetCannotBeReported() {
        UUID nothing = UUID.randomUUID();

        ResponseEntity<Map<String, Object>> response =
                post("/v1/projects/" + nothing + "/report", account("reporter").accessToken(), reportBody("SPAM", null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(reportsOn(nothing)).isZero();
    }

    @Test
    @DisplayName("a slug that names nobody cannot be reported")
    void anInventedSlugCannotBeReported() {
        ResponseEntity<Map<String, Object>> response = post(
                "/v1/users/nobody-answers-to-this-" + SEQUENCE.incrementAndGet() + "/report",
                account("reporter").accessToken(),
                reportBody("SPAM", null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("code", "REPORT_TARGET_NOT_FOUND");
    }

    @Test
    @DisplayName("nobody reports themselves")
    void anAccountCannotReportItself() {
        Account reporter = account("reporter");

        ResponseEntity<Map<String, Object>> response =
                post("/v1/users/" + reporter.slug() + "/report", reporter.accessToken(), reportBody("SPAM", null));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "CANNOT_REPORT_SELF");
    }

    @Test
    @DisplayName("a report of OTHER has to say what")
    void otherRequiresDetail() {
        UUID campaign = liveCampaign(account("creator"));

        ResponseEntity<Map<String, Object>> refused = post(
                "/v1/projects/" + campaign + "/report",
                account("reporter").accessToken(),
                reportBody("OTHER", "   "));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "REPORT_DETAIL_REQUIRED");
        assertThat(metaOf(refused.getBody())).containsEntry("field", "detail");
        assertThat(reportsOn(campaign)).isZero();

        // And the same reason with something written is accepted, so the refusal is
        // about the missing text rather than about the reason.
        assertThat(post(
                                "/v1/projects/" + campaign + "/report",
                                account("reporter").accessToken(),
                                reportBody("OTHER", "The story is copied from another campaign."))
                        .getStatusCode())
                .isEqualTo(HttpStatus.ACCEPTED);
    }

    @Test
    @DisplayName("a reason outside the taxonomy is refused")
    void anUnknownReasonIsRefused() {
        UUID campaign = liveCampaign(account("creator"));

        ResponseEntity<Map<String, Object>> response = post(
                "/v1/projects/" + campaign + "/report",
                account("reporter").accessToken(),
                reportBody("I_DO_NOT_LIKE_IT", null));

        // A 400 rather than a silent OTHER. A taxonomy that quietly accepts anything
        // is a taxonomy nobody can count.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(reportsOn(campaign)).isZero();
    }

    // ------------------------------------------------------------------
    // The queue
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the queue refuses an account that is not platform staff")
    void theQueueRefusesAnAccountThatIsNotStaff() {
        Account reporter = account("reporter");

        ResponseEntity<Map<String, Object>> response =
                get("/v1/admin/moderation/reports", reporter.accessToken());

        // 403 and not 404: the refusal happens before any report is loaded, so there
        // is nothing to be evasive about, and an operator whose moderator list is
        // unconfigured needs to be told that rather than shown a missing endpoint.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).containsEntry("code", "NOT_A_MODERATOR");
    }

    @Test
    @DisplayName("resolving refuses an account that is not platform staff")
    void resolvingRefusesAnAccountThatIsNotStaff() {
        Account reporter = account("reporter");
        UUID campaign = liveCampaign(account("creator"));
        UUID report = idOf(post("/v1/projects/" + campaign + "/report", reporter.accessToken(), reportBody("FRAUD", null))
                .getBody());

        ResponseEntity<Map<String, Object>> response =
                post("/v1/admin/moderation/reports/" + report + "/uphold", reporter.accessToken(), null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        // And nothing moved.
        assertThat(get("/v1/admin/moderation/reports/" + report, moderator().accessToken())
                        .getBody())
                .containsEntry("state", "OPEN");
    }

    @Test
    @DisplayName("a moderator sees the report, who made it, and how many others reported the same thing")
    void theQueueCarriesTheTriageSignal() {
        UUID campaign = liveCampaign(account("creator"));
        Account first = account("reporter");
        post("/v1/projects/" + campaign + "/report", first.accessToken(), reportBody("FRAUD", "Nothing shipped."));
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("SPAM", null));

        ResponseEntity<Map<String, Object>> queue =
                get("/v1/admin/moderation/reports", moderator().accessToken());

        assertThat(queue.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<Map<String, Object>> reports = reportsIn(queue.getBody());
        assertThat(reports).hasSize(2);

        Map<String, Object> oldest = reports.get(0);
        // Oldest first, because a queue is worked in the order things arrived.
        assertThat(oldest).containsEntry("reporterId", first.id().toString());
        assertThat(oldest).containsEntry("detail", "Nothing shipped.");
        // "One complaint" and "two complaints" are different situations, and the
        // second is the one that gets looked at first.
        assertThat(((Number) oldest.get("openReportsOnTarget")).longValue()).isEqualTo(2);
        assertThat(oldest.get("resolution")).isNull();
    }

    @Test
    @DisplayName("the queue pages from a cursor rather than an offset")
    void theQueuePagesFromACursor() {
        UUID campaign = liveCampaign(account("creator"));
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("SPAM", null));

        ResponseEntity<Map<String, Object>> firstPage =
                get("/v1/admin/moderation/reports?limit=1", moderator().accessToken());
        List<Map<String, Object>> first = reportsIn(firstPage.getBody());
        assertThat(first).hasSize(1);
        assertThat(firstPage.getBody().get("nextCursor")).isEqualTo(first.get(0).get("id"));

        ResponseEntity<Map<String, Object>> secondPage = get(
                "/v1/admin/moderation/reports?limit=1&after=" + firstPage.getBody().get("nextCursor"),
                moderator().accessToken());
        List<Map<String, Object>> second = reportsIn(secondPage.getBody());
        assertThat(second).hasSize(1);
        assertThat(second.get(0).get("id")).isNotEqualTo(first.get(0).get("id"));

        // A full page still carries a cursor, even when it happens to be the last
        // one. The alternative -- guessing "there is no more" from a page that came
        // back full -- would hide the tail of the queue whenever the number of
        // reports divides by the page size, which on a safety queue means complaints
        // nobody ever reads. The cost is one request that comes back empty, and that
        // request is the one that says there is nothing left.
        assertThat(secondPage.getBody().get("nextCursor")).isNotNull();

        ResponseEntity<Map<String, Object>> pastTheEnd = get(
                "/v1/admin/moderation/reports?limit=1&after=" + secondPage.getBody().get("nextCursor"),
                moderator().accessToken());
        assertThat(reportsIn(pastTheEnd.getBody())).isEmpty();
        assertThat(pastTheEnd.getBody().get("nextCursor")).isNull();
    }

    @Test
    @DisplayName("the queue narrows to one kind of reported thing, and says which it narrowed to")
    void theQueueNarrowsByTarget() {
        UUID campaign = liveCampaign(account("creator"));
        Account person = account("subject");
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));
        post("/v1/users/" + person.slug() + "/report", account("reporter").accessToken(), reportBody("OFFENSIVE", null));

        ResponseEntity<Map<String, Object>> profiles =
                get("/v1/admin/moderation/reports?target=USER", moderator().accessToken());

        List<Map<String, Object>> reports = reportsIn(profiles.getBody());
        assertThat(reports).hasSize(1);
        assertThat(targetOf(reports.get(0))).containsEntry("id", person.id().toString());
        // Echoed, because AD-09 draws the campaign queue and the profile queue from this
        // one endpoint: a screen that filed the wrong response would be showing complaints
        // about people under a heading about campaigns.
        assertThat(profiles.getBody()).containsEntry("target", "USER");

        // And the unfiltered queue is unchanged by the parameter existing, which is what
        // makes this safe to add to the screen #101 already ships.
        assertThat(reportsIn(get("/v1/admin/moderation/reports", moderator().accessToken()).getBody()))
                .hasSize(2);
    }

    @Test
    @DisplayName("a narrowed queue pages through its own kind rather than through the whole table")
    void aNarrowedQueuePagesThroughItsOwnKind() {
        UUID campaign = liveCampaign(account("creator"));
        Account person = account("subject");

        /*
         * Two campaign reports around one profile report, so that a page of one taken
         * from the unfiltered queue would be a campaign report. This is the assertion the
         * filter exists for: narrowing in the browser would hand a client a cursor that
         * has already moved past rows it never saw, and there is no way to ask for them
         * back.
         */
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));
        post("/v1/users/" + person.slug() + "/report", account("reporter").accessToken(), reportBody("OFFENSIVE", null));
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("SPAM", null));

        ResponseEntity<Map<String, Object>> firstPage =
                get("/v1/admin/moderation/reports?target=USER&limit=1", moderator().accessToken());
        List<Map<String, Object>> first = reportsIn(firstPage.getBody());
        assertThat(first).hasSize(1);
        assertThat(targetOf(first.get(0))).containsEntry("type", "USER");

        ResponseEntity<Map<String, Object>> pastTheEnd = get(
                "/v1/admin/moderation/reports?target=USER&limit=1&after="
                        + firstPage.getBody().get("nextCursor"),
                moderator().accessToken());
        assertThat(reportsIn(pastTheEnd.getBody())).isEmpty();
    }

    @Test
    @DisplayName("a kind nothing can be reported as returns an empty queue rather than a refusal")
    void anUnreportableKindIsEmptyRatherThanRefused() {
        UUID campaign = liveCampaign(account("creator"));
        post("/v1/projects/" + campaign + "/report", account("reporter").accessToken(), reportBody("FRAUD", null));

        ResponseEntity<Map<String, Object>> updates =
                get("/v1/admin/moderation/reports?target=PROJECT_UPDATE", moderator().accessToken());

        // PROJECT_UPDATE is in V23's check constraint and has no report route (§10.2), so
        // the honest answer is that there is nothing in that queue -- not a 400 telling a
        // client the value does not exist, which it does. #297 is the issue that gives it
        // an intake, and the day it lands nothing here changes.
        assertThat(updates.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(reportsIn(updates.getBody())).isEmpty();
        assertThat(updates.getBody()).containsEntry("target", "PROJECT_UPDATE");
    }

    @Test
    @DisplayName("a kind outside the taxonomy is refused rather than quietly ignored")
    void anUnknownKindIsRefused() {
        ResponseEntity<Map<String, Object>> refused =
                get("/v1/admin/moderation/reports?target=PROFILE", moderator().accessToken());

        // "PROFILE" is what somebody types for USER. Answering it with the whole queue
        // would be showing campaign reports on the profile screen, which is worse than
        // showing nothing and much worse than saying no.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // ------------------------------------------------------------------
    // Deciding a report
    // ------------------------------------------------------------------

    @Test
    @DisplayName("upholding a report is terminal, signed, and dated")
    void upholdingAReport() {
        UUID campaign = liveCampaign(account("creator"));
        UUID report = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        account("reporter").accessToken(),
                        reportBody("PROHIBITED_ITEM", null))
                .getBody());

        Account moderator = moderator();
        ResponseEntity<Map<String, Object>> upheld = post(
                "/v1/admin/moderation/reports/" + report + "/uphold",
                moderator.accessToken(),
                Map.of("note", "Weapons replica."));

        assertThat(upheld.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(upheld.getBody()).containsEntry("state", "UPHELD");
        assertThat(resolutionOf(upheld.getBody()))
                .containsEntry("moderatorId", moderator.id().toString())
                .containsEntry("note", "Weapons replica.");
        assertThat(resolutionOf(upheld.getBody()).get("at")).isNotNull();

        // The campaign is untouched. Deciding a report is not acting on it -- that
        // is AD-02's suspension, a separate privileged action.
        assertThat(get("/v1/projects/" + campaign + "/prelaunch", null).getStatusCode())
                .isNotEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> resolutionOf(Map<String, Object> body) {
        return (Map<String, Object>) body.get("resolution");
    }

    @Test
    @DisplayName("a report can only be decided once")
    void aDecidedReportCannotBeDecidedAgain() {
        UUID campaign = liveCampaign(account("creator"));
        UUID report = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        account("reporter").accessToken(),
                        reportBody("SPAM", null))
                .getBody());

        post("/v1/admin/moderation/reports/" + report + "/dismiss", moderator().accessToken(), null);

        ResponseEntity<Map<String, Object>> again =
                post("/v1/admin/moderation/reports/" + report + "/uphold", moderator().accessToken(), null);

        // 409 and not 400: the request was well formed and would have been accepted a
        // moment earlier. The usual way here is two moderators with the same queue
        // open, and the body tells the loser what the report actually became.
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "REPORT_ALREADY_RESOLVED");
        assertThat(metaOf(again.getBody())).containsEntry("state", "DISMISSED");
        assertThat(metaOf(again.getBody())).containsEntry("allowed", List.of());
    }

    @Test
    @DisplayName("deciding a report writes exactly one audit row, naming the moderator")
    void decidingAReportWritesExactlyOneAuditRow() {
        UUID campaign = liveCampaign(account("creator"));
        UUID upheldReport = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        account("reporter").accessToken(),
                        reportBody("FRAUD", null))
                .getBody());
        UUID dismissedReport = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        account("reporter").accessToken(),
                        reportBody("SPAM", null))
                .getBody());

        Account moderator = moderator();
        post("/v1/admin/moderation/reports/" + upheldReport + "/uphold", moderator.accessToken(), null);
        post("/v1/admin/moderation/reports/" + dismissedReport + "/dismiss", moderator.accessToken(), null);

        List<AuditEntry> upheldRows = auditRowsAbout(upheldReport);
        assertThat(upheldRows).hasSize(1);
        assertThat(upheldRows.get(0).getAction()).isEqualTo("report.upheld");
        assertThat(upheldRows.get(0).getActorId()).isEqualTo(moderator.id());
        // The dismissal is recorded too. "Who dismissed the fourteen reports about
        // this campaign" is the question an investigation starts from, and a table
        // of upheld reports cannot answer it.
        assertThat(auditRowsAbout(dismissedReport)).singleElement().satisfies(row -> assertThat(row.getAction())
                .isEqualTo("report.dismissed"));

        // Making a report is not a privileged action and leaves no audit row; the
        // report itself is the record of it.
        assertThat(auditRowsAbout(upheldReport)).hasSize(1);
    }

    @Test
    @DisplayName("a refused resolution leaves no audit row, because nothing was decided")
    void aRefusedResolutionIsNotRecordedAsOne() {
        Account reporter = account("reporter");
        UUID campaign = liveCampaign(account("creator"));
        UUID report = idOf(post("/v1/projects/" + campaign + "/report", reporter.accessToken(), reportBody("FRAUD", null))
                .getBody());

        post("/v1/admin/moderation/reports/" + report + "/uphold", reporter.accessToken(), null);

        // The audit trail records privileged actions. An account that was refused
        // before anything happened did not take one, and a row saying it upheld the
        // report would be a false entry -- which is worse than a gap, because a gap
        // is visible and a false entry is evidence.
        assertThat(auditRowsAbout(report)).isEmpty();
    }

    @Test
    @DisplayName("a decided report leaves the queue, and is found under its outcome")
    void aDecidedReportLeavesTheQueue() {
        UUID campaign = liveCampaign(account("creator"));
        UUID report = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        account("reporter").accessToken(),
                        reportBody("MISREPRESENTATION", null))
                .getBody());

        post("/v1/admin/moderation/reports/" + report + "/dismiss", moderator().accessToken(), null);

        assertThat(reportsIn(get("/v1/admin/moderation/reports?state=OPEN", moderator().accessToken())
                        .getBody()))
                .isEmpty();
        assertThat(reportsIn(get("/v1/admin/moderation/reports?state=DISMISSED", moderator().accessToken())
                        .getBody()))
                .singleElement()
                .satisfies(row -> assertThat(row.get("id")).isEqualTo(report.toString()));
    }

    @Test
    @DisplayName("a reporter may report again once their earlier report has been decided")
    void aResolvedReportReleasesTheReporter() {
        Account reporter = account("reporter");
        UUID campaign = liveCampaign(account("creator"));
        UUID first = idOf(post("/v1/projects/" + campaign + "/report", reporter.accessToken(), reportBody("SPAM", null))
                .getBody());

        post("/v1/admin/moderation/reports/" + first + "/dismiss", moderator().accessToken(), null);

        ResponseEntity<Map<String, Object>> again = post(
                "/v1/projects/" + campaign + "/report", reporter.accessToken(), reportBody("FRAUD", "It got worse."));

        // Somebody told in March that their report was dismissed, finding the same
        // campaign doing something worse in June, is making a new complaint about new
        // facts. Dropping it while showing them a success is the worst failure a
        // safety feature has.
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(idOf(again.getBody())).isNotEqualTo(first);
        assertThat(reportsOn(campaign)).isEqualTo(2);
    }

    @Test
    @DisplayName("a report identifier that is not one is a 404 for staff")
    void anUnknownReportIsNotFound() {
        ResponseEntity<Map<String, Object>> response = post(
                "/v1/admin/moderation/reports/" + UUID.randomUUID() + "/uphold", moderator().accessToken(), null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).containsEntry("code", "REPORT_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // What the report is about -- #399
    // ------------------------------------------------------------------
    //
    // The detail page rendered the reporter's claim, the reporter, and two buttons, and
    // nothing at all about the thing being complained of: not the text, not the author,
    // not the campaign, and no link to any of them. A moderator asked to uphold something
    // they cannot read either guesses or leaves the queue, and the cheap guess is always
    // to dismiss -- which is how a moderation queue quietly stops working.

    @Test
    @DisplayName("the content of a report about a comment is the comment")
    void aCommentReportCarriesTheComment() {
        UUID campaign = liveCampaign(account("creator"));
        Account author = account("author");
        UUID comment = idOf(post(
                        "/v1/projects/" + campaign + "/comments",
                        author.accessToken(),
                        Map.of("body", "Free download here, follow the link."))
                .getBody());
        UUID report = idOf(post(
                        "/v1/comments/" + comment + "/report",
                        account("reporter").accessToken(),
                        reportBody("SPAM", "The comment contains a free download link."))
                .getBody());

        Map<String, Object> content = contentOf(report);

        assertThat(content).containsEntry("targetType", "COMMENT");
        assertThat(content).containsEntry("state", "PRESENT");
        assertThat(content)
                .as("the sentence the decision is actually about")
                .containsEntry("body", "Free download here, follow the link.");
        assertThat(content).containsEntry("authorId", author.id().toString());
        assertThat(content.get("createdAt"))
                .as("when it was written, which is not when it was reported")
                .isNotNull();

        Map<String, Object> project = campaignOf(content);
        assertThat(project).as("which campaign it is on, and a path to it").isNotNull();
        assertThat(project).containsEntry("id", campaign.toString());
        assertThat(project.get("slug")).isNotNull();
        assertThat(project.get("creatorSlug")).isNotNull();
    }

    @Test
    @DisplayName("a comment that has since been removed is still readable, and says it was removed")
    void aRemovedCommentIsStillReadable() {
        UUID campaign = liveCampaign(account("creator"));
        Account author = account("author");
        UUID comment = idOf(post(
                        "/v1/projects/" + campaign + "/comments",
                        author.accessToken(),
                        Map.of("body", "Something worth complaining about."))
                .getBody());
        UUID report = idOf(post(
                        "/v1/comments/" + comment + "/report",
                        account("reporter").accessToken(),
                        reportBody("OFFENSIVE", null))
                .getBody());

        delete("/v1/comments/" + comment, author.accessToken());

        Map<String, Object> content = contentOf(report);

        // V25 keeps the row and its text for exactly this: a report filed before the
        // removal still has to be decidable, and a moderator told only "removed" cannot
        // tell an upheld report from a dismissed one.
        assertThat(content).containsEntry("state", "REMOVED");
        assertThat(content).containsEntry("body", "Something worth complaining about.");
    }

    @Test
    @DisplayName("a report about a campaign points at the campaign rather than inlining a fragment of it")
    void aCampaignReportIsAddressedDirectly() {
        UUID campaign = liveCampaign(account("creator"));
        UUID report = idOf(post(
                        "/v1/projects/" + campaign + "/report",
                        account("reporter").accessToken(),
                        reportBody("FRAUD", null))
                .getBody());

        Map<String, Object> content = contentOf(report);

        // A campaign has a staff preview that renders it in any state, so there is no blob
        // of text to inline -- and a blurb next to a link to the page it came from is
        // worse than the link alone.
        assertThat(content).containsEntry("targetType", "PROJECT");
        assertThat(content).containsEntry("state", "ADDRESSED_DIRECTLY");
        assertThat(campaignOf(content)).containsEntry("id", campaign.toString());
    }

    @Test
    @DisplayName("the content of a report is not readable by an account that is not staff")
    void theContentRefusesAnAccountThatIsNotStaff() {
        UUID campaign = liveCampaign(account("creator"));
        Account reporter = account("reporter");
        UUID report = idOf(post(
                        "/v1/projects/" + campaign + "/report", reporter.accessToken(), reportBody("SPAM", null))
                .getBody());

        // Including the reporter. A report is an accusation, and the evidence behind one
        // is read by the people who decide it.
        assertThat(get("/v1/admin/moderation/reports/" + report + "/content", reporter.accessToken())
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/v1/admin/moderation/reports/" + report + "/content", null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("asking about a report that does not exist is a 404, not an empty answer")
    void theContentOfAnUnknownReportIsNotFound() {
        ResponseEntity<Map<String, Object>> missing = get(
                "/v1/admin/moderation/reports/" + UUID.randomUUID() + "/content",
                moderator().accessToken());

        // Distinct from content that has gone, which is a 200 carrying GONE: "there is no
        // such report" and "the comment it was about has been purged" send a moderator to
        // two different places.
        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missing.getBody()).containsEntry("code", "REPORT_NOT_FOUND");
    }

    /** The evidence behind one report, as staff reads it. */
    private Map<String, Object> contentOf(UUID reportId) {
        ResponseEntity<Map<String, Object>> response =
                get("/v1/admin/moderation/reports/" + reportId + "/content", moderator().accessToken());

        assertThat(response.getStatusCode())
                .as("reading the evidence: %s", response.getBody())
                .isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> campaignOf(Map<String, Object> content) {
        return (Map<String, Object>) content.get("project");
    }

    private ResponseEntity<Map<String, Object>> delete(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.DELETE,
                new HttpEntity<>(bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }
}
