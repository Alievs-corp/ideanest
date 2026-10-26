package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code /v1/admin/collections}: AD-03's curation module, over HTTP.
 *
 * <p>Two properties carry this suite, and CLAUDE.md and §3.2 are why.
 *
 * <p><strong>Nobody but platform staff may curate.</strong> §3.2 grants "apply an
 * editorial badge" to moderators and admins and to nobody else, and putting a campaign
 * into a badge-granting collection <em>is</em> applying one. Every mutation is checked
 * against the configured moderator list, and the default — an account that is merely
 * signed in — is refused. That is the case this suite makes the common one: every
 * account in it except {@link #moderator()} is an ordinary user.
 *
 * <p><strong>Every privileged action leaves a row nobody can tidy away.</strong> The
 * audit assertions read {@code curation_events} directly rather than through an
 * endpoint, because there is no endpoint: AD-14's platform-wide log belongs to epic
 * #100. What the rows have to say is who acted, what they did, to what, and why.
 */
class CurationApiTests extends DiscoveryTestSupport {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** Shared across the class; see {@link #moderator()}. */
    private static Account MODERATOR;

    @Autowired
    private UserRepository users;

    private UUID campaign;

    @BeforeEach
    void seedACampaign() {
        Campaigns.clear(dataSource);
        UUID creator = Campaigns.creator(dataSource, "curation-api-creator");
        Instant launched = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        campaign = Campaigns.seed(dataSource, creator, "curated-campaign")
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .pledged("500.00")
                .launchedAt(launched)
                .deadline(launched.plus(30, ChronoUnit.DAYS))
                .insert();
    }

    // ------------------------------------------------------------------
    // Who may
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every curation mutation is refused for an account that is not staff")
    void mutationsAreRefusedForANonModerator() {
        // Created by staff first, so that the refusals below are about who is asking
        // rather than about the collection not existing — a 404 would pass a naive
        // "was it refused" assertion just as well as a 403 and would mean something
        // completely different.
        createCollection(moderator(), "staff-picks", body("STAFF_SELECTION", true));
        Account stranger = account();

        List<Request> mutations = List.of(
                new Request(
                        HttpMethod.POST, "/v1/admin/collections", Map.of("slug", "sneaky", "collection",
                                body("THEMED", false))),
                new Request(HttpMethod.PUT, "/v1/admin/collections/staff-picks", body("THEMED", false)),
                new Request(
                        HttpMethod.POST, "/v1/admin/collections/staff-picks/publish", Map.of("note", "mine now")),
                new Request(
                        HttpMethod.POST, "/v1/admin/collections/staff-picks/unpublish", Map.of("note", "mine now")),
                new Request(
                        HttpMethod.POST,
                        "/v1/admin/collections/staff-picks/projects",
                        Map.of("projectId", campaign.toString(), "note", "mine now")),
                new Request(
                        HttpMethod.POST,
                        "/v1/admin/collections/staff-picks/projects/" + campaign + "/remove",
                        Map.of("note", "mine now")),
                new Request(
                        HttpMethod.PUT,
                        "/v1/admin/collections/staff-picks/projects/order",
                        Map.of("projectIds", List.of(campaign.toString()))));

        for (Request mutation : mutations) {
            ResponseEntity<Map<String, Object>> response = send(stranger, mutation);

            assertThat(response.getStatusCode())
                    .withFailMessage("%s %s was not refused: %s", mutation.method(), mutation.path(), response.getBody())
                    .isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(response.getBody()).containsEntry("code", "NOT_A_MODERATOR");
        }

        // And nothing was written, by any of them.
        assertThat(auditRows("staff-picks")).hasSize(1);
        assertThat(auditRows("staff-picks").get(0)).containsEntry("action", "COLLECTION_CREATED");
    }

    @Test
    @DisplayName("the administrative reads are refused for a non-moderator too")
    void readsAreRefusedForANonModerator() {
        createCollection(moderator(), "staff-picks", body("STAFF_SELECTION", true));
        Account stranger = account();

        // An unpublished collection is an editorial decision in progress, so the
        // administrative read is as privileged as the write.
        assertThat(send(stranger, new Request(HttpMethod.GET, "/v1/admin/collections", null))
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(send(stranger, new Request(HttpMethod.GET, "/v1/admin/collections/staff-picks", null))
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    @DisplayName("an anonymous caller is refused before the moderator check")
    void anonymousCallersAreRefused() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/collections",
                HttpMethod.GET,
                new HttpEntity<>(new HttpHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // What is recorded
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every mutation a moderator makes is recorded, naming who, what, and when")
    void everyMutationIsAudited() {
        Account curator = moderator();
        Instant before = Instant.now().minusSeconds(5);

        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));
        assertThat(send(curator, new Request(HttpMethod.PUT, "/v1/admin/collections/staff-picks",
                        body("STAFF_SELECTION", true)))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/staff-picks/projects",
                                Map.of("projectId", campaign.toString(), "note", "Strongest games campaign this month")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/staff-picks/publish",
                                Map.of("note", "Ready for the front page")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/staff-picks/projects/" + campaign + "/remove",
                                Map.of("note", "Creator asked to be taken down")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/staff-picks/unpublish",
                                Map.of("note", "Nothing left in it")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        List<Map<String, Object>> rows = auditRows("staff-picks");

        assertThat(rows.stream().map(row -> row.get("action")).toList())
                .containsExactly(
                        "COLLECTION_CREATED",
                        "COLLECTION_UPDATED",
                        "PROJECT_ADDED",
                        "COLLECTION_PUBLISHED",
                        "PROJECT_REMOVED",
                        "COLLECTION_UNPUBLISHED");

        for (Map<String, Object> row : rows) {
            // Who. A human decision recorded without saying whose it was is not an
            // audit trail.
            assertThat(row.get("actor_id")).isEqualTo(curator.id());
            assertThat(row.get("actor_role")).isEqualTo("MODERATOR");
            // When, from the database's clock rather than the application's.
            assertThat((Instant) row.get("created_at")).isAfter(before);
        }

        // What it was done to, for the two actions that are about a campaign — and
        // nothing for the four that are about the list, so that a row saying a
        // campaign was removed can always say which.
        Map<String, Object> added = rows.get(2);
        assertThat(added.get("project_id")).isEqualTo(campaign);
        assertThat(added.get("note")).isEqualTo("Strongest games campaign this month");
        assertThat(rows.get(0).get("project_id")).isNull();
        assertThat(rows.get(3).get("note")).isEqualTo("Ready for the front page");
    }

    @Test
    @DisplayName("every mutation is also in the platform's audit trail, without the note")
    void everyMutationReachesTheAuditTrail() {
        Account curator = moderator();

        createCollection(curator, "trail-picks", body("STAFF_SELECTION", true));
        addProject(curator, "trail-picks", campaign, "Strongest games campaign this month");
        publish(curator, "trail-picks");
        assertThat(send(curator, new Request(
                                HttpMethod.PUT,
                                "/v1/admin/collections/trail-picks/projects/order",
                                Map.of("projectIds", List.of(campaign.toString()))))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        UUID collectionId = new JdbcTemplate(dataSource)
                .queryForObject("SELECT id FROM collections WHERE slug = ?", UUID.class, "trail-picks");
        List<Map<String, Object>> trail = new JdbcTemplate(dataSource)
                .queryForList(
                        """
                        SELECT action, entity_type, actor_id, actor_type, detail
                          FROM audit_logs
                         WHERE entity_id = ?
                         ORDER BY occurred_at ASC, action ASC
                        """,
                        collectionId);

        // #587: curation_events is the collection's own history, and the console's trail and
        // an investigation read audit_logs, which had nothing from curation at all.
        assertThat(trail.stream().map(row -> row.get("action")).toList())
                .containsExactly(
                        "collection.created",
                        "collection.project_added",
                        "collection.published",
                        "collection.reordered");
        for (Map<String, Object> row : trail) {
            assertThat(row.get("entity_type")).isEqualTo("collection");
            assertThat(row.get("actor_id")).isEqualTo(curator.id());
            assertThat(row.get("actor_type")).isEqualTo("MODERATOR");
            assertThat((String) row.get("detail")).contains("slug=trail-picks");
            assertThat((String) row.get("detail")).doesNotContain("Strongest");
        }
        assertThat((String) trail.get(1).get("detail")).contains("project=" + campaign);
    }

    @Test
    @DisplayName("an action that changes nothing is not recorded as a decision")
    void noOpsAreNotAudited() {
        Account curator = moderator();
        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));
        addProject(curator, "staff-picks", campaign, "First pick");

        // The same campaign again, and a campaign that is not in the list.
        addProject(curator, "staff-picks", campaign, "Again");
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/staff-picks/projects/" + UUID.randomUUID() + "/remove",
                                Map.of("note", "Not there")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // An audit trail that recorded attempts rather than decisions is one nobody
        // can read.
        assertThat(auditRows("staff-picks").stream().map(row -> row.get("action")).toList())
                .containsExactly("COLLECTION_CREATED", "PROJECT_ADDED");
    }

    @Test
    @DisplayName("the audit trail outlives the campaign it is about")
    void theAuditSurvivesADeletedCampaign() {
        Account curator = moderator();
        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));
        addProject(curator, "staff-picks", campaign, "A pick");

        // V14 gives curation_events.project_id no ON DELETE clause on purpose: a
        // campaign staff have acted on cannot be hard deleted, and the evidence of the
        // decision cannot be removed by removing what it was about.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        assertThat(org.assertj.core.api.Assertions.catchThrowable(
                        () -> jdbc.update("DELETE FROM projects WHERE id = ?", campaign)))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);

        assertThat(auditRows("staff-picks")).hasSize(2);
    }

    // ------------------------------------------------------------------
    // What the workflow does
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a new collection is unpublished, and publishing is a separate decision")
    void creatingDoesNotPublish() {
        Account curator = moderator();
        Map<String, Object> created = createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));

        assertThat(created).doesNotContainKey("publishedAt");
        // Not visible to anybody yet.
        assertThat(get("/v1/collections/staff-picks", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        publish(curator, "staff-picks");

        assertThat(get("/v1/collections/staff-picks", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("adding a campaign to a published badge-granting collection features it")
    void addingToAStaffSelectionAppliesTheBadge() {
        Account curator = moderator();
        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));
        publish(curator, "staff-picks");

        assertThat(slugs(feed("?limit=100&showOnly=featured"))).isEmpty();

        addProject(curator, "staff-picks", campaign, "Worth the front page");

        assertThat(slugs(feed("?limit=100&showOnly=featured"))).containsExactly("curated-campaign");

        // And withdrawing the list withdraws the badge with it, without touching the
        // membership row or the record of why it was made.
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/staff-picks/unpublish",
                                Map.of("note", "Season over")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(slugs(feed("?limit=100&showOnly=featured"))).isEmpty();
    }

    @Test
    @DisplayName("a reorder names every campaign exactly once, and changes the public order")
    void reorderingRestatesTheWholeSequence() {
        Account curator = moderator();
        UUID creator = Campaigns.creator(dataSource, "curation-api-creator");
        Instant launched = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        UUID second = Campaigns.seed(dataSource, creator, "second-campaign")
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .launchedAt(launched)
                .deadline(launched.plus(30, ChronoUnit.DAYS))
                .insert();

        createCollection(curator, "edited", body("THEMED", false));
        addProject(curator, "edited", campaign, "First");
        addProject(curator, "edited", second, "Second");
        publish(curator, "edited");

        assertThat(slugs(collectionPage("edited"))).containsExactly("curated-campaign", "second-campaign");

        // A partial order would leave the campaigns it did not mention wherever they
        // happened to be, which is an order nobody chose.
        ResponseEntity<Map<String, Object>> partial = send(curator, new Request(
                HttpMethod.PUT,
                "/v1/admin/collections/edited/projects/order",
                Map.of("projectIds", List.of(second.toString()))));
        assertThat(partial.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(partial.getBody()).containsEntry("code", "CURATION_REJECTED");

        assertThat(send(curator, new Request(
                                HttpMethod.PUT,
                                "/v1/admin/collections/edited/projects/order",
                                Map.of("projectIds", List.of(second.toString(), campaign.toString()))))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(slugs(collectionPage("edited"))).containsExactly("second-campaign", "curated-campaign");
        assertThat(auditRows("edited").stream().map(row -> row.get("action")).toList())
                .contains("PROJECTS_REORDERED");
    }

    // ------------------------------------------------------------------
    // What is refused
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a collection without an Azerbaijani title is refused")
    void azerbaijaniIsRequired() {
        Map<String, Object> collection = new LinkedHashMap<>(body("THEMED", false));
        collection.put("copy", Map.of("en", Map.of("title", "English only")));

        ResponseEntity<Map<String, Object>> response = send(
                moderator(),
                new Request(HttpMethod.POST, "/v1/admin/collections", Map.of("slug", "en-only", "collection", collection)));

        // §21.1 makes Azerbaijani primary, and V11 explains why no CHECK can require a
        // sibling row: the rule is held here, at the request that would violate it.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "CURATION_REJECTED");
        assertThat(response.getBody().get("meta").toString()).contains("copy.az");
    }

    @Test
    @DisplayName("an unsupported locale, a backwards window, and an unknown kind are each refused by name")
    void badInputIsRefusedByField() {
        Account curator = moderator();

        Map<String, Object> unsupportedLocale = new LinkedHashMap<>(body("THEMED", false));
        unsupportedLocale.put(
                "copy", Map.of("az", Map.of("title", "Başlıq"), "de", Map.of("title", "Titel")));
        assertRefused(curator, "de-copy", unsupportedLocale, "copy.de");

        Map<String, Object> backwards = new LinkedHashMap<>(body("OPEN_CALL", false));
        backwards.put("opensAt", Instant.now().plus(10, ChronoUnit.DAYS).toString());
        backwards.put("closesAt", Instant.now().plus(1, ChronoUnit.DAYS).toString());
        assertRefused(curator, "backwards", backwards, "closesAt");

        Map<String, Object> unknownKind = new LinkedHashMap<>(body("THEMED", false));
        unknownKind.put("kind", "FAVOURITES");
        assertRefused(curator, "unknown-kind", unknownKind, "kind");
    }

    @Test
    @DisplayName("a note is required for the four actions that change what the public sees")
    void theReasonIsRequired() {
        Account curator = moderator();
        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));

        // §3.2's badge is discretionary and the note is the only place the reason for
        // one survives. Refused by bean validation before the service is reached.
        List<Request> withoutANote = List.of(
                new Request(HttpMethod.POST, "/v1/admin/collections/staff-picks/publish", Map.of()),
                new Request(HttpMethod.POST, "/v1/admin/collections/staff-picks/unpublish", Map.of()),
                new Request(
                        HttpMethod.POST,
                        "/v1/admin/collections/staff-picks/projects",
                        Map.of("projectId", campaign.toString())),
                new Request(
                        HttpMethod.POST,
                        "/v1/admin/collections/staff-picks/projects/" + campaign + "/remove",
                        Map.of()));

        for (Request request : withoutANote) {
            assertThat(send(curator, request).getStatusCode())
                    .withFailMessage("%s accepted a decision with no reason", request.path())
                    .isEqualTo(HttpStatus.BAD_REQUEST);
        }
    }

    @Test
    @DisplayName("a slug another collection already answers at is a 409")
    void aTakenSlugIsAConflict() {
        Account curator = moderator();
        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));

        ResponseEntity<Map<String, Object>> response = send(
                curator,
                new Request(
                        HttpMethod.POST,
                        "/v1/admin/collections",
                        Map.of("slug", "staff-picks", "collection", body("THEMED", false))));

        // Not a 400: nothing about the request is malformed, and the fix is a
        // different slug rather than a different shape.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).containsEntry("code", "COLLECTION_SLUG_TAKEN");
    }

    @Test
    @DisplayName("a campaign that does not exist is refused by name rather than by constraint")
    void anUnknownCampaignIsRefused() {
        Account curator = moderator();
        createCollection(curator, "staff-picks", body("STAFF_SELECTION", true));

        ResponseEntity<Map<String, Object>> response = send(
                curator,
                new Request(
                        HttpMethod.POST,
                        "/v1/admin/collections/staff-picks/projects",
                        Map.of("projectId", UUID.randomUUID().toString(), "note", "A pick")));

        // A foreign key violation reaches the client as a 500; a curator who pasted
        // the wrong identifier needs to be told which field is wrong.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().get("meta").toString()).contains("projectId");
    }

    @Test
    @DisplayName("a campaign the public cannot see may still be curated, and is shown to the curator")
    void aCuratorMayPrepareWithUnlaunchedCampaigns() {
        Account curator = moderator();
        UUID creator = Campaigns.creator(dataSource, "curation-api-creator");
        UUID draft = Campaigns.seed(dataSource, creator, "draft-campaign")
                .state("DRAFT")
                .category("games")
                .insert();

        createCollection(curator, "next-month", body("THEMED", false));
        addProject(curator, "next-month", draft, "Launching next week");
        publish(curator, "next-month");

        // Refusing it would make the feature unusable a week before every launch.
        Map<String, Object> admin = send(curator,
                        new Request(HttpMethod.GET, "/v1/admin/collections/next-month", null))
                .getBody();
        List<Map<String, Object>> members = items(admin, "projects");
        assertThat(members).hasSize(1);
        assertThat(members.get(0)).containsEntry("publiclyVisible", false);

        // What protects the reader is the read, not the write.
        assertThat(items(collectionPage("next-month"))).isEmpty();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered, signed-in account: its bearer token and its identifier. */
    private record Account(String accessToken, UUID id) {
    }

    private record Request(HttpMethod method, String path, Object body) {
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("curator" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Not Staff"),
                String.class);
        return signIn(email);
    }

    /**
     * The one account this suite's configuration treats as platform staff.
     *
     * <p>Registered and signed in once for the whole class rather than per test,
     * because the address is fixed — {@code application-test.yml} names it — and the
     * auth module's per-email sign-in limit is deliberately realistic. Every other
     * account in the file is therefore a non-moderator, which is what makes the
     * refusal tests the default case rather than a special one.
     */
    private Account moderator() {
        if (MODERATOR != null) {
            return MODERATOR;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                String.class);
        MODERATOR = signIn(email);
        return MODERATOR;
    }

    private Account signIn(EmailAddress email) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private ResponseEntity<Map<String, Object>> send(Account account, Request request) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(account.accessToken());
        return rest.exchange(
                request.path(),
                request.method(),
                new HttpEntity<>(request.body(), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /** The description every fixture starts from: a title in Azerbaijani and nothing else. */
    private static Map<String, Object> body(String kind, boolean grantsBadge) {
        Map<String, Object> collection = new LinkedHashMap<>();
        collection.put("kind", kind.toLowerCase(java.util.Locale.ROOT));
        collection.put("grantsBadge", grantsBadge);
        collection.put("copy", Map.of("az", Map.of("title", "Redaksiya seçimi")));
        return collection;
    }

    private Map<String, Object> createCollection(Account curator, String slug, Map<String, Object> collection) {
        ResponseEntity<Map<String, Object>> response = send(
                curator,
                new Request(HttpMethod.POST, "/v1/admin/collections", Map.of("slug", slug, "collection", collection)));
        assertThat(response.getStatusCode())
                .withFailMessage("creating %s failed: %s", slug, response.getBody())
                .isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private void publish(Account curator, String slug) {
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/" + slug + "/publish",
                                Map.of("note", "Ready")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    private void addProject(Account curator, String slug, UUID projectId, String note) {
        assertThat(send(curator, new Request(
                                HttpMethod.POST,
                                "/v1/admin/collections/" + slug + "/projects",
                                Map.of("projectId", projectId.toString(), "note", note)))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    private void assertRefused(Account curator, String slug, Map<String, Object> collection, String field) {
        ResponseEntity<Map<String, Object>> response = send(
                curator,
                new Request(HttpMethod.POST, "/v1/admin/collections", Map.of("slug", slug, "collection", collection)));

        assertThat(response.getStatusCode())
                .withFailMessage("%s was accepted: %s", field, response.getBody())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "CURATION_REJECTED");
        assertThat(response.getBody().get("meta").toString()).contains(field);
    }

    private Map<String, Object> collectionPage(String slug) {
        ResponseEntity<Map<String, Object>> response = get("/v1/collections/" + slug, new HttpHeaders());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    /** The audit trail for one collection, oldest first, straight out of the table. */
    private List<Map<String, Object>> auditRows(String slug) {
        return new JdbcTemplate(dataSource)
                .query(
                        """
                        SELECT e.action, e.project_id, e.actor_id, e.actor_role, e.note, e.created_at
                          FROM curation_events e
                          JOIN collections c ON c.id = e.collection_id
                         WHERE c.slug = ?
                         ORDER BY e.created_at ASC, e.action ASC
                        """,
                        (resultSet, index) -> {
                            Map<String, Object> row = new LinkedHashMap<>();
                            row.put("action", resultSet.getString("action"));
                            row.put("project_id", resultSet.getObject("project_id", UUID.class));
                            row.put("actor_id", resultSet.getObject("actor_id", UUID.class));
                            row.put("actor_role", resultSet.getString("actor_role"));
                            row.put("note", resultSet.getString("note"));
                            row.put(
                                    "created_at",
                                    resultSet.getObject("created_at", java.time.OffsetDateTime.class)
                                            .toInstant());
                            return row;
                        },
                        slug);
    }
}
