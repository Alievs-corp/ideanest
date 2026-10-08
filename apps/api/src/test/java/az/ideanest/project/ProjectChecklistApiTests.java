package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.ProjectStateTransition;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.project.infrastructure.ProjectStateTransitionRepository;
import az.ideanest.project.infrastructure.SubcategoryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
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
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The completeness checklist and the submission that enforces it, over HTTP.
 *
 * <p>The test that carries the design is
 * {@link #theChecklistAndTheSubmissionAgree()}. Everything else here would still
 * pass if the checklist endpoint and {@code POST /submit} were two
 * implementations of §5.3 that happened to be written on the same afternoon;
 * that one is what fails when they stop agreeing.
 *
 * <p>{@link SubmissionChecklistTests} proves the rules against §5.3 with no Spring
 * anywhere near them. This proves they are wired to the endpoint that advises and
 * to the write that enforces, and that the reward module's facts reach both.
 */
class ProjectChecklistApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static Account MODERATOR;

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
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM reward_tiers");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // The checklist a creator reads
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a fresh draft is not submittable, and every failing item says where to fix it")
    void aFreshDraftIsNotSubmittable() {
        Account creator = account();
        UUID id = idOf(draft(creator));

        Map<String, Object> checklist = checklistOf(id, creator);

        assertThat(checklist).containsEntry("submittable", false);
        assertThat(checklist).containsEntry("state", "DRAFT");

        // Every blocking item that is not met carries a sentence and the editor
        // section that fixes it. A checklist that said what was wrong and not where
        // would be a list of complaints.
        for (Map<String, Object> item : blocking(checklist)) {
            assertThat(item.get("section")).isIn("basics", "rewards", "story");
            assertThat(item.get("label")).asString().isNotBlank();
            if (Boolean.FALSE.equals(item.get("satisfied"))) {
                assertThat(item.get("detail")).asString().isNotBlank();
            }
        }

        // Seven of §5.3's ten blocking rules. The title arrived with creation — it is
        // the one thing a draft cannot exist without — and the two about rewards are
        // satisfied by a campaign with no tiers, which §5.3 permits.
        assertThat(unmetNames(blocking(checklist)))
                .containsExactly(
                        "SUMMARY", "CATEGORY", "COVER_IMAGE", "GOAL", "DURATION", "STORY", "RISKS");
    }

    @Test
    @DisplayName("advice is a separate list from what refuses a submission")
    void adviceIsKeptApartFromRefusal() {
        Account creator = account();
        UUID id = idOf(submittableDraft(creator));

        Map<String, Object> checklist = checklistOf(id, creator);

        // Complete by §5.3 and plainly not finished: no subcategory, no launch date,
        // no rewards, no pictures in the story. Both facts are true at once, and a
        // response that could not express both would have to lie about one.
        assertThat(checklist).containsEntry("submittable", true);
        assertThat(unmetNames(blocking(checklist))).isEmpty();
        assertThat(unmetNames(advisory(checklist)))
                .containsExactly("SUBCATEGORY", "SCHEDULED_LAUNCH", "STORY_MEDIA", "REWARDS_OFFERED");

        // Ten blocking requirements at weight two, plus the one advisory item this
        // campaign does satisfy -- its cover is large enough -- out of twenty-five. Built
        // from the blocking half alone this would read 100 and tell the creator of a bare
        // campaign there was nothing left to do.
        assertThat(checklist).containsEntry("score", 84);
    }

    @Test
    @DisplayName("the score reaches a hundred only when the advice has been taken too")
    void aFinishedCampaignScoresFullMarks() {
        Account creator = account();
        UUID id = idOf(submittableDraft(creator));

        UUID games = categories.findBySlug("games").orElseThrow().getId();
        UUID tabletop = subcategories.findByParentIdOrderBySortOrderAsc(games).getFirst().getId();
        patch(id, creator, Map.of("subcategoryId", tabletop.toString()));
        patch(id, creator, Map.of("scheduledLaunchAt", "2027-01-01T09:00:00Z"));
        patch(id, creator, Map.of("story", storyWithAPicture()));
        reward(id, creator, "Signed copy", "40.00");

        Map<String, Object> checklist = checklistOf(id, creator);
        assertThat(unmetNames(advisory(checklist))).isEmpty();
        assertThat(checklist).containsEntry("score", 100);
    }

    @Test
    @DisplayName("the checklist is written in the language the request asks for")
    void theChecklistSpeaksTheReadersLanguage() {
        Account creator = account();
        UUID id = idOf(draft(creator));

        ResponseEntity<Map<String, Object>> response =
                get("/v1/projects/" + id + "/checklist", creator, "az-AZ,az;q=0.9,en;q=0.8");
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The rows differ by language, so a cache between here and the reader has to be told.
        assertThat(response.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);

        Map<String, Object> cover = row(blocking(response.getBody()), "COVER_IMAGE");
        assertThat(cover).containsEntry("label", "Örtük şəkli");
        assertThat(cover)
                .containsEntry(
                        "detail",
                        "Örtük şəkli mütləqdir. Kampaniya göstərildiyi hər yerdə bu şəkillə təmsil olunur.");
        assertThat(row(blocking(response.getBody()), "STORY"))
                .containsEntry("label", "Hekayə")
                .containsEntry("detail", "Hekayə 0 simvoldan ibarətdir. Ən azı 500 simvol lazımdır.");
        // The wire names do not move with the language: a client branches on them.
        assertThat(unmetNames(blocking(response.getBody())))
                .containsExactly(
                        "SUMMARY", "CATEGORY", "COVER_IMAGE", "GOAL", "DURATION", "STORY", "RISKS");

        // English is still English, and a reader who states no language gets the primary one.
        assertThat(row(blocking(get("/v1/projects/" + id + "/checklist", creator, "en").getBody()), "COVER_IMAGE"))
                .containsEntry("label", "Cover image");
        assertThat(row(blocking(checklistOf(id, creator)), "COVER_IMAGE")).containsEntry("label", "Örtük şəkli");
    }

    @Test
    @DisplayName("a refused submission names what is missing in the reader's language")
    void theRefusalSpeaksTheReadersLanguage() {
        Account creator = account();
        UUID id = idOf(submittableDraft(creator));
        patchJson(id, creator, "{\"blurb\": null}");

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/projects/" + id + "/submit",
                HttpMethod.POST,
                new HttpEntity<>(null, withLanguage(bearer(creator.accessToken()), "ru")),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_SUBMITTABLE");
        assertThat(unmetOf(refused.getBody()))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry).containsEntry("requirement", "SUMMARY");
                    assertThat(entry).containsEntry("label", "Краткое описание");
                    assertThat(entry)
                            .containsEntry(
                                    "detail",
                                    "Краткое описание в одну строку показывается под кампанией везде, где она встречается.");
                });
    }

    @Test
    @DisplayName("a stranger cannot read a campaign's checklist, and is told it does not exist")
    void theChecklistIsPrivateToTheCampaign() {
        Account owner = account();
        Account stranger = account();
        UUID id = idOf(draft(owner));

        // 404 rather than 403, exactly as the editor projection answers: a checklist
        // reports the contents of an unreleased campaign, so it must not be an oracle
        // for which identifiers exist.
        ResponseEntity<Map<String, Object>> refused = get("/v1/projects/" + id + "/checklist", stranger);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // The submission that enforces it
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the checklist and the submission agree, requirement by requirement")
    void theChecklistAndTheSubmissionAgree() {
        Account creator = account();

        // Each entry breaks exactly one blocking rule on an otherwise complete
        // campaign. The assertion is not that the submission is refused — it is that
        // the endpoint and the write name the SAME requirement, which is the entire
        // reason both go through one class.
        Map<String, String> breakages = new LinkedHashMap<>();
        breakages.put("SUMMARY", "{\"blurb\": null}");
        breakages.put("CATEGORY", "{\"categoryId\": null}");
        breakages.put("COVER_IMAGE", "{\"coverImage\": null}");
        breakages.put("GOAL", "{\"goal\": null}");
        breakages.put("DURATION", "{\"durationDays\": null}");
        breakages.put("STORY", "{\"story\": null}");
        breakages.put("RISKS", "{\"risks\": null}");
        // Inside the range the edit endpoint accepts and below the configured
        // minimum, so this is a rule only the checklist enforces.
        breakages.put("GOAL_TOO_SMALL", "{\"goal\": {\"amount\": \"50.00\", \"currency\": \"AZN\"}}");

        breakages.forEach((expected, body) -> {
            UUID id = idOf(submittableDraft(creator));
            assertThat(patchJson(id, creator, body).getStatusCode()).isEqualTo(HttpStatus.OK);

            String requirement = expected.equals("GOAL_TOO_SMALL") ? "GOAL" : expected;

            assertThat(unmetNames(blocking(checklistOf(id, creator))))
                    .withFailMessage("the checklist did not report %s", requirement)
                    .containsExactly(requirement);

            ResponseEntity<Map<String, Object>> refused = post("/v1/projects/" + id + "/submit", creator, null);
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_SUBMITTABLE");

            // The refusal names every failing requirement and where each is fixed, so
            // a client can point at the control rather than show a banner.
            assertThat(unmetFromProblem(refused.getBody()))
                    .withFailMessage("the submission did not report %s", requirement)
                    .containsExactly(requirement);
        });
    }

    @Test
    @DisplayName("a title can never fail the checklist, because the edit endpoint refuses one that would")
    void theTitleIsCaughtBeforeTheChecklistSeesIt() {
        Account creator = account();
        UUID id = idOf(submittableDraft(creator));

        // §5.3's title rule is enforced twice over: `title` is NOT NULL, the editor
        // refuses to clear it, and a title over sixty characters is a 400 naming the
        // field. So the checklist's TITLE row is a rule that cannot be observed
        // failing through the API — which is the right outcome and is recorded here
        // rather than left to somebody wondering why it is untested.
        assertThat(patchJson(id, creator, "{\"title\": null}").getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(patch(id, creator, Map.of("title", "t".repeat(61))).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(unmetNames(blocking(checklistOf(id, creator)))).isEmpty();
    }

    @Test
    @DisplayName("a reward priced below the smallest chargeable amount refuses the submission")
    void rewardFactsCrossTheModuleBoundary() {
        Account creator = account();
        UUID id = idOf(submittableDraft(creator));

        // The reward module answers through a port this module declares, because the
        // reward module already depends on this one and the reverse would be a cycle.
        // This is the assertion that the wiring exists at all.
        reward(id, creator, "A postcard", "0.50");

        assertThat(unmetNames(blocking(checklistOf(id, creator)))).containsExactly("REWARD_PRICES");

        ResponseEntity<Map<String, Object>> refused = post("/v1/projects/" + id + "/submit", creator, null);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(unmetFromProblem(refused.getBody())).containsExactly("REWARD_PRICES");
        // And it sends the creator to the tab that holds the price.
        assertThat(sectionsFromProblem(refused.getBody())).containsExactly("rewards");

        // Repricing it above the floor makes the same campaign submittable, through
        // the same class, with no other change.
        reward(id, creator, "A better postcard", "5.00");
        deleteCheapestReward(id, creator);
        assertThat(post("/v1/projects/" + id + "/submit", creator, null).getBody())
                .containsEntry("state", "SUBMITTED");
    }

    @Test
    @DisplayName("a complete campaign is accepted, and the audit row says so")
    void aCompleteCampaignIsAccepted() {
        Account creator = account();
        UUID id = idOf(submittableDraft(creator));

        assertThat(post("/v1/projects/" + id + "/submit", creator, null).getBody())
                .containsEntry("state", "SUBMITTED");
        assertThat(historyOf(id))
                .extracting(ProjectStateTransition::getToState)
                .containsExactly(ProjectState.DRAFT, ProjectState.SUBMITTED);
    }

    @Test
    @DisplayName("the state refuses a submission before completeness does")
    void theEdgeIsCheckedFirst() {
        Account creator = account();
        Account moderator = moderator();
        UUID id = idOf(submittableDraft(creator));
        post("/v1/projects/" + id + "/submit", creator, null);
        post("/v1/admin/moderation/" + id + "/reject", moderator, Map.of("note", "§5.4: resale goods."));

        // Emptied after the rejection, so both refusals are available. The state is
        // the one the creator cannot fix, so it is the one they are told about —
        // reporting a missing summary here would send them to write one for a
        // campaign that is over.
        patchJson(id, creator, "{\"blurb\": null}");

        ResponseEntity<Map<String, Object>> refused = post("/v1/projects/" + id + "/submit", creator, null);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_TRANSITION_NOT_ALLOWED");
    }

    // ------------------------------------------------------------------
    // The change-request loop
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign sent back carries the moderator's note to its creator, and stops carrying it as current when resubmitted")
    void theCreatorSeesWhyTheCampaignCameBack() {
        Account creator = account();
        Account moderator = moderator();
        UUID id = idOf(submittableDraft(creator));
        post("/v1/projects/" + id + "/submit", creator, null);

        post(
                "/v1/admin/moderation/" + id + "/request-changes",
                moderator,
                Map.of("note", "The summary describes a different product."));

        // The failure requestChanges exists to prevent is a creator told "changes
        // requested" and nothing else. The note is on the transition row; this is the
        // read that puts it in front of them.
        Map<String, Object> sentBack = checklistOf(id, creator);
        assertThat(sentBack).containsEntry("state", "CHANGES_REQUESTED");

        Map<String, Object> moderation = moderationOf(sentBack);
        assertThat(moderation).containsEntry("outcome", "CHANGES_REQUESTED");
        assertThat(moderation).containsEntry("note", "The summary describes a different product.");
        assertThat(moderation).containsEntry("current", true);
        assertThat(moderation.get("decidedAt")).isNotNull();

        // Fixed and sent back in. §6.1's loop, and the reason CHANGES_REQUESTED is a
        // state rather than a flag on a rejection.
        patch(id, creator, Map.of("blurb", "A summary describing the actual product."));
        assertThat(post("/v1/projects/" + id + "/submit", creator, null).getBody())
                .containsEntry("state", "SUBMITTED");

        Map<String, Object> resubmitted = checklistOf(id, creator);
        assertThat(resubmitted).containsEntry("state", "SUBMITTED");

        Map<String, Object> stale = moderationOf(resubmitted);
        // Still the last thing anybody said, and no longer something to act on. The
        // client is told which by the server rather than left to compare two enums.
        assertThat(stale).containsEntry("outcome", "CHANGES_REQUESTED");
        assertThat(stale).containsEntry("current", false);

        assertThat(historyOf(id))
                .extracting(ProjectStateTransition::getToState)
                .containsExactly(
                        ProjectState.DRAFT,
                        ProjectState.SUBMITTED,
                        ProjectState.CHANGES_REQUESTED,
                        ProjectState.SUBMITTED);
    }

    @Test
    @DisplayName("a rejected campaign shows the reason it was rejected")
    void aRejectionIsShownToItsCreator() {
        Account creator = account();
        Account moderator = moderator();
        UUID id = idOf(submittableDraft(creator));
        post("/v1/projects/" + id + "/submit", creator, null);
        post("/v1/admin/moderation/" + id + "/reject", moderator, Map.of("note", "§5.4: resale goods."));

        Map<String, Object> moderation = moderationOf(checklistOf(id, creator));
        assertThat(moderation).containsEntry("outcome", "REJECTED");
        assertThat(moderation).containsEntry("note", "§5.4: resale goods.");
        assertThat(moderation).containsEntry("current", true);
    }

    @Test
    @DisplayName("a campaign nobody has moderated carries no moderation outcome")
    void thereIsNoOutcomeBeforeThereIsADecision() {
        Account creator = account();
        UUID id = idOf(draft(creator));

        // Absent rather than an empty object. A screen that renders "no decision yet"
        // as a decision is how a draft acquires a moderation banner.
        assertThat(checklistOf(id, creator)).doesNotContainKey("moderation");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("checklist" + SEQUENCE.incrementAndGet() + "@example.com");
        Account account = signIn(email, "Test Creator");
        // Publishing needs a plan since V62. Written rather than bought, because this
        // suite is not about them -- Campaigns.mayPublish carries both preconditions.
        Campaigns.mayPublish(dataSource, account.id());
        return account;
    }

    private Account moderator() {
        if (MODERATOR != null) {
            return MODERATOR;
        }
        MODERATOR = signIn(EmailAddress.of(MODERATOR_EMAIL), "Test Moderator");
        return MODERATOR;
    }

    private Account signIn(EmailAddress email, String name) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", name),
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

    private Map<String, Object> draft(Account creator) {
        return post("/v1/projects", creator, Map.of("title", "A campaign")).getBody();
    }

    private Map<String, Object> submittableDraft(Account creator) {
        Map<String, Object> project = draft(creator);
        return patch(idOf(project), creator, Campaigns.completeBasics(categories)).getBody();
    }

    /** A story that satisfies the length rule and holds a picture, so the advisory passes too. */
    private static Map<String, Object> storyWithAPicture() {
        return Map.of(
                "version",
                1,
                "blocks",
                List.of(
                        Map.of(
                                "type",
                                "paragraph",
                                "spans",
                                List.of(Map.of("text", "b".repeat(600), "marks", List.of()))),
                        Map.of(
                                "type",
                                "image",
                                "url",
                                "https://cdn.example.com/prototype.jpg",
                                "width",
                                1200,
                                "height",
                                800,
                                "alt",
                                "The prototype on a workbench")));
    }

    private void reward(UUID projectId, Account creator, String title, String amount) {
        ResponseEntity<Map<String, Object>> created = post(
                "/v1/projects/" + projectId + "/rewards",
                creator,
                Map.of("title", title, "price", Map.of("amount", amount, "currency", "AZN")));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    /** Removes the cheapest tier, so the campaign is left with only well-priced ones. */
    private void deleteCheapestReward(UUID projectId, Account creator) {
        ResponseEntity<List<Map<String, Object>>> list = rest.exchange(
                "/v1/projects/" + projectId + "/rewards",
                HttpMethod.GET,
                new HttpEntity<>(bearer(creator.accessToken())),
                new ParameterizedTypeReference<List<Map<String, Object>>>() {});

        Map<String, Object> cheapest = list.getBody().stream()
                .min((left, right) -> amountOf(left).compareTo(amountOf(right)))
                .orElseThrow();

        rest.exchange(
                "/v1/rewards/" + cheapest.get("id"),
                HttpMethod.DELETE,
                new HttpEntity<>(bearer(creator.accessToken())),
                String.class);
    }

    private static BigDecimal amountOf(Map<String, Object> reward) {
        Map<?, ?> price = (Map<?, ?>) reward.get("price");
        return new BigDecimal((String) price.get("amount"));
    }

    private List<ProjectStateTransition> historyOf(UUID projectId) {
        return transitions.findByProjectIdOrderByCreatedAtAsc(projectId);
    }

    // ------------------------------------------------------------------
    // Reading the response
    // ------------------------------------------------------------------

    private Map<String, Object> checklistOf(UUID projectId, Account account) {
        ResponseEntity<Map<String, Object>> response = get("/v1/projects/" + projectId + "/checklist", account);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> blocking(Map<String, Object> checklist) {
        return (List<Map<String, Object>>) checklist.get("blocking");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> advisory(Map<String, Object> checklist) {
        return (List<Map<String, Object>>) checklist.get("advisory");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> moderationOf(Map<String, Object> checklist) {
        return (Map<String, Object>) checklist.get("moderation");
    }

    private static Map<String, Object> row(List<Map<String, Object>> items, String requirement) {
        return items.stream()
                .filter(item -> requirement.equals(item.get("requirement")))
                .findFirst()
                .orElseThrow(() -> new AssertionError(requirement + " is not on the checklist"));
    }

    private static List<String> unmetNames(List<Map<String, Object>> items) {
        return items.stream()
                .filter(item -> Boolean.FALSE.equals(item.get("satisfied")))
                .map(item -> (String) item.get("requirement"))
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> unmetOf(Map<String, Object> problem) {
        Map<?, ?> meta = (Map<?, ?>) problem.get("meta");
        return (List<Map<String, Object>>) meta.get("unmet");
    }

    private static List<String> unmetFromProblem(Map<String, Object> problem) {
        return unmetOf(problem).stream().map(item -> (String) item.get("requirement")).toList();
    }

    private static List<String> sectionsFromProblem(Map<String, Object> problem) {
        return unmetOf(problem).stream().map(item -> (String) item.get("section")).toList();
    }

    // ------------------------------------------------------------------
    // HTTP
    // ------------------------------------------------------------------

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

    private ResponseEntity<Map<String, Object>> post(String path, Account account, Object body) {
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(body, bearer(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> patch(UUID projectId, Account account, Map<String, Object> body) {
        return rest.exchange(
                "/v1/projects/" + projectId,
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /**
     * A patch sent as literal JSON, so that a null actually crosses the wire.
     *
     * <p>The application's Jackson omits nulls, and {@link TestRestTemplate} shares
     * it — a {@link Map} with a null value would serialise with the key missing,
     * which is "leave it alone" rather than "clear it".
     */
    private ResponseEntity<Map<String, Object>> patchJson(UUID projectId, Account account, String body) {
        return rest.exchange(
                "/v1/projects/" + projectId,
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account account) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(bearer(account.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account account, String acceptLanguage) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(withLanguage(bearer(account.accessToken()), acceptLanguage)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders withLanguage(HttpHeaders headers, String acceptLanguage) {
        headers.set(HttpHeaders.ACCEPT_LANGUAGE, acceptLanguage);
        return headers;
    }

    private static UUID idOf(Map<String, Object> project) {
        return UUID.fromString((String) project.get("id"));
    }
}
