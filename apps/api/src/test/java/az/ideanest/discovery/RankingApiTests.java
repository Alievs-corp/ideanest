package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.discovery.application.RankingWeightStore;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Curations;
import az.ideanest.support.Weights;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
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
 * {@code /v1/admin/ranking}: tuning §11.2, and seeing what it did.
 *
 * <p>Three properties carry this suite, and CLAUDE.md and §11.2 are why.
 *
 * <p><strong>Nobody but platform staff may tune, or even look.</strong> A weight moves
 * every campaign in every feed at once, which is a larger act than any single curation
 * decision — and the breakdown is a specification of how to rank highly on this
 * platform, which is not a thing to hand to whoever asks. Every account in this file
 * except {@link #moderator()} is an ordinary user, so the refusal is the common case.
 *
 * <p><strong>Every change leaves a row nobody can tidy away</strong>, carrying the value
 * before as well as the value after — because "what was the editorial weight during the
 * experiment" is the question the trail exists to answer, and a log of only the new
 * value cannot.
 *
 * <p><strong>Five of §11.2's eight terms are visibly inert rather than silently
 * absent.</strong> This is the suite where that is asserted, because the diagnostic is
 * where somebody tuning would find out. A ranking that quietly dropped five terms would
 * pass every ordering test in {@code RankingRelevanceTests} and would still be a
 * misrepresentation of the specification.
 */
class RankingApiTests extends DiscoveryTestSupport {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** Shared across the class; see {@link #moderator()}. */
    private static Account moderatorAccount;

    @Autowired
    private UserRepository users;

    @Autowired
    private RankingWeightStore weightStore;

    @BeforeEach
    void seedCampaignsAndWeights() {
        Campaigns.clear(dataSource);
        Weights.restoreDefaults(dataSource);
        weightStore.refresh();

        UUID creator = Campaigns.creator(dataSource, "ranking-api-creator");
        Instant launched = Instant.now().minus(30, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        UUID badged = Campaigns.seed(dataSource, creator, "explained-campaign")
                .title("Robot dostum")
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .pledged("900.00")
                .backers(20)
                .launchedAt(launched)
                .deadline(launched.plus(60, ChronoUnit.DAYS))
                .insert();
        Campaigns.seed(dataSource, creator, "quiet-campaign")
                .title("Sakit layihə")
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .pledged("10.00")
                .launchedAt(launched)
                .deadline(launched.plus(60, ChronoUnit.DAYS))
                .insert();
        Campaigns.seed(dataSource, creator, "hidden-campaign")
                .state("SUSPENDED")
                .category("games")
                .goal("1000.00")
                .pledged("900.00")
                .launchedAt(launched)
                .deadline(launched.plus(60, ChronoUnit.DAYS))
                .insert();

        UUID picks = Curations.collection(dataSource, "ranking-api-picks")
                .kind("STAFF_SELECTION")
                .grantsBadge()
                .published()
                .insert();
        Curations.members(dataSource, picks, badged);
    }

    @AfterEach
    void restoreWeights() {
        Weights.restoreDefaults(dataSource);
        weightStore.refresh();
    }

    // ------------------------------------------------------------------
    // Who may
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every ranking endpoint is refused for an account that is not staff")
    void everythingIsRefusedForANonModerator() {
        Account stranger = account();

        List<Request> requests = List.of(
                new Request(HttpMethod.GET, "/v1/admin/ranking/weights", null),
                new Request(HttpMethod.GET, "/v1/admin/ranking/explain/explained-campaign", null),
                new Request(
                        HttpMethod.PUT,
                        "/v1/admin/ranking/weights/editorial",
                        Map.of("weight", 5, "active", true, "note", "mine now")));

        for (Request request : requests) {
            ResponseEntity<Map<String, Object>> response = send(stranger, request);
            assertThat(response.getStatusCode())
                    .withFailMessage("%s %s was not refused: %s", request.method(), request.path(), response.getBody())
                    .isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(response.getBody()).containsEntry("code", "NOT_A_MODERATOR");
        }

        // Not even the read. The weights describe how to rank highly, and a creator
        // who knew them would know what to optimise.
        assertThat(auditRows()).isEmpty();
    }

    @Test
    @DisplayName("an anonymous caller is refused before the moderator check")
    void anonymousCallersAreRefused() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/ranking/weights",
                HttpMethod.GET,
                new HttpEntity<>(new HttpHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // Every term, including the ones that do nothing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the weights list names all nine terms, and says what is blocking the five that are inert")
    void theListNamesTheInertTermsAndWhatBlocksThem() {
        Map<String, Object> body = ok(send(moderator(), new Request(HttpMethod.GET, "/v1/admin/ranking/weights", null)));
        List<Map<String, Object>> terms = items(body, "terms");

        // §11.2's eight, plus the text term #43 left for the composite. A response
        // holding only what runs would let somebody tune four weights believing they
        // were tuning the specification.
        assertThat(terms.stream().map(term -> term.get("term")).toList())
                .containsExactly(
                        "text_match",
                        "pledge_velocity",
                        "backer_velocity",
                        "completion",
                        "editorial",
                        "conversion",
                        "personalisation",
                        "recency",
                        "spam");

        Map<String, Map<String, Object>> byTerm = new LinkedHashMap<>();
        terms.forEach(term -> byTerm.put((String) term.get("term"), term));

        // The four that run say nothing about being blocked.
        for (String live : List.of("text_match", "completion", "editorial", "recency")) {
            assertThat(byTerm.get(live)).containsEntry("active", true).doesNotContainKey("blockedBy");
        }
        // The five that do not each name what would activate them, so somebody reading
        // this learns where the gap is rather than guessing at a zero.
        assertThat((String) byTerm.get("pledge_velocity").get("blockedBy")).contains("#50");
        assertThat((String) byTerm.get("backer_velocity").get("blockedBy")).contains("#50");
        assertThat((String) byTerm.get("conversion").get("blockedBy")).contains("#95");
        assertThat((String) byTerm.get("personalisation").get("blockedBy")).contains("D-07");
        assertThat((String) byTerm.get("spam").get("blockedBy")).contains("#108");
        for (String inert :
                List.of("pledge_velocity", "backer_velocity", "conversion", "personalisation", "spam")) {
            assertThat(byTerm.get(inert)).containsEntry("active", false);
            assertThat(new BigDecimal(byTerm.get(inert).get("weight").toString())).isEqualByComparingTo("0");
        }
        // And a version, which is what a cursor is bound to.
        assertThat((String) body.get("version")).isNotBlank();
    }

    @Test
    @DisplayName("a term nothing computes cannot be switched on")
    void anInertTermCannotBeActivated() {
        ResponseEntity<Map<String, Object>> response = send(
                moderator(),
                new Request(
                        HttpMethod.PUT,
                        "/v1/admin/ranking/weights/pledge_velocity",
                        Map.of("weight", 0.5, "active", true, "note", "Trying it out")));

        // Refused rather than accepted-and-ignored, which is the failure the whole
        // capability mechanism in this module exists to prevent, arriving through the
        // ranking table instead of through a query parameter: a term switched on with
        // nothing behind it produces no difference in any feed and is indistinguishable
        // from a weight that is simply too small.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "RANKING_REJECTED");
        assertThat(response.getBody().get("meta").toString()).contains("active");
        assertThat(response.getBody().get("detail").toString()).contains("#50");

        // A weight on it is legal, though, and does nothing. That is what makes turning
        // it on the day #50 lands a configuration change plus the expression, rather
        // than a new row and a new vocabulary.
        assertThat(setWeight("pledge_velocity", "0.5", false, "Ready for #50").getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // What is recorded
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every change is recorded with the value before, the value after, and the reason")
    void everyChangeIsAudited() {
        Instant before = Instant.now().minusSeconds(5);
        Account curator = moderator();

        assertThat(setWeight("editorial", "0.45", true, "Testing whether staff picks convert")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(setWeight("recency", "0.10", true, "Too much churn on the front page")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        List<Map<String, Object>> rows = auditRows();
        assertThat(rows.stream().map(row -> row.get("term")).toList()).containsExactly("editorial", "recency");

        Map<String, Object> editorial = rows.get(0);
        // The before as well as the after. A trail of "it is now 0.45" cannot answer
        // "what was it during the experiment", and reconstructing it from the previous
        // row is only correct if no row was ever missed.
        assertThat(new BigDecimal(editorial.get("old_weight").toString())).isEqualByComparingTo("0.15");
        assertThat(new BigDecimal(editorial.get("new_weight").toString())).isEqualByComparingTo("0.45");
        assertThat(editorial).containsEntry("old_active", true).containsEntry("new_active", true);
        // Who. A change to what every backer sees, recorded without saying whose it
        // was, is not an audit trail.
        assertThat(editorial.get("actor_id")).isEqualTo(curator.id());
        assertThat(editorial).containsEntry("actor_role", "MODERATOR");
        // Why. §11.2 asks for ranking to be measurable, and a weight moved with no
        // stated hypothesis is unmeasurable by construction.
        assertThat(editorial).containsEntry("note", "Testing whether staff picks convert");
        assertThat((Instant) editorial.get("created_at")).isAfter(before);
    }

    @Test
    @DisplayName("a change is also in the platform's audit trail, with both values and without the note")
    void aChangeReachesTheAuditTrail() {
        Account curator = moderator();
        // The database's clock, and no margin: the rows other tests in this class wrote a
        // moment ago are about the same term and cannot be deleted.
        java.sql.Timestamp before = new JdbcTemplate(dataSource)
                .queryForObject("SELECT clock_timestamp()", java.sql.Timestamp.class);

        assertThat(setWeight("editorial", "0.45", true, "Testing whether staff picks convert")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // A term has no row identifier, so the entity is derived from its name, as a feature
        // flag's is: two changes to one term are one history.
        UUID term = UUID.nameUUIDFromBytes("ranking_weight:editorial".getBytes(StandardCharsets.UTF_8));
        List<Map<String, Object>> trail = new JdbcTemplate(dataSource)
                .queryForList(
                        """
                        SELECT action, entity_type, actor_id, actor_type, detail
                          FROM audit_logs
                         WHERE entity_id = ? AND occurred_at > ?
                        """,
                        term,
                        before);

        // #587: ranking_weight_changes is the term's own history, and the console's trail
        // and an investigation read audit_logs, which had nothing from here.
        assertThat(trail).hasSize(1);
        Map<String, Object> row = trail.getFirst();
        assertThat(row).containsEntry("action", "ranking.weight_changed").containsEntry("entity_type", "ranking_weight");
        assertThat(row).containsEntry("actor_id", curator.id()).containsEntry("actor_type", "MODERATOR");
        assertThat((String) row.get("detail"))
                .contains("term=editorial")
                .contains("before: weight=0.15")
                .contains("after: weight=0.45")
                .doesNotContain("staff picks");
    }

    @Test
    @DisplayName("a change that changes nothing is not recorded as a decision")
    void noOpsAreNotAudited() {
        setWeight("editorial", "0.45", true, "First");
        setWeight("editorial", "0.45", true, "Again");
        // A different scale for the same number is the same weight, and the same feed.
        setWeight("editorial", "0.450", true, "And again");

        assertThat(auditRows()).hasSize(1);
    }

    @Test
    @DisplayName("a change with no reason, a negative weight, and an oversized weight are all refused")
    void badChangesAreRefused() {
        Map<String, Map<String, Object>> refused = new LinkedHashMap<>();
        refused.put("note", Map.of("weight", 0.5, "active", true));
        refused.put("weight-negative", Map.of("weight", -1, "active", true, "note", "Invert it"));
        refused.put("weight-huge", Map.of("weight", 1000, "active", true, "note", "Only this one matters"));

        for (Map.Entry<String, Map<String, Object>> entry : refused.entrySet()) {
            ResponseEntity<Map<String, Object>> response = send(
                    moderator(),
                    new Request(HttpMethod.PUT, "/v1/admin/ranking/weights/editorial", entry.getValue()));
            assertThat(response.getStatusCode())
                    .withFailMessage("%s was accepted: %s", entry.getKey(), response.getBody())
                    .isEqualTo(HttpStatus.BAD_REQUEST);
        }

        // A negative weight is refused rather than clamped because §11.2 subtracts the
        // spam term itself: the sign belongs to the term, and a negative number here
        // would let somebody invert any term by typing one character.
        assertThat(auditRows()).isEmpty();
    }

    @Test
    @DisplayName("a term that is not one of the nine is refused with the vocabulary")
    void anUnknownTermIsRefusedWithTheList() {
        ResponseEntity<Map<String, Object>> response = send(
                moderator(),
                new Request(
                        HttpMethod.PUT,
                        "/v1/admin/ranking/weights/karma",
                        Map.of("weight", 1, "active", true, "note", "Why not")));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "RANKING_REJECTED");
        assertThat(response.getBody().get("detail").toString()).contains("completion");
    }

    // ------------------------------------------------------------------
    // Tuning without a deployment
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a weight set over the API is in force on the next request")
    void aChangeIsInForceImmediatelyForTheInstanceThatTookIt() {
        // A third campaign that wins on recency and loses on everything else, so the
        // two orders below are genuinely opposite rather than the same order twice.
        Instant justNow = Instant.now().minus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);
        Campaigns.seed(dataSource, Campaigns.creator(dataSource, "ranking-api-creator"), "brand-new")
                .title("Təzə layihə")
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .pledged("10.00")
                .launchedAt(justNow)
                .deadline(justNow.plus(60, ChronoUnit.DAYS))
                .insert();

        setWeight("text_match", "0", true, "Isolating completion");
        setWeight("recency", "0", true, "Isolating completion");
        setWeight("editorial", "0", true, "Isolating completion");
        setWeight("completion", "1", true, "Isolating completion");
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("explained-campaign");

        // The same two requests, in the other order, with nothing between them but a
        // PUT. No deployment, no restart, and no waiting for the staleness window
        // either: the instance that took the change re-reads before it answers, which
        // is the explicit half of RankingWeightStore.
        setWeight("completion", "0", true, "Isolating recency");
        setWeight("recency", "1", true, "Isolating recency");
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("brand-new");
    }

    // ------------------------------------------------------------------
    // The diagnostic
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the diagnostic breaks a campaign's score into every term, live and inert")
    void theDiagnosticExplainsEveryTerm() {
        Map<String, Object> explained = explain("explained-campaign", null);

        assertThat(explained).containsEntry("slug", "explained-campaign");
        assertThat(explained).containsEntry("title", "Robot dostum");
        assertThat((String) explained.get("weightsVersion")).isNotBlank();

        Map<String, Map<String, Object>> byTerm = new LinkedHashMap<>();
        items(explained, "terms").forEach(term -> byTerm.put((String) term.get("term"), term));
        assertThat(byTerm).hasSize(9);

        // Completion: 900 of 1000, through the sigmoid — 900² / (900² + 1000²).
        assertThat(new BigDecimal(byTerm.get("completion").get("value").toString()))
                .isEqualByComparingTo("0.447514");
        // The editorial badge: one, because the campaign is in a published,
        // badge-granting collection. Binary rather than a count.
        assertThat(new BigDecimal(byTerm.get("editorial").get("value").toString())).isEqualByComparingTo("1");
        // The text term with no query: zero for everybody rather than absent.
        assertThat(new BigDecimal(byTerm.get("text_match").get("value").toString())).isEqualByComparingTo("0");
        // Recency: thirty days old against a seven-day half-value, so well under a half
        // and comfortably above nothing.
        BigDecimal recency = new BigDecimal(byTerm.get("recency").get("value").toString());
        assertThat(recency).isBetween(new BigDecimal("0.1"), new BigDecimal("0.3"));

        // And the five that nothing computes: no value at all, a contribution of
        // exactly zero, and the reason. THE ABSENCE IS THE POINT — a zero here would
        // say "this campaign has no momentum" where the truth is "this platform does
        // not measure momentum".
        for (String inert :
                List.of("pledge_velocity", "backer_velocity", "conversion", "personalisation", "spam")) {
            assertThat(byTerm.get(inert))
                    .withFailMessage("%s reported a value", inert)
                    .doesNotContainKey("value");
            assertThat(new BigDecimal(byTerm.get(inert).get("contribution").toString()))
                    .isEqualByComparingTo("0");
            assertThat((String) byTerm.get(inert).get("blockedBy")).isNotBlank();
        }

        // The contributions add up to the total, which is what makes the breakdown a
        // breakdown rather than four unrelated numbers beside a fifth.
        BigDecimal summed = byTerm.values().stream()
                .map(term -> new BigDecimal(term.get("contribution").toString()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(summed.subtract(new BigDecimal(explained.get("total").toString())).abs())
                .isLessThan(new BigDecimal("0.000001"));
    }

    @Test
    @DisplayName("the diagnostic explains the order the feed actually produced")
    void theDiagnosticAgreesWithTheFeed() {
        // An explanation computed by a second code path would be a plausible story
        // about a position rather than the reason for it, and nothing would report the
        // day the two drifted. So: the campaign with the higher total is the campaign
        // the feed puts first, under the seeded weights and under an inverted set.
        BigDecimal explained = new BigDecimal(explain("explained-campaign", null).get("total").toString());
        BigDecimal quiet = new BigDecimal(explain("quiet-campaign", null).get("total").toString());
        assertThat(explained).isGreaterThan(quiet);
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("explained-campaign");

        // With a query, the text term is in the total and the diagnostic says so.
        Map<String, Object> withQuery = explain("explained-campaign", "robot");
        Map<String, Object> textTerm = items(withQuery, "terms").stream()
                .filter(term -> "text_match".equals(term.get("term")))
                .findFirst()
                .orElseThrow();
        assertThat(new BigDecimal(textTerm.get("value").toString())).isGreaterThan(BigDecimal.ZERO);
        assertThat(new BigDecimal(withQuery.get("total").toString())).isGreaterThan(explained);
    }

    @Test
    @DisplayName("the diagnostic is not a way to read a campaign the public cannot see")
    void theDiagnosticHonoursTheVisibilityPredicate() {
        ResponseEntity<Map<String, Object>> response = send(
                moderator(), new Request(HttpMethod.GET, "/v1/admin/ranking/explain/hidden-campaign", null));

        // A moderator tool over a suspended campaign is still a second way into the
        // table, and a campaign that is not in a feed has no position in one to
        // explain.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "RANKING_REJECTED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private record Request(HttpMethod method, String path, Object body) {
    }

    private ResponseEntity<Map<String, Object>> setWeight(
            String term, String weight, boolean active, String note) {
        return send(
                moderator(),
                new Request(
                        HttpMethod.PUT,
                        "/v1/admin/ranking/weights/" + term,
                        Map.of("weight", new BigDecimal(weight), "active", active, "note", note)));
    }

    private Map<String, Object> explain(String slug, String query) {
        String path = "/v1/admin/ranking/explain/" + slug + (query == null ? "" : "?q=" + query);
        return ok(send(moderator(), new Request(HttpMethod.GET, path, null)));
    }

    private static Map<String, Object> ok(ResponseEntity<Map<String, Object>> response) {
        assertThat(response.getStatusCode())
                .withFailMessage("the request failed: %s", response.getBody())
                .isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("ranker" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Not Staff"),
                String.class);
        return signIn(email);
    }

    /**
     * The one account this suite's configuration treats as platform staff.
     *
     * <p>Registered and signed in once for the whole class, for the reason
     * {@code CurationApiTests} gives: the address is fixed and the auth module's
     * per-email sign-in limit is deliberately realistic.
     */
    private Account moderator() {
        if (moderatorAccount != null) {
            return moderatorAccount;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                String.class);
        moderatorAccount = signIn(email);
        return moderatorAccount;
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

    /** The audit trail, oldest first, straight out of the table. */
    private List<Map<String, Object>> auditRows() {
        return new JdbcTemplate(dataSource)
                .query(
                        """
                        SELECT term, old_weight, new_weight, old_active, new_active,
                               actor_id, actor_role, note, created_at
                          FROM ranking_weight_changes
                         ORDER BY created_at ASC, term ASC
                        """,
                        (resultSet, index) -> {
                            Map<String, Object> row = new LinkedHashMap<>();
                            row.put("term", resultSet.getString("term"));
                            row.put("old_weight", resultSet.getBigDecimal("old_weight"));
                            row.put("new_weight", resultSet.getBigDecimal("new_weight"));
                            row.put("old_active", resultSet.getObject("old_active"));
                            row.put("new_active", resultSet.getObject("new_active"));
                            row.put("actor_id", resultSet.getObject("actor_id", UUID.class));
                            row.put("actor_role", resultSet.getString("actor_role"));
                            row.put("note", resultSet.getString("note"));
                            row.put("created_at", resultSet.getObject("created_at", java.time.OffsetDateTime.class)
                                    .toInstant());
                            return row;
                        });
    }
}
