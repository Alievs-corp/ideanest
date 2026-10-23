package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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
 * The story, over HTTP: what is refused, what is stored, and what the version
 * history does.
 *
 * <p>The tests that carry the design are
 * {@link #aSecondChangeInsideTheWindowWritesNoVersion()} and
 * {@link #aChangeAfterTheWindowWritesAnotherVersion()}. The editor autosaves every
 * few seconds, so the interval rule is the difference between a readable history
 * and several thousand near-identical {@code jsonb} documents per afternoon — and
 * a rule about elapsed time is exactly the kind that is written once, believed, and
 * never exercised.
 *
 * <p>Time is moved rather than waited for. {@code AdjustableClock} is the
 * application's {@link java.time.Clock}, and
 * {@code StoryVersionService} compares a stored {@code created_at} against it — so
 * advancing the clock six minutes is indistinguishable, to the rule, from six
 * minutes passing. A sleeping test would be slow and would fail exactly when the
 * machine is busy, which is on CI in the run nobody is watching.
 *
 * <p>{@code application-test.yml} keeps three versions rather than the fifty
 * production keeps. The arithmetic is identical and the assertion does not need
 * fifty documents to prove it.
 */
class StoryApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** {@code ideanest.project.story.versions-kept} in {@code application-test.yml}. */
    private static final int VERSIONS_KEPT = 3;

    /** Past {@code ideanest.project.story.version-interval}, which is five minutes. */
    private static final Duration PAST_THE_WINDOW = Duration.ofMinutes(6);

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void freezeTime() {
        // Frozen so that "the same time step" means something across three HTTP
        // calls: without it the second save in a test could genuinely fall outside
        // the window on a slow machine, and the test would pass for the wrong
        // reason exactly when it mattered.
        clock.freeze();
    }

    @AfterEach
    void releaseTimeAndClearProjects() {
        // The context, and therefore the clock, is shared with every other
        // integration test. Leaving it frozen would break them somewhere else.
        clock.reset();

        // Campaigns reference users and deliberately do not cascade from them, so a
        // suite that left rows here would break the identity tests' own cleanup.
        // Story versions cascade from projects; deleted explicitly anyway, because a
        // cleanup that relies on a cascade stops working the day the cascade is
        // reconsidered and nothing says why.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM project_story_versions");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Creator(String accessToken, UUID id) {
    }

    private Creator creator() {
        EmailAddress email = EmailAddress.of("storyteller" + SEQUENCE.incrementAndGet() + "@example.com");
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
        return new Creator((String) signedIn.getBody().get("accessToken"), id);
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

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<List<Map<String, Object>>> getList(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(bearer(accessToken)),
                new ParameterizedTypeReference<List<Map<String, Object>>>() {});
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /**
     * A patch sent as literal JSON.
     *
     * <p>Every story in this file is written by hand rather than assembled from
     * maps. A document is nested three deep and its exact shape is what is under
     * test, and {@link java.util.Map#of} neither preserves order nor makes the shape
     * readable in the test that depends on it.
     */
    private ResponseEntity<Map<String, Object>> patchJson(String path, String accessToken, String body) {
        return rest.exchange(
                path,
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private UUID draft(Creator creator) {
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("title", "A campaign with a story"), bearer(creator.accessToken())),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** A one-paragraph story, whose text is the only thing that differs between saves. */
    private static String storyOf(String text) {
        return "{\"story\": {\"version\": 1, \"blocks\": [{\"type\": \"paragraph\", \"spans\": "
                + "[{\"text\": \"" + text + "\", \"marks\": []}]}]}}";
    }

    private ResponseEntity<Map<String, Object>> save(UUID project, Creator creator, String text) {
        return patchJson("/v1/projects/" + project, creator.accessToken(), storyOf(text));
    }

    private List<Map<String, Object>> versions(UUID project, Creator creator) {
        return getList("/v1/projects/" + project + "/story/versions", creator.accessToken()).getBody();
    }

    /** The one paragraph's text, dug out of a `ProjectEdit` or a version detail. */
    @SuppressWarnings("unchecked")
    private static String textOf(Map<String, Object> document) {
        List<Map<String, Object>> blocks = (List<Map<String, Object>>) document.get("blocks");
        List<Map<String, Object>> spans = (List<Map<String, Object>>) blocks.getFirst().get("spans");
        return (String) spans.getFirst().get("text");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> storyIn(Map<String, Object> projectEdit) {
        return (Map<String, Object>) projectEdit.get("story");
    }

    // ------------------------------------------------------------------
    // Validation on the autosave path
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a document with an unknown block is refused with STORY_DOCUMENT_INVALID and the path")
    void anInvalidDocumentIsRefused() {
        Creator creator = creator();
        UUID project = draft(creator);

        ResponseEntity<Map<String, Object>> refused = patchJson(
                "/v1/projects/" + project,
                creator.accessToken(),
                "{\"story\": {\"version\": 1, \"blocks\": [{\"type\": \"rule\"}, {\"type\": \"marquee\"}]}}");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Its own code rather than PROJECT_FIELD_INVALID, per contract §5: the
        // editor that receives this looks at the document, not at a form field.
        assertThat(refused.getBody()).containsEntry("code", "STORY_DOCUMENT_INVALID");
        // The path, so the message can be put beside the block it is about rather
        // than in a banner above a story a thousand words long.
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("path", "blocks[1].type"));

        // And nothing was stored. A refused document must not leave half a story
        // behind, and it must not leave a version claiming one was written.
        assertThat(get("/v1/projects/" + project + "/edit", creator.accessToken()).getBody())
                .containsEntry("story", null);
        assertThat(versions(project, creator)).isEmpty();
    }

    @Test
    @DisplayName("an image without its alt key is refused, naming the block")
    void anImageWithoutAltIsRefused() {
        Creator creator = creator();
        UUID project = draft(creator);

        ResponseEntity<Map<String, Object>> refused = patchJson(
                "/v1/projects/" + project,
                creator.accessToken(),
                "{\"story\": {\"version\": 1, \"blocks\": [{\"type\": \"image\", "
                        + "\"url\": \"https://cdn.example.com/a.jpg\", \"width\": 1600, \"height\": 900}]}}");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "STORY_DOCUMENT_INVALID");
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("path", "blocks[0].alt"));
    }

    @Test
    @DisplayName("an image and a section image with an empty description are stored")
    void anImageWithAnEmptyAltIsStored() {
        // #543: refusing these refused the whole story, and a creator lost every image in it.
        Creator creator = creator();
        UUID project = draft(creator);

        ResponseEntity<String> saved = rest.exchange(
                "/v1/projects/" + project,
                HttpMethod.PATCH,
                new HttpEntity<>(
                        "{\"story\": {\"version\": 1, \"blocks\": ["
                                + "{\"type\": \"image\", \"url\": \"https://cdn.example.com/a.jpg\", \"width\": 1600,"
                                + " \"height\": 900, \"alt\": \"\"},"
                                + "{\"type\": \"section\", \"id\": \"our-workshop\", \"title\": \"Our workshop\","
                                + " \"image\": {\"url\": \"https://cdn.example.com/b.jpg\", \"width\": 1440,"
                                + " \"height\": 960, \"alt\": \"\"}, \"spans\": []}]}}",
                        bearer(creator.accessToken())),
                String.class);

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody()).contains("\"url\":\"https://cdn.example.com/b.jpg\"");
        assertThat(versions(project, creator)).hasSize(1);
    }

    @Test
    @DisplayName("an embed from a provider that is not allow-listed is refused")
    void anUnknownEmbedProviderIsRefused() {
        Creator creator = creator();
        UUID project = draft(creator);

        ResponseEntity<Map<String, Object>> refused = patchJson(
                "/v1/projects/" + project,
                creator.accessToken(),
                "{\"story\": {\"version\": 1, \"blocks\": [{\"type\": \"embed\", \"provider\": \"tiktok\", "
                        + "\"url\": \"https://tiktok.com/a\", \"title\": \"A clip\"}]}}");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("path", "blocks[0].provider"));
    }

    @Test
    @DisplayName("two headings with the same anchor are refused")
    void duplicateHeadingAnchorsAreRefused() {
        Creator creator = creator();
        UUID project = draft(creator);

        ResponseEntity<Map<String, Object>> refused = patchJson(
                "/v1/projects/" + project,
                creator.accessToken(),
                "{\"story\": {\"version\": 1, \"blocks\": ["
                        + "{\"type\": \"heading\", \"level\": 2, \"id\": \"the-plan\", \"text\": \"The plan\"},"
                        + "{\"type\": \"heading\", \"level\": 2, \"id\": \"the-plan\", \"text\": \"Again\"}]}}");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("path", "blocks[1].id"));
    }

    @Test
    @DisplayName("a valid document is stored and returned as a document")
    void aValidDocumentIsStored() {
        Creator creator = creator();
        UUID project = draft(creator);

        ResponseEntity<String> saved = rest.exchange(
                "/v1/projects/" + project,
                HttpMethod.PATCH,
                new HttpEntity<>(
                        "{\"story\": {\"version\": 1, \"blocks\": ["
                                + "{\"type\": \"heading\", \"level\": 2, \"id\": \"how-it-works\", \"text\": \"How it works\"},"
                                + "{\"type\": \"paragraph\", \"spans\": [{\"text\": \"Plain \", \"marks\": []},"
                                + " {\"text\": \"bold\", \"marks\": [\"strong\"]}]},"
                                + "{\"type\": \"list\", \"ordered\": false, \"items\": [[{\"text\": \"One\", \"marks\": []}]]},"
                                + "{\"type\": \"quote\", \"spans\": []},"
                                + "{\"type\": \"rule\"},"
                                + "{\"type\": \"image\", \"url\": \"https://cdn.example.com/a.jpg\", \"width\": 1600,"
                                + " \"height\": 900, \"alt\": \"The prototype\"},"
                                + "{\"type\": \"embed\", \"provider\": \"vimeo\", \"url\": \"https://vimeo.com/1\","
                                + " \"title\": \"The prototype in use\"}]}}",
                        bearer(creator.accessToken())),
                String.class);

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        // JSON, not an escaped string: the column is jsonb all the way out, and the
        // first client to forget to parse it twice would render the escapes.
        assertThat(saved.getBody()).contains("\"story\":{").doesNotContain("\"story\":\"{");
        assertThat(saved.getBody()).contains("\"id\":\"how-it-works\"").contains("\"marks\":[\"strong\"]");
    }

    @Test
    @DisplayName("the story survives a save that does not mention it")
    void autosavingAnotherFieldLeavesTheStoryAlone() {
        Creator creator = creator();
        UUID project = draft(creator);
        save(project, creator, "The opening paragraph");

        // The basics tab autosaves one field at a time. Read as "set the title and
        // clear the rest", this request would delete the story — and it would look
        // entirely ordinary in a log.
        Map<String, Object> saved = patchJson(
                        "/v1/projects/" + project, creator.accessToken(), "{\"title\": \"A better title\"}")
                .getBody();

        assertThat(textOf(storyIn(saved))).isEqualTo("The opening paragraph");
    }

    // ------------------------------------------------------------------
    // When a version is written
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the first change to a story writes version 1")
    void theFirstChangeWritesAVersion() {
        Creator creator = creator();
        UUID project = draft(creator);

        save(project, creator, "The opening paragraph");

        List<Map<String, Object>> history = versions(project, creator);
        assertThat(history).hasSize(1);
        assertThat(history.getFirst()).containsEntry("number", 1);
        assertThat(history.getFirst()).containsEntry("authorId", creator.id().toString());
        // The count is what makes a list of timestamps usable: it is how a creator
        // tells the version from before they deleted a section from the one after.
        assertThat(history.getFirst()).containsEntry("characters", "The opening paragraph".length());
        // Written immediately rather than after the interval, because there is
        // nothing to protect against yet — the interval exists to stop the SECOND
        // through thousandth save, and a creator whose first save was not preserved
        // has no history at all for the first five minutes of writing.
    }

    @Test
    @DisplayName("a second change inside the window writes no version")
    void aSecondChangeInsideTheWindowWritesNoVersion() {
        Creator creator = creator();
        UUID project = draft(creator);

        save(project, creator, "The opening paragraph");
        save(project, creator, "The opening paragraph, revised");
        save(project, creator, "The opening paragraph, revised again");

        // The rule the whole feature depends on. The editor autosaves a few hundred
        // milliseconds after somebody stops typing, so without this the three saves
        // above would be three rows — and an afternoon's writing several thousand.
        assertThat(versions(project, creator)).hasSize(1);

        // The story itself is the latest text regardless. The interval decides what
        // is PRESERVED, never what is stored.
        assertThat(textOf(storyIn(get("/v1/projects/" + project + "/edit", creator.accessToken())
                        .getBody())))
                .isEqualTo("The opening paragraph, revised again");
    }

    @Test
    @DisplayName("a change after the window writes another version")
    void aChangeAfterTheWindowWritesAnotherVersion() {
        Creator creator = creator();
        UUID project = draft(creator);

        save(project, creator, "The opening paragraph");
        clock.advance(PAST_THE_WINDOW);
        save(project, creator, "The opening paragraph, revised");

        List<Map<String, Object>> history = versions(project, creator);
        assertThat(history).hasSize(2);
        // Newest first, which is the order a history is read in and the order the
        // index is built in.
        assertThat(history).extracting(version -> version.get("number")).containsExactly(2, 1);
    }

    @Test
    @DisplayName("saving a story that has not changed writes no version, however long has passed")
    void anUnchangedStoryWritesNoVersion() {
        Creator creator = creator();
        UUID project = draft(creator);

        save(project, creator, "The opening paragraph");
        clock.advance(PAST_THE_WINDOW);
        save(project, creator, "The opening paragraph");

        // Both conditions, not either. Time alone would write a version every five
        // minutes of a session in which nothing was typed — and the editor sends the
        // whole document on every save, so an unchanged one is a request that
        // happens routinely.
        assertThat(versions(project, creator)).hasSize(1);
    }

    @Test
    @DisplayName("only the most recent versions are kept")
    void retentionPrunesTheOldest() {
        Creator creator = creator();
        UUID project = draft(creator);

        // One more than the retention window, so exactly one has to be dropped.
        for (int revision = 1; revision <= VERSIONS_KEPT + 1; revision++) {
            save(project, creator, "Revision " + revision);
            clock.advance(PAST_THE_WINDOW);
        }

        List<Map<String, Object>> history = versions(project, creator);
        assertThat(history).hasSize(VERSIONS_KEPT);
        // The numbers are NOT renumbered when old versions are pruned: a number that
        // moved would make a link somebody kept, or a support conversation, point at
        // a different document.
        assertThat(history).extracting(version -> version.get("number")).containsExactly(4, 3, 2);

        // And version 1 is gone rather than empty, with a code saying which of the
        // two it is.
        ResponseEntity<Map<String, Object>> pruned =
                get("/v1/projects/" + project + "/story/versions/1", creator.accessToken());
        assertThat(pruned.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(pruned.getBody()).containsEntry("code", "STORY_VERSION_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // Reading and restoring
    // ------------------------------------------------------------------

    @Test
    @DisplayName("one version can be read whole, before anything is replaced with it")
    void aVersionCanBeRead() {
        Creator creator = creator();
        UUID project = draft(creator);
        save(project, creator, "The opening paragraph");

        Map<String, Object> version =
                get("/v1/projects/" + project + "/story/versions/1", creator.accessToken()).getBody();

        assertThat(version).containsEntry("number", 1);
        assertThat(textOf(storyIn(Map.of("story", version.get("document"))))).isEqualTo("The opening paragraph");
    }

    @Test
    @DisplayName("restoring produces the older document, and preserves the newer one first")
    void restoringProducesTheOlderDocument() {
        Creator creator = creator();
        UUID project = draft(creator);

        save(project, creator, "The first draft");
        clock.advance(PAST_THE_WINDOW);
        save(project, creator, "The second draft");
        clock.advance(PAST_THE_WINDOW);

        Map<String, Object> restored =
                post("/v1/projects/" + project + "/story/versions/1/restore", creator.accessToken()).getBody();

        // The whole ProjectEdit, because the editor's next action is to render the
        // story it now holds.
        assertThat(textOf(storyIn(restored))).isEqualTo("The first draft");
        assertThat(textOf(storyIn(get("/v1/projects/" + project + "/edit", creator.accessToken())
                        .getBody())))
                .isEqualTo("The first draft");

        // Restoring is destructive, and what makes it safe to offer is that the
        // document it replaced is still reachable — so a creator who restored the
        // wrong draft can restore back.
        //
        // No THIRD version was written, and that is the correct outcome rather than
        // a gap. Version 2 already holds the second draft: it was written by the
        // save that produced it, so preserving it again would store the same
        // document twice under two numbers. The restore only writes a version when
        // the current story is not already the newest one — which is the case when a
        // creator restores after typing inside the interval.
        assertThat(versions(project, creator)).extracting(version -> version.get("number"))
                .containsExactly(2, 1);
        assertThat(textOf(storyIn(Map.of(
                        "story",
                        get("/v1/projects/" + project + "/story/versions/2", creator.accessToken())
                                .getBody()
                                .get("document")))))
                .isEqualTo("The second draft");
    }

    @Test
    @DisplayName("restoring preserves unsaved-to-history writing first")
    void restoringPreservesWhatItReplaces() {
        Creator creator = creator();
        UUID project = draft(creator);

        save(project, creator, "The first draft");
        clock.advance(PAST_THE_WINDOW);
        // Two saves in the same window: version 2 holds the second draft, and the
        // third is in `projects.story` only. This is the state a creator is actually
        // in when they reach for the history — they have been typing for a minute and
        // want the version from before they started.
        save(project, creator, "The second draft");
        save(project, creator, "The third draft, which was a mistake");

        // No clock advance, deliberately. A restore preserves what it replaces
        // whatever the interval says: the interval throttles autosave, and applying
        // it here would discard the minute of writing the creator was trying to get
        // away from, in the one operation that has no way back.
        post("/v1/projects/" + project + "/story/versions/1/restore", creator.accessToken());

        // The mistake is preserved as version 3 before being replaced. Without this
        // the restore would be the one destructive action in the editor with no way
        // back, which is the failure the whole feature exists to prevent.
        assertThat(versions(project, creator)).extracting(version -> version.get("number"))
                .containsExactly(3, 2, 1);
        assertThat(textOf(storyIn(Map.of(
                        "story",
                        get("/v1/projects/" + project + "/story/versions/3", creator.accessToken())
                                .getBody()
                                .get("document")))))
                .isEqualTo("The third draft, which was a mistake");
    }

    @Test
    @DisplayName("restoring a version that does not exist changes nothing")
    void restoringAnUnknownVersionChangesNothing() {
        Creator creator = creator();
        UUID project = draft(creator);
        save(project, creator, "The only draft");

        ResponseEntity<Map<String, Object>> refused =
                post("/v1/projects/" + project + "/story/versions/99/restore", creator.accessToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "STORY_VERSION_NOT_FOUND");
        assertThat(textOf(storyIn(get("/v1/projects/" + project + "/edit", creator.accessToken())
                        .getBody())))
                .isEqualTo("The only draft");
    }

    // ------------------------------------------------------------------
    // Who may see a story's history
    // ------------------------------------------------------------------

    @Test
    @DisplayName("another creator's story history is a 404 on every endpoint")
    void aStoryHistoryIsPrivateToItsCreator() {
        Creator owner = creator();
        Creator stranger = creator();
        UUID project = draft(owner);
        save(project, owner, "An unannounced product");

        // 404 rather than 403, exactly as for the campaign itself. A draft's story is
        // an unreleased product and sometimes a company that does not exist yet;
        // answering 403 would turn the version history into an oracle for what other
        // people are preparing.
        ResponseEntity<Map<String, Object>> list =
                get("/v1/projects/" + project + "/story/versions", stranger.accessToken());
        assertThat(list.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(list.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");

        assertThat(get("/v1/projects/" + project + "/story/versions/1", stranger.accessToken())
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(post("/v1/projects/" + project + "/story/versions/1/restore", stranger.accessToken())
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        // And the story is untouched.
        assertThat(textOf(storyIn(get("/v1/projects/" + project + "/edit", owner.accessToken())
                        .getBody())))
                .isEqualTo("An unannounced product");
    }

    @Test
    @DisplayName("an unauthenticated caller cannot read a story's history")
    void theHistoryIsBehindAuthentication() {
        Creator creator = creator();
        UUID project = draft(creator);

        assertThat(rest.exchange(
                                "/v1/projects/" + project + "/story/versions",
                                HttpMethod.GET,
                                new HttpEntity<>(jsonHeaders()),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
