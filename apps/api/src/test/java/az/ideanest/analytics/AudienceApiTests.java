package az.ideanest.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.analytics.application.AudienceEventService;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.Campaigns;
import az.ideanest.support.StaffGrants;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
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
 * #633 end to end: the beacon, what it counts, who may read the result, and the cards.
 *
 * <p>Site figures are shared by the whole suite, so each test that asserts on them sends
 * its events with a country of its own in {@code CF-IPCountry} and reads the rows for
 * that country only. Campaign figures are per campaign and need no such trick.
 */
class AudienceApiTests extends AbstractIntegrationTest {

    private static final ZoneId BAKU = ZoneId.of("Asia/Baku");

    private static final String NOTE = "audience api fixture";

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    private static final String CHROME =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

    private static final String SAFARI =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private AudienceEventService audience;

    @AfterEach
    void clear() {
        clock.reset();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Campaign rows cascade from the campaign; the site rows are this class's countries.
        jdbc.update("DELETE FROM projects WHERE slug LIKE 'audience-api-%'");
        jdbc.update("DELETE FROM audience_hourly WHERE project_id IS NULL AND country IN ('AQ', 'BV', 'HM', 'TF', 'UM', 'GS', 'PN')");
        jdbc.update("DELETE FROM collaborators WHERE invited_email LIKE 'audience-api-%'");
        // Salts and markers are the suite's, and a test that moved the clock leaves a
        // salt for a day that has not come yet. Nothing outside this class reads them.
        jdbc.update("DELETE FROM audience_seen");
        jdbc.update("DELETE FROM audience_day_salts");
        StaffGrants.clear(dataSource, NOTE);
    }

