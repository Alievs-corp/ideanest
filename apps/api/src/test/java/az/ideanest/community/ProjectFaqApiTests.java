package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.RecordingCollaboratorInvitationNotifier;
import az.ideanest.user.infrastructure.UserRepository;
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
 * The FAQ tab over HTTP: who may read it, who may change it, and in what order it comes
 * back. §4.4's FAQ tab, §4.7's CD-15, #283.
 *
 * <p>The tests that carry the design are {@link #aStrangerIsToldTheCampaignDoesNotExist()}
 * and {@link #aReorderNamesEveryEntryExactlyOnce()}. The first is the 404-not-403 rule
 * this platform applies everywhere and the one an FAQ write could most easily get wrong,
 * because the single-entry endpoints carry no campaign in the path and a refusal that
 * distinguished "not yours" from "not there" would be an oracle for which identifiers are
 * real. The second is the whole of the reorder contract: every entry exactly once, both
 * halves of the disagreement named, and positions rewritten from zero so that two
 * concurrent reorders produce one of the two orders rather than a blend.
 */
class ProjectFaqApiTests extends AbstractIntegrationTest {

    /**
     * What this class's fixture accounts are called.
     *
     * <p><strong>Namespaced so they cannot be another suite's.</strong> Nothing deletes
     * users between classes, and {@code role + "-" + counter} is a convention several
     * suites share with counters that all start at one. A suite that takes
     * {@code creator-1@example.com} first leaves the next one unable to register a
     * password against it — its sign-in answers 401, its next call carries
     * {@code Authorization: Bearer null}, and the failure surfaces in a fixture far from
     * the cause and only when the whole suite runs.
     */
    private static final String HANDLE_PREFIX = "faq-";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private RecordingCollaboratorInvitationNotifier invitations;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clearCampaigns() {
        // FAQ entries and grants cascade from the campaign; removed explicitly anyway,
        // because a cleanup that leans on a cascade stops working the day the cascade is
        // reconsidered and nothing says why. The audit rows are deliberately left where
        // they are: `audit_logs` refuses DELETE, which is the property it exists for.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM project_faqs");
        jdbc.update("DELETE FROM collaborators");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
        invitations.clear();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(EmailAddress email, String accessToken, UUID id) {
    }

    private Account account(String role) {
        EmailAddress email = EmailAddress.of(HANDLE_PREFIX + role + "-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                OBJECT);

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account(email, (String) signedIn.getBody().get("accessToken"), id);
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

    private UUID draft(Account creator) {
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("title", "A campaign with questions"), bearer(creator.accessToken())),
                OBJECT);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** A campaign the public can read: LIVE, which is one of §6.1's nine public states. */
    private UUID liveCampaign(Account creator) {
        UUID project = draft(creator);
        Campaigns.launch(dataSource, project);
        return project;
    }

    /** An accepted grant conferring exactly the capabilities named. */
    private Account collaborator(UUID projectId, Account creator, String... capabilities) {
        Account invitee = account("collaborator");
        ResponseEntity<Map<String, Object>> invited = rest.exchange(
                "/v1/projects/" + projectId + "/collaborators",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", invitee.email().value(), "capabilities", List.of(capabilities)),
                        bearer(creator.accessToken())),
                OBJECT);
        assertThat(invited.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        String token = invitations.tokenSentTo(invitee.email()).orElseThrow();
        ResponseEntity<Map<String, Object>> accepted = rest.exchange(
                "/v1/collaborators/invitations/" + token + "/accept",
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(invitee.accessToken())),
                OBJECT);
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.OK);
        return invitee;
    }

    private static Map<String, Object> entry(String question, String answer) {
        // A LinkedHashMap rather than Map.of, because several of these tests send a null
        // deliberately and Map.of refuses one.
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("question", question);
        body.put("answer", answer);
        return body;
    }

    private ResponseEntity<Map<String, Object>> create(UUID project, Account caller, Map<String, Object> body) {
        return rest.exchange(
                "/v1/projects/" + project + "/faqs",
                HttpMethod.POST,
                new HttpEntity<>(body, bearer(caller.accessToken())),
                OBJECT);
    }

    private UUID createdEntry(UUID project, Account caller, String question, String answer) {
        ResponseEntity<Map<String, Object>> created = create(project, caller, entry(question, answer));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private ResponseEntity<Map<String, Object>> patch(UUID faqId, Account caller, Map<String, Object> body) {
        return rest.exchange(
                "/v1/faqs/" + faqId, HttpMethod.PATCH, new HttpEntity<>(body, bearer(caller.accessToken())), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> reorder(UUID project, Account caller, List<UUID> order) {
        return rest.exchange(
                "/v1/projects/" + project + "/faqs/reorder",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("faqIds", order.stream().map(UUID::toString).toList()),
                        bearer(caller.accessToken())),
                OBJECT);
    }

    private ResponseEntity<Map<String, Object>> read(UUID project, String accessToken) {
        HttpHeaders headers = accessToken == null ? new HttpHeaders() : bearer(accessToken);
        return rest.exchange("/v1/projects/" + project + "/faqs", HttpMethod.GET, new HttpEntity<>(headers), OBJECT);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> entriesIn(ResponseEntity<Map<String, Object>> response) {
        return (List<Map<String, Object>>) response.getBody().get("faqs");
    }

    private static List<String> questionsIn(ResponseEntity<Map<String, Object>> response) {
        return entriesIn(response).stream().map(faq -> (String) faq.get("question")).toList();
    }

    private int countFor(UUID project) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM project_faqs WHERE project_id = ?", Integer.class, project);
    }

    // ------------------------------------------------------------------
    // Writing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a creator adds an entry and it comes back with an identifier")
    void anEntryIsCreated() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> created =
                create(project, creator, entry("  When do you ship?  ", "In March."));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        // Trimmed on the way in, by FaqContent, which the entity calls — not by the
        // request record, so a second write path would inherit the rule.
        assertThat(created.getBody()).containsEntry("question", "When do you ship?");
        assertThat(created.getBody()).containsEntry("answer", "In March.");
        // The identifier is what PATCH, DELETE and a reorder body all name, so it has to
        // be in the response to the request that made the entry.
        assertThat(created.getBody().get("id")).isNotNull();
    }

    @Test
    @DisplayName("a patch changes one field and leaves the other alone")
    void aPatchIsPartial() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID faq = createdEntry(project, creator, "When do you ship?", "In March.");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("answer", "In April — the moulds were late.");
        ResponseEntity<Map<String, Object>> patched = patch(faq, creator, body);

        assertThat(patched.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The editor autosaves one input at a time. Without Patched both fields arrive
        // as null and fixing a typo in the answer would blank the question above it.
        assertThat(patched.getBody()).containsEntry("question", "When do you ship?");
        assertThat(patched.getBody()).containsEntry("answer", "In April — the moulds were late.");
    }

    @Test
    @DisplayName("a delete removes the entry and answers 204")
    void anEntryIsDeleted() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID faq = createdEntry(project, creator, "When do you ship?", "In March.");

        ResponseEntity<Void> deleted = rest.exchange(
                "/v1/faqs/" + faq,
                HttpMethod.DELETE,
                new HttpEntity<>(bearer(creator.accessToken())),
                Void.class);

        assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        // A hard delete: nothing references an FAQ entry, so there is no tombstone to
        // serve and no predicate a later read has to remember.
        assertThat(countFor(project)).isZero();
    }

    @Test
    @DisplayName("a blank question is refused by the domain, with the field named")
    void blankContentIsRefused() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = create(project, creator, entry("   ", "In March."));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "FAQ_CONTENT_INVALID");
        // Named, so the message lands beside the input that caused it rather than as a
        // banner over a form the creator has just filled in.
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "question"));
        assertThat(countFor(project)).isZero();
    }

    @Test
    @DisplayName("a blank answer is refused too, because an unanswered question on a public page is worse than none")
    void aBlankAnswerIsRefused() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused =
                create(project, creator, entry("When do you ship?", "\n\n"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "answer"));
    }

    // ------------------------------------------------------------------
    // Who may write
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a stranger is told the campaign does not exist, on every write")
    void aStrangerIsToldTheCampaignDoesNotExist() {
        Account creator = account("creator");
        Account stranger = account("stranger");
        UUID project = liveCampaign(creator);
        UUID faq = createdEntry(project, creator, "When do you ship?", "In March.");

        // 404 and not 403, everywhere. A 403 would confirm the campaign is real and,
        // from the flat path, that the entry is — which is an oracle a caller can ask by
        // guessing identifiers.
        ResponseEntity<Map<String, Object>> created =
                create(project, stranger, entry("Whose campaign is this?", "Not yours."));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(created.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");

        ResponseEntity<Map<String, Object>> patched = patch(faq, stranger, entry("Mine now?", "No."));
        assertThat(patched.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        // FAQ_NOT_FOUND rather than PROJECT_NOT_FOUND, and identical to what an invented
        // identifier gets — see below.
        assertThat(patched.getBody()).containsEntry("code", "FAQ_NOT_FOUND");

        ResponseEntity<Map<String, Object>> invented =
                patch(UUID.randomUUID(), stranger, entry("Mine now?", "No."));
        assertThat(invented.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(invented.getBody()).containsEntry("code", "FAQ_NOT_FOUND");

        // And nothing was written or changed. A refusal that still left a row would be
        // the same defect with a quieter symptom.
        assertThat(countFor(project)).isEqualTo(1);
    }

    @Test
    @DisplayName("a collaborator without MANAGE_FAQ is refused, and one with it is not")
    void theCapabilityIsTheOneThatDecides() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        Account pricer = collaborator(project, creator, "EDIT_REWARDS");

        ResponseEntity<Map<String, Object>> refused =
                create(project, pricer, entry("When do you ship?", "In March."));

        // 403 rather than 404: they were invited, they can already see the campaign, and
        // there is nothing left to hide from them.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "CAPABILITY_NOT_GRANTED");
        assertThat(countFor(project)).isZero();

        // The other half. A test that only asserted the refusal would pass just as well
        // against an endpoint that refused everybody.
        Account answerer = collaborator(project, creator, "MANAGE_FAQ");
        ResponseEntity<Map<String, Object>> allowed =
                create(project, answerer, entry("When do you ship?", "In March."));
        assertThat(allowed.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(countFor(project)).isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // Reading
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the public read returns every entry in the creator's order")
    void thePublicReadIsInOrder() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID first = createdEntry(project, creator, "When do you ship?", "In March.");
        UUID second = createdEntry(project, creator, "Do you ship abroad?", "Yes.");
        UUID third = createdEntry(project, creator, "Can I change my reward?", "Until the deadline.");

        // Written in one order, arranged in another. The read has to follow the second.
        assertThat(reorder(project, creator, List.of(third, first, second)).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        ResponseEntity<Map<String, Object>> anonymous = read(project, null);

        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(questionsIn(anonymous))
                .containsExactly("Can I change my reward?", "When do you ship?", "Do you ship abroad?");
        // No token was sent. A suite that authenticated would be testing a different
        // endpoint from the one the security matcher opens.
        assertThat(anonymous.getHeaders().getCacheControl()).contains("public").contains("no-cache");
    }

    @Test
    @DisplayName("a campaign with no entries answers an empty list rather than a missing key")
    void anEmptyFaqIsStillAList() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> anonymous = read(project, null);

        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.OK);
        // A client should not have to tell "this campaign has answered nothing" from
        // "this server does not send that key".
        assertThat(anonymous.getBody()).containsKey("faqs");
        assertThat(entriesIn(anonymous)).isEmpty();
    }

    @Test
    @DisplayName("an unlaunched campaign's FAQ is the creator's alone, and its response is not shareable")
    void aDraftIsReadableOnlyByItsTeam() {
        Account creator = account("creator");
        Account stranger = account("stranger");
        UUID project = draft(creator);
        createdEntry(project, creator, "When do you ship?", "In March.");

        // The public question is asked second, deliberately: a creator reading the FAQ on
        // their own unlaunched campaign is entitled to it.
        ResponseEntity<Map<String, Object>> team = read(project, creator.accessToken());
        assertThat(team.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(questionsIn(team)).containsExactly("When do you ship?");
        // Private, because this exact URL serves a stranger a 404 — a shared cache handed
        // the team's body would serve an unlaunched campaign's FAQ to the next visitor.
        assertThat(team.getHeaders().getCacheControl()).contains("private");

        assertThat(read(project, null).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(read(project, stranger.accessToken()).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("an unchanged list revalidates as 304, and an edited one does not")
    void theListCarriesAValidator() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID faq = createdEntry(project, creator, "When do you ship?", "In March.");

        String etag = read(project, null).getHeaders().getETag();
        assertThat(etag).isNotNull();

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<Map<String, Object>> unchanged = rest.exchange(
                "/v1/projects/" + project + "/faqs", HttpMethod.GET, new HttpEntity<>(conditional), OBJECT);
        assertThat(unchanged.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);

        // The text is part of the tag, not just the identifiers — an FAQ entry is
        // editable in place, which is the difference between this tab and the Updates
        // tab, and a tag over identifiers alone would serve a 304 for a list whose every
        // answer had been rewritten.
        patch(faq, creator, entry("When do you ship?", "In April."));
        ResponseEntity<Map<String, Object>> changed = rest.exchange(
                "/v1/projects/" + project + "/faqs", HttpMethod.GET, new HttpEntity<>(conditional), OBJECT);
        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Order
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reorder names every entry exactly once, or names what is wrong with the list")
    void aReorderNamesEveryEntryExactlyOnce() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID first = createdEntry(project, creator, "When do you ship?", "In March.");
        UUID second = createdEntry(project, creator, "Do you ship abroad?", "Yes.");
        UUID stranger = UUID.randomUUID();

        // Missing `second`, and naming an identifier that is not this campaign's. Both
        // halves are reported, because a client whose list is stale needs to know which.
        ResponseEntity<Map<String, Object>> refused = reorder(project, creator, List.of(first, stranger));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "FAQ_ORDER_INCOMPLETE");
        assertThat(refused.getBody().get("meta"))
                .isEqualTo(Map.of("missing", List.of(second.toString()), "unexpected", List.of(stranger.toString())));

        // A repeat counts as unexpected: it would give one entry two positions and leave
        // the other with none.
        ResponseEntity<Map<String, Object>> repeated = reorder(project, creator, List.of(first, first));
        assertThat(repeated.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(repeated.getBody().get("meta"))
                .isEqualTo(Map.of("missing", List.of(second.toString()), "unexpected", List.of(first.toString())));

        // And nothing moved. The full set or nothing: a partial reorder would leave the
        // entries it omits interleaved with the ones that moved.
        assertThat(questionsIn(read(project, null)))
                .containsExactly("When do you ship?", "Do you ship abroad?");
    }

    @Test
    @DisplayName("a reorder longer than any campaign's list is refused before it is read")
    void anOversizedReorderIsRefused() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        createdEntry(project, creator, "When do you ship?", "In March.");

        List<UUID> runaway = java.util.stream.Stream.generate(UUID::randomUUID).limit(201).toList();
        ResponseEntity<Map<String, Object>> refused = reorder(project, creator, runaway);

        // #587: a bound on the request rather than on the campaign, so a list of any length
        // is not held in memory and compared against the entries before being refused.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("errors").toString()).contains("faqIds");
    }

    @Test
    @DisplayName("a reorder rewrites every position from zero")
    void aReorderRewritesPositionsFromZero() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID first = createdEntry(project, creator, "When do you ship?", "In March.");
        UUID second = createdEntry(project, creator, "Do you ship abroad?", "Yes.");
        UUID third = createdEntry(project, creator, "Can I change my reward?", "Until the deadline.");

        assertThat(reorder(project, creator, List.of(third, second, first)).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // Rewritten rather than adjusted, so the stored order is exactly the list the
        // client sent and two concurrent reorders produce one of the two orders rather
        // than a blend of both.
        List<Integer> positions = new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT sort_order FROM project_faqs WHERE project_id = ?"
                                + " ORDER BY sort_order ASC, created_at ASC",
                        Integer.class,
                        project);
        assertThat(positions).containsExactly(0, 1, 2);
    }

    @Test
    @DisplayName("the reorder answers with the list it just wrote")
    void aReorderAnswersWithTheList() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);
        UUID first = createdEntry(project, creator, "When do you ship?", "In March.");
        UUID second = createdEntry(project, creator, "Do you ship abroad?", "Yes.");

        ResponseEntity<Map<String, Object>> reordered = reorder(project, creator, List.of(second, first));

        // The same shape the public read answers, so a client that has just dragged holds
        // exactly what the tab would have served it.
        assertThat(questionsIn(reordered)).containsExactly("Do you ship abroad?", "When do you ship?");
    }
}
