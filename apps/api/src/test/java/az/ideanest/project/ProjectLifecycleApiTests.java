package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.domain.ActorRole;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.ProjectStateTransition;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.project.infrastructure.ProjectStateTransitionRepository;
import az.ideanest.project.infrastructure.SubcategoryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
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
 * A campaign's life, over HTTP.
 *
 * <p>The tests that carry the design are
 * {@link #everyTransitionWritesExactlyOneAuditRow()} — the reason the transition
 * service exists at all — and {@link #autosavingOneFieldLeavesTheRestAlone()},
 * which is what stands between a creator's work and a partial update that erases
 * what it did not mention.
 */
class ProjectLifecycleApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** Shared across the class. See {@link #moderator()} for why it is cached. */
    private static Creator MODERATOR;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private SubcategoryRepository subcategories;

    @Autowired
    private ProjectStateTransitionRepository transitions;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clearProjects() {
        // Campaigns reference users and deliberately do not cascade from them, so a
        // suite that left rows here would break the identity tests' own cleanup.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Creator(String accessToken, UUID id) {
    }

    private Creator creator() {
        EmailAddress email = EmailAddress.of("creator" + SEQUENCE.incrementAndGet() + "@example.com");
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
        // Publishing needs a plan since V62. Written rather than bought, because this
        // suite is not about them -- Campaigns.mayPublish carries both preconditions.
        Campaigns.mayPublish(dataSource, id);
        return new Creator((String) signedIn.getBody().get("accessToken"), id);
    }

    /**
     * The one account this suite's configuration treats as platform staff.
     *
     * <p>Registered and signed in once for the whole class rather than per test,
     * because the address is fixed — {@code application-test.yml} names it — and
     * the auth module's per-email sign-in limit is deliberately realistic. Every
     * other account in the file is therefore a non-moderator, which is what makes
     * {@link #moderationRefusesAnAccountThatIsNotStaff()} the default case rather
     * than a special one.
     */
    private Creator moderator() {
        if (MODERATOR != null) {
            return MODERATOR;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        MODERATOR = new Creator((String) signedIn.getBody().get("accessToken"), id);
        return MODERATOR;
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
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> patch(String path, String accessToken, Map<String, Object> body) {
        return rest.exchange(
                path,
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /**
     * A patch sent as literal JSON.
     *
     * <p>Needed for the tests about clearing a field. The application's Jackson is
     * configured with {@code default-property-inclusion: non_null}, and
     * {@link TestRestTemplate} shares it — so a {@link Map} containing a null value
     * is serialised with that key <em>omitted</em>, which is the opposite of what
     * those tests are checking. Writing the body by hand is the only way to be sure
     * the null actually crossed the wire.
     */
    private ResponseEntity<Map<String, Object>> patchJson(String path, String accessToken, String body) {
        return rest.exchange(
                path,
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /** A draft, created through the endpoint a client would use. */
    private Map<String, Object> draft(Creator creator, String title) {
        return post("/v1/projects", creator.accessToken(), Map.of("title", title)).getBody();
    }

    private static UUID idOf(Map<String, Object> project) {
        return UUID.fromString((String) project.get("id"));
    }

    /**
     * A draft §5.3 is satisfied with, in the state a submission starts from.
     *
     * <p>Everything the completeness checklist blocks on, and nothing it merely
     * advises: no subcategory, no scheduled launch, no reward tiers, and a story
     * with no pictures in it. So a campaign built by this fixture can be submitted
     * and is deliberately not "finished" — which is what
     * {@code ProjectChecklistApiTests} uses to tell advice apart from refusal.
     */
    private Map<String, Object> submittableDraft(Creator creator, String title) {
        Map<String, Object> project = draft(creator, title);

        return patch(
                        "/v1/projects/" + idOf(project),
                        creator.accessToken(),
                        Campaigns.completeBasics(categories))
                .getBody();
    }

    /**
     * A campaign that is taking money, reached the way a real one is.
     *
     * <p>Through the endpoints rather than by writing {@code state = 'LIVE'} into the
     * row: the launch is what stamps {@code launched_at} and computes the deadline,
     * and a fixture that set the state by hand would let a test pass against a
     * campaign that could never exist. Moderation is part of the path, which is why
     * this takes the moderator as well.
     */
    private UUID liveCampaign(Creator creator, Creator moderator, String title) {
        UUID id = idOf(submittableDraft(creator, title));
        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);
        post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null);
        post("/v1/projects/" + id + "/launch", creator.accessToken(), null);
        return id;
    }

    @SuppressWarnings("unchecked")
    private static List<String> lockedFieldsOf(Map<String, Object> project) {
        return (List<String>) project.get("lockedFields");
    }

    private List<ProjectStateTransition> historyOf(UUID projectId) {
        return transitions.findByProjectIdOrderByCreatedAtAsc(projectId);
    }

    // ------------------------------------------------------------------
    // Creating a draft
    // ------------------------------------------------------------------

    @Test
    @DisplayName("creating a draft returns it in DRAFT, with a slug and a location")
    void creatingADraft() {
        Creator creator = creator();

        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects", creator.accessToken(), Map.of("title", "Səbinə's Coffee Table Book"));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map<String, Object> project = created.getBody();
        assertThat(project.get("state")).isEqualTo("DRAFT");
        assertThat(project.get("title")).isEqualTo("Səbinə's Coffee Table Book");
        // Folded by Slugs, which is written for Azerbaijani: ə has no Unicode
        // decomposition, so a library that assumed Latin-1 would leave it in the URL.
        assertThat(project.get("slug")).isEqualTo("sebine-s-coffee-table-book");
        // The client's next request is the editor projection, and a created resource
        // should say where it is.
        assertThat(created.getHeaders().getLocation())
                .hasToString("/v1/projects/" + project.get("id") + "/edit");

        // Nothing §5.3 requires is demanded here: the editor is reached by creating
        // the campaign, so a draft that needed a goal would be a form behind a form.
        assertThat(project.get("goal")).isNull();
        assertThat(project.get("categoryId")).isNull();
        // Nothing is frozen in a draft: §5.3 freezes the goal and the deadline at
        // launch, and this campaign has not been shown to anybody.
        assertThat(project).containsEntry("lockedFields", List.of());
    }

    @Test
    @DisplayName("a title that folds to nothing still produces a usable slug")
    void anUntransliterableTitleStillGetsASlug() {
        Creator creator = creator();

        // A title written entirely in a script Slugs does not transliterate. Slugs
        // returns an empty string and leaves the decision here, rather than
        // inventing one and hiding the case.
        Map<String, Object> project = draft(creator, "日本語のタイトル");

        assertThat(project.get("slug")).isEqualTo("project");
    }

    @Test
    @DisplayName("two drafts with the same title get different slugs")
    void slugsAreDisambiguatedPerCreator() {
        Creator creator = creator();

        assertThat(draft(creator, "Untitled").get("slug")).isEqualTo("untitled");
        // The unique index is per creator, so the second one has to be numbered
        // rather than refused.
        assertThat(draft(creator, "Untitled").get("slug")).isEqualTo("untitled-2");
    }

    @Test
    @DisplayName("a title that slugs to a route segment is numbered from the start (#148)")
    void reservedSlugsAreSkipped() {
        Creator creator = creator();

        // /projects/{creator}/back is the checkout, so "back" is never an address.
        assertThat(draft(creator, "Back").get("slug")).isEqualTo("back-2");
        assertThat(draft(creator, "Dashboard").get("slug")).isEqualTo("dashboard-2");
        assertThat(draft(creator, "Back").get("slug")).isEqualTo("back-3");
    }

    @Test
    @DisplayName("an unauthenticated caller cannot create a campaign")
    void creatingIsBehindAuthentication() {
        assertThat(rest.exchange(
                                "/v1/projects",
                                HttpMethod.POST,
                                new HttpEntity<>(Map.of("title", "A campaign"), jsonHeaders()),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a title longer than sixty characters is refused")
    void titleLengthIsValidated() {
        Creator creator = creator();

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects", creator.accessToken(), Map.of("title", "t".repeat(61)));

        // §5.3, answered as a 400 naming the field rather than as a constraint
        // violation and a 500.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // ------------------------------------------------------------------
    // Editing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("autosaving one field leaves the rest alone")
    void autosavingOneFieldLeavesTheRestAlone() {
        Creator creator = creator();
        Map<String, Object> project = submittableDraft(creator, "A campaign");
        UUID id = idOf(project);

        // The editor autosaves one field at a time, so this body is the normal case.
        Map<String, Object> saved = patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "A better title"))
                .getBody();

        assertThat(saved.get("title")).isEqualTo("A better title");
        // Everything the client did not mention survives. Read as "set the title and
        // clear the rest", this request would have deleted the creator's work — and
        // it would look entirely ordinary in a log.
        assertThat(saved.get("blurb")).isEqualTo(project.get("blurb"));
        assertThat(saved.get("goal")).isEqualTo(project.get("goal"));
        assertThat(saved.get("durationDays")).isEqualTo(30);
        assertThat(saved.get("risks")).isEqualTo(project.get("risks"));
        // And the slug does not follow the title: it is in the public URL, and every
        // link already shared would break.
        assertThat(saved.get("slug")).isEqualTo(project.get("slug"));
    }

    @Test
    @DisplayName("an explicit null clears a field")
    void anExplicitNullClearsAField() {
        Creator creator = creator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));

        // RFC 7396: null removes the member. Told apart from absence above, which is
        // the whole reason the request type does not use Optional.
        assertThat(patchJson("/v1/projects/" + id, creator.accessToken(), "{\"blurb\": null}")
                        .getBody())
                .containsEntry("blurb", null);
    }

    @Test
    @DisplayName("the goal is money: a string on the wire, exact underneath")
    void theGoalIsMoney() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));

        ResponseEntity<String> saved = rest.exchange(
                "/v1/projects/" + id,
                HttpMethod.PATCH,
                new HttpEntity<>(
                        Map.of("goal", Map.of("amount", "5000", "currency", "AZN")), bearer(creator.accessToken())),
                String.class);

        // §10.3: a string, never a number, because a JSON number is an IEEE 754
        // double in every mainstream parser. Padded to the scale of the column, so a
        // client comparing what it sent with what it got back is not told the value
        // changed.
        assertThat(saved.getBody()).contains("\"goal\":{\"amount\":\"5000.00\",\"currency\":\"AZN\"}");
    }

    @Test
    @DisplayName("an amount with three decimal places is refused rather than rounded")
    void anUnrepresentableGoalIsRefused() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));

        // numeric(14,2) would round it silently, and silent rounding of money is how
        // a ledger stops reconciling.
        assertThat(patch(
                                "/v1/projects/" + id,
                                creator.accessToken(),
                                Map.of("goal", Map.of("amount", "5000.555", "currency", "AZN")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a goal of zero and a duration outside 1-60 days are refused by field")
    void invalidFieldsAreNamed() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));

        ResponseEntity<Map<String, Object>> zeroGoal = patch(
                "/v1/projects/" + id, creator.accessToken(), Map.of("goal", Map.of("amount", "0", "currency", "AZN")));
        assertThat(zeroGoal.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(zeroGoal.getBody()).containsEntry("code", "PROJECT_FIELD_INVALID");
        // The field name, so the editor can put the message beside the input rather
        // than in a banner above a long form.
        assertThat(zeroGoal.getBody().get("meta")).isEqualTo(Map.of("field", "goal"));

        ResponseEntity<Map<String, Object>> tooLong =
                patch("/v1/projects/" + id, creator.accessToken(), Map.of("durationDays", 61));
        assertThat(tooLong.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(tooLong.getBody().get("meta")).isEqualTo(Map.of("field", "durationDays"));
    }

    @Test
    @DisplayName("a subcategory has to belong to the chosen category")
    void filingIsConsistent() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));
        UUID games = categories.findBySlug("games").orElseThrow().getId();
        UUID technology = categories.findBySlug("technology").orElseThrow().getId();
        UUID tabletop = subcategories.findByParentIdOrderBySortOrderAsc(games).getFirst().getId();

        Map<String, Object> filed = patch(
                        "/v1/projects/" + id,
                        creator.accessToken(),
                        Map.of("categoryId", games.toString(), "subcategoryId", tabletop.toString()))
                .getBody();
        assertThat(filed.get("categoryId")).isEqualTo(games.toString());
        assertThat(filed.get("subcategoryId")).isEqualTo(tabletop.toString());

        // A mismatch is a 400 naming the field, not the 500 the composite foreign key
        // would produce on its own.
        ResponseEntity<Map<String, Object>> mismatched = patch(
                "/v1/projects/" + id,
                creator.accessToken(),
                Map.of("categoryId", technology.toString(), "subcategoryId", tabletop.toString()));
        assertThat(mismatched.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(mismatched.getBody().get("meta")).isEqualTo(Map.of("field", "subcategoryId"));

        // Moving the category on its own clears the subcategory: keeping it would
        // leave "Tabletop games" under "Technology", which the database refuses.
        Map<String, Object> refiled =
                patch("/v1/projects/" + id, creator.accessToken(), Map.of("categoryId", technology.toString()))
                        .getBody();
        assertThat(refiled.get("categoryId")).isEqualTo(technology.toString());
        assertThat(refiled.get("subcategoryId")).isNull();
    }

    @Test
    @DisplayName("the story is stored and returned as a document, not as a string of JSON")
    void theStoryRoundTripsAsJson() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));
        Map<String, Object> story = Map.of(
                "version",
                1,
                "blocks",
                List.of(Map.of("type", "paragraph", "spans", List.of(Map.of("text", "Hello", "marks", List.of())))));

        ResponseEntity<String> saved = rest.exchange(
                "/v1/projects/" + id,
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("story", story), bearer(creator.accessToken())),
                String.class);

        // Returned as JSON rather than as an escaped string: the first client to
        // forget to parse it twice would render the escapes. #35 owns the document's
        // schema; this only asserts that the column is jsonb all the way out.
        assertThat(saved.getBody()).contains("\"story\":{").contains("\"blocks\":[");
        assertThat(saved.getBody()).doesNotContain("\"story\":\"{");
    }

    @Test
    @DisplayName("a story that is not a document is refused")
    void aScalarStoryIsRefused() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));

        // jsonb would happily store 5. The editor reading it back expects the
        // document of #35, so the failure belongs at the request that stored it.
        assertThat(patch("/v1/projects/" + id, creator.accessToken(), Map.of("story", 5))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a cover image is stored as one thing, and half of one is refused")
    void theCoverImageMovesAsAWhole() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));

        Map<String, Object> saved = patch(
                        "/v1/projects/" + id,
                        creator.accessToken(),
                        Map.of(
                                "coverImage",
                                Map.of("url", "https://cdn.example.com/cover.jpg", "width", 1600, "height", 900)))
                .getBody();
        assertThat(saved.get("coverImage"))
                .isEqualTo(Map.of("url", "https://cdn.example.com/cover.jpg", "width", 1600, "height", 900));

        // §5.3 checks the image against a minimum size, and a row that says an image
        // is present without saying how large it is cannot be checked at all.
        assertThat(patch(
                                "/v1/projects/" + id,
                                creator.accessToken(),
                                Map.of("coverImage", Map.of("url", "https://cdn.example.com/cover.jpg")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // ------------------------------------------------------------------
    // Who may see and change a campaign
    // ------------------------------------------------------------------

    @Test
    @DisplayName("another account cannot read or edit a campaign, and is told it does not exist")
    void aDraftIsPrivateToItsCreator() {
        Creator owner = creator();
        Creator stranger = creator();
        UUID id = idOf(draft(owner, "An unannounced product"));

        // 404 rather than 403, deliberately. A draft is an unreleased product and
        // sometimes a company that does not exist yet; answering 403 would turn the
        // editor into an oracle for what other people are preparing.
        ResponseEntity<Map<String, Object>> read = get("/v1/projects/" + id + "/edit", stranger.accessToken());
        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(read.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");

        assertThat(patch("/v1/projects/" + id, stranger.accessToken(), Map.of("title", "Mine now"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(post("/v1/projects/" + id + "/submit", stranger.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        // And the campaign is untouched.
        assertThat(get("/v1/projects/" + id + "/edit", owner.accessToken()).getBody())
                .containsEntry("title", "An unannounced product");
    }

    @Test
    @DisplayName("a campaign that does not exist is a 404, not a 500")
    void anUnknownProjectIsNotFound() {
        Creator creator = creator();

        assertThat(get("/v1/projects/" + UUID.randomUUID() + "/edit", creator.accessToken())
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // The state machine, over HTTP
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign goes draft, submitted, approved, live")
    void theHappyPath() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));

        assertThat(post("/v1/projects/" + id + "/submit", creator.accessToken(), null)
                        .getBody())
                .containsEntry("state", "SUBMITTED");

        assertThat(post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null)
                        .getBody())
                .containsEntry("state", "APPROVED");

        Map<String, Object> live = post("/v1/projects/" + id + "/launch", creator.accessToken(), null)
                .getBody();
        assertThat(live).containsEntry("state", "LIVE");

        // Going live stamps the launch and computes the deadline from the duration.
        // Both are stored, because §5.3 freezes them and a derived deadline would
        // move if the duration were ever edited.
        Instant launchedAt = Instant.parse((String) live.get("launchedAt"));
        Instant deadline = Instant.parse((String) live.get("deadline"));
        assertThat(Duration.between(launchedAt, deadline)).isEqualTo(Duration.ofDays(30));
    }

    @Test
    @DisplayName("moderation refuses an account that is not platform staff")
    void moderationRefusesAnAccountThatIsNotStaff() {
        Creator creator = creator();
        Creator stranger = creator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));
        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);

        // The whole point of moderation: the person who wrote the campaign is not
        // the person who clears it. Approving your own submission is the bypass
        // this endpoint exists to prevent, and a valid access token is not enough.
        ResponseEntity<Map<String, Object>> byCreator =
                post("/v1/admin/moderation/" + id + "/approve", creator.accessToken(), null);
        assertThat(byCreator.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(byCreator.getBody()).containsEntry("code", "NOT_A_MODERATOR");

        // Nor does a second free account, which is why ownership alone would not
        // have been a rule worth writing.
        assertThat(post("/v1/admin/moderation/" + id + "/reject", stranger.accessToken(), Map.of("note", "No."))
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(post(
                                "/v1/admin/moderation/" + id + "/request-changes",
                                stranger.accessToken(),
                                Map.of("note", "Rewrite it."))
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        // Refused before anything moved, and no audit row claiming otherwise.
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody())
                .containsEntry("state", "SUBMITTED");
        assertThat(transitions.findByProjectIdOrderByCreatedAtAsc(id))
                .extracting(ProjectStateTransition::getToState)
                .containsExactly(ProjectState.DRAFT, ProjectState.SUBMITTED);
    }

    @Test
    @DisplayName("moderation can send a campaign back, and it can be resubmitted")
    void changesRequestedIsNotTerminal() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));
        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);

        Map<String, Object> returned = post(
                        "/v1/admin/moderation/" + id + "/request-changes",
                        moderator.accessToken(),
                        Map.of("note", "The summary describes a different product."))
                .getBody();
        assertThat(returned).containsEntry("state", "CHANGES_REQUESTED");

        // The reason this state exists rather than a rejection with a flag: a
        // rejection is terminal, and a fixable summary should not end a campaign.
        assertThat(post("/v1/projects/" + id + "/submit", creator.accessToken(), null)
                        .getBody())
                .containsEntry("state", "SUBMITTED");

        assertThat(historyOf(id))
                .extracting(ProjectStateTransition::getToState)
                .containsExactly(
                        ProjectState.DRAFT,
                        ProjectState.SUBMITTED,
                        ProjectState.CHANGES_REQUESTED,
                        ProjectState.SUBMITTED);
    }

    @Test
    @DisplayName("a moderation decision the creator has to act on needs a reason")
    void rejectionCarriesItsReason() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));
        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);

        // A rejection without a reason is a support ticket every time, and it is the
        // one thing the creator is shown.
        ResponseEntity<Map<String, Object>> refused =
                post("/v1/admin/moderation/" + id + "/reject", moderator.accessToken(), Map.of("note", " "));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "note"));

        Map<String, Object> rejected = post(
                        "/v1/admin/moderation/" + id + "/reject",
                        moderator.accessToken(),
                        Map.of("note", "§5.4: resale goods."))
                .getBody();
        assertThat(rejected).containsEntry("state", "REJECTED");
        assertThat(historyOf(id).getLast().getNote()).isEqualTo("§5.4: resale goods.");
    }

    @Test
    @DisplayName("cancelling a live campaign records the reason backers are shown")
    void cancellingALiveCampaign() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));
        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);
        post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null);
        post("/v1/projects/" + id + "/launch", creator.accessToken(), null);

        // A reason is required: cancelling abandons commitments people made with
        // their card details on file.
        assertThat(post("/v1/projects/" + id + "/cancel", creator.accessToken(), Map.of("reason", ""))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        Map<String, Object> cancelled = post(
                        "/v1/projects/" + id + "/cancel",
                        creator.accessToken(),
                        Map.of("reason", "The manufacturer withdrew."))
                .getBody();
        assertThat(cancelled).containsEntry("state", "CANCELED");
        assertThat(historyOf(id).getLast().getNote()).isEqualTo("The manufacturer withdrew.");
    }

    @Test
    @DisplayName("a transition the state machine refuses is a 409 saying what is possible instead")
    void aForbiddenTransitionIsAConflict() {
        Creator creator = creator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));

        ResponseEntity<Map<String, Object>> refused = post("/v1/projects/" + id + "/launch", creator.accessToken(), null);

        // 409 rather than 400: the request is well formed and the state of the
        // campaign is what refuses it — frequently the state another tab put it in.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_TRANSITION_NOT_ALLOWED");
        assertThat(refused.getBody().get("meta"))
                .isEqualTo(Map.of(
                        "state",
                        "DRAFT",
                        "requested",
                        "LIVE",
                        // What the client can offer instead, so it does not have to
                        // reload and guess which of its buttons still works.
                        "allowed",
                        List.of("PRELAUNCH", "SUBMITTED")));

        // Nothing happened. A refused transition must not leave a state change or an
        // audit row behind.
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody())
                .containsEntry("state", "DRAFT");
        assertThat(historyOf(id)).hasSize(1);
    }

    @Test
    @DisplayName("a terminal campaign cannot be moved by any endpoint")
    void terminalIsTerminal() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));
        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);
        post("/v1/admin/moderation/" + id + "/reject", moderator.accessToken(), Map.of("note", "§5.4."));

        // Every route out of a terminal state, refused. A rejected campaign that
        // could be resubmitted would make the decision meaningless.
        assertThat(post("/v1/projects/" + id + "/submit", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
        assertThat(post("/v1/projects/" + id + "/launch", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
        assertThat(post("/v1/projects/" + id + "/cancel", creator.accessToken(), Map.of("reason", "Changed my mind"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
        assertThat(post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    @DisplayName("a campaign with no goal never reaches a moderator")
    void anIncompleteCampaignCannotBeSubmitted() {
        Creator creator = creator();
        UUID id = idOf(draft(creator, "A campaign"));

        ResponseEntity<Map<String, Object>> refused = post("/v1/projects/" + id + "/submit", creator.accessToken(), null);

        // §5.3, enforced on the write rather than only reported by the checklist
        // endpoint. This is also what makes PROJECT_NOT_LAUNCHABLE unreachable
        // through the API: a campaign with no goal cannot reach APPROVED, so it can
        // never be launched from there. That check stays as the guard for the
        // scheduled launch of §8.4, which does not go through a submission.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_SUBMITTABLE");

        // Nothing moved, and no audit row claims otherwise.
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody())
                .containsEntry("state", "DRAFT");
        assertThat(historyOf(id)).hasSize(1);
    }

    // ------------------------------------------------------------------
    // What launching freezes (§5.3)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a live campaign's goal can be neither changed nor removed")
    void aLiveCampaignKeepsItsGoal() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "A campaign");

        // 409 rather than 400: 5000 was accepted an hour ago and 6000 is a perfectly
        // good number. What refuses it is the state the campaign is now in, which is
        // frequently the state a scheduled launch put it in while the tab was open.
        ResponseEntity<Map<String, Object>> raised = patch(
                "/v1/projects/" + id,
                creator.accessToken(),
                Map.of("goal", Map.of("amount", "6000.00", "currency", "AZN")));
        assertThat(raised.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(raised.getBody()).containsEntry("code", "PROJECT_FIELD_LOCKED");
        // The field so the editor can highlight it, and the state so it can say why
        // without asking a second time.
        assertThat(raised.getBody().get("meta")).isEqualTo(Map.of("field", "goal", "state", "LIVE"));

        // Clearing it is a change to it. This is also the case the database refuses
        // outright — §5.1 cannot resolve a live campaign with no goal — and it used to
        // be the only part of §5.3 that was enforced.
        ResponseEntity<Map<String, Object>> cleared =
                patchJson("/v1/projects/" + id, creator.accessToken(), "{\"goal\": null}");
        assertThat(cleared.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(cleared.getBody()).containsEntry("code", "PROJECT_FIELD_LOCKED");

        // And nothing moved.
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody().get("goal"))
                .isEqualTo(Map.of("amount", "5000.00", "currency", "AZN"));
    }

    @Test
    @DisplayName("a live campaign's deadline is frozen, in both the fields it is made of")
    void aLiveCampaignKeepsItsDeadline() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "A campaign");
        Instant deadline =
                Instant.parse((String) get("/v1/projects/" + id + "/edit", creator.accessToken())
                        .getBody()
                        .get("deadline"));

        // The deadline is not an editable field: it is computed at launch from the
        // duration and the launch instant. Freezing it therefore means freezing both
        // of the fields a creator can reach.
        ResponseEntity<Map<String, Object>> lengthened =
                patch("/v1/projects/" + id, creator.accessToken(), Map.of("durationDays", 45));
        assertThat(lengthened.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(lengthened.getBody().get("meta")).isEqualTo(Map.of("field", "durationDays", "state", "LIVE"));

        ResponseEntity<Map<String, Object>> rescheduled = patch(
                "/v1/projects/" + id, creator.accessToken(), Map.of("scheduledLaunchAt", "2027-01-01T09:00:00Z"));
        assertThat(rescheduled.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(rescheduled.getBody().get("meta"))
                .isEqualTo(Map.of("field", "scheduledLaunchAt", "state", "LIVE"));

        // A campaign whose deadline could move is a campaign whose backers were told
        // one thing and charged on another.
        Map<String, Object> unchanged =
                get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody();
        assertThat(unchanged).containsEntry("durationDays", 30);
        assertThat(Instant.parse((String) unchanged.get("deadline"))).isEqualTo(deadline);
    }

    @Test
    @DisplayName("a locked field in a body refuses the whole patch, and applies none of it")
    void aPatchIsAllOrNothing() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "A campaign");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "A better title");
        body.put("goal", Map.of("amount", "9000.00", "currency", "AZN"));

        assertThat(patch("/v1/projects/" + id, creator.accessToken(), body).getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);

        // Half a save is worse than none: the creator would have to work out which
        // half, and the title they can see would tell them the goal went through.
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody())
                .containsEntry("title", "A campaign");
    }

    @Test
    @DisplayName("everything §5.3 does not freeze is still editable once live")
    void launchingFreezesOnlyWhatItHasTo() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "A campaign");

        // §5.5 obliges a creator to keep backers informed of delays and to answer
        // complaints, and the campaign page is where they do it. A launch that froze
        // the story would freeze the only place that conversation happens.
        Map<String, Object> saved = patch(
                        "/v1/projects/" + id,
                        creator.accessToken(),
                        Map.of("title", "A campaign, still going", "risks", "The factory has quoted a longer lead time."))
                .getBody();

        assertThat(saved).containsEntry("title", "A campaign, still going");
        assertThat(saved).containsEntry("risks", "The factory has quoted a longer lead time.");
    }

    @Test
    @DisplayName("a draft freezes nothing, including the fields a launch will freeze")
    void aDraftFreezesNothing() {
        Creator creator = creator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("goal", Map.of("amount", "7500.00", "currency", "AZN"));
        body.put("durationDays", 45);
        body.put("scheduledLaunchAt", "2027-01-01T09:00:00Z");

        Map<String, Object> saved =
                patch("/v1/projects/" + id, creator.accessToken(), body).getBody();

        // Before launch nothing has been shown to anybody who could act on it, so all
        // three move freely — including in one body, which is what the editor sends
        // when a creator fills in the funding section.
        assertThat(saved).containsEntry("goal", Map.of("amount", "7500.00", "currency", "AZN"));
        assertThat(saved).containsEntry("durationDays", 45);
        assertThat(Instant.parse((String) saved.get("scheduledLaunchAt")))
                .isEqualTo(Instant.parse("2027-01-01T09:00:00Z"));
        assertThat(lockedFieldsOf(saved)).isEmpty();
    }

    @Test
    @DisplayName("lockedFields is empty until launch and names the frozen fields afterwards")
    void lockedFieldsFollowTheState() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));

        assertThat(lockedFieldsOf(get("/v1/projects/" + id + "/edit", creator.accessToken())
                        .getBody()))
                .isEmpty();

        // Still empty in front of a moderator: a submission is not a promise to a
        // backer, and a creator answering CHANGES_REQUESTED usually has to move one of
        // these.
        assertThat(lockedFieldsOf(post("/v1/projects/" + id + "/submit", creator.accessToken(), null)
                        .getBody()))
                .isEmpty();
        assertThat(lockedFieldsOf(
                        post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null)
                                .getBody()))
                .isEmpty();

        // The response to the launch itself already says what has just frozen, which
        // is the moment a client most needs to be told.
        Map<String, Object> live = post("/v1/projects/" + id + "/launch", creator.accessToken(), null)
                .getBody();
        // The names are the keys of the PATCH body, so the editor matches them against
        // its own inputs rather than translating them. A reward's price is frozen by
        // the same rule and is not a field of this body.
        assertThat(lockedFieldsOf(live)).containsExactly("goal", "durationDays", "scheduledLaunchAt");

        // Every response carries the same answer, so a client's state does not depend
        // on which request it happened to make last.
        assertThat(lockedFieldsOf(get("/v1/projects/" + id + "/edit", creator.accessToken())
                        .getBody()))
                .containsExactly("goal", "durationDays", "scheduledLaunchAt");

        // A cancelled campaign is not a draft again. What backers were asked for stays
        // exactly as it was.
        Map<String, Object> cancelled = post(
                        "/v1/projects/" + id + "/cancel",
                        creator.accessToken(),
                        Map.of("reason", "The manufacturer withdrew."))
                .getBody();
        assertThat(cancelled).containsEntry("state", "CANCELED");
        assertThat(lockedFieldsOf(cancelled)).containsExactly("goal", "durationDays", "scheduledLaunchAt");
        assertThat(patch("/v1/projects/" + id, creator.accessToken(), Map.of("durationDays", 10))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    // ------------------------------------------------------------------
    // The audit trail
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every transition writes exactly one audit row, with the role that made it")
    void everyTransitionWritesExactlyOneAuditRow() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = idOf(submittableDraft(creator, "A campaign"));

        post("/v1/projects/" + id + "/submit", creator.accessToken(), null);
        post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null);
        post("/v1/projects/" + id + "/launch", creator.accessToken(), null);

        List<ProjectStateTransition> history = historyOf(id);

        // Four transitions, four rows: creation is one of them, so the history reads
        // as a complete sequence rather than starting at the first submission. An
        // edit — the PATCH inside fundableDraft — is not a transition and adds
        // nothing here.
        assertThat(history).hasSize(4);

        assertThat(history.get(0).getFromState()).isNull();
        assertThat(history.get(0).getToState()).isEqualTo(ProjectState.DRAFT);
        assertThat(history.get(0).getActorRole()).isEqualTo(ActorRole.CREATOR);
        assertThat(history.get(0).getActorId()).isEqualTo(creator.id());

        assertThat(history.get(1).getFromState()).isEqualTo(ProjectState.DRAFT);
        assertThat(history.get(1).getToState()).isEqualTo(ProjectState.SUBMITTED);
        assertThat(history.get(1).getActorRole()).isEqualTo(ActorRole.CREATOR);
        assertThat(history.get(1).getActorId()).isEqualTo(creator.id());

        // The row that makes the table worth having: who approved this campaign, in
        // what capacity, and when.
        assertThat(history.get(2).getFromState()).isEqualTo(ProjectState.SUBMITTED);
        assertThat(history.get(2).getToState()).isEqualTo(ProjectState.APPROVED);
        assertThat(history.get(2).getActorRole()).isEqualTo(ActorRole.MODERATOR);
        assertThat(history.get(2).getActorId()).isEqualTo(moderator.id());

        assertThat(history.get(3).getToState()).isEqualTo(ProjectState.LIVE);
        assertThat(history.get(3).getActorRole()).isEqualTo(ActorRole.CREATOR);

        assertThat(history).allSatisfy(row -> assertThat(row.getCreatedAt()).isNotNull());
    }
}
