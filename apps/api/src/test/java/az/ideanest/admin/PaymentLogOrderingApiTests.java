package az.ideanest.admin;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Ledgers;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
import com.github.f4b6a3.uuid.UuidCreator;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
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
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The payment log is ordered by the column it displays — issue #412.
 *
 * <h2>What was wrong</h2>
 *
 * <p>{@code /admin/payments} describes itself as newest first, and AD-05 on the console index
 * says the same. It was ordered by {@code id}, on the argument that a UUID v7 carries the
 * millisecond it was minted in (§7.3), so the key and {@code created_at} say the same thing and
 * only one of them is unique.
 *
 * <p>They are written by two different clocks. The identifier is minted in the application when
 * {@code PaymentTransaction} builds the row; {@code created_at} is {@code DEFAULT now()} (V41)
 * and is the database's, taken when the insert lands. A charge that mints its key before a
 * provider call and commits after it, two instances whose clocks differ, and anything migrated
 * in with a key from elsewhere all put the two orders out of step — and {@code PaymentLogView}
 * renders the timestamp while the query ordered by the key.
 *
 * <p>#404 found the same defect on {@code audit_logs} and
 * {@link AuditTrailOrderingApiTests} is what pinned it there. This suite is that one applied to
 * the console surface that is entirely money, where it costs more: the rows are retry attempts
 * against somebody's card and <strong>the order is the evidence</strong>. §9.6 permits four
 * collection attempts, and "declined, declined, collected" read in the wrong order is a
 * different story about the same pledge.
 *
 * <h2>How this suite reproduces it</h2>
 *
 * <p>By writing rows the way the two clocks disagree: inserts whose {@code created_at} runs
 * backwards while their identifiers run forwards. Every row goes in through SQL, because
 * {@code created_at} is {@code insertable = false} on the entity precisely so that no caller
 * can choose it — which is the right rule and makes the disagreement unreachable through the
 * application.
 *
 * <p><strong>The rows are cleaned up, and the teardown is not optional.</strong> V41 puts a
 * trigger on {@code transactions} that raises on UPDATE and DELETE, so an ordinary
 * {@code DELETE} will not do it — {@code Ledgers.clear} turns the trigger off for the length
 * of the delete and back on in a {@code finally}, and {@code ConsoleReadApiTests} does the
 * same thing beside this file for the same reason. This is the half where
 * {@link AuditTrailOrderingApiTests} genuinely cannot follow: its table refuses DELETE and
 * TRUNCATE with no trigger to disable, so it leaves its rows and hides them behind an invented
 * entity kind.
 *
 * <p>Leaving them here would not be untidy, it would break somebody else's suite. A campaign
 * cannot be deleted while a transaction references it, and a member of staff cannot be deleted
 * while a campaign references them — {@code projects_creator_id_fkey} is
 * {@code ON DELETE NO ACTION} — so three rows left behind by this file make
 * {@code DELETE FROM users} fail in {@code IdentitySchemaTests}, which has nothing to do with
 * payments and no way to find out why.
 *
 * <p>Each test still writes against a campaign of its own and every assertion reads
 * {@code ?projectId=}, which is belt and braces rather than redundancy: it keeps a test honest
 * about which rows it is asserting on even while the whole table is its own.
 */
class PaymentLogOrderingApiTests extends AbstractIntegrationTest {

    /** The address {@code application-test.yml} lists as staff. */
    private static final String STAFF_EMAIL = "moderator@ideanest.test";

    private static final String PASSWORD = "a-long-enough-password";

    private static final String LOG = "/v1/admin/payments";

    /** Keeps two campaigns in one run from colliding on a handle. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    /**
     * The money, gone, before the next test and before the next suite.
     *
     * <p>{@code Ledgers.clear} is what makes that possible on an append-only table, and it
     * carries the argument for why turning the triggers off in teardown weakens nothing this
     * suite asserts. {@code Campaigns.clear} then has projects it is allowed to delete, which is
     * what keeps this file out of {@code IdentitySchemaTests}' way.
     */
    @AfterEach
    void clearTheMoney() {
        Ledgers.clear(dataSource);
        Campaigns.clear(dataSource);
    }

