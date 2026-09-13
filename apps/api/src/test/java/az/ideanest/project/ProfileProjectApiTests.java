package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * The campaigns on a creator's profile — §4.2's created tab, over HTTP.
 *
 * <p><strong>The rule this endpoint has to get right is which campaigns it does not
 * show</strong>, and {@link #onlyTheNinePublicStatesAppear()} is the whole of it: a draft is
 * an unreleased product, a submission is in a moderation queue, and a suspended campaign is
 * frequently an open investigation. A creator's public page listing any of the three would
 * publish, on the one URL a search engine indexes, exactly what the campaign page's own 404
 * withholds. The test seeds one campaign in every one of §6.1's sixteen states and asserts
 * the nine, rather than asserting three examples — an omission from the visible set fails it
 * as loudly as an addition to it.
 *
 * <p>The second thing it has to get right is that the profile's setting reaches this tab.
 * P-07 withdraws the page <em>and its archives</em>, so
 * {@link #aPrivateProfileHasNoCreatedTab()} checks the 404 here against the one the profile
 * itself gives: a tab that answered 200 would publish through a second URL what the first
 * one hides.
 *
 * <p>Every read is made without a bearer token. That is what a visitor has, and a suite that
 * authenticated would be testing a different endpoint from the one the matcher opens.
 */
class ProfileProjectApiTests extends AbstractIntegrationTest {

    /**
     * What this class's fixture accounts are called, namespaced so they cannot collide
     * with another suite's — see {@code BackerArchiveApiTests.account} for the failure
     * that shape produces when two classes share a handle convention.
     */
    private static final String HANDLE_PREFIX = "created-";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** §6.1's nine, which is what {@code PublicProjects.VISIBLE} holds. */
    private static final List<String> PUBLIC_STATES = List.of(
            "PRELAUNCH",
            "LIVE",
            "CANCELED",
            "SUCCESSFUL",
            "UNSUCCESSFUL",
            "COLLECTING",
            "LATE_PLEDGE",
            "FULFILLING",
            "COMPLETED");

    /** The other seven. Every one of them is somebody's private business. */
    private static final List<String> WITHHELD_STATES =
            List.of("DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "SCHEDULED", "SUSPENDED");

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    @AfterEach
    void clearCampaigns() {
        Campaigns.clear(dataSource);
    }

    // -----------------------------------------------------------------------
    // §6.1
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("only §6.1's nine public states appear, and the other seven are absent identically")
    void onlyTheNinePublicStatesAppear() {
        UUID creator = creator("prolific");
        for (String state : PUBLIC_STATES) {
            Campaigns.seed(dataSource, creator, slug(state)).state(state).insert();
        }
        for (String state : WITHHELD_STATES) {
            Campaigns.seed(dataSource, creator, slug(state)).state(state).insert();
        }

        List<Map<String, Object>> cards = cards(created(slugOf(creator), null, 50));

        // Every one of the nine, and none of the seven. Asserted as a set rather than by
        // sampling: an omission from the visible set is as much a defect as an addition to
        // it, and the version of this test that checked three examples would pass while
        // PRELAUNCH quietly stopped being served.
        assertThat(cards.stream().map(card -> card.get("state")).toList())
                .containsExactlyInAnyOrderElementsOf(PUBLIC_STATES);
        // And nothing in the response says a row was withheld -- which is what stops this
        // list being an oracle for what a competitor has in progress.
        assertThat(parse(created(slugOf(creator), null, 50))).containsOnlyKeys("projects", "nextCursor");
    }

    @Test
    @DisplayName("a card carries money as an object with a string amount, and a goal-less prelaunch as null")
    void aCardCarriesMoneyAsAnObject() {
        UUID creator = creator("priced");
        Campaigns.seed(dataSource, creator, "funded-thing")
                .state("LIVE")
                .goal("5000.00")
                .pledged("1250.50")
                .backers(7)
                .insert();
        // §5.3 requires a goal by submission and not before, so PRELAUNCH is the one public
        // state a campaign reaches without one.
        Campaigns.seed(dataSource, creator, "teaser").state("PRELAUNCH").insert();

        List<Map<String, Object>> cards = cards(created(slugOf(creator), null, 50));
        Map<String, Object> funded = card(cards, "funded-thing");

        // Never a JSON number. On a funding platform that is somebody's pledge, and the
        // string is what stops a client parsing it into a double on the way past.
        assertThat(funded.get("goal")).isEqualTo(Map.of("amount", "5000.00", "currency", "AZN"));
        assertThat(funded.get("pledged")).isEqualTo(Map.of("amount", "1250.50", "currency", "AZN"));
        assertThat(funded.get("backersCount")).isEqualTo(7);
        assertThat(funded.get("creatorSlug")).isEqualTo(slugOf(creator));
        assertThat(funded.get("coverImage"))
                .isEqualTo(Map.of("url", "https://cdn.example.com/funded-thing.jpg", "width", 1600, "height", 900));

        Map<String, Object> teaser = card(cards, "teaser");
        // Present as a key and null as a value, so a client can tell "no goal yet" from a
        // field it failed to read.
        assertThat(teaser).containsKey("goal");
        assertThat(teaser.get("goal")).isNull();
    }

    // -----------------------------------------------------------------------
    // Paging
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the list pages on a cursor and ends with a null one")
    void theListPagesOnACursor() {
        UUID creator = creator("paging");
        Campaigns.seed(dataSource, creator, "first-one").state("LIVE").insert();
        Campaigns.seed(dataSource, creator, "second-one").state("LIVE").insert();
        Campaigns.seed(dataSource, creator, "third-one").state("LIVE").insert();

        Map<String, Object> firstPage = parse(created(slugOf(creator), null, 2));
        assertThat(cards(firstPage)).hasSize(2);
        String cursor = (String) firstPage.get("nextCursor");
        assertThat(cursor).isNotNull();

        Map<String, Object> secondPage = parse(created(slugOf(creator), cursor, 2));
        assertThat(cards(secondPage)).hasSize(1);
        // Null rather than absent or "", so a client tests one thing. The three-way
        // distinction is what gets handled two ways in two clients.
        assertThat(secondPage).containsKey("nextCursor");
        assertThat(secondPage.get("nextCursor")).isNull();

        // No campaign appears on both pages: the cursor names a row rather than a position,
        // which is the property an offset would lose the moment a draft was created above.
        assertThat(slugsOf(cards(firstPage))).doesNotContainAnyElementsOf(slugsOf(cards(secondPage)));
    }

    @Test
    @DisplayName("a cursor this endpoint did not issue is refused rather than ignored")
    void aCorruptCursorIsRefused() {
        UUID creator = creator("corrupt");
        Campaigns.seed(dataSource, creator, "only-one").state("LIVE").insert();

        ResponseEntity<String> response = created(slugOf(creator), "not-a-cursor-anybody-issued", null);

        // Refused, because quietly serving the first page would make a client that is paging
        // wrongly look like one that has reached the end -- and the reader would see the top
        // of the list again instead of the rest of it.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(parse(response).get("code")).isEqualTo("INVALID_CURSOR");
    }

    // -----------------------------------------------------------------------
    // Whose 404 this is
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a private profile has no created tab, and says so the way the profile itself does")
    void aPrivateProfileHasNoCreatedTab() {
        UUID creator = creator("withdrawn");
        Campaigns.seed(dataSource, creator, "still-live").state("LIVE").insert();
        assertThat(created(slugOf(creator), null, null).getStatusCode()).isEqualTo(HttpStatus.OK);

        jdbc().update("UPDATE users SET profile_visibility = 'PRIVATE' WHERE id = ?", creator);

        ResponseEntity<String> hidden = created(slugOf(creator), null, null);
        ResponseEntity<String> absent = created("nobody-is-called-this-" + SEQUENCE.incrementAndGet(), null, null);

        // The two against each other. P-07 withdraws the page and its archives, so a tab
        // that answered anything other than the profile's own 404 would publish through a
        // second URL what the first one hides -- and a 403 would confirm the account exists.
        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(hidden.getStatusCode()).isEqualTo(absent.getStatusCode());
        assertThat(withoutInstance(hidden)).isEqualTo(withoutInstance(absent));
        assertThat(parse(hidden).get("code")).isEqualTo("USER_NOT_FOUND");

        // And the campaign itself is untouched: P-07 withdraws the index, not what it
        // indexes. ProfileVisibility says so, and V45 says why it cannot say otherwise.
        assertThat(jdbc().queryForObject(
                        "SELECT state FROM projects WHERE creator_id = ? AND slug = 'still-live'",
                        String.class,
                        creator))
                .isEqualTo("LIVE");
    }

    @Test
    @DisplayName("a creator with nothing public gets an empty list rather than a 404")
    void aCreatorWithNothingPublicGetsAnEmptyList() {
        UUID creator = creator("quiet");
        Campaigns.seed(dataSource, creator, "not-ready-yet").state("DRAFT").insert();

        Map<String, Object> body = parse(created(slugOf(creator), null, null));

        // "This person has no campaigns" must not be answerable as "this person has no
        // profile", which is the distinction P-07 is about.
        assertThat(cards(body)).isEmpty();
        assertThat(body.get("nextCursor")).isNull();
    }

    // -----------------------------------------------------------------------
    // §10.3
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the list revalidates to 304 and is never held past a withdrawal")
    void theListRevalidates() {
        UUID creator = creator("cached");
        Campaigns.seed(dataSource, creator, "the-only-one").state("LIVE").insert();

        ResponseEntity<String> first = created(slugOf(creator), null, null);
        String etag = first.getHeaders().getETag();
        assertThat(etag).isNotNull();
        assertThat(first.getHeaders().getCacheControl()).contains("public").contains("no-cache");
        assertThat(first.getHeaders().getCacheControl()).doesNotContain("max-age");

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<String> revalidated = rest.exchange(
                "/v1/users/" + slugOf(creator) + "/projects",
                HttpMethod.GET,
                new HttpEntity<>(conditional),
                String.class);
        assertThat(revalidated.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        assertThat(revalidated.getHeaders().getCacheControl()).contains("no-cache");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    private UUID creator(String role) {
        return Campaigns.creator(dataSource, HANDLE_PREFIX + role + "-" + SEQUENCE.incrementAndGet());
    }

    private String slugOf(UUID creatorId) {
        return jdbc().queryForObject("SELECT slug FROM users WHERE id = ?", String.class, creatorId);
    }

    /** A campaign slug per state; {@code projects_slug_shape} wants lowercase and hyphens. */
    private static String slug(String state) {
        return state.toLowerCase(Locale.ROOT).replace('_', '-') + "-campaign";
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    /** Deliberately without a bearer token. This endpoint has no caller to establish. */
    private ResponseEntity<String> created(String slug, String cursor, Integer limit) {
        StringBuilder path = new StringBuilder("/v1/users/").append(slug).append("/projects?");
        if (cursor != null) {
            path.append("cursor=").append(cursor).append('&');
        }
        if (limit != null) {
            path.append("limit=").append(limit);
        }
        return rest.getForEntity(path.toString(), String.class);
    }

    // -----------------------------------------------------------------------
    // Readings
    // -----------------------------------------------------------------------

    /**
     * A problem detail with RFC 9457's {@code instance} removed.
     *
     * <p><strong>Excluded on purpose, and it must stay excluded.</strong> {@code instance}
     * is the path that was asked for, so a private profile and an absent one differ in it
     * necessarily — they are different URLs. A stricter assertion would be demanding that
     * the response not say which request it is answering, which is neither true nor
     * desirable, and it would fail for a reason that has nothing to do with the property
     * under test. What must not differ is everything else: {@code status}, {@code type},
     * {@code title}, {@code detail} and {@code code}, because any of those differing is the
     * oracle these tests exist to prevent.
     */
    private Map<String, Object> withoutInstance(ResponseEntity<String> response) {
        Map<String, Object> body = new LinkedHashMap<>(parse(response));
        body.remove("instance");
        return body;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(ResponseEntity<String> response) {
        try {
            return json.readValue(response.getBody(), Map.class);
        } catch (Exception e) {
            throw new IllegalStateException("Not a JSON object: " + response.getBody(), e);
        }
    }

    private List<Map<String, Object>> cards(ResponseEntity<String> response) {
        return cards(parse(response));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> cards(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("projects");
    }

    private static Map<String, Object> card(List<Map<String, Object>> cards, String slug) {
        return cards.stream()
                .filter(card -> slug.equals(card.get("slug")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No card for " + slug + " in " + cards));
    }

    private static List<Object> slugsOf(List<Map<String, Object>> cards) {
        return cards.stream().map(card -> card.get("slug")).toList();
    }
}
