package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.shared.EmailAddress;
import az.ideanest.user.infrastructure.UserRepository;
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
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.ObjectMapper;

/**
 * A creator reading their own campaigns — {@code GET /v1/me/projects}, over HTTP.
 *
 * <p><strong>This endpoint is the inverse of the one beside it, and the tests are written to
 * hold that inversion still.</strong> {@code GET /v1/users/{slug}/projects} exists to publish
 * nine of §6.1's sixteen states and to withhold the other seven identically;
 * {@link ProfileProjectApiTests} asserts exactly that. This one exists to show all sixteen to
 * the one person entitled to see them, so {@link #everyStateAppears()} is the mirror of that
 * suite's central test — and the two failing in opposite directions is the pair of defects
 * worth catching.
 *
 * <p>The property that carries the risk is not which states appear but <em>whose</em>
 * campaigns do. The account comes from the access token and from nothing a client sends, so
 * {@link #onlyTheCallersOwnCampaignsAppear()} seeds a second creator whose work must never
 * cross over, and {@link #aStrangerIsRefused()} checks that there is no unauthenticated way
 * in at all. A list of drafts served to the wrong reader is an unreleased product disclosed
 * to whoever asked.
 */
class MyProjectApiTests extends AbstractIntegrationTest {

    private static final String PASSWORD = "IdeaNest2026!";

    /**
     * Namespaced, because two suites sharing an address convention is a failure that shows
     * up three frames away — the loser signs in as nobody and carries a null bearer token.
     */
    private static final String EMAIL_PREFIX = "my-projects-";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /** All sixteen of §6.1. The point of this endpoint is that none of them is withheld. */
    private static final List<String> ALL_STATES = List.of(
            "DRAFT",
            "SUBMITTED",
            "CHANGES_REQUESTED",
            "REJECTED",
            "APPROVED",
            "SCHEDULED",
            "PRELAUNCH",
            "LIVE",
            "CANCELED",
            "SUCCESSFUL",
            "UNSUCCESSFUL",
            "COLLECTING",
            "LATE_PLEDGE",
            "FULFILLING",
            "COMPLETED",
            "SUSPENDED");

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private UserRepository users;

    @AfterEach
    void clearCampaigns() {
        Campaigns.clear(dataSource);
    }

    // -----------------------------------------------------------------------
    // §6.1
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("every one of §6.1's sixteen states appears, which is the whole point of it")
    void everyStateAppears() {
        Creator creator = creator();
        for (String state : ALL_STATES) {
            Campaigns.seed(dataSource, creator.id(), slug(state)).state(state).insert();
        }

        List<Map<String, Object>> cards = cards(mine(creator.accessToken(), null, 50));

        // As a set rather than by sampling. A state dropped from this list is a campaign its
        // creator can no longer reach from anywhere in the product, and the version of this
        // test that checked DRAFT and LIVE would pass while SUSPENDED disappeared -- which
        // is the state whose owner most needs to be told.
        assertThat(cards.stream().map(card -> card.get("state")).toList())
                .containsExactlyInAnyOrderElementsOf(ALL_STATES);
    }

    @Test
    @DisplayName("a draft is reachable here and absent from the same creator's public list")
    void aDraftIsReachableHereAndNowhereElse() {
        Creator creator = creator();
        Campaigns.seed(dataSource, creator.id(), "unfinished-thing").state("DRAFT").insert();

        // The pair, against each other. Either one alone would pass with the two endpoints
        // wired to the same state set, which is the mistake this endpoint invites.
        assertThat(slugsOf(cards(mine(creator.accessToken(), null, null)))).containsExactly("unfinished-thing");
        assertThat(cards(rest.getForEntity("/v1/users/" + slugOf(creator.id()) + "/projects", String.class)))
                .isEmpty();
    }

    // -----------------------------------------------------------------------
    // Whose list this is
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("only the caller's own campaigns appear, whatever anybody else is working on")
    void onlyTheCallersOwnCampaignsAppear() {
        Creator creator = creator();
        Campaigns.seed(dataSource, creator.id(), "mine-to-see").state("DRAFT").insert();

        UUID somebodyElse = Campaigns.creator(dataSource, EMAIL_PREFIX + "other-" + SEQUENCE.incrementAndGet());
        Campaigns.seed(dataSource, somebodyElse, "not-mine-to-see").state("DRAFT").insert();

        // The account is the subject of the token and is never a parameter, so there is no
        // request a client could make that would put the other row here.
        assertThat(slugsOf(cards(mine(creator.accessToken(), null, 50)))).containsExactly("mine-to-see");
    }