    @Test
    @DisplayName("rows come back by when the provider was called, not by the order their keys were minted")
    void theLogIsOrderedByTheTimestampItDisplays() {
        Fixture fixture = campaignWithPledge("ordering-displayed");
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        // Minted in ascending key order and stamped in descending time order, which is exactly
        // the disagreement the old ordering could not see.
        UUID oldest = charge(fixture, "FAILED", 1, now.minus(30, ChronoUnit.DAYS));
        UUID middle = charge(fixture, "FAILED", 2, now.minus(7, ChronoUnit.DAYS));
        UUID newest = charge(fixture, "SUCCEEDED", 3, now.minus(1, ChronoUnit.MINUTES));

        List<Map<String, Object>> rows = rowsOf(log("?projectId=" + fixture.projectId()));

        assertThat(rows.stream().map(row -> row.get("id")).toList())
                .as("newest first, by createdAt")
                .containsExactly(newest.toString(), middle.toString(), oldest.toString());
    }

    @Test
    @DisplayName("what the page says and what it is ordered by are the same fact")
    void theRenderedTimestampsDescend() {
        Fixture fixture = campaignWithPledge("ordering-rendered");
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        charge(fixture, "FAILED", 1, now.minus(30, ChronoUnit.DAYS));
        charge(fixture, "FAILED", 2, now.minus(7, ChronoUnit.DAYS));
        charge(fixture, "SUCCEEDED", 3, now.minus(1, ChronoUnit.MINUTES));

        List<Instant> shown = rowsOf(log("?projectId=" + fixture.projectId())).stream()
                .map(row -> Instant.parse((String) row.get("createdAt")))
                .toList();

        // The assertion the screen's own heading makes.
        assertThat(shown).isSortedAccordingTo((left, right) -> right.compareTo(left));
    }

    @Test
    @DisplayName("the outcome filter is ordered the same way as the page it narrows")
    void theOutcomeFilterIsOrderedByTimeToo() {
        Fixture fixture = campaignWithPledge("ordering-outcome");
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        // Failures either side of a success, so a log ordered by the key would put the older
        // refusal first -- which is the reading "why was this card refused" is made from.
        UUID older = charge(fixture, "FAILED", 1, now.minus(2, ChronoUnit.HOURS));
        charge(fixture, "SUCCEEDED", 2, now.minus(90, ChronoUnit.MINUTES));
        UUID newer = charge(fixture, "FAILED", 3, now.minus(1, ChronoUnit.HOURS));

        List<Map<String, Object>> failures =
                rowsOf(log("?projectId=" + fixture.projectId() + "&status=FAILED"));

        assertThat(failures.stream().map(row -> row.get("id")).toList())
                .containsExactly(newer.toString(), older.toString());
    }

    @Test
    @DisplayName("paging continues where the page ended rather than repeating or skipping")
    void pagingWalksTheLogInTheSameOrder() {
        Fixture fixture = campaignWithPledge("ordering-paging");
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        UUID oldest = charge(fixture, "FAILED", 1, now.minus(30, ChronoUnit.DAYS));
        UUID middle = charge(fixture, "FAILED", 2, now.minus(7, ChronoUnit.DAYS));
        UUID newest = charge(fixture, "SUCCEEDED", 3, now.minus(1, ChronoUnit.MINUTES));

        Map<String, Object> first = log("?projectId=" + fixture.projectId() + "&limit=2");
        assertThat(rowsOf(first).stream().map(row -> row.get("id")).toList())
                .containsExactly(newest.toString(), middle.toString());
        assertThat(first.get("nextCursor")).as("a full page may have more behind it").isNotNull();

        Map<String, Object> second =
                log("?projectId=" + fixture.projectId() + "&limit=2&after=" + first.get("nextCursor"));
        assertThat(rowsOf(second).stream().map(row -> row.get("id")).toList())
                .containsExactly(oldest.toString());
        assertThat(second.get("nextCursor")).as("a short page is the end").isNull();
    }

    @Test
    @DisplayName("four attempts inside one second are each served exactly once")
    void tiedTimestampsAreBrokenByTheIdentifier() {
        Fixture fixture = campaignWithPledge("ordering-tied");

        /*
         * §9.6 permits four collection attempts, and a retry loop that runs them back to back
         * puts all four inside one `now()`. That makes the tie the ordinary case on this
         * surface rather than the edge one, which is why the cursor is a pair: an instant-only
         * cursor either repeats a row or drops it, depending on which side of the boundary the
         * page ended.
         */
        Instant tied = Instant.now().truncatedTo(ChronoUnit.MILLIS).minus(2, ChronoUnit.MINUTES);
        List<UUID> attempts = new ArrayList<>();
        for (int attempt = 1; attempt <= 4; attempt++) {
            attempts.add(charge(fixture, "FAILED", attempt, tied));
        }

        List<String> seen = new ArrayList<>();
        String cursor = null;
        for (int page = 0; page < 4; page++) {
            String query = "?projectId=" + fixture.projectId() + "&limit=1" + (cursor == null ? "" : "&after=" + cursor);
            Map<String, Object> body = log(query);
            seen.addAll(rowsOf(body).stream().map(row -> (String) row.get("id")).toList());
            cursor = (String) body.get("nextCursor");
        }

        assertThat(seen)
                .as("all four, each exactly once")
                .containsExactlyInAnyOrderElementsOf(attempts.stream().map(UUID::toString).toList());
    }

