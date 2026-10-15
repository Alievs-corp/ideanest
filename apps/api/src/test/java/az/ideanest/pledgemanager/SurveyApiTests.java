package az.ideanest.pledgemanager;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.outbox.OutboxRelay;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.HashMap;
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
 * §4.8's PM-01 to PM-06 (#73, #74): the survey builder, the send, and the answers.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aConditionalQuestionIsOnlyAskedOfTheTierItNames()} — PM-02, and the
 *       rule that the filter is a fact rather than a hint: a backer is not shown the
 *       question <em>and</em> cannot answer it.
 *   <li>{@link #theQuestionsFreezeOnceTheSurveyHasBeenSent()} — what "sent" means, and
 *       that the note and the deadline stay editable.
 *   <li>{@link #answersCanBeChangedUntilTheCutOffAndNotAfter()} — PM-06, compared
 *       against the clock rather than swept.
 *   <li>{@link #anAudienceAboveTheCeilingIsReportedAsTruncated()} — the frozen count is
 *       honest about the backers the platform decided not to ask.
 *   <li>{@link #sendingASurveyIsAudited()} — the act, never the questions.
 * </ul>
 */
class SurveyApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** §4.10 gives {@code SURVEY_AVAILABLE} email, push and in-app. */
    private static final int SURVEY_CHANNELS = 3;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private OutboxRelay relay;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM survey_answers");
        jdbc.update("DELETE FROM survey_responses");
        jdbc.update("DELETE FROM survey_nudges");
        jdbc.update("DELETE FROM survey_questions");
        jdbc.update("DELETE FROM surveys");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // The builder — PM-01 to PM-03
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a survey is created as a draft with its questions in the order they were given")
    void aSurveyIsCreatedAsADraft() {
        Account creator = account("survey-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> created = create(
                project,
                creator,
                "Reward details",
                List.of(
                        question("What size?", "CHOICE", true, List.of("S", "M", "L"), null),
                        question("Anything else?", "TEXT", false, List.of(), null)));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).containsEntry("sent", false);
        assertThat(created.getBody().get("sentTo")).as("a draft has reached nobody").isNull();

        List<Map<String, Object>> questions = questions(created.getBody());
        assertThat(questions).hasSize(2);
        assertThat(questions.get(0)).containsEntry("prompt", "What size?").containsEntry("position", 0);
        assertThat(questions.get(1)).containsEntry("prompt", "Anything else?").containsEntry("position", 1);
    }

    @Test
    @DisplayName("a choice question with fewer than two options is refused, naming the field")
    void aChoiceQuestionNeedsOptions() {
        Account creator = account("choice-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = create(
                project, creator, "Bad survey", List.of(question("Pick one", "CHOICE", true, List.of("Only"), null)));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "SURVEY_INVALID");
        assertThat(meta(refused.getBody())).containsEntry("field", "choices");
    }

    @Test
    @DisplayName("options on a text question are refused rather than ignored")
    void optionsOnATextQuestionAreRefused() {
        Account creator = account("text-creator");
        UUID project = liveCampaign(creator);

        // A creator who did this picked the wrong type, and would not find out until
        // the answers came back as free prose.
        ResponseEntity<Map<String, Object>> refused = create(
                project, creator, "Bad survey", List.of(question("Name", "TEXT", false, List.of("A", "B"), null)));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(meta(refused.getBody())).containsEntry("field", "choices");
    }

    // ------------------------------------------------------------------
    // The send — PM-04
    // ------------------------------------------------------------------

    @Test
    @DisplayName("sending a survey freezes its recipient count and notifies every backer")
    void sendingASurveyNotifiesEveryBacker() {
        Account creator = account("send-creator");
        UUID project = liveCampaign(creator);
        UUID first = backer(project, "COLLECTED", "AZ", null);
        UUID second = backer(project, "COLLECTED", "DE", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        ResponseEntity<Map<String, Object>> sent = send(survey, creator);

        assertThat(sent.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(sent.getBody()).containsEntry("sent", true).containsEntry("sentTo", 2);

        relay.run();
        assertThat(recipients()).containsExactlyInAnyOrder(first, second);
        assertThat(notificationCount()).isEqualTo(2 * SURVEY_CHANNELS);
    }

    @Test
    @DisplayName("a survey that asks nothing cannot be sent")
    void anEmptySurveyCannotBeSent() {
        Account creator = account("empty-creator");
        UUID project = liveCampaign(creator);
        UUID survey = surveyOn(project, creator, List.of());

        ResponseEntity<Map<String, Object>> refused = send(survey, creator);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "SURVEY_HAS_NO_QUESTIONS");
    }

    @Test
    @DisplayName("a survey cannot be sent twice")
    void aSurveyCannotBeSentTwice() {
        Account creator = account("twice-creator");
        UUID project = liveCampaign(creator);
        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));

        send(survey, creator);
        ResponseEntity<Map<String, Object>> again = send(survey, creator);

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(again.getBody()).containsEntry("code", "SURVEY_ALREADY_SENT");
    }

    /**
     * The frozen count is honest about the backers the platform decided not to ask.
     *
     * <p>{@code application-test.yml} sets the ceiling to two so that three backers
     * exercise it. Without this the number would look like a complete send.
     */
    @Test
    @DisplayName("an audience above the ceiling is truncated and the frozen count says so")
    void anAudienceAboveTheCeilingIsReportedAsTruncated() {
        Account creator = account("ceiling-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "AZ", null);
        backer(project, "COLLECTED", "AZ", null);
        backer(project, "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        ResponseEntity<Map<String, Object>> sent = send(survey, creator);

        assertThat(sent.getBody())
                .as("the ceiling in the test profile is two")
                .containsEntry("sentTo", 2);
    }

    @Test
    @DisplayName("sending a survey is audited, and the audit row carries counts rather than questions")
    void sendingASurveyIsAudited() {
        Account creator = account("audit-creator");
        UUID project = liveCampaign(creator);
        backer(project, "COLLECTED", "AZ", null);

        UUID survey = surveyOn(
                project, creator, List.of(question("A secret internal question", "TEXT", false, List.of(), null)));
        send(survey, creator);

        // Filtered to this campaign, because `audit_logs` refuses DELETE by design —
        // V21's statement trigger — so the table carries every other test's rows too.
        List<AuditEntry> entries = auditEntries.findAll().stream()
                .filter(entry -> entry.getAction().equals(AuditAction.PROJECT_SURVEY_SENT.action()))
                .filter(entry -> project.equals(entry.getEntityId()))
                .toList();

        assertThat(entries).singleElement().satisfies(entry -> {
            assertThat(entry.getEntityId()).isEqualTo(project);
            assertThat(entry.getDetail()).contains("recipients=1").contains("questions=1");
            assertThat(entry.getDetail())
                    .as("audit_logs has no retention rule, so creator prose never goes in it")
                    .doesNotContain("A secret internal question");
        });
    }

    // ------------------------------------------------------------------
    // What "sent" means
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the questions freeze once the survey has been sent, and the note and deadline do not")
    void theQuestionsFreezeOnceTheSurveyHasBeenSent() {
        Account creator = account("freeze-creator");
        UUID project = liveCampaign(creator);
        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);

        ResponseEntity<Map<String, Object>> changedQuestions = update(
                survey,
                creator,
                "Reward details",
                "A note.",
                List.of(question("What colour?", "CHOICE", true, List.of("Red", "Blue"), null)));

        assertThat(changedQuestions.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(changedQuestions.getBody()).containsEntry("code", "SURVEY_ALREADY_SENT");

        ResponseEntity<Map<String, Object>> changedNote = update(
                survey,
                creator,
                "Reward details",
                "Sorry, one more thing.",
                List.of(question("What size?", "CHOICE", true, sizes(), null)));

        assertThat(changedNote.getStatusCode())
                .as("the covering note is prose nobody answered")
                .isEqualTo(HttpStatus.OK);
        assertThat(changedNote.getBody()).containsEntry("message", "Sorry, one more thing.");
    }

    @Test
    @DisplayName("a sent survey cannot be deleted")
    void aSentSurveyCannotBeDeleted() {
        Account creator = account("delete-creator");
        UUID project = liveCampaign(creator);
        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);

        assertThat(exchange("/v1/surveys/" + survey, HttpMethod.DELETE, creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    // ------------------------------------------------------------------
    // Answering — PM-02, PM-05, PM-06
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a backer answers a survey and reads their own answers back")
    void aBackerAnswersASurvey() {
        Account creator = account("answer-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("answer-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);

        UUID questionId = firstQuestionId(survey, creator);
        ResponseEntity<Map<String, Object>> answered = respond(survey, backer, pledge, questionId, List.of("M"));

        assertThat(answered.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(answered.getBody()).containsEntry("answered", true).containsEntry("open", true);

        List<Map<String, Object>> mine = surveysOf(backer);
        assertThat(mine).singleElement().satisfies(entry -> {
            assertThat(entry).containsEntry("answered", true);
            assertThat(answersOf(entry)).singleElement().satisfies(answer ->
                    assertThat(answer).containsEntry("value", List.of("M")));
        });
    }

    /**
     * PM-02, and the rule that the filter is a fact rather than a hint.
     *
     * <p>A backer on a different tier is not shown the question, and a client that
     * submitted an answer to it anyway is refused — because a silently dropped answer
     * is one the backer believes they gave.
     */
    @Test
    @DisplayName("a question conditional on a tier is only asked of the backers who chose it")
    void aConditionalQuestionIsOnlyAskedOfTheTierItNames() {
        Account creator = account("tier-creator");
        UUID project = liveCampaign(creator);
        UUID shirtTier = rewardTier(project, creator, "Shirt");

        Account shirtBacker = account("shirt-backer");
        UUID shirtPledge = pledgeFor(project, shirtBacker.id(), "COLLECTED", "AZ", shirtTier);
        Account posterBacker = account("poster-backer");
        UUID posterPledge = pledgeFor(project, posterBacker.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(
                project,
                creator,
                List.of(
                        question("What size?", "CHOICE", true, sizes(), shirtTier),
                        question("Anything else?", "TEXT", false, List.of(), null)));
        send(survey, creator);
        UUID sizeQuestion = firstQuestionId(survey, creator);

        assertThat(questionPrompts(surveysOf(shirtBacker).get(0)))
                .as("the backer who chose the tier is asked both")
                .containsExactly("What size?", "Anything else?");
        assertThat(questionPrompts(surveysOf(posterBacker).get(0)))
                .as("the backer who did not is asked only the unconditional one")
                .containsExactly("Anything else?");

        ResponseEntity<Map<String, Object>> refused =
                respond(survey, posterBacker, posterPledge, sizeQuestion, List.of("M"));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "SURVEY_ANSWER_INVALID");

        assertThat(respond(survey, shirtBacker, shirtPledge, sizeQuestion, List.of("M"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("an answer that is not one of the offered options is refused")
    void anAnswerOutsideTheOptionsIsRefused() {
        Account creator = account("option-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("option-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);

        ResponseEntity<Map<String, Object>> refused =
                respond(survey, backer, pledge, firstQuestionId(survey, creator), List.of("XXL"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "SURVEY_ANSWER_INVALID");
    }

    @Test
    @DisplayName("a required question left unanswered is refused")
    void aRequiredQuestionMustBeAnswered() {
        Account creator = account("required-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("required-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);

        Map<String, Object> request = new HashMap<>();
        request.put("pledgeId", pledge.toString());
        request.put("answers", List.of());

        ResponseEntity<Map<String, Object>> refused =
                exchange("/v1/surveys/" + survey + "/respond", HttpMethod.POST, backer.accessToken(), request);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
    }

    /**
     * PM-06: the cut-off is a comparison against the clock, not a job.
     *
     * <p>Moved by rewriting the row rather than by waiting, which is what makes the
     * rule assertable at all — and the point is that no sweep had to run for the
     * survey to close.
     */
    @Test
    @DisplayName("answers can be changed until the cut-off and not after")
    void answersCanBeChangedUntilTheCutOffAndNotAfter() {
        Account creator = account("cutoff-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("cutoff-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);
        UUID questionId = firstQuestionId(survey, creator);

        assertThat(respond(survey, backer, pledge, questionId, List.of("S")).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(respond(survey, backer, pledge, questionId, List.of("L")).getStatusCode())
                .as("PM-06: an edit of the same row")
                .isEqualTo(HttpStatus.OK);
        assertThat(responseCount(survey)).as("one row, not two").isEqualTo(1);

        // Both instants move, because V35 refuses a cut-off that precedes the send —
        // a survey closed on arrival is one every backer was invited to and refused by.
        // Rewriting the row rather than waiting is what makes the rule assertable at
        // all, and the point of the assertion is that no sweep had to run.
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE surveys SET sent_at = now() - interval '2 hours',"
                                + " respond_by = now() - interval '1 hour' WHERE id = ?",
                        survey);

        ResponseEntity<Map<String, Object>> tooLate = respond(survey, backer, pledge, questionId, List.of("M"));
        assertThat(tooLate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(tooLate.getBody()).containsEntry("code", "SURVEY_NOT_OPEN");
    }

    @Test
    @DisplayName("a draft survey does not appear to backers and cannot be answered")
    void aDraftIsInvisibleToBackers() {
        Account creator = account("draft-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("draft-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));

        assertThat(surveysOf(backer)).isEmpty();
        assertThat(respond(survey, backer, pledge, UUID.randomUUID(), List.of("M"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    // ------------------------------------------------------------------
    // The creator's read
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the creator reads the responses with the questions they answer")
    void theCreatorReadsTheResponses() {
        Account creator = account("read-creator");
        UUID project = liveCampaign(creator);
        Account backer = account("read-backer");
        UUID pledge = pledgeFor(project, backer.id(), "COLLECTED", "AZ", null);

        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);
        respond(survey, backer, pledge, firstQuestionId(survey, creator), List.of("M"));

        ResponseEntity<Map<String, Object>> collected =
                exchange("/v1/surveys/" + survey + "/responses", HttpMethod.GET, creator.accessToken(), null);

        assertThat(collected.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(collected.getBody()).containsEntry("total", 1);
        assertThat(collected.getHeaders().getCacheControl()).contains("no-store");
        assertThat(questions(collected.getBody())).hasSize(1);
    }

    @Test
    @DisplayName("a backer cannot read another campaign's responses")
    void aBackerCannotReadTheResponses() {
        Account creator = account("guard-creator");
        UUID project = liveCampaign(creator);
        Account stranger = account("guard-stranger");
        UUID survey = surveyOn(project, creator, List.of(question("What size?", "CHOICE", true, sizes(), null)));
        send(survey, creator);

        assertThat(exchange("/v1/surveys/" + survey + "/responses", HttpMethod.GET, stranger.accessToken(), null)
                        .getStatusCode())
                .as("a stranger is not told the campaign exists")
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private static List<String> sizes() {
        return List.of("S", "M", "L");
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

    private UUID liveCampaign(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign that asks questions " + SEQUENCE.incrementAndGet()));
        UUID project = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, project);
        return project;
    }

    private UUID rewardTier(UUID project, Account creator, String title) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects/" + project + "/rewards",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", title, "price", Map.of("amount", "25.00", "currency", "AZN")));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID backer(UUID project, String state, String country, UUID tier) {
        UUID backerId = Campaigns.creator(dataSource, "sv-b" + SEQUENCE.incrementAndGet());
        pledgeFor(project, backerId, state, country, tier);
        return backerId;
    }

    private UUID pledgeFor(UUID project, UUID backerId, String state, String country, UUID tier) {
        UUID pledgeId = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges
                            (id, project_id, backer_id, reward_tier_id, state, base_amount, shipping_country,
                             confirmed_at)
                        VALUES (?, ?, ?, ?, ?, 25.00, ?, now())
                        """,
                        pledgeId,
                        project,
                        backerId,
                        tier,
                        state,
                        country);
        return pledgeId;
    }

    private static Map<String, Object> question(
            String prompt, String type, boolean required, List<String> choices, UUID rewardTierId) {

        Map<String, Object> body = new HashMap<>();
        body.put("prompt", prompt);
        body.put("type", type);
        body.put("required", required);
        body.put("choices", choices);
        if (rewardTierId != null) {
            body.put("rewardTierId", rewardTierId.toString());
        }
        return body;
    }

    private ResponseEntity<Map<String, Object>> create(
            UUID project, Account caller, String title, List<Map<String, Object>> questions) {

        Map<String, Object> body = new HashMap<>();
        body.put("title", title);
        body.put("questions", questions);
        return exchange("/v1/projects/" + project + "/surveys", HttpMethod.POST, caller.accessToken(), body);
    }

    private UUID surveyOn(UUID project, Account creator, List<Map<String, Object>> questions) {
        return UUID.fromString(
                (String) create(project, creator, "Reward details", questions).getBody().get("id"));
    }

    private ResponseEntity<Map<String, Object>> update(
            UUID survey, Account caller, String title, String message, List<Map<String, Object>> questions) {

        Map<String, Object> body = new HashMap<>();
        body.put("title", title);
        body.put("message", message);
        body.put("questions", questions);
        return exchange("/v1/surveys/" + survey, HttpMethod.PUT, caller.accessToken(), body);
    }

    private ResponseEntity<Map<String, Object>> send(UUID survey, Account caller) {
        return exchange("/v1/surveys/" + survey + "/send", HttpMethod.POST, caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> respond(
            UUID survey, Account caller, UUID pledge, UUID questionId, List<String> value) {

        Map<String, Object> body = new HashMap<>();
        body.put("pledgeId", pledge.toString());
        body.put("answers", List.of(Map.of("questionId", questionId.toString(), "value", value)));
        return exchange("/v1/surveys/" + survey + "/respond", HttpMethod.POST, caller.accessToken(), body);
    }

    private UUID firstQuestionId(UUID survey, Account creator) {
        ResponseEntity<Map<String, Object>> read =
                exchange("/v1/surveys/" + survey, HttpMethod.GET, creator.accessToken(), null);
        return UUID.fromString((String) questions(read.getBody()).get(0).get("id"));
    }

    private List<Map<String, Object>> surveysOf(Account backer) {
        ResponseEntity<Map<String, Object>> mine =
                exchange("/v1/me/surveys", HttpMethod.GET, backer.accessToken(), null);
        return listOf(mine.getBody(), "surveys");
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOf(Map<String, Object> body, String field) {
        return (List<Map<String, Object>>) body.get(field);
    }

    private static List<Map<String, Object>> questions(Map<String, Object> body) {
        return listOf(body, "questions");
    }

    private static List<Map<String, Object>> answersOf(Map<String, Object> body) {
        return listOf(body, "answers");
    }

    private static List<String> questionPrompts(Map<String, Object> body) {
        return questions(body).stream().map(question -> (String) question.get("prompt")).toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> body) {
        return (Map<String, Object>) body.get("meta");
    }

    private List<UUID> recipients() {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT DISTINCT recipient_id FROM notifications WHERE type = 'SURVEY_AVAILABLE'", UUID.class);
    }

    private long notificationCount() {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM notifications WHERE type = 'SURVEY_AVAILABLE'", Long.class);
    }

    private long responseCount(UUID survey) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM survey_responses WHERE survey_id = ?", Long.class, survey);
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