    @Test
    @DisplayName("a stranger is refused rather than served an empty list")
    void aStrangerIsRefused() {
        Creator creator = creator();
        Campaigns.seed(dataSource, creator.id(), "private-work").state("DRAFT").insert();

        ResponseEntity<String> anonymous = rest.getForEntity("/v1/me/projects", String.class);

        // 401 and not 200-with-nothing. An empty list would be a lie that reads as an
        // answer, and a client would render "you have no campaigns" at somebody whose
        // session had simply expired.
        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a creator who has started nothing gets an empty list rather than a failure")
    void aCreatorWhoHasStartedNothingGetsAnEmptyList() {
        Creator creator = creator();

        Map<String, Object> body = parse(mine(creator.accessToken(), null, null));

        assertThat(cards(body)).isEmpty();
        assertThat(body).containsKey("nextCursor");
        assertThat(body.get("nextCursor")).isNull();
    }

    // -----------------------------------------------------------------------
    // Paging and caching
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the list pages on a cursor and ends with a null one")
    void theListPagesOnACursor() {
        Creator creator = creator();
        Campaigns.seed(dataSource, creator.id(), "first-draft").state("DRAFT").insert();
        Campaigns.seed(dataSource, creator.id(), "second-draft").state("SUBMITTED").insert();
        Campaigns.seed(dataSource, creator.id(), "third-draft").state("LIVE").insert();

        Map<String, Object> firstPage = parse(mine(creator.accessToken(), null, 2));
        assertThat(cards(firstPage)).hasSize(2);
        String cursor = (String) firstPage.get("nextCursor");
        assertThat(cursor).isNotNull();

        Map<String, Object> secondPage = parse(mine(creator.accessToken(), cursor, 2));
        assertThat(cards(secondPage)).hasSize(1);
        assertThat(secondPage.get("nextCursor")).isNull();

        // The cursor names a row rather than a position, so a draft created above the page
        // boundary cannot make a campaign appear on both pages or on neither.
        assertThat(slugsOf(cards(firstPage))).doesNotContainAnyElementsOf(slugsOf(cards(secondPage)));
    }

    @Test
    @DisplayName("the list is never stored by a shared cache, because it carries unpublished work")
    void theListIsNeverStored() {
        Creator creator = creator();
        Campaigns.seed(dataSource, creator.id(), "not-for-a-proxy").state("DRAFT").insert();

        ResponseEntity<String> response = mine(creator.accessToken(), null, null);

        // no-store and private, not no-cache and public. "Revalidate before reuse" still
        // permits a shared proxy to hold the body in the meantime, and this body names work
        // §6.1 publishes to nobody.
        assertThat(response.getHeaders().getCacheControl()).contains("no-store").contains("private");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Creator(String accessToken, UUID id) {}

    private Creator creator() {
        EmailAddress email =
                EmailAddress.of(EMAIL_PREFIX + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"),
                        jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Creator((String) signedIn.getBody().get("accessToken"), id);
    }

    private String slugOf(UUID creatorId) {
        return users.findById(creatorId).orElseThrow().getSlug();
    }

    /** A campaign slug per state; {@code projects_slug_shape} wants lowercase and hyphens. */
    private static String slug(String state) {
        return state.toLowerCase(Locale.ROOT).replace('_', '-') + "-of-mine";
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    private ResponseEntity<String> mine(String accessToken, String cursor, Integer limit) {
        StringBuilder path = new StringBuilder("/v1/me/projects?");
        if (cursor != null) {
            path.append("cursor=").append(cursor).append('&');
        }
        if (limit != null) {
            path.append("limit=").append(limit);
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        return rest.exchange(path.toString(), HttpMethod.GET, new HttpEntity<>(headers), String.class);
    }

    // -----------------------------------------------------------------------
    // Readings
    // -----------------------------------------------------------------------

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

    private static List<Object> slugsOf(List<Map<String, Object>> cards) {
        return cards.stream().map(card -> card.get("slug")).toList();
    }
}