    @Test
    @DisplayName("a cursor this endpoint did not produce is refused rather than silently restarted")
    void aCorruptCursorIsABadRequest() {
        ResponseEntity<Map<String, Object>> refused = get(LOG + "?after=not-a-cursor", staffToken());

        // Serving the first page would make a client that is paging wrongly look like one that
        // has finished, and hand an operator reconciling a collection run the top of the log in
        // place of the attempts they had not read.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "INVALID_CURSOR");
    }

    @Test
    @DisplayName("a bare identifier is no longer a cursor, because the identifier is no longer the order")
    void theOldCursorShapeIsRefused() {
        /*
         * The previous cursor was the last row's `id` and `openapi.json` documented it as a
         * `uuid`. Refusing it is the point rather than a side effect: a client still sending one
         * is a client paging by a key that no longer decides the order, and the honest answer is
         * that its cursor is not one this endpoint produces.
         */
        ResponseEntity<Map<String, Object>> refused =
                get(LOG + "?after=" + UUID.randomUUID(), staffToken());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "INVALID_CURSOR");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A campaign and a pledge on it, which is everything a transaction needs to reference. */
    private record Fixture(UUID projectId, UUID pledgeId) {
    }

    private Fixture campaignWithPledge(String handle) {
        String unique = handle + SEQUENCE.incrementAndGet();
        UUID creatorId = Campaigns.creator(dataSource, unique);
        UUID projectId = Campaigns.seed(dataSource, creatorId, unique)
                .state("COLLECTING")
                .goal("100.00")
                .insert();
        return new Fixture(projectId, Pledges.confirmed(dataSource, projectId, unique + "-backer", "100.00"));
    }

    /**
     * One row in {@code transactions}, with both clocks set by hand.
     *
     * <p>Through SQL because {@code created_at} is {@code insertable = false}: the entity cannot
     * express a row whose timestamp disagrees with its key, which is the rule that makes the
     * column trustworthy and also the reason this test cannot go through it.
     *
     * <p>The identifier is a UUID v7 rather than a version 4, and that is not incidental. A
     * fixture using {@link UUID#randomUUID()} would order at random, which would make a log
     * still sorted by the key <em>fail</em> for the wrong reason — it has to be minted in
     * ascending order for "the keys ascend while the clock descends" to be the thing under test.
     *
     * @return the identifier, minted here so the caller can assert on the order
     */
    private UUID charge(Fixture fixture, String status, int attempt, Instant createdAt) {
        UUID id = UuidCreator.getTimeOrderedEpoch();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency,
                                                  provider, provider_transaction_id, failure_code,
                                                  attempt_number, idempotency_key, created_at)
                        VALUES (?, ?, ?, 'CHARGE', ?, CAST('10.00' AS numeric), 'AZN', 'AZERICARD', ?, ?, ?, ?, ?)
                        """,
                        id,
                        fixture.pledgeId(),
                        fixture.projectId(),
                        status,
                        "prov-" + id,
                        // `transactions_failure_belongs_to_a_failure` and `..._failures_say_why`
                        // between them make the code present exactly when the status is FAILED.
                        "FAILED".equals(status) ? "do_not_honour" : null,
                        attempt,
                        "ordering-test-" + id,
                        java.sql.Timestamp.from(createdAt));
        return id;
    }

    private Map<String, Object> log(String query) {
        ResponseEntity<Map<String, Object>> response = get(LOG + query, staffToken());
        assertThat(response.getStatusCode())
                .as("reading the log: %s", response.getBody())
                .isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rowsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("transactions");
    }

    /**
     * A minted token rather than a sign-in.
     *
     * <p>A dozen suites share this address and {@code sign-ins-per-email} is left at its real
     * value of five, so signing in here spends one of those five and fails somebody else's suite
     * with a 401 that has nothing to do with them.
     */
    private String staffToken() {
        EmailAddress email = EmailAddress.of(STAFF_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();

        return tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);

        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }
}
