package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
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
 * Project updates over HTTP: who may publish one, who may read it, and when.
 *
 * <p>The tests that carry the design are
 * {@link #aBackersOnlyUpdateIsWithheldFromThePublic()} and
 * {@link #aScheduledUpdateAppearsWhenItsMomentArrives()}. The first is the one rule an
 * update has that a story does not — a creator writing to the people who paid them and
 * not to the internet — and getting it wrong in the other direction is not recoverable.
 * The second is the whole of CD-12's scheduling: there is no state column and no job, so
 * if the clock moving does not make an update appear, nothing else will.
 *
 * <p>Time is moved rather than waited for. {@code AdjustableClock} is the application's
 * {@link java.time.Clock}, so advancing it a week is indistinguishable, to the rule, from
 * a week passing.
 */
class ProjectUpdateApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void releaseTimeAndClearProjects() {
        // The context, and therefore the clock, is shared with every other
        // integration test. Leaving it frozen would break them somewhere else.
        clock.reset();

        // Updates cascade from projects; deleted explicitly anyway, because a
        // cleanup that relies on a cascade stops working the day the cascade is
        // reconsidered and nothing says why. The audit rows are deliberately left:
        // `audit_logs` refuses DELETE, which is the property it exists for.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM project_updates");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
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

    /** A campaign in DRAFT, owned by this account. */
    private UUID draft(Account creator) {
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("title", "A campaign with updates"), bearer(creator.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** A campaign the public can read: LIVE, which is one of §6.1's nine public states. */
    private UUID liveCampaign(Account creator) {
        UUID project = draft(creator);
        Campaigns.launch(dataSource, project);
        return project;
    }

    private static Map<String, Object> update(String title, String visibility, Instant publishAt) {
        // A LinkedHashMap rather than Map.of, because a scheduled update carries a
        // null publishAt in half these tests and Map.of refuses one.
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("body", "The moulds arrived and the first run starts on Monday.");
        body.put("visibility", visibility);
        body.put("publishAt", publishAt == null ? null : publishAt.toString());
        return body;
    }

    private ResponseEntity<Map<String, Object>> publish(UUID project, Account creator, Map<String, Object> body) {
        return rest.exchange(
                "/v1/projects/" + project + "/updates",
                HttpMethod.POST,
                new HttpEntity<>(body, bearer(creator.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> read(String path, String accessToken) {
        HttpHeaders headers = accessToken == null ? new HttpHeaders() : bearer(accessToken);
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> updatesIn(ResponseEntity<Map<String, Object>> response) {
        return (List<Map<String, Object>>) response.getBody().get("updates");
    }

    private List<Map<String, Object>> anonymousList(UUID project) {
        return updatesIn(read("/v1/projects/" + project + "/updates", null));
    }

    // ------------------------------------------------------------------
    // Publishing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a creator publishes an update and it is numbered 1")
    void anUpdateIsPublished() {
        Account creator = account("updates-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> published =
                publish(project, creator, update("Moulds arrived", "PUBLIC", null));

        assertThat(published.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(published.getBody()).containsEntry("number", 1);
        assertThat(published.getBody()).containsEntry("visibility", "PUBLIC");
        // Who wrote it, so that #38's collaborators are distinguishable from the
        // creator in a list.
        assertThat(published.getBody()).containsEntry("authorId", creator.id().toString());
        // Published now, so the public read must already be able to see it — there
        // is no job in between and no state to move.
        assertThat(published.getBody().get("publishedAt")).isNotNull();
    }

    @Test
    @DisplayName("the public list names each update, so a reader can report the one they read (#255)")
    void aListedUpdateCanBeReported() {
        Account creator = account("updates-creator");
        UUID project = liveCampaign(creator);
        ResponseEntity<Map<String, Object>> published =
                publish(project, creator, update("Moulds arrived", "PUBLIC", null));

        Map<String, Object> listed = anonymousList(project).getFirst();
        // The id the creator was answered with is the one every reader sees.
        assertThat(listed).containsEntry("id", published.getBody().get("id"));
        assertThat(listed.get("id")).isNotNull();

        ResponseEntity<Map<String, Object>> reported = rest.exchange(
                "/v1/updates/" + listed.get("id") + "/report",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("reason", "SPAM"), bearer(account("updates-reader").accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(reported.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
    }

    @Test
    @DisplayName("numbers are allocated in order, per campaign, starting again at 1")
    void numbersAreAllocatedPerCampaign() {
        Account creator = account("updates-numbering");
        UUID first = liveCampaign(creator);
        UUID second = liveCampaign(creator);

        assertThat(publish(first, creator, update("One", "PUBLIC", null)).getBody())
                .containsEntry("number", 1);
        assertThat(publish(first, creator, update("Two", "PUBLIC", null)).getBody())
                .containsEntry("number", 2);
        // "Update 1" means the first update of this campaign. A number shared across
        // the platform would be meaningless to a reader and would leak volume.
        assertThat(publish(second, creator, update("One", "PUBLIC", null)).getBody())
                .containsEntry("number", 1);
    }

    @Test
    @DisplayName("publishing is audited against the campaign")
    void publishingIsAudited() {
        Account creator = account("updates-audit");
        UUID project = liveCampaign(creator);

        publish(project, creator, update("Moulds arrived", "BACKERS_ONLY", null));

        // §5.5 makes an update an obligation and no endpoint takes one back, so
        // "who said this, on which campaign" has to be answerable by somebody who
        // was not in the room.
        var recorded = auditEntries.findByEntityTypeAndEntityIdOrderByOccurredAtDesc(
                AuditAction.PROJECT_UPDATE_PUBLISHED.entityType(), project);
        assertThat(recorded).isNotEmpty();
        assertThat(recorded.getFirst().getAction()).isEqualTo(AuditAction.PROJECT_UPDATE_PUBLISHED.action());
        assertThat(recorded.getFirst().getActorId()).isEqualTo(creator.id());
        // The number and the audience, and deliberately not the title or the body:
        // the audit table has no retention rule yet and must not accumulate copies
        // of content that lives elsewhere under one.
        assertThat(recorded.getFirst().getDetail()).contains("number=1", "visibility=BACKERS_ONLY");
    }

    // ------------------------------------------------------------------
    // Authorisation
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a stranger cannot publish to somebody else's campaign, and is told it does not exist")
    void aStrangerCannotPublish() {
        Account creator = account("updates-owner");
        Account stranger = account("updates-stranger");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused =
                publish(project, stranger, update("Not yours", "PUBLIC", null));

        // 404 rather than 403, as everywhere else: distinguishing "not yours" from
        // "not there" turns the endpoint into an oracle.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
        assertThat(anonymousList(project)).isEmpty();
    }

    @Test
    @DisplayName("publishing requires a token")
    void publishingRequiresTraceableIdentity() {
        Account creator = account("updates-anon-write");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/projects/" + project + "/updates",
                HttpMethod.POST,
                new HttpEntity<>(update("Anonymous", "PUBLIC", null), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        // The GET on this path is permitted without one; the POST falls through to
        // the filter chain's default. A rule that let one imply the other would
        // make every public read endpoint a write endpoint.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // Who sees what
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a backers-only update is withheld from the public and shown to the team")
    void aBackersOnlyUpdateIsWithheldFromThePublic() {
        Account creator = account("updates-audience");
        UUID project = liveCampaign(creator);

        publish(project, creator, update("Everyone", "PUBLIC", null));
        publish(project, creator, update("Backers", "BACKERS_ONLY", null));

        List<Map<String, Object>> anonymous = anonymousList(project);
        assertThat(anonymous).hasSize(1);
        assertThat(anonymous.getFirst()).containsEntry("title", "Everyone");

        // The creator reads their own campaign and sees both. Whether a *backer*
        // does is the gap this issue names rather than closes: the pledge module
        // publishes no "has this account backed this campaign", and failing closed
        // is the direction that cannot be taken back.
        List<Map<String, Object>> team =
                updatesIn(read("/v1/projects/" + project + "/updates", creator.accessToken()));
        assertThat(team).hasSize(2);
        assertThat(team.getFirst()).containsEntry("title", "Backers");
    }

    @Test
    @DisplayName("a signed-in stranger reads the campaign exactly as an anonymous visitor does")
    void aSignedInStrangerIsStillThePublic() {
        Account creator = account("updates-viewer-owner");
        Account stranger = account("updates-viewer-stranger");
        UUID project = liveCampaign(creator);

        publish(project, creator, update("Everyone", "PUBLIC", null));
        publish(project, creator, update("Backers", "BACKERS_ONLY", null));

        // Holding a token is not a relationship to the campaign. Anything else
        // would make "backers-only" mean "registered-only".
        assertThat(updatesIn(read("/v1/projects/" + project + "/updates", stranger.accessToken())))
                .hasSize(1);
    }

    @Test
    @DisplayName("a campaign that is not publicly visible answers 404, and its team still reads its updates")
    void aDraftIsInvisibleToThePublicAndReadableByItsTeam() {
        Account creator = account("updates-draft");
        UUID project = draft(creator);

        // A draft has no public page, so it can still be written to — a creator may
        // prepare the launch announcement — and it must not be readable.
        assertThat(publish(project, creator, update("Prepared", "PUBLIC", null)).getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        ResponseEntity<Map<String, Object>> anonymous = read("/v1/projects/" + project + "/updates", null);
        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(anonymous.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");

        assertThat(updatesIn(read("/v1/projects/" + project + "/updates", creator.accessToken())))
                .hasSize(1);
    }

    @Test
    @DisplayName("a campaign that does not exist answers 404")
    void anUnknownCampaignIsNotThere() {
        assertThat(read("/v1/projects/" + UUID.randomUUID() + "/updates", null).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // Scheduling
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a scheduled update appears when its moment arrives, with nothing running in between")
    void aScheduledUpdateAppearsWhenItsMomentArrives() {
        Account creator = account("updates-scheduled");
        UUID project = liveCampaign(creator);
        clock.freeze();

        Instant nextWeek = clock.instant().plus(Duration.ofDays(7));
        assertThat(publish(project, creator, update("Next week", "PUBLIC", nextWeek)).getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        // Not yet. There is no state column and no §8.4 job, so this is the whole
        // of the mechanism being asserted.
        assertThat(anonymousList(project)).isEmpty();
        // The creator can see what they scheduled, which is the only way to check it
        // before it goes out.
        assertThat(updatesIn(read("/v1/projects/" + project + "/updates", creator.accessToken())))
                .hasSize(1);

        clock.advance(Duration.ofDays(8));

        assertThat(anonymousList(project)).hasSize(1);
    }

    @Test
    @DisplayName("an update cannot be back-dated")
    void anUpdateCannotBePublishedInThePast() {
        Account creator = account("updates-backdate");
        UUID project = liveCampaign(creator);
        clock.freeze();

        ResponseEntity<Map<String, Object>> refused = publish(
                project, creator, update("Yesterday", "PUBLIC", clock.instant().minus(Duration.ofDays(1))));

        // Back-dating an announcement to people who were never told is not a thing
        // to accept silently, and the boundary is named so the client can move to it.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "UPDATE_SCHEDULE_INVALID");
        assertThat(refused.getBody().get("meta")).isInstanceOf(Map.class);
    }

    @Test
    @DisplayName("an update cannot be scheduled before the one that precedes it")
    void updatesStayInOrder() {
        Account creator = account("updates-order");
        UUID project = liveCampaign(creator);
        clock.freeze();

        publish(project, creator, update("Next month", "PUBLIC", clock.instant().plus(Duration.ofDays(30))));

        ResponseEntity<Map<String, Object>> refused = publish(
                project, creator, update("Next week", "PUBLIC", clock.instant().plus(Duration.ofDays(7))));

        // The page is ordered by a number allocated on insert, so allowing this
        // would put update 2 on the page three weeks before update 1.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "UPDATE_SCHEDULE_INVALID");
    }

    @Test
    @DisplayName("an update cannot be scheduled more than a year ahead")
    void schedulingIsBounded() {
        Account creator = account("updates-far-future");
        UUID project = liveCampaign(creator);
        clock.freeze();

        ResponseEntity<Map<String, Object>> refused = publish(
                project, creator, update("Eventually", "PUBLIC", clock.instant().plus(Duration.ofDays(400))));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "UPDATE_SCHEDULE_INVALID");
    }

    // ------------------------------------------------------------------
    // Content
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a blank title is refused, naming the field")
    void aBlankTitleIsRefused() {
        Account creator = account("updates-blank");
        UUID project = liveCampaign(creator);

        Map<String, Object> body = update("   ", "PUBLIC", null);
        ResponseEntity<Map<String, Object>> refused = publish(project, creator, body);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "UPDATE_CONTENT_INVALID");
        // Beside the input rather than in a banner above eight hundred words the
        // creator has just written.
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "title"));
    }

    @Test
    @DisplayName("an omitted visibility is refused rather than defaulted")
    void visibilityIsRequired() {
        Account creator = account("updates-no-visibility");
        UUID project = liveCampaign(creator);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "Moulds arrived");
        body.put("body", "The first run starts on Monday.");

        // A default of PUBLIC would publish to the internet something written for
        // backers the first time a client forgot the field.
        assertThat(publish(project, creator, body).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(anonymousList(project)).isEmpty();
    }

    // ------------------------------------------------------------------
    // Reading the list
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the list is newest first and pages by cursor")
    void theListPagesByCursor() {
        Account creator = account("updates-paging");
        UUID project = liveCampaign(creator);
        for (int i = 1; i <= 5; i++) {
            publish(project, creator, update("Update " + i, "PUBLIC", null));
        }

        ResponseEntity<Map<String, Object>> firstPage =
                read("/v1/projects/" + project + "/updates?limit=2", null);
        List<Map<String, Object>> first = updatesIn(firstPage);

        assertThat(first).hasSize(2);
        // Newest first: nobody opens a campaign to look at update 1.
        assertThat(first.getFirst()).containsEntry("number", 5);
        assertThat(first.getLast()).containsEntry("number", 4);
        assertThat(firstPage.getBody()).containsEntry("nextCursor", 4);

        List<Map<String, Object>> second =
                updatesIn(read("/v1/projects/" + project + "/updates?limit=2&cursor=4", null));
        assertThat(second).hasSize(2);
        assertThat(second.getFirst()).containsEntry("number", 3);

        ResponseEntity<Map<String, Object>> lastPage =
                read("/v1/projects/" + project + "/updates?limit=2&cursor=2", null);
        assertThat(updatesIn(lastPage)).hasSize(1);
        // Null rather than absent, so a client tests for "there is more" without
        // knowing that the cursor happens to be a number.
        assertThat(lastPage.getBody()).containsKey("nextCursor");
        assertThat(lastPage.getBody().get("nextCursor")).isNull();
    }

    @Test
    @DisplayName("a page the caller already holds answers 304")
    void anUnchangedPageIsNotResent() {
        Account creator = account("updates-etag");
        UUID project = liveCampaign(creator);
        publish(project, creator, update("Moulds arrived", "PUBLIC", null));

        ResponseEntity<Map<String, Object>> firstRead = read("/v1/projects/" + project + "/updates", null);
        String etag = firstRead.getHeaders().getETag();
        assertThat(etag).isNotNull();
        // §10.3 asks for both on a public read. A cache with no policy invents one.
        assertThat(firstRead.getHeaders().getCacheControl()).contains("no-cache").contains("public");

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<Void> revalidated = rest.exchange(
                "/v1/projects/" + project + "/updates",
                HttpMethod.GET,
                new HttpEntity<>(conditional),
                Void.class);

        assertThat(revalidated.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        // The policy is on the 304 as well, which checkNotModified writes itself —
        // a 304 without it leaves a cache deciding how long the stored body lasts.
        assertThat(revalidated.getHeaders().getCacheControl()).contains("no-cache");
    }

    @Test
    @DisplayName("the team's page is private, because it carries what nobody has been shown")
    void theTeamsPageIsNotShareable() {
        Account creator = account("updates-private");
        UUID project = liveCampaign(creator);
        publish(project, creator, update("Backers", "BACKERS_ONLY", null));

        ResponseEntity<Map<String, Object>> team =
                read("/v1/projects/" + project + "/updates", creator.accessToken());

        // The two audiences share a URL, so the response has to say for itself that
        // it is not shareable.
        assertThat(team.getHeaders().getCacheControl()).contains("private");
    }

    @Test
    @DisplayName("a campaign with no updates answers an empty page rather than a 404")
    void anEmptyCampaignHasAnEmptyList() {
        Account creator = account("updates-empty");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> response = read("/v1/projects/" + project + "/updates", null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(updatesIn(response)).isEmpty();
        assertThat(response.getBody()).containsKey("nextCursor");
    }
}
