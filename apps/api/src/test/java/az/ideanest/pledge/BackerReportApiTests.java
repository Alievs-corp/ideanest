package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
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
 * §4.7's CD-10, CD-07, CD-08 and CD-11 over HTTP: the campaign team's view of who backed
 * it, the two splits behind its charts, and the file it exports.
 *
 * <h2>What these tests are actually pinning</h2>
 *
 * <p>Not "the endpoint answers 200". Four things that are decisions rather than
 * implementation, and that would each be wrong in a way nobody notices:
 *
 * <ul>
 *   <li><strong>Which pledges are backers.</strong> A reservation is not a backer and a
 *       cancelled pledge is no longer one. Both would inflate a fulfilment list, and the
 *       second would post a reward to somebody who withdrew.
 *   <li><strong>An anonymous backer is named to their own creator.</strong> PL-12 is a
 *       promise about the public page; withholding the name here would make the reward
 *       undeliverable. {@code PublicBackerApiTests} pins the other half — that the public
 *       count includes them and the public page does not name them.
 *   <li><strong>Paging cannot drop a backer.</strong> The cursor is a pair, and a campaign
 *       whose pledges landed in the same microsecond is exactly the case a
 *       timestamp-only cursor loses rows on.
 *   <li><strong>The export says when it is short.</strong> A truncated fulfilment list
 *       looks exactly like a complete one.
 * </ul>
 *
 * <p>Who may read it at all is {@code CapabilityContractApiTests}', where every capability
 * is asserted twice against a collaborator who holds it and one who does not.
 */
class BackerReportApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private TestRestTemplate rest;

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
    void clear() {
        // In dependency order rather than by cascade, for the reason PublicBackerApiTests
        // gives: this is the cleanup and not the assertion.
        jdbc().update("DELETE FROM backer_segments");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM reward_tiers");
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // CD-10 — the list
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the report lists the campaign's backers, newest first, with what each paid")
    void theReportListsBackers() {
        Campaign campaign = liveCampaign();
        UUID early = backer(campaign, "Aysel Mammadova", "50.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        UUID late = backer(campaign, "Rashad Aliyev", "120.00", "DE", "COLLECTED", "2026-03-05T10:00:00Z");

        Map<String, Object> body = backers(campaign, "").getBody();

        assertThat(((Number) body.get("matched")).longValue()).isEqualTo(2);
        assertThat(body).containsEntry("currency", "AZN");

        List<Map<String, Object>> rows = rowsOf(body);
        assertThat(rows).hasSize(2);
        // Newest first: the fulfilment question is "who has arrived", and the answer a
        // creator wants at the top is the one they have not seen.
        assertThat(rows.get(0)).containsEntry("pledgeId", late.toString()).containsEntry("name", "Rashad Aliyev");
        assertThat(rows.get(0)).containsEntry("country", "DE").containsEntry("state", "COLLECTED");
        assertThat(amountOf(rows.get(0))).isEqualTo("120.00");
        assertThat(rows.get(1)).containsEntry("pledgeId", early.toString());

        // The email is present, because §4.8 has no other channel to a backer and a
        // report without one is a report the pledge manager cannot use.
        assertThat(rows.get(0).get("email")).asString().contains("@");
    }

    @Test
    @DisplayName("a reservation and a cancelled pledge are not backers")
    void onlyReportedStatesAreBackers() {
        Campaign campaign = liveCampaign();
        backer(campaign, "A committed backer", "30.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        draft(campaign, "Somebody mid-checkout");
        backer(campaign, "Somebody who withdrew", "30.00", "AZ", "CANCELED_BY_BACKER", "2026-03-02T10:00:00Z");

        Map<String, Object> body = backers(campaign, "").getBody();

        // One, not three. A draft is a five-minute reservation and a cancellation is
        // somebody who is no longer a backer; both in the list would be two rewards
        // posted to people who are not owed one.
        assertThat(((Number) body.get("matched")).longValue()).isEqualTo(1);
        assertThat(rowsOf(body)).singleElement().extracting(row -> row.get("name")).isEqualTo("A committed backer");
    }

    @Test
    @DisplayName("an anonymous backer is named to their own creator, and flagged")
    void anAnonymousBackerIsNamedToTheCreator() {
        Campaign campaign = liveCampaign();
        UUID pledge = backer(campaign, "Nigar Huseynova", "75.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        jdbc().update("UPDATE pledges SET is_anonymous = true WHERE id = ?", pledge);

        Map<String, Object> row = rowsOf(backers(campaign, "").getBody()).get(0);

        // PL-12 hides who from the public page. It was never a promise that the creator
        // would have to address a parcel to a number.
        assertThat(row).containsEntry("name", "Nigar Huseynova");
        assertThat(row).containsEntry("anonymous", true);
    }

    @Test
    @DisplayName("the report filters by state, tier and destination, and searches by name")
    void theReportFilters() {
        Campaign campaign = liveCampaign();
        UUID tier = tier(campaign, "An early copy", "25.00");
        backer(campaign, "Aysel Mammadova", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z", tier);
        backer(campaign, "Rashad Aliyev", "40.00", "DE", "FULFILLED", "2026-03-02T10:00:00Z", null);

        assertThat(matchedIn(campaign, "?state=COLLECTED")).isEqualTo(1);
        assertThat(matchedIn(campaign, "?country=DE")).isEqualTo(1);
        // Lower case on the way in: a creator typing a country code is not obliged to
        // know that the column stores it folded up.
        assertThat(matchedIn(campaign, "?country=de")).isEqualTo(1);
        assertThat(matchedIn(campaign, "?rewardTier=" + tier)).isEqualTo(1);
        assertThat(matchedIn(campaign, "?q=aysel")).isEqualTo(1);
        assertThat(matchedIn(campaign, "?q=MAMMADOVA")).isEqualTo(1);
        assertThat(matchedIn(campaign, "?q=nobody")).isZero();
        // Two axes narrow rather than widen.
        assertThat(matchedIn(campaign, "?state=FULFILLED&country=AZ")).isZero();
    }

    @Test
    @DisplayName("a wildcard in the search is a character and not a wildcard")
    void aWildcardInTheSearchIsEscaped() {
        Campaign campaign = liveCampaign();
        backer(campaign, "Aysel Mammadova", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");

        // The failure this prevents is a search box that silently returns everybody,
        // which reads as "no filter applied" rather than as a bug.
        assertThat(matchedIn(campaign, "?q=%25")).isZero();
        assertThat(matchedIn(campaign, "?q=_")).isZero();
    }

    @Test
    @DisplayName("a state outside the report is a bad request that says which states there are")
    void anUnreportedStateIsRefused() {
        Campaign campaign = liveCampaign();

        ResponseEntity<Map<String, Object>> refused = backers(campaign, "?state=DRAFT");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "BACKER_FILTER_INVALID");
        assertThat(refused.getBody().get("detail")).asString().contains("COLLECTED");
    }

    @Test
    @DisplayName("paging keeps every backer, including two confirmed in the same microsecond")
    void pagingKeepsEveryBacker() {
        Campaign campaign = liveCampaign();
        // The same instant on purpose: a cursor that were a timestamp alone would either
        // skip one of these or return it twice, and on a fulfilment list that is a reward
        // nobody posts.
        for (int i = 0; i < 5; i++) {
            backer(campaign, "Backer " + i, "10.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        }

        List<String> seen = new ArrayList<>();
        String query = "?size=2";
        for (int page = 0; page < 5; page++) {
            Map<String, Object> body = backers(campaign, query).getBody();
            rowsOf(body).forEach(row -> seen.add((String) row.get("pledgeId")));
            Object next = body.get("nextCursor");
            if (next == null) {
                break;
            }
            query = "?size=2&cursor=" + next;
        }

        assertThat(seen).hasSize(5).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("a cursor from another campaign answers an empty page rather than that campaign's backers")
    void aForeignCursorAnswersNothing() {
        Campaign mine = liveCampaign();
        Campaign theirs = liveCampaign();
        backer(mine, "My backer", "10.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        UUID theirPledge = backer(theirs, "Their backer", "10.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");

        Map<String, Object> body = backers(mine, "?cursor=" + theirPledge).getBody();

        // The cursor's own key is looked up inside this campaign, so a foreign one
        // resolves to nothing and the comparison excludes every row. The count still
        // reports what the filter matches, which is what stops the empty page from
        // reading as an empty campaign.
        assertThat(rowsOf(body)).isEmpty();
        assertThat(((Number) body.get("matched")).longValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("a stranger is told the campaign does not exist")
    void aStrangerGetsANotFound() {
        Campaign campaign = liveCampaign();
        Account stranger = account("backer-report-stranger");

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/projects/" + campaign.id() + "/backers",
                HttpMethod.GET,
                new HttpEntity<>(bearer(stranger.accessToken())),
                OBJECT);

        // Not a 403: what a campaign has raised and who backed it is competitive
        // information, and a 403 would confirm the identifier names a real campaign.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
    }

    // ------------------------------------------------------------------
    // CD-07 and CD-08 — the splits
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the breakdown splits by tier and by destination, and both add up to the whole")
    void theBreakdownSplitsByTierAndDestination() {
        Campaign campaign = liveCampaign();
        UUID tier = tier(campaign, "An early copy", "25.00");
        backer(campaign, "Aysel", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z", tier);
        backer(campaign, "Rashad", "35.00", "DE", "COLLECTED", "2026-03-02T10:00:00Z", tier);
        // §4.5's PL-02: support with no reward, and no destination either.
        backer(campaign, "Leyla", "40.00", null, "COLLECTED", "2026-03-03T10:00:00Z", null);

        Map<String, Object> body = breakdown(campaign).getBody();

        assertThat(((Number) body.get("backerCount")).longValue()).isEqualTo(3);
        assertThat(amountOf(body, "total")).isEqualTo("100.00");

        List<Map<String, Object>> rewards = listOf(body, "rewards");
        // One tier, with its title from the reward module and its own price beside what
        // it took. The PL-02 pledge is deliberately not here, which is why the campaign's
        // total is its own figure rather than a sum of this list.
        assertThat(rewards).hasSize(1);
        assertThat(rewards.get(0)).containsEntry("title", "An early copy");
        assertThat(((Number) rewards.get(0).get("backerCount")).longValue()).isEqualTo(2);
        assertThat(amountOf(rewards.get(0))).isEqualTo("60.00");
        assertThat(amountOf(rewards.get(0), "price")).isEqualTo("25.00");

        List<Map<String, Object>> countries = listOf(body, "countries");
        // Three groups, one of which is the pledge that named no destination — reported
        // rather than dropped, so the parts add up to the whole. It sorts by what it took
        // like the others, so it is first here rather than last.
        assertThat(countries).hasSize(3);
        assertThat(countries.get(0)).doesNotContainKey("country");
        assertThat(countries.get(1)).containsEntry("country", "DE");
        assertThat(countries.stream()
                        .mapToLong(slice -> ((Number) slice.get("backerCount")).longValue())
                        .sum())
                .isEqualTo(3);
    }

    @Test
    @DisplayName("a campaign nobody has backed has an empty breakdown rather than zeroes in a currency")
    void anUnbackedCampaignHasAnEmptyBreakdown() {
        Campaign campaign = liveCampaign();

        Map<String, Object> body = breakdown(campaign).getBody();

        assertThat(((Number) body.get("backerCount")).longValue()).isZero();
        assertThat(listOf(body, "rewards")).isEmpty();
        // "This campaign has taken nothing" and "it took zero manat" are different
        // sentences, and only the first one is true.
        assertThat(body).doesNotContainKey("currency").doesNotContainKey("total");
    }

    // ------------------------------------------------------------------
    // CD-11 — the export
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the export is a CSV with a header, a row per backer, and a byte order mark")
    void theExportIsACsv() {
        Campaign campaign = liveCampaign();
        UUID tier = tier(campaign, "An early copy", "25.00");
        backer(campaign, "Aysel Mammadova", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z", tier);

        ResponseEntity<String> exported = export(campaign, null);

        assertThat(exported.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(exported.getHeaders().getContentType().toString()).startsWith("text/csv");
        assertThat(exported.getHeaders().getFirst("X-Export-Rows")).isEqualTo("1");
        assertThat(exported.getHeaders().getFirst("X-Export-Truncated")).isEqualTo("false");
        assertThat(exported.getHeaders().getContentDisposition().getFilename()).startsWith("backers-");

        String csv = exported.getBody();
        // The mark is what makes Excel on Windows read the file as UTF-8 rather than as
        // the system code page, which is the difference between a name and mojibake.
        assertThat(csv).startsWith("\uFEFFpledge_id,backer_name,backer_email");
        assertThat(csv).contains("Aysel Mammadova").contains("An early copy").contains("25.00").contains("AZN");
        assertThat(csv.lines().count()).isEqualTo(2);
    }

    @Test
    @DisplayName("a display name that would be a formula is disarmed before the spreadsheet opens it")
    void aFormulaInADisplayNameIsDisarmed() {
        Campaign campaign = liveCampaign();
        // A display name is the most attacker-controlled string on the platform, and the
        // person who opens the file is the creator.
        backer(campaign, "=1+1", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");

        String csv = export(campaign, null).getBody();

        assertThat(csv).contains("'=1+1");
        assertThat(csv).doesNotContain(",=1+1");
    }

    @Test
    @DisplayName("the export honours the filter it was given")
    void theExportHonoursItsFilter() {
        Campaign campaign = liveCampaign();
        backer(campaign, "Aysel Mammadova", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        backer(campaign, "Rashad Aliyev", "40.00", "DE", "COLLECTED", "2026-03-02T10:00:00Z");

        ResponseEntity<String> exported = export(campaign, Map.of("filter", Map.of("countries", List.of("DE"))));

        assertThat(exported.getHeaders().getFirst("X-Export-Rows")).isEqualTo("1");
        assertThat(exported.getBody()).contains("Rashad Aliyev").doesNotContain("Aysel Mammadova");
    }

    // ------------------------------------------------------------------
    // CD-10 — saved segments
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a segment is saved, listed, applied to the report, and deleted")
    void aSegmentIsSavedAndApplied() {
        Campaign campaign = liveCampaign();
        backer(campaign, "Aysel Mammadova", "25.00", "AZ", "COLLECTED", "2026-03-01T10:00:00Z");
        backer(campaign, "Rashad Aliyev", "40.00", "DE", "COLLECTED", "2026-03-02T10:00:00Z");

        ResponseEntity<Map<String, Object>> saved = saveSegment(
                campaign, Map.of("name", "Germany", "filter", Map.of("countries", List.of("de"))));
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        UUID segmentId = UUID.fromString((String) saved.getBody().get("id"));
        // Folded on the way in, and returned folded: the stored filter is what the report
        // will run, so showing the creator something else would be a lie about their own
        // segment.
        assertThat(filterOf(saved.getBody()).get("countries")).isEqualTo(List.of("DE"));

        // Applied by identifier, so a segment whose definition changes changes what the
        // report shows. That indirection is the point of saving one.
        assertThat(matchedIn(campaign, "?segment=" + segmentId)).isEqualTo(1);

        ResponseEntity<String> listed = rest.exchange(
                "/v1/projects/" + campaign.id() + "/backer-segments",
                HttpMethod.GET,
                new HttpEntity<>(bearer(campaign.accessToken())),
                String.class);
        assertThat(listed.getBody()).contains("Germany");

        ResponseEntity<Void> deleted = rest.exchange(
                "/v1/projects/" + campaign.id() + "/backer-segments/" + segmentId,
                HttpMethod.DELETE,
                new HttpEntity<>(bearer(campaign.accessToken())),
                Void.class);
        assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(backers(campaign, "?segment=" + segmentId).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("a second segment by the same name, in any case, is refused")
    void aDuplicateSegmentNameIsRefused() {
        Campaign campaign = liveCampaign();
        assertThat(saveSegment(campaign, Map.of("name", "Germany")).getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        ResponseEntity<Map<String, Object>> refused = saveSegment(campaign, Map.of("name", "  germany "));

        // The second one is somebody who forgot they made the first, and two
        // identical-looking rows is the worst outcome for a list you pick from.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "BACKER_SEGMENT_NAME_TAKEN");
    }

    @Test
    @DisplayName("another campaign's segment is not found rather than refused")
    void aForeignSegmentIsNotFound() {
        Campaign mine = liveCampaign();
        Campaign theirs = liveCampaign();
        UUID theirSegment = UUID.fromString(
                (String) saveSegment(theirs, Map.of("name", "Germany")).getBody().get("id"));

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/projects/" + mine.id() + "/backer-segments/" + theirSegment,
                HttpMethod.PUT,
                new HttpEntity<>(Map.of("name", "Mine now"), bearer(mine.accessToken())),
                OBJECT);

        // The caller is authorised on the campaign in the path and on nothing else, so
        // "that segment is real, but not yours" would confirm an identifier from somebody
        // else's dashboard.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "BACKER_SEGMENT_NOT_FOUND");
    }

    @Test
    @DisplayName("a replaced segment keeps its author and gains a new filter")
    void aReplacedSegmentKeepsItsAuthor() {
        Campaign campaign = liveCampaign();
        Map<String, Object> saved = saveSegment(
                        campaign, Map.of("name", "Germany", "filter", Map.of("countries", List.of("DE"))))
                .getBody();
        UUID segmentId = UUID.fromString((String) saved.get("id"));

        ResponseEntity<Map<String, Object>> replaced = rest.exchange(
                "/v1/projects/" + campaign.id() + "/backer-segments/" + segmentId,
                HttpMethod.PUT,
                new HttpEntity<>(
                        Map.of("name", "Collected", "filter", Map.of("states", List.of("COLLECTED"))),
                        bearer(campaign.accessToken())),
                OBJECT);

        assertThat(replaced.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replaced.getBody()).containsEntry("name", "Collected");
        assertThat(filterOf(replaced.getBody()).get("states")).isEqualTo(List.of("COLLECTED"));
        // The whole filter is replaced, never merged: the country axis is gone rather
        // than left behind because the new body did not mention it.
        assertThat(filterOf(replaced.getBody())).doesNotContainKey("countries");
        // An edit does not make the editor the author.
        assertThat(replaced.getBody()).containsEntry("createdBy", saved.get("createdBy"));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(EmailAddress email, String accessToken, UUID id) {
    }

    private record Campaign(UUID id, String accessToken, UUID creatorId) {
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                OBJECT);

        UUID id = jdbc().queryForObject("SELECT id FROM users WHERE email = ?", UUID.class, email.value());
        return new Account(email, (String) signedIn.getBody().get("accessToken"), id);
    }

    private Campaign liveCampaign() {
        Account creator = account("backer-report");
        UUID projectId = Campaigns.seed(dataSource, creator.id(), "backer-report-" + SEQUENCE.incrementAndGet())
                .state("LIVE")
                .insert();
        return new Campaign(projectId, creator.accessToken(), creator.id());
    }

    /**
     * A reward tier, inserted directly.
     *
     * <p>Through SQL rather than through the editor's endpoint, because what this suite is
     * about is the report and a tier created over HTTP would drag the whole reward
     * validation path into every one of these tests.
     */
    private UUID tier(Campaign campaign, String title, String price) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        """
                        INSERT INTO reward_tiers (id, project_id, title, amount, currency, sort_order)
                        VALUES (?, ?, ?, ?, 'AZN', 0)
                        """,
                        id,
                        campaign.id(),
                        title,
                        new BigDecimal(price));
        return id;
    }

    private UUID backer(Campaign campaign, String name, String amount, String country, String state, String at) {
        return backer(campaign, name, amount, country, state, at, null);
    }

    /** One pledge by one new account, in the state and at the instant given. */
    private UUID backer(
            Campaign campaign, String name, String amount, String country, String state, String at, UUID tier) {

        Account backer = account("backer-report-backer");
        jdbc().update("UPDATE users SET name = ? WHERE id = ?", name, backer.id());

        UUID pledgeId = Identifiers.newIdentifier();
        OffsetDateTime confirmed = Instant.parse(at).atOffset(ZoneOffset.UTC);
        jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, reward_tier_id, state, base_amount,
                                             currency, shipping_country, confirmed_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'AZN', ?, ?)
                        """,
                        pledgeId,
                        campaign.id(),
                        backer.id(),
                        tier,
                        state,
                        new BigDecimal(amount),
                        country,
                        confirmed);
        return pledgeId;
    }

    /** A reservation: the state the report exists to leave out. */
    private void draft(Campaign campaign, String name) {
        Account backer = account("backer-report-draft");
        jdbc().update("UPDATE users SET name = ? WHERE id = ?", name, backer.id());

        jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, currency,
                                             reservation_expires_at)
                        VALUES (?, ?, ?, 'DRAFT', 10.00, 'AZN', now() + interval '5 minutes')
                        """,
                        Identifiers.newIdentifier(),
                        campaign.id(),
                        backer.id());
    }

    private ResponseEntity<Map<String, Object>> backers(Campaign campaign, String query) {
        return rest.exchange(
                "/v1/projects/" + campaign.id() + "/backers" + query,
                HttpMethod.GET,
                new HttpEntity<>(bearer(campaign.accessToken())),
                OBJECT);
    }

    private long matchedIn(Campaign campaign, String query) {
        return ((Number) backers(campaign, query).getBody().get("matched")).longValue();
    }

    private ResponseEntity<Map<String, Object>> breakdown(Campaign campaign) {
        return rest.exchange(
                "/v1/projects/" + campaign.id() + "/backers/breakdown",
                HttpMethod.GET,
                new HttpEntity<>(bearer(campaign.accessToken())),
                OBJECT);
    }

    /** The export, read as a string: the body is a file rather than JSON. */
    private ResponseEntity<String> export(Campaign campaign, Object body) {
        return rest.exchange(
                "/v1/projects/" + campaign.id() + "/backers/export",
                HttpMethod.POST,
                new HttpEntity<>(body == null ? new LinkedHashMap<String, Object>() : body,
                        bearer(campaign.accessToken())),
                String.class);
    }

    private ResponseEntity<Map<String, Object>> saveSegment(Campaign campaign, Object body) {
        return rest.exchange(
                "/v1/projects/" + campaign.id() + "/backer-segments",
                HttpMethod.POST,
                new HttpEntity<>(body, bearer(campaign.accessToken())),
                OBJECT);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rowsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("backers");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOf(Map<String, Object> body, String field) {
        return (List<Map<String, Object>>) body.get(field);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> filterOf(Map<String, Object> segment) {
        return (Map<String, Object>) segment.get("filter");
    }

    /** The {@code amount} of a Money field, which crosses as a string per §10.3. */
    @SuppressWarnings("unchecked")
    private static String amountOf(Map<String, Object> body, String field) {
        return (String) ((Map<String, Object>) body.get(field)).get("amount");
    }

    private static String amountOf(Map<String, Object> body) {
        return amountOf(body, "amount");
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
