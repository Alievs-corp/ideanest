package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.staff.domain.StaffRole;
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
 * The console's answer to "what campaigns are there".
 *
 * <p>The gap this closes is the one the submission queue could not: that queue lists
 * campaigns waiting on a moderator, the report queue lists campaigns somebody complained
 * about, and the suspension endpoint takes an id a member of staff already has. A
 * campaign that is simply a draft, or simply live, appeared in none of them.
 * {@link #aDraftIsListedWithoutHavingDoneAnything()} is that sentence as a test.
 *
 * <p>The two that carry the rest of the design are
 * {@link #anUnreviewableStateIsAnEmptyPageRatherThanARefusal()} — the deliberate
 * difference from the queue — and {@link #pagingWalksTheListWithoutRepeatingOrSkipping()},
 * which is what the {@code (created_at, id)} keyset exists for.
 */
class CampaignDirectoryApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The address {@code application-test.yml} lists as staff. */
    private static final String STAFF_EMAIL = "moderator@ideanest.test";

    private static final String DIRECTORY = "/v1/admin/projects";

    private static final String ROLE_FIXTURE_NOTE = "CampaignDirectoryApiTests fixture";

    private static Account STAFF;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clearProjects() {
        // Campaigns reference users and deliberately do not cascade from them, so rows
        // left here break the identity suites' own cleanup.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
        jdbc.update("DELETE FROM staff_role_grants WHERE note = ?", ROLE_FIXTURE_NOTE);
    }

    // ------------------------------------------------------------------
    // The gap
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a draft is listed without having been submitted or reported")
    void aDraftIsListedWithoutHavingDoneAnything() {
        Account creator = creator();
        UUID id = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Never submitted"))
                .getBody());

        List<Map<String, Object>> campaigns = campaignsIn(directory(""));

        // Every other way into a campaign starts from something the campaign did. This
        // one does not, which is the whole point of it.
        assertThat(campaigns).anySatisfy(row -> assertThat(row).containsEntry("projectId", id.toString()));
    }

    @Test
    @DisplayName("a campaign that has said nothing about money is listed with no goal rather than left out")
    void aDraftWithoutAGoalIsStillListed() {
        Account creator = creator();
        UUID id = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Nothing filled in yet"))
                .getBody());

        Map<String, Object> row = rowFor(directory(""), id);

        assertThat(row.get("goal")).as("a draft has not said what it needs yet").isNull();
        // Zero is a figure. Leaving it out would read as "not known", and what is known
        // is that nobody has pledged.
        assertThat(row.get("pledged")).isNotNull();
        assertThat(row).containsEntry("backersCount", 0);
    }

    @Test
    @DisplayName("a row carries what staff need to recognise a campaign")
    void aRowCarriesWhatStaffNeedToRecogniseACampaign() {
        Account creator = creator();
        UUID id = idOf(submittableDraft(creator, "A campaign with everything on it"));

        Map<String, Object> row = rowFor(directory(""), id);

        assertThat(row).containsEntry("title", "A campaign with everything on it");
        assertThat(row).containsEntry("state", "DRAFT");
        assertThat(row).containsEntry("creatorId", creator.id().toString());
        assertThat(row).containsEntry("creatorName", "Test Creator");
        assertThat(row.get("createdAt")).as("when it was started, which is the order of this list").isNotNull();
        // Never live, so neither instant exists yet -- and null rather than an epoch,
        // which would draw as 1970 on a screen.
        assertThat(row.get("launchedAt")).isNull();
        assertThat(row.get("deadline")).isNull();

        @SuppressWarnings("unchecked")
        Map<String, Object> goal = (Map<String, Object>) row.get("goal");
        // §10.3: money crosses as a string, never a number.
        assertThat(goal.get("amount")).isInstanceOf(String.class);
    }

    // ------------------------------------------------------------------
    // Ordering and filtering
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the list is newest first, because the question is what is there rather than what has waited")
    void theListIsNewestFirst() {
        Account creator = creator();
        UUID first = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Started first")).getBody());
        UUID second = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Started second")).getBody());

        List<String> order =
                campaignsIn(directory("")).stream().map(row -> (String) row.get("projectId")).toList();

        assertThat(order).containsExactly(second.toString(), first.toString());
    }

    @Test
    @DisplayName("a state narrows the list to that state alone")
    void aStateNarrowsTheList() {
        Account creator = creator();
        UUID draft = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Still a draft")).getBody());
        UUID submitted = submitted(creator, "Sent for review");

        List<String> submittedOnly = campaignsIn(directory("?state=SUBMITTED")).stream()
                .map(row -> (String) row.get("projectId"))
                .toList();

        assertThat(submittedOnly).containsExactly(submitted.toString());
        assertThat(submittedOnly).doesNotContain(draft.toString());
    }

    @Test
    @DisplayName("a state nobody is in is an empty page, not a refusal")
    void anUnreviewableStateIsAnEmptyPageRatherThanARefusal() {
        Account creator = creator();
        submitted(creator, "Sent for review");

        ResponseEntity<Map<String, Object>> live = get(DIRECTORY + "?state=LIVE", staff().accessToken());

        // The deliberate difference from the submission queue, which refuses this with
        // UNREVIEWABLE_STATE. That endpoint is asking what can be decided, so "no
        // campaigns are LIVE for review" reads as nonsense. This one is asking what is
        // on the platform, where "none are live" is an answer.
        assertThat(live.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(campaignsIn(live.getBody())).isEmpty();
        assertThat(live.getBody()).containsEntry("state", "LIVE");
    }

    @Test
    @DisplayName("a state outside §6.1 is a bad request rather than an empty page")
    void aStateOutsideTheEnumIsRefused() {
        ResponseEntity<Map<String, Object>> refused = get(DIRECTORY + "?state=WONDERFUL", staff().accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // ------------------------------------------------------------------
    // Searching - issue #404
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a search matches a fragment of the title and leaves the rest out")
    void aSearchMatchesPartOfATitle() {
        Account creator = creator();
        UUID wanted = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Handmade ceramic bowls"))
                .getBody());
        UUID other = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "A documentary film"))
                .getBody());

        List<String> found = idsIn(directory("?query=ceramic"));

        // The defect #404 opened on: this is the only screen that lists campaigns in every
        // state, and it had no input of any kind. Finding one among hundreds meant paging.
        assertThat(found).containsExactly(wanted.toString());
        assertThat(found).doesNotContain(other.toString());
    }

    @Test
    @DisplayName("a search folds the letters of \u00a711.3, so kohne finds K\u00f6hn\u0259")
    void aSearchFoldsTheAzerbaijaniLetters() {
        Account creator = creator();
        UUID wanted = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "K\u00f6hn\u0259 \u015e\u0259h\u0259r"))
                .getBody());

        // The same fold public search uses, over the same index V13 built. A console whose
        // search needed the right keyboard would be a console nobody uses from a phone.
        assertThat(idsIn(directory("?query=kohne"))).contains(wanted.toString());
    }

    @Test
    @DisplayName("a search matches the creator, not only the campaign")
    void aSearchMatchesTheCreator() {
        Account creator = creator();
        UUID theirs = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Nothing in the title"))
                .getBody());

        // "Test Creator" is the name the fixture registers. #404 asks for title, creator and
        // identifier, because those are the three things a complaint arrives holding.
        // A space as `+`: see `directory` on why `%20` does not survive the test client.
        assertThat(idsIn(directory("?query=test+creator"))).contains(theirs.toString());
    }

    @Test
    @DisplayName("a whole identifier finds the campaign it names, and only that one")
    void anIdentifierIsMatchedExactly() {
        Account creator = creator();
        UUID wanted = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "First")).getBody());
        post("/v1/projects", creator.accessToken(), Map.of("title", "Second"));

        assertThat(idsIn(directory("?query=" + wanted))).containsExactly(wanted.toString());
    }

    @Test
    @DisplayName("a creator identifier as the search term finds everything they made")
    void aCreatorIdentifierAsATermFindsTheirCampaigns() {
        Account creator = creator();
        UUID first = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "One")).getBody());
        UUID second = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Two")).getBody());
        UUID somebodyElses =
                idOf(post("/v1/projects", creator().accessToken(), Map.of("title", "Three")).getBody());

        List<String> found = idsIn(directory("?query=" + creator.id()));

        assertThat(found).containsExactlyInAnyOrder(second.toString(), first.toString());
        assertThat(found).doesNotContain(somebodyElses.toString());
    }

    @Test
    @DisplayName("a search combines with a state rather than replacing it")
    void aSearchCombinesWithTheStateFilter() {
        Account creator = creator();
        UUID draft = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Lantern festival"))
                .getBody());
        UUID sent = submitted(creator, "Lantern workshop");

        assertThat(idsIn(directory("?query=lantern&state=SUBMITTED"))).containsExactly(sent.toString());
        assertThat(idsIn(directory("?query=lantern&state=DRAFT"))).containsExactly(draft.toString());
    }

    @Test
    @DisplayName("a wildcard a caller typed is searched for rather than matching everything")
    void aTypedWildcardIsEscaped() {
        Account creator = creator();
        post("/v1/projects", creator.accessToken(), Map.of("title", "An ordinary campaign"));

        // A percent sign reaching the LIKE unescaped would make this the whole directory.
        assertThat(idsIn(directory("?query=%25"))).isEmpty();
    }

    @Test
    @DisplayName("a blank search is no search rather than a search for nothing")
    void aBlankSearchIsNoSearch() {
        Account creator = creator();
        UUID id = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Anything"))
                .getBody());

        Map<String, Object> body = directory("?query=++");

        assertThat(idsIn(body)).contains(id.toString());
        // Echoed as absent, so a cleared form behaves like a fresh one and the client can
        // see which of the two the answer is.
        assertThat(body.get("query")).isNull();
    }

    @Test
    @DisplayName("the search that was applied is echoed, trimmed")
    void theAppliedSearchIsEchoed() {
        Map<String, Object> body = directory("?query=+ceramic+");

        // A screen with two reads in flight has to be able to tell which answer it is
        // holding; a term echoed untrimmed would not match what it sent.
        assertThat(body).containsEntry("query", "ceramic");
    }

    @Test
    @DisplayName("a creator filter lists that person's campaigns and nobody else's")
    void aCreatorFilterNarrowsToOnePerson() {
        Account creator = creator();
        Account other = creator();
        UUID theirs = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Mine")).getBody());
        UUID notTheirs = idOf(post("/v1/projects", other.accessToken(), Map.of("title", "Theirs")).getBody());

        Map<String, Object> body = directory("?creatorId=" + creator.id());

        // What the console's account detail screen is built on: #404 asks that a moderator
        // can see what somebody created before deciding whether to suspend them.
        assertThat(idsIn(body)).containsExactly(theirs.toString());
        assertThat(idsIn(body)).doesNotContain(notTheirs.toString());
        assertThat(body).containsEntry("creatorId", creator.id().toString());
    }

    @Test
    @DisplayName("a creator who has made nothing is an empty page rather than a refusal")
    void aCreatorWithNoCampaignsIsAnEmptyPage() {
        Account nobody = creator();

        ResponseEntity<Map<String, Object>> body =
                get(DIRECTORY + "?creatorId=" + nobody.id(), staff().accessToken());

        assertThat(body.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(campaignsIn(body.getBody())).isEmpty();
    }

    @Test
    @DisplayName("searching pages, and the second page continues rather than repeating")
    void aSearchPagesLikeTheUnfilteredList() {
        Account creator = creator();
        UUID first = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Bowl one")).getBody());
        UUID second = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Bowl two")).getBody());
        UUID third = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Bowl three")).getBody());

        Map<String, Object> page = directory("?query=bowl&limit=2");
        assertThat(idsIn(page)).containsExactly(third.toString(), second.toString());

        // The keyset has to carry the filter with it, or page two is the whole directory.
        Map<String, Object> next = directory("?query=bowl&limit=2&after=" + page.get("nextCursor"));
        assertThat(idsIn(next)).containsExactly(first.toString());
    }

    // ------------------------------------------------------------------
    // Who may read it
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the directory refuses an account that is not platform staff")
    void theDirectoryRefusesAnAccountThatIsNotStaff() {
        Account stranger = creator();

        ResponseEntity<Map<String, Object>> refused = get(DIRECTORY, stranger.accessToken());

        // This lists drafts -- private working documents their creators have shown
        // nobody. Serving them to anybody with an account is the failure the capability
        // check exists to prevent.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("the directory refuses a request with no credentials at all")
    void theDirectoryRefusesAnAnonymousRequest() {
        ResponseEntity<Map<String, Object>> refused = get(DIRECTORY, null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a curator can search the list, because curating a campaign starts with finding it")
    void aCuratorCanSearchTheDirectory() {
        Account creator = creator();
        UUID id = submitted(creator, "Pottery kiln for the village");
        Account curator = staff("directory-curator", StaffRole.CURATOR);

        ResponseEntity<Map<String, Object>> found = get(DIRECTORY + "?query=kiln", curator.accessToken());

        assertThat(found.getStatusCode()).as("%s", found.getBody()).isEqualTo(HttpStatus.OK);
        assertThat(idsIn(found.getBody())).containsExactly(id.toString());
    }

    @Test
    @DisplayName("a curator still cannot read the preview, which is everything a creator wrote")
    void aCuratorCannotReadThePreview() {
        UUID id = submitted(creator(), "Not for curators to read in full");
        Account curator = staff("directory-curator", StaffRole.CURATOR);

        ResponseEntity<Map<String, Object>> refused = get(DIRECTORY + "/" + id, curator.accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("staff who neither moderate nor curate are still refused the list")
    void financeIsRefusedTheDirectory() {
        Account finance = staff("directory-finance", StaffRole.FINANCE);

        ResponseEntity<Map<String, Object>> refused = get(DIRECTORY, finance.accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ------------------------------------------------------------------
    // The staff preview — #399
    // ------------------------------------------------------------------

    @Test
    @DisplayName("staff can read a campaign the public cannot, which is the whole of #399")
    void aCampaignInReviewIsReadableByStaffAndNotByAnybodyElse() {
        Account creator = creator();
        UUID id = submitted(creator, "Waiting on a decision");

        ResponseEntity<Map<String, Object>> preview = get(DIRECTORY + "/" + id, staff().accessToken());
        assertThat(preview.getStatusCode())
                .as("the moderator deciding this campaign: %s", preview.getBody())
                .isEqualTo(HttpStatus.OK);
        assertThat(preview.getBody()).containsEntry("title", "Waiting on a decision");
        assertThat(preview.getBody()).containsEntry("state", "SUBMITTED");

        // And the link that used to be the queue's only route to the campaign. It is a
        // 404 by construction — a campaign in review is not public, which is what being
        // in review means — so approval was happening on a title and a goal figure.
        @SuppressWarnings("unchecked")
        Map<String, Object> creatorBlock = (Map<String, Object>) preview.getBody().get("creator");
        ResponseEntity<Map<String, Object>> publicPage = get(
                "/v1/projects/" + creatorBlock.get("slug") + "/" + preview.getBody().get("slug"), null);
        assertThat(publicPage.getStatusCode())
                .as("the public page for the same campaign")
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("the preview carries the story, which is the thing a decision is actually about")
    void thePreviewCarriesWhatTheCreatorWrote() {
        Account creator = creator();
        UUID id = idOf(submittableDraft(creator, "A campaign with a story"));

        ResponseEntity<Map<String, Object>> preview = get(DIRECTORY + "/" + id, staff().accessToken());

        assertThat(preview.getStatusCode()).isEqualTo(HttpStatus.OK);
        // A draft: not public in any state, and the one a moderator has least other
        // ways of reading.
        assertThat(preview.getBody()).containsEntry("state", "DRAFT");
        assertThat(preview.getBody().get("story"))
                .as("the document, parsed, rather than a string containing JSON")
                .isInstanceOf(Map.class);
        assertThat(preview.getBody().get("risks")).isNotNull();
    }

    @Test
    @DisplayName("the preview refuses an account that is not platform staff")
    void thePreviewRefusesAnAccountThatIsNotStaff() {
        Account creator = creator();
        UUID id = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Somebody's draft"))
                .getBody());

        ResponseEntity<Map<String, Object>> refused = get(DIRECTORY + "/" + id, creator().accessToken());

        // Including the creator's own neighbour: this endpoint serves any campaign in any
        // state, so the only thing standing between a signed-in stranger and every draft
        // on the platform is this check.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("the preview refuses a request with no credentials at all")
    void thePreviewRefusesAnAnonymousRequest() {
        Account creator = creator();
        UUID id = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Somebody's draft"))
                .getBody());

        assertThat(get(DIRECTORY + "/" + id, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("an identifier that names no campaign is a 404")
    void thePreviewIsNotFoundForAnIdentifierThatNamesNothing() {
        ResponseEntity<Map<String, Object>> missing =
                get(DIRECTORY + "/" + UUID.randomUUID(), staff().accessToken());

        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // Paging
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a full page carries a cursor and the next page continues from it")
    void pagingWalksTheListWithoutRepeatingOrSkipping() {
        Account creator = creator();
        UUID first = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "First")).getBody());
        UUID second = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Second")).getBody());
        UUID third = idOf(post("/v1/projects", creator.accessToken(), Map.of("title", "Third")).getBody());

        Map<String, Object> page = directory("?limit=2");
        assertThat(campaignsIn(page).stream().map(row -> row.get("projectId")).toList())
                .as("newest first")
                .containsExactly(third.toString(), second.toString());
        assertThat(page.get("nextCursor")).as("a full page may have more behind it").isNotNull();

        Map<String, Object> next = directory("?limit=2&after=" + page.get("nextCursor"));
        assertThat(campaignsIn(next).stream().map(row -> row.get("projectId")).toList())
                .as("the second page continues rather than repeating")
                .containsExactly(first.toString());
        assertThat(next.get("nextCursor"))
                .as("a short page is the end, and says so without costing a request to find out")
                .isNull();
    }

    @Test
    @DisplayName("an empty platform is an empty list rather than a failure")
    void anEmptyDirectoryIsAnEmptyList() {
        Map<String, Object> body = directory("");

        assertThat(campaignsIn(body)).isEmpty();
        assertThat(body.get("nextCursor")).isNull();
        // No filter was asked for, and the answer says so rather than inventing one.
        assertThat(body.get("state")).isNull();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    /** The identifiers on a page, in the order they came back. */
    private static List<String> idsIn(Map<String, Object> body) {
        return campaignsIn(body).stream().map(row -> (String) row.get("projectId")).toList();
    }

    private Account creator() {
        // Its own prefix: two suites sharing one handle sign in as each other's accounts
        // and fail three frames from the cause.
        EmailAddress email = EmailAddress.of("campaign-directory" + SEQUENCE.incrementAndGet() + "@example.com");
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
        // Submitting needs a plan since #368.
        Campaigns.mayPublish(dataSource, id);
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    /**
     * The staff account, with a minted token rather than a sign-in.
     *
     * <p>A dozen suites share this address and {@code sign-ins-per-email} is left at its
     * real value of five, so signing in here spends one of those five and fails somebody
     * else's suite with a 401 that has nothing to do with them.
     */
    private Account staff() {
        if (STAFF != null) {
            return STAFF;
        }
        EmailAddress email = EmailAddress.of(STAFF_EMAIL);
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

        STAFF = new Account(accessToken, id);
        return STAFF;
    }

    /** Somebody holding one role, granted with SQL for the reason {@code ConsoleReadApiTests} gives. */
    private Account staff(String slug, StaffRole role) {
        EmailAddress email = EmailAddress.of(slug + "@ideanest.test");
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test " + role.name()),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT DO NOTHING
                        """,
                        id,
                        role.name(),
                        staff().id(),
                        ROLE_FIXTURE_NOTE);

        String accessToken = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    /** A draft §5.3 is satisfied with — see {@code SubmissionQueueApiTests} for the order. */
    private Map<String, Object> submittableDraft(Account creator, String title) {
        Map<String, Object> draft = post("/v1/projects", creator.accessToken(), Map.of("title", title))
                .getBody();
        return patch("/v1/projects/" + idOf(draft), creator.accessToken(), Campaigns.completeBasics(categories))
                .getBody();
    }

    private UUID submitted(Account creator, String title) {
        UUID id = idOf(submittableDraft(creator, title));
        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + id + "/submit", creator.accessToken(), null);

        // Asserted rather than assumed. A refused submission leaves the campaign in DRAFT
        // and every assertion downstream reads as "the filter is broken".
        assertThat(submitted.getStatusCode())
                .as("submitting %s: %s", title, submitted.getBody())
                .isEqualTo(HttpStatus.OK);
        return id;
    }

    private static UUID idOf(Map<String, Object> project) {
        return UUID.fromString((String) project.get("id"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> campaignsIn(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("campaigns");
    }

    private static Map<String, Object> rowFor(Map<String, Object> body, UUID projectId) {
        return campaignsIn(body).stream()
                .filter(row -> projectId.toString().equals(row.get("projectId")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No row for " + projectId + " in " + body));
    }

    /** The directory as staff sees it. */
    /**
     * One page of the directory, as staff.
     *
     * <p><strong>A space in {@code query} is written {@code +}, never {@code %20}.</strong>
     * {@code TestRestTemplate} takes this string as a URI template and encodes the {@code %}
     * in it, so {@code %20} reaches the service as the three characters {@code %20} and the
     * search looks for them. {@code +} is the query-string spelling of a space, Tomcat decodes
     * it, and it is what the browser sends anyway — {@code URLSearchParams} encodes a space as
     * {@code +}.
     */
    private Map<String, Object> directory(String query) {
        ResponseEntity<Map<String, Object>> response = get(DIRECTORY + query, staff().accessToken());
        assertThat(response.getStatusCode()).as("reading the directory: %s", response.getBody()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(headers(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> patch(String path, String accessToken, Object body) {
        return rest.exchange(
                path,
                HttpMethod.PATCH,
                new HttpEntity<>(body, headers(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(body, headers(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders headers(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        if (accessToken != null) {
            headers.setBearerAuth(accessToken);
        }
        return headers;
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