    // ------------------------------------------------------------------
    // Counting
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reader's page views all count, and the reader counts once a day")
    void pageViewsAreRawAndVisitorsAreDaily() {
        assertThat(visit("AQ", CHROME, "203.0.113.10").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        visit("AQ", CHROME, "203.0.113.10");
        visit("AQ", CHROME, "203.0.113.10");
        // Somebody else: another address, through Cloudflare.
        visit("AQ", SAFARI, "203.0.113.11");

        assertThat(siteCounts("AQ")).containsEntry("visitors", 2L).containsEntry("page_views", 4L);
    }

    @Test
    @DisplayName("a campaign is viewed once a day per reader, and the card's total moves with it but its last-saved time does not")
    void viewsAreDailyAndCountOnTheCard() {
        UUID project = campaign("LIVE");
        OffsetDateTime savedBefore = updatedAt(project);

        assertThat(event(view(project), CHROME, "203.0.113.20", "AZ").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        event(view(project), CHROME, "203.0.113.20", "AZ");
        event(view(project), SAFARI, "203.0.113.21", "TR");

        assertThat(campaignCounts(project)).containsEntry("views", 2L).containsEntry("clicks", 0L);
        assertThat(viewCount(project)).isEqualTo(2);
        assertThat(updatedAt(project)).isEqualTo(savedBefore);
    }

    @Test
    @DisplayName("a click counts once a day per reader, under the surface of that first click")
    void clicksAreDailyAndKeepTheFirstSurface() {
        UUID project = campaign("LIVE");

        event(click(project, "SEARCH"), CHROME, "203.0.113.30", "AZ");
        event(click(project, "HOME"), CHROME, "203.0.113.30", "AZ");

        List<Map<String, Object>> rows = new JdbcTemplate(dataSource).queryForList(
                "SELECT surface, clicks FROM audience_hourly WHERE project_id = ? AND clicks > 0", project);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst()).containsEntry("surface", "SEARCH").containsEntry("clicks", 1);
        assertThat(viewCount(project)).isZero();
    }

    @Test
    @DisplayName("a bot's events and events about a campaign the public cannot see write nothing, and answer the same")
    void botsAndHiddenCampaignsWriteNothing() {
        UUID draft = campaign("DRAFT");
        UUID live = campaign("LIVE");

        assertThat(visit("BV", "Mozilla/5.0 (compatible; Googlebot/2.1)", "203.0.113.40").getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(event(view(live), "curl/8.4.0", "203.0.113.40", "AZ").getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(event(view(draft), CHROME, "203.0.113.41", "AZ").getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(event(click(UUID.randomUUID(), "HOME"), CHROME, "203.0.113.41", "AZ").getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(siteCounts("BV")).containsEntry("visitors", 0L).containsEntry("page_views", 0L);
        assertThat(campaignCounts(live)).containsEntry("views", 0L);
        assertThat(campaignCounts(draft)).containsEntry("views", 0L);
        assertThat(viewCount(draft)).isZero();
        assertThat(viewCount(live)).isZero();
    }

    @Test
    @DisplayName("an event whose fields do not fit its kind is a 400, and so is a missing kind or an unknown platform")
    void malformedEventsAreRefused() {
        UUID project = UUID.randomUUID();

        assertThat(event(Map.of("kind", "VIEW", "platform", "WEB"), CHROME, "203.0.113.50", null).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(event(Map.of("kind", "VISIT", "platform", "WEB", "projectId", project.toString()), CHROME,
                        "203.0.113.50", null)
                .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(event(Map.of("kind", "CLICK", "platform", "WEB", "projectId", project.toString()), CHROME,
                        "203.0.113.50", null)
                .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(event(Map.of("kind", "VIEW", "platform", "WEB", "projectId", project.toString(), "surface", "HOME"),
                        CHROME, "203.0.113.50", null)
                .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(event(Map.of("platform", "WEB"), CHROME, "203.0.113.50", null).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(event(Map.of("kind", "VISIT", "platform", "PLAYSTATION"), CHROME, "203.0.113.50", null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("an expired or forged token on the beacon is ignored rather than refused")
    void aTokenIsNotRead() {
        HttpHeaders headers = beaconHeaders(CHROME, "203.0.113.60", "HM");
        headers.setBearerAuth("not-a-token");

        ResponseEntity<String> response = rest.exchange(
                "/v1/audience/events",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("kind", "VISIT", "platform", "WEB"), headers),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(siteCounts("HM")).containsEntry("visitors", 1L);
    }

    @Test
    @DisplayName("the country is Cloudflare's when it gives one, and unknown for XX, T1 or none without a GeoIP database")
    void countryResolution() {
        UUID project = campaign("LIVE");

        event(view(project), CHROME, "203.0.113.70", "az");
        event(view(project), CHROME, "203.0.113.71", "XX");
        event(view(project), CHROME, "203.0.113.72", "T1");
        event(view(project), CHROME, "203.0.113.73", null);

        List<Map<String, Object>> rows = new JdbcTemplate(dataSource).queryForList(
                "SELECT country, sum(views) AS views FROM audience_hourly WHERE project_id = ? GROUP BY country ORDER BY country",
                project);
        assertThat(rows).extracting(row -> row.get("country")).containsExactly("AZ", "ZZ");
        assertThat(((Number) rows.get(1).get("views")).longValue()).isEqualTo(3);
    }

    @Test
    @DisplayName("no address and no user agent is stored anywhere, only a 32-byte keyed hash")
    void nothingPersonalIsStored() {
        UUID project = campaign("LIVE");
        event(view(project), CHROME, "198.51.100.77", "AZ");

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        List<String> seenColumns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'audience_seen' ORDER BY column_name",
                String.class);
        List<String> hourlyColumns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'audience_hourly' ORDER BY column_name",
                String.class);
        assertThat(seenColumns).containsExactly("day", "kind", "project_id", "visitor_hash");
        assertThat(hourlyColumns).containsExactly(
                "clicks", "country", "hour", "page_views", "platform", "project_id", "surface", "views", "visitors");

        byte[] hash = jdbc.queryForObject(
                "SELECT visitor_hash FROM audience_seen WHERE project_id = ?", byte[].class, project);
        assertThat(hash).hasSize(32);
        assertThat(new String(hash, java.nio.charset.StandardCharsets.ISO_8859_1))
                .doesNotContain("198.51.100.77")
                .doesNotContain("Chrome");
    }

    @Test
    @DisplayName("Cloudflare's connecting address tells two readers behind one edge apart")
    void connectingAddressSeparatesReaders() {
        visit("TF", CHROME, "203.0.113.80");
        visit("TF", CHROME, "203.0.113.81");
        visit("TF", CHROME, "203.0.113.81");

        assertThat(siteCounts("TF")).containsEntry("visitors", 2L).containsEntry("page_views", 3L);
    }

    @Test
    @DisplayName("a new Baku day has a new salt, so yesterday's reader is counted again today")
    void theSaltRotatesWithTheDay() {
        clock.freeze();
        visit("UM", CHROME, "203.0.113.90");
        LocalDate first = clock.instant().atZone(BAKU).toLocalDate();
        clock.advance(Duration.ofDays(1));
        visit("UM", CHROME, "203.0.113.90");

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        byte[] firstSalt = jdbc.queryForObject("SELECT salt FROM audience_day_salts WHERE day = ?", byte[].class, first);
        byte[] secondSalt = jdbc.queryForObject(
                "SELECT salt FROM audience_day_salts WHERE day = ?", byte[].class, first.plusDays(1));
        assertThat(secondSalt).isNotEqualTo(firstSalt);
        assertThat(siteCounts("UM")).containsEntry("visitors", 2L).containsEntry("page_views", 2L);
    }

    @Test
    @DisplayName("the cleanup forgets the salts and markers of every day before yesterday, and keeps the figures")
    void cleanupForgetsPassedDays() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        LocalDate today = Instant.now().atZone(BAKU).toLocalDate();
        for (int back = 0; back <= 3; back++) {
            LocalDate day = today.minusDays(back);
            jdbc.update(
                    "INSERT INTO audience_day_salts (day, salt) VALUES (?, ?) ON CONFLICT (day) DO NOTHING",
                    day, new byte[32]);
            jdbc.update(
                    "INSERT INTO audience_seen (day, visitor_hash, kind, project_id) VALUES (?, ?, 1, NULL)"
                            + " ON CONFLICT DO NOTHING",
                    day, new byte[32]);
        }
        visit("GS", CHROME, "203.0.113.95");

        audience.forgetPassedDays();

        assertThat(jdbc.queryForList("SELECT day FROM audience_day_salts ORDER BY day", LocalDate.class))
                .containsExactly(today.minusDays(1), today);
        assertThat(jdbc.queryForList("SELECT DISTINCT day FROM audience_seen ORDER BY day", LocalDate.class))
                .containsExactly(today.minusDays(1), today);
        assertThat(siteCounts("GS")).containsEntry("visitors", 1L);
    }

    // ------------------------------------------------------------------
    // Who may read it
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the owner reads their campaign: zero-filled series, totals, breakdowns and the all-time count")
    void theOwnerReadsTheirCampaign() {
        UUID owner = Campaigns.creator(dataSource, "audience-api-owner-" + SEQUENCE.incrementAndGet());
        UUID project = campaign("LIVE", owner);
        event(view(project), CHROME, "203.0.113.100", "AZ");
        event(view(project), SAFARI, "203.0.113.101", null);
        event(click(project, "DISCOVER"), CHROME, "203.0.113.100", "AZ");

        ResponseEntity<Map<String, Object>> response = get("/v1/projects/" + project + "/audience?period=week", token(owner));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getCacheControl()).contains("no-store").contains("private");
        Map<String, Object> body = response.getBody();
        assertThat(body).containsEntry("period", "week").containsEntry("bucket", "DAY").containsEntry("timeZone", "Asia/Baku");
        assertThat(((Number) body.get("allTimeViews")).longValue()).isEqualTo(2);
        assertThat(map(body.get("totals"))).containsEntry("views", 2).containsEntry("clicks", 1);
        List<Map<String, Object>> series = list(body.get("series"));
        assertThat(series).hasSize(7);
        assertThat(series.getLast()).containsEntry("views", 2).containsEntry("clicks", 1);
        assertThat(series.getFirst()).containsEntry("views", 0).containsEntry("clicks", 0);
        assertThat(list(body.get("countries"))).extracting(row -> row.get("country")).containsExactly("AZ", "ZZ");
        assertThat(list(body.get("surfaces"))).containsExactly(Map.of("surface", "DISCOVER", "clicks", 1));
        assertThat(list(body.get("platforms"))).containsExactly(Map.of("platform", "WEB", "views", 2));

        for (String period : List.of("day", "month", "year")) {
            Map<String, Object> other = get("/v1/projects/" + project + "/audience?period=" + period, token(owner)).getBody();
            int expected = switch (period) {
                case "day" -> 24;
                case "month" -> 30;
                default -> 12;
            };
            assertThat(list(other.get("series"))).as(period).hasSize(expected);
        }
        assertThat(get("/v1/projects/" + project + "/audience?period=quarter", token(owner)).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("anonymous is 401, a stranger 404, a collaborator without VIEW_FINANCES 403, with it 200")
    void theCampaignReportIsGated() {
        UUID owner = Campaigns.creator(dataSource, "audience-api-owner-" + SEQUENCE.incrementAndGet());
        UUID project = campaign("LIVE", owner);
        UUID stranger = Campaigns.creator(dataSource, "audience-api-stranger-" + SEQUENCE.incrementAndGet());
        UUID pricer = collaborator(project, owner, "EDIT_REWARDS");
        UUID analyst = collaborator(project, owner, "VIEW_FINANCES");
        String path = "/v1/projects/" + project + "/audience?period=day";

        assertThat(rest.exchange(path, HttpMethod.GET, null, OBJECT).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        ResponseEntity<Map<String, Object>> asStranger = get(path, token(stranger));
        assertThat(asStranger.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(asStranger.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
        assertThat(get(path, token(pricer)).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get(path, token(analyst)).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(get(path, token(owner)).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("staff without VIEW_AUDIENCE are refused; a curator reads both screens and each read is audited")
    void theConsoleIsGatedAndAudited() {
        UUID project = campaign("LIVE");
        event(view(project), CHROME, "203.0.113.110", "PN");
        visit("PN", CHROME, "203.0.113.110");

        UUID nobody = Campaigns.creator(dataSource, "audience-api-nobody-" + SEQUENCE.incrementAndGet());
        UUID moderator = staff(StaffRole.MODERATOR);
        UUID curator = staff(StaffRole.CURATOR);

        assertThat(get("/v1/admin/audience?period=week", token(nobody)).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/v1/admin/audience?period=week", token(moderator)).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/v1/admin/audience/projects/" + project, token(moderator)).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);

        ResponseEntity<Map<String, Object>> platform = get("/v1/admin/audience?period=week", token(curator));
        assertThat(platform.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(platform.getHeaders().getCacheControl()).contains("no-store");
        Map<String, Object> body = platform.getBody();
        assertThat(body).containsEntry("period", "week").containsEntry("bucket", "DAY");
        assertThat(list(body.get("series"))).hasSize(7);
        assertThat(list(body.get("countries"))).anySatisfy(row -> assertThat(row).containsEntry("country", "PN"));
        assertThat(list(body.get("topCampaigns"))).anySatisfy(row -> assertThat(row)
                .containsEntry("projectId", project.toString())
                .containsEntry("views", 1)
                .containsKey("title")
                .containsKey("creatorSlug"));

        ResponseEntity<Map<String, Object>> one = get("/v1/admin/audience/projects/" + project + "?period=day", token(curator));
        assertThat(one.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(map(one.getBody().get("totals"))).containsEntry("views", 1);
        assertThat(list(one.getBody().get("series"))).hasSize(24);

        assertThat(get("/v1/admin/audience/projects/" + UUID.randomUUID(), token(curator)).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(get("/v1/admin/audience?period=decade", token(curator)).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        List<String> details = new JdbcTemplate(dataSource).queryForList(
                "SELECT detail FROM audit_logs WHERE action = 'analytics.read' AND actor_id = ?", String.class, curator);
        assertThat(details).contains("audience period=week", "audience project=" + project + " period=day");
    }

    // ------------------------------------------------------------------
    // Cards
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the discovery card and the profile card carry the campaign's view count")
    void cardsCarryTheViewCount() {
        UUID owner = Campaigns.creator(dataSource, "audience-api-owner-" + SEQUENCE.incrementAndGet());
        UUID project = campaign("LIVE", owner);
        event(view(project), CHROME, "203.0.113.120", "AZ");
        event(view(project), SAFARI, "203.0.113.121", "AZ");

        Map<String, Object> mine = get("/v1/me/projects", token(owner)).getBody();
        assertThat(list(mine.get("projects")))
                .filteredOn(card -> project.toString().equals(card.get("id")))
                .singleElement()
                .satisfies(card -> assertThat(card).containsEntry("viewCount", 2));

        Map<String, Object> feed = rest.exchange("/v1/discover?sort=newest&limit=50", HttpMethod.GET, null, OBJECT)
                .getBody();
        assertThat(list(feed.get("items")))
                .filteredOn(card -> project.toString().equals(card.get("id")))
                .singleElement()
                .satisfies(card -> assertThat(card).containsEntry("viewCount", 2));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private UUID campaign(String state) {
        return campaign(state, Campaigns.creator(dataSource, "audience-api-creator-" + SEQUENCE.incrementAndGet()));
    }

    private UUID campaign(String state, UUID creator) {
        String slug = "audience-api-" + SEQUENCE.incrementAndGet() + "-" + UUID.randomUUID().toString().substring(0, 8);
        Campaigns.Seed seed = Campaigns.seed(dataSource, creator, slug).state(state);
        if ("LIVE".equals(state)) {
            seed.launchedAt(Instant.now().minusSeconds(60));
        }
        return seed.insert();
    }

    private UUID collaborator(UUID project, UUID owner, String capability) {
        String handle = "audience-api-collaborator-" + SEQUENCE.incrementAndGet();
        UUID account = Campaigns.creator(dataSource, handle);
        UUID collaboratorId = UUID.randomUUID();
        byte[] tokenHash = new byte[32];
        new java.security.SecureRandom().nextBytes(tokenHash);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update(
                """
                INSERT INTO collaborators
                    (id, project_id, account_id, invited_email, invitation_token_hash,
                     invited_by, expires_at, accepted_at)
                VALUES (?, ?, ?, ?, ?, ?, now() + interval '7 days', now())
                """,
                collaboratorId,
                project,
                account,
                handle + "@example.com",
                tokenHash,
                owner);
        jdbc.update(
                "INSERT INTO collaborator_capabilities (collaborator_id, capability) VALUES (?, ?)",
                collaboratorId,
                capability);
        return account;
    }

    private UUID staff(StaffRole role) {
        UUID account = Campaigns.creator(dataSource, "audience-api-staff-" + SEQUENCE.incrementAndGet());
        StaffGrants.grant(dataSource, account, role, NOTE);
        return account;
    }

    private String token(UUID account) {
        return tokens.issue(
                        account,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
    }

    private static Map<String, Object> view(UUID project) {
        return Map.of("kind", "VIEW", "platform", "WEB", "projectId", project.toString());
    }

    private static Map<String, Object> click(UUID project, String surface) {
        return Map.of("kind", "CLICK", "platform", "WEB", "projectId", project.toString(), "surface", surface);
    }

    private ResponseEntity<String> visit(String country, String agent, String address) {
        return event(Map.of("kind", "VISIT", "platform", "WEB"), agent, address, country);
    }

    private ResponseEntity<String> event(Map<String, Object> body, String agent, String address, String country) {
        return rest.exchange(
                "/v1/audience/events",
                HttpMethod.POST,
                new HttpEntity<>(new HashMap<>(body), beaconHeaders(agent, address, country)),
                String.class);
    }

    private static HttpHeaders beaconHeaders(String agent, String address, String country) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.USER_AGENT, agent);
        headers.set("CF-Connecting-IP", address);
        if (country != null) {
            headers.set("CF-IPCountry", country);
        }
        return headers;
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), OBJECT);
    }

    private Map<String, Object> siteCounts(String country) {
        return new JdbcTemplate(dataSource).queryForMap(
                """
                SELECT coalesce(sum(visitors), 0)::bigint AS visitors, coalesce(sum(page_views), 0)::bigint AS page_views
                  FROM audience_hourly WHERE project_id IS NULL AND country = ?
                """,
                country);
    }

    private Map<String, Object> campaignCounts(UUID project) {
        return new JdbcTemplate(dataSource).queryForMap(
                """
                SELECT coalesce(sum(views), 0)::bigint AS views, coalesce(sum(clicks), 0)::bigint AS clicks
                  FROM audience_hourly WHERE project_id = ?
                """,
                project);
    }

    private long viewCount(UUID project) {
        return new JdbcTemplate(dataSource).queryForObject("SELECT view_count FROM projects WHERE id = ?", Long.class, project);
    }

    private OffsetDateTime updatedAt(UUID project) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT updated_at FROM projects WHERE id = ?", OffsetDateTime.class, project);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object value) {
        return (List<Map<String, Object>>) value;
    }
}
