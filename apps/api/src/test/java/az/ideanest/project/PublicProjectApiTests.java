package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.CampaignFinalizerJob;
import az.ideanest.project.application.Taxonomy;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code GET /v1/projects/{creatorSlug}/{projectSlug}}: the campaign page, to anybody.
 *
 * <p>#119's data source. The properties asserted here are the ones a server-rendered
 * page and a search engine depend on, plus the ones a public endpoint has to get right
 * before it is worth having:
 *
 * <ul>
 *   <li>{@link #theCampaignIsServedToNobodyInParticular()} — the whole point: no token.
 *   <li>{@link #twoCreatorsMayShareAProjectSlug()} — why the URL carries both halves.
 *   <li>{@link #aCampaignTheStateHidesIsNotFound()} — the visibility rule, which is the
 *       one thing a public read of a private table must never get wrong.
 *   <li>{@link #theEditorIsStillBehindAToken()} — the security matcher. The public page
 *       and the campaign editor are both two path segments, and a pattern that failed to
 *       tell them apart would publish the editor.
 *   <li>{@link #aClosedCampaignReportsTheFrozenOutcome()} — #63's numbers on the surface
 *       that reports them.
 * </ul>
 */
class PublicProjectApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final Duration CAMPAIGN_LENGTH = Duration.ofDays(30);

    private static final ParameterizedTypeReference<Map<String, Object>> BODY = new ParameterizedTypeReference<>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private CampaignFinalizerJob finalizer;

    @Autowired
    private DataSource dataSource;

    private String handle;
    private UUID creatorId;

    @BeforeEach
    void aCreator() {
        handle = "page-" + SEQUENCE.incrementAndGet();
        creatorId = Campaigns.creator(dataSource, handle);
    }

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update(
                "DELETE FROM project_state_transitions WHERE project_id IN"
                        + " (SELECT id FROM projects WHERE creator_id = ?)",
                creatorId);
        jdbc.update("DELETE FROM projects WHERE creator_id = ?", creatorId);
    }

    // ------------------------------------------------------------------
    // The page
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a live campaign is served to a caller with no session at all")
    void theCampaignIsServedToNobodyInParticular() {
        live("studio-diary");

        ResponseEntity<Map<String, Object>> response = get(handle, "studio-diary");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("slug")).isEqualTo("studio-diary");
        assertThat(body.get("state")).isEqualTo("LIVE");
        assertThat(body.get("title")).isNotNull();
        assertThat(body.get("backersCount")).isEqualTo(42);
    }

    /**
     * §10.3: money crosses the wire as a string, never a number.
     *
     * <p>On the one page whose subject is how much money a campaign has raised, a JSON
     * number is a total somebody's client is invited to parse into a double.
     */
    @Test
    @DisplayName("every amount is an object with a string in it")
    void moneyIsNeverANumber() {
        live("money");

        Map<String, Object> body = get(handle, "money").getBody();

        assertThat(body).isNotNull();
        assertThat(body.get("goal")).isEqualTo(Map.of("amount", "10000.00", "currency", "AZN"));
        assertThat(body.get("pledged")).isEqualTo(Map.of("amount", "12500.00", "currency", "AZN"));
    }

    /**
     * The story is in the response, and it is JSON rather than a string containing JSON.
     *
     * <p>This is the field #119 exists for. A page whose body arrived in a second request
     * is a page whose text is not in the HTML a crawler is served, so an endpoint that
     * left the story out would leave the server render with nothing to render.
     */
    @Test
    @DisplayName("the story travels with the page, as a document")
    void theStoryTravelsWithThePage() {
        live("story");

        Map<String, Object> body = get(handle, "story").getBody();

        assertThat(body).isNotNull();
        assertThat(body.get("story"))
                .as("a document, not a quoted string a client has to parse again")
                .isInstanceOf(Map.class);
    }

    /**
     * The reason the public URL has two segments.
     *
     * <p>{@code projects_creator_slug_key} is unique per creator, so a campaign slug is
     * not a global name. A read that took only the campaign slug would have to pick one.
     */
    @Test
    @DisplayName("two creators may both have a coffee-table-book")
    void twoCreatorsMayShareAProjectSlug() {
        live("coffee-table-book");
        UUID other = Campaigns.creator(dataSource, handle + "-two");
        Campaigns.seed(dataSource, other, "coffee-table-book")
                .state("LIVE")
                .title("Somebody else's book")
                .insert();

        try {
            Map<String, Object> mine = get(handle, "coffee-table-book").getBody();
            Map<String, Object> theirs = get(handle + "-two", "coffee-table-book").getBody();

            assertThat(mine).isNotNull();
            assertThat(theirs).isNotNull();
            assertThat(mine.get("id")).isNotEqualTo(theirs.get("id"));
            assertThat(theirs.get("title")).isEqualTo("Somebody else's book");
        } finally {
            new JdbcTemplate(dataSource).update("DELETE FROM projects WHERE creator_id = ?", other);
        }
    }

    // ------------------------------------------------------------------
    // What is not served
    // ------------------------------------------------------------------

    /**
     * The seven states of §6.1 that are not public, and one that is public and must not
     * be.
     *
     * <p>{@code SUSPENDED} is the one worth naming: it is a campaign the public has
     * already seen and pledged to, stopped by trust and safety, frequently while an
     * investigation is open. Serving its page would republish what the platform has just
     * withdrawn, and a 403 would confirm to anybody holding the URL that it had been
     * stopped.
     */
    @Test
    @DisplayName("a campaign whose state is not public is not found")
    void aCampaignTheStateHidesIsNotFound() {
        List<String> hidden = List.of("DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "SCHEDULED");
        for (String state : hidden) {
            // projects_slug_shape allows hyphens and not underscores, so the state's
            // own spelling cannot be a slug.
            String slug = "hidden-" + state.toLowerCase(java.util.Locale.ROOT).replace('_', '-');
            Campaigns.seed(dataSource, creatorId, slug).state(state).insert();

            assertThat(get(handle, slug).getStatusCode())
                    .as("%s is not a public state", state)
                    .isEqualTo(HttpStatus.NOT_FOUND);
        }

        Campaigns.seed(dataSource, creatorId, "stopped").state("SUSPENDED").insert();
        assertThat(get(handle, "stopped").getStatusCode())
                .as("a suspended campaign is answered as one that does not exist")
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("a URL that resolves to nothing is not found, either half of it")
    void anUnknownUrlIsNotFound() {
        live("real");

        assertThat(get(handle, "not-a-campaign").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(get("not-a-creator", "real").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    /**
     * <strong>The security matcher, asserted.</strong>
     *
     * <p>{@code /v1/projects/{creatorSlug}/{projectSlug}} and
     * {@code /v1/projects/{id}/edit} are both four path segments. A permit rule written
     * as {@code /v1/projects/*&#47;*} would match the second as readily as the first, and
     * would publish the campaign editor — every field of an unlaunched campaign, to
     * anybody holding an identifier. This is the test that says it does not.
     */
    @Test
    @DisplayName("the campaign editor is still behind a token")
    void theEditorIsStillBehindAToken() {
        UUID projectId = live("guarded");

        ResponseEntity<String> edit =
                rest.getForEntity("/v1/projects/{id}/edit", String.class, projectId);
        ResponseEntity<String> checklist =
                rest.getForEntity("/v1/projects/{id}/checklist", String.class, projectId);

        assertThat(edit.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(checklist.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // §63's outcome
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a running campaign reports no outcome at all")
    void aRunningCampaignHasNoOutcome() {
        live("running");

        Map<String, Object> body = get(handle, "running").getBody();

        assertThat(body).isNotNull();
        assertThat(body).doesNotContainKey("outcome");
    }

    /**
     * The page reports what decided the campaign, not what has since been collected.
     *
     * <p>V29's whole argument, on the surface it was written for: {@code pledged} keeps
     * moving as collections fail, and {@code outcome.pledged} is the number printed next
     * to the word "successful".
     */
    @Test
    @DisplayName("a closed campaign reports the frozen outcome beside the live total")
    void aClosedCampaignReportsTheFrozenOutcome() {
        UUID projectId = closed("funded");
        finalizer.finaliseClosedCampaigns(Instant.now().truncatedTo(ChronoUnit.MICROS));
        new JdbcTemplate(dataSource)
                .update("UPDATE projects SET pledged_amount = 9000.00 WHERE id = ?", projectId);

        Map<String, Object> body = get(handle, "funded").getBody();

        assertThat(body).isNotNull();
        assertThat(body.get("state")).isEqualTo("SUCCESSFUL");
        assertThat(body.get("pledged"))
                .as("the live total, which collections have moved")
                .isEqualTo(Map.of("amount", "9000.00", "currency", "AZN"));

        @SuppressWarnings("unchecked")
        Map<String, Object> outcome = (Map<String, Object>) body.get("outcome");
        assertThat(outcome).isNotNull();
        assertThat(outcome.get("pledged"))
                .as("what it raised at the deadline, which nothing may move")
                .isEqualTo(Map.of("amount", "12500.00", "currency", "AZN"));
        assertThat(outcome.get("backersCount")).isEqualTo(42);
    }

    // ------------------------------------------------------------------
    // §10.3's caching and localisation
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a caller holding the page is answered 304 rather than the bytes again")
    void anUnchangedPageIsNotResent() {
        live("cached");

        ResponseEntity<Map<String, Object>> first = get(handle, "cached");
        String etag = first.getHeaders().getETag();
        assertThat(etag).isNotNull();
        assertThat(first.getHeaders().getCacheControl()).contains("max-age=60").contains("public");

        HttpHeaders headers = new HttpHeaders();
        headers.setIfNoneMatch(etag);
        ResponseEntity<String> second = rest.exchange(
                "/v1/projects/{creator}/{project}",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class,
                handle,
                "cached");

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        assertThat(second.getBody()).isNull();
    }

    /**
     * The taxonomy is named in the reader's language, and the response says so.
     *
     * <p>{@code Vary: Accept-Language} is what stops a shared cache handing one reader's
     * breadcrumb to another. The two names below also check the SQL fallback chain in
     * {@code PublicProjectPages} against {@link Taxonomy}'s Java one — the duplication
     * that class documents, checked rather than asserted in a comment.
     */
    @Test
    @DisplayName("the category is named in the reader's language, and the tag varies with it")
    void theCategoryIsNamedInTheReadersLanguage() {
        Campaigns.seed(dataSource, creatorId, "filed")
                .state("LIVE")
                .category("games")
                .insert();

        ResponseEntity<Map<String, Object>> azerbaijani = get(handle, "filed", "az");
        ResponseEntity<Map<String, Object>> english = get(handle, "filed", "en");

        assertThat(azerbaijani.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);

        Map<String, Object> azBody = azerbaijani.getBody();
        Map<String, Object> enBody = english.getBody();
        assertThat(azBody).isNotNull();
        assertThat(enBody).isNotNull();

        @SuppressWarnings("unchecked")
        Map<String, Object> azCategory = (Map<String, Object>) azBody.get("category");
        @SuppressWarnings("unchecked")
        Map<String, Object> enCategory = (Map<String, Object>) enBody.get("category");

        assertThat(azCategory.get("slug")).isEqualTo("games");
        assertThat(enCategory.get("slug")).isEqualTo("games");
        assertThat(azCategory.get("name")).isNotNull();
        assertThat(enCategory.get("name")).isNotNull();
        assertThat(azerbaijani.getHeaders().getETag())
                .as("two languages of one campaign must not share a tag")
                .isNotEqualTo(english.getHeaders().getETag());
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private ResponseEntity<Map<String, Object>> get(String creatorSlug, String projectSlug) {
        return get(creatorSlug, projectSlug, null);
    }

    private ResponseEntity<Map<String, Object>> get(String creatorSlug, String projectSlug, String language) {
        HttpHeaders headers = new HttpHeaders();
        if (language != null) {
            headers.setAcceptLanguageAsLocales(List.of(java.util.Locale.forLanguageTag(language)));
        }
        return rest.exchange(
                "/v1/projects/{creator}/{project}",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                BODY,
                creatorSlug,
                projectSlug);
    }

    /** A funded campaign that is still running. */
    private UUID live(String slug) {
        return campaign(slug, Duration.ofDays(10));
    }

    /** The same campaign, a day past its deadline. */
    private UUID closed(String slug) {
        // Past the first deadline and its seven-day window (#33), so the finaliser decides it.
        return campaign(slug, Duration.ofDays(8).negated());
    }

    private UUID campaign(String slug, Duration deadlineFromNow) {
        Instant deadline = Instant.now().plus(deadlineFromNow);
        return Campaigns.seed(dataSource, creatorId, slug)
                .state("LIVE")
                .title("A campaign called " + slug)
                .blurb("A summary that fits inside a hundred and thirty-five characters.")
                .story("A paragraph of story prose.")
                .goal("10000.00")
                .pledged("12500.00")
                .backers(42)
                .launchedAt(deadline.minus(CAMPAIGN_LENGTH))
                .deadline(deadline)
                .insert();
    }
}
