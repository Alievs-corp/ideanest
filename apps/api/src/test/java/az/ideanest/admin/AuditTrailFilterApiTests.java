package az.ideanest.admin;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import com.github.f4b6a3.uuid.UuidCreator;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
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
 * "What did this person do last Tuesday" — #404's date range on the audit trail.
 *
 * <h2>What was missing</h2>
 *
 * <p>The trail filtered by entity kind, by one entity, and by one actor. It had no date
 * range, on the argument that the order <em>is</em> the date — the identifier carries the
 * millisecond it was minted in (§7.3) — so "since Tuesday" was reading pages until the dates
 * stopped being interesting.
 *
 * <p>Both halves of that were wrong. The first is the ordering defect
 * {@link AuditTrailOrderingApiTests} covers: the key and {@code occurred_at} are written by
 * two different clocks, so the identifier does not stand in for the date at all. The second
 * is what an operator actually does with an audit log — the question the surface exists to
 * answer is about a person and a day, and answering it by paging through everything since is
 * not reading.
 *
 * <p>The range costs nothing to serve, which is why it is here and a filter on the action is
 * not: every one of V21's four indexes ends in {@code occurred_at DESC}, so a bound on that
 * column narrows the scan whichever shape the query had already chosen.
 *
 * <h2>The actor filter is tested here too, and had no control until #404</h2>
 *
 * <p>The service has accepted {@code actorId} since #314 and the screen offered no way to set
 * one, so the trail's central question was reachable only by editing the URL. The endpoint's
 * behaviour is asserted here; the control that reaches it is {@code AuditTrailView}'s.
 *
 * <h2>Rows are written through SQL, and none of them is cleaned up</h2>
 *
 * <p>{@code occurred_at} is {@code insertable = false} on the entity precisely so that no
 * caller can choose it, and V21 puts a trigger on the table that raises on DELETE and
 * TRUNCATE. So every row this suite writes is there for the rest of the run — they carry an
 * entity kind no production action uses, and every assertion filters to it.
 */
class AuditTrailFilterApiTests extends AbstractIntegrationTest {

    /** The address {@code application-test.yml} lists as staff. */
    private static final String STAFF_EMAIL = "moderator@ideanest.test";

    private static final String PASSWORD = "a-long-enough-password";

    /** An entity kind nothing on the platform writes. See the class note on cleanup. */
    private static final String PROBE = "range-probe";

    private static final String TRAIL = "/v1/admin/audit";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    // ------------------------------------------------------------------
    // The date range
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a lower bound leaves out everything older, and includes the instant itself")
    void theLowerBoundIsInclusive() {
        UUID subject = UUID.randomUUID();
        Instant boundary = Instant.now().truncatedTo(ChronoUnit.MILLIS).minus(7, ChronoUnit.DAYS);

        UUID older = write(subject, "probe.older", boundary.minus(1, ChronoUnit.SECONDS));
        UUID onTheBoundary = write(subject, "probe.boundary", boundary);
        UUID newer = write(subject, "probe.newer", boundary.plus(1, ChronoUnit.SECONDS));

        List<String> found = idsIn(trail(probe(subject) + "&from=" + boundary));

        // Inclusive, because a reader asking for Tuesday means from its midnight — and a
        // row stamped exactly at midnight belongs to the day that starts there.
        assertThat(found).containsExactly(newer.toString(), onTheBoundary.toString());
        assertThat(found).doesNotContain(older.toString());
    }

    @Test
    @DisplayName("an upper bound excludes the instant itself, so two adjacent days do not both claim midnight")
    void theUpperBoundIsExclusive() {
        UUID subject = UUID.randomUUID();
        Instant boundary = Instant.now().truncatedTo(ChronoUnit.MILLIS).minus(3, ChronoUnit.DAYS);

        UUID before = write(subject, "probe.before", boundary.minus(1, ChronoUnit.SECONDS));
        UUID onTheBoundary = write(subject, "probe.boundary", boundary);

        List<String> found = idsIn(trail(probe(subject) + "&to=" + boundary));

        // The property that makes "one day" expressible as [midnight, next midnight): a
        // caller who computes the second bound from a chosen day never has to think about
        // the boundary row, because it belongs to exactly one of the two windows.
        assertThat(found).containsExactly(before.toString());
        assertThat(found).doesNotContain(onTheBoundary.toString());
    }

    @Test
    @DisplayName("both bounds together are one day, and nothing outside it")
    void aDayIsThePairOfBounds() {
        UUID subject = UUID.randomUUID();
        Instant midnight = Instant.now().truncatedTo(ChronoUnit.DAYS).minus(10, ChronoUnit.DAYS);

        UUID theDayBefore = write(subject, "probe.day-before", midnight.minus(1, ChronoUnit.HOURS));
        UUID morning = write(subject, "probe.morning", midnight.plus(9, ChronoUnit.HOURS));
        UUID evening = write(subject, "probe.evening", midnight.plus(21, ChronoUnit.HOURS));
        UUID theDayAfter = write(subject, "probe.day-after", midnight.plus(25, ChronoUnit.HOURS));

        List<String> found = idsIn(
                trail(probe(subject) + "&from=" + midnight + "&to=" + midnight.plus(1, ChronoUnit.DAYS)));

        assertThat(found).containsExactly(evening.toString(), morning.toString());
        assertThat(found).doesNotContain(theDayBefore.toString(), theDayAfter.toString());
    }

    @Test
    @DisplayName("an inverted range matches nothing rather than being quietly turned round")
    void anInvertedRangeIsEmpty() {
        UUID subject = UUID.randomUUID();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        write(subject, "probe.one", now.minus(2, ChronoUnit.DAYS));

        // "Between Friday and Tuesday" is a question with no rows in it, and answering it
        // with the rows between Tuesday and Friday would be answering a different question
        // in a place where nobody would notice the substitution.
        assertThat(idsIn(trail(probe(subject) + "&from=" + now + "&to=" + now.minus(5, ChronoUnit.DAYS))))
                .isEmpty();
    }

    @Test
    @DisplayName("the range that was applied is echoed, so a client can tell which answer it holds")
    void theRangeIsEchoed() {
        UUID subject = UUID.randomUUID();
        Instant from = Instant.now().truncatedTo(ChronoUnit.DAYS).minus(4, ChronoUnit.DAYS);
        Instant to = from.plus(1, ChronoUnit.DAYS);

        Map<String, Object> body = trail(probe(subject) + "&from=" + from + "&to=" + to);

        assertThat(Instant.parse((String) body.get("from"))).isEqualTo(from);
        assertThat(Instant.parse((String) body.get("to"))).isEqualTo(to);
    }

    @Test
    @DisplayName("an unbounded read echoes no range rather than inventing one")
    void anUnboundedReadEchoesNothing() {
        Map<String, Object> body = trail(probe(UUID.randomUUID()));

        assertThat(body.get("from")).isNull();
        assertThat(body.get("to")).isNull();
    }

    @Test
    @DisplayName("a bound that is not an instant is a bad request rather than an unbounded page")
    void aMalformedBoundIsRefused() {
        ResponseEntity<Map<String, Object>> refused = get(TRAIL + "?from=last-tuesday", staffToken());

        // Ignoring it would hand back the whole trail under a heading that says "since
        // Tuesday", which on this surface is the same class of defect as the ordering one.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("the range survives paging, so page two is not the whole trail")
    void pagingCarriesTheRange() {
        UUID subject = UUID.randomUUID();
        Instant midnight = Instant.now().truncatedTo(ChronoUnit.DAYS).minus(20, ChronoUnit.DAYS);

        UUID outside = write(subject, "probe.outside", midnight.minus(1, ChronoUnit.HOURS));
        UUID first = write(subject, "probe.first", midnight.plus(1, ChronoUnit.HOURS));
        UUID second = write(subject, "probe.second", midnight.plus(2, ChronoUnit.HOURS));
        UUID third = write(subject, "probe.third", midnight.plus(3, ChronoUnit.HOURS));

        String window = probe(subject) + "&from=" + midnight + "&to=" + midnight.plus(1, ChronoUnit.DAYS);

        Map<String, Object> page = trail(window + "&limit=2");
        assertThat(idsIn(page)).containsExactly(third.toString(), second.toString());

        Map<String, Object> next = trail(window + "&limit=2&after=" + page.get("nextCursor"));
        assertThat(idsIn(next)).containsExactly(first.toString());
        assertThat(idsIn(next)).doesNotContain(outside.toString());
    }

    // ------------------------------------------------------------------
    // The actor filter, which had no control until #404
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an actor filter answers what one account did, and nobody else")
    void anActorFilterNarrowsToOneAccount() {
        UUID subject = UUID.randomUUID();
        UUID actor = UUID.randomUUID();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        UUID theirs = writeBy(subject, actor, "probe.theirs", now.minus(1, ChronoUnit.MINUTES));
        UUID somebodyElses = writeBy(subject, UUID.randomUUID(), "probe.other", now.minus(2, ChronoUnit.MINUTES));

        List<String> found = idsIn(trail("?actorId=" + actor));

        assertThat(found).contains(theirs.toString());
        assertThat(found).doesNotContain(somebodyElses.toString());
    }

    @Test
    @DisplayName("an actor and a range together are the question the screen exists to ask")
    void anActorAndARangeCombine() {
        UUID subject = UUID.randomUUID();
        UUID actor = UUID.randomUUID();
        Instant midnight = Instant.now().truncatedTo(ChronoUnit.DAYS).minus(30, ChronoUnit.DAYS);

        UUID onTheDay = writeBy(subject, actor, "probe.on-the-day", midnight.plus(11, ChronoUnit.HOURS));
        UUID anotherDay = writeBy(subject, actor, "probe.another-day", midnight.minus(11, ChronoUnit.HOURS));

        // "What did this person do last Tuesday", literally. The range is the trailing
        // column of the actor index, so this is one scan and not two.
        List<String> found = idsIn(
                trail("?actorId=" + actor + "&from=" + midnight + "&to=" + midnight.plus(1, ChronoUnit.DAYS)));

        assertThat(found).containsExactly(onTheDay.toString());
        assertThat(found).doesNotContain(anotherDay.toString());
    }

    @Test
    @DisplayName("an actor and a kind combine: what this person did to this kind of thing")
    void anActorAndAKindCombine() {
        UUID actor = UUID.randomUUID();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        UUID theirsOfTheKind = writeRow(UUID.randomUUID(), actor, "probe.kind", PROBE, now.minus(1, ChronoUnit.MINUTES));
        UUID theirsOfAnother = writeRow(UUID.randomUUID(), actor, "probe.kind", PROBE + "-other", now.minus(2, ChronoUnit.MINUTES));
        UUID somebodyElses = writeRow(UUID.randomUUID(), UUID.randomUUID(), "probe.kind", PROBE, now.minus(3, ChronoUnit.MINUTES));

        Map<String, Object> body = trail("?entityType=" + PROBE + "&actorId=" + actor);

        // The actor used to be dropped whenever a kind was set, and the page answered "what has
        // anybody done to this kind" under a filter that still named the person.
        assertThat(idsIn(body)).containsExactly(theirsOfTheKind.toString());
        assertThat(idsIn(body)).doesNotContain(theirsOfAnother.toString(), somebodyElses.toString());
        assertThat(body).containsEntry("actorId", actor.toString());
        assertThat(body).containsEntry("entityType", PROBE);
    }

    @Test
    @DisplayName("an actor and one entity combine too, and page together")
    void anActorAndAnEntityCombineAndPage() {
        UUID subject = UUID.randomUUID();
        UUID actor = UUID.randomUUID();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        UUID newer = writeBy(subject, actor, "probe.newer", now.minus(1, ChronoUnit.MINUTES));
        writeBy(subject, UUID.randomUUID(), "probe.other", now.minus(2, ChronoUnit.MINUTES));
        UUID older = writeBy(subject, actor, "probe.older", now.minus(3, ChronoUnit.MINUTES));

        Map<String, Object> first = trail(probe(subject) + "&actorId=" + actor + "&limit=1");
        assertThat(idsIn(first)).containsExactly(newer.toString());

        Map<String, Object> second = trail(probe(subject) + "&actorId=" + actor + "&limit=1&after=" + first.get("nextCursor"));
        assertThat(idsIn(second)).containsExactly(older.toString());
        assertThat(second).doesNotContainKey("nextCursor");
    }

    @Test
    @DisplayName("hiding reads leaves out the routine screen reads and keeps everything else, including a look at somebody's record")
    void hidingReadsKeepsWritesAndPrivateLooks() {
        UUID actor = UUID.randomUUID();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);

        UUID trailRead = writeBy(UUID.randomUUID(), actor, "audit.trail_read", now.minus(1, ChronoUnit.MINUTES));
        UUID dashboardRead = writeBy(UUID.randomUUID(), actor, "dashboard.read", now.minus(2, ChronoUnit.MINUTES));
        UUID analyticsRead = writeBy(UUID.randomUUID(), actor, "analytics.read", now.minus(3, ChronoUnit.MINUTES));
        UUID documentRead = writeBy(UUID.randomUUID(), actor, "identity.document_read", now.minus(4, ChronoUnit.MINUTES));
        UUID approval = writeBy(UUID.randomUUID(), actor, "project.approved", now.minus(5, ChronoUnit.MINUTES));

        Map<String, Object> hidden = trail("?actorId=" + actor + "&hideReads=true");
        assertThat(idsIn(hidden)).containsExactly(documentRead.toString(), approval.toString());
        assertThat(hidden).containsEntry("hideReads", true);

        Map<String, Object> everything = trail("?actorId=" + actor);
        assertThat(idsIn(everything))
                .containsExactly(
                        trailRead.toString(),
                        dashboardRead.toString(),
                        analyticsRead.toString(),
                        documentRead.toString(),
                        approval.toString());
        assertThat(everything).containsEntry("hideReads", false);
    }

    @Test
    @DisplayName("a last page that is exactly full says it is the last, rather than sending the reader to an empty one")
    void anExactlyFullLastPageHasNoCursor() {
        UUID subject = UUID.randomUUID();
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        write(subject, "probe.one", now.minus(2, ChronoUnit.MINUTES));
        write(subject, "probe.two", now.minus(1, ChronoUnit.MINUTES));

        Map<String, Object> page = trail(probe(subject) + "&limit=2");

        assertThat(idsIn(page)).hasSize(2);
        assertThat(page).doesNotContainKey("nextCursor");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** The two filter parameters that keep this suite's rows out of everybody else's way. */
    private static String probe(UUID subject) {
        return "?entityType=" + PROBE + "&entityId=" + subject;
    }

    private UUID write(UUID entityId, String action, Instant occurredAt) {
        return writeRow(entityId, null, action, occurredAt);
    }

    private UUID writeBy(UUID entityId, UUID actorId, String action, Instant occurredAt) {
        return writeRow(entityId, actorId, action, occurredAt);
    }

    /**
     * One audit row, with both clocks set by hand.
     *
     * <p>Through SQL because {@code occurred_at} is {@code insertable = false}: the entity
     * cannot express a row whose timestamp was chosen, which is the rule that makes the
     * column trustworthy and also the reason this suite cannot go through it.
     */
    private UUID writeRow(UUID entityId, UUID actorId, String action, Instant occurredAt) {
        return writeRow(entityId, actorId, action, PROBE, occurredAt);
    }

    private UUID writeRow(UUID entityId, UUID actorId, String action, String entityType, Instant occurredAt) {
        UUID id = UuidCreator.getTimeOrderedEpoch();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO audit_logs
                            (id, occurred_at, actor_type, actor_id, action, entity_type, entity_id, outcome)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED')
                        """,
                        id,
                        java.sql.Timestamp.from(occurredAt),
                        actorId == null ? "SYSTEM" : "MODERATOR",
                        actorId,
                        action,
                        entityType,
                        entityId);
        return id;
    }

    private Map<String, Object> trail(String query) {
        ResponseEntity<Map<String, Object>> response = get(TRAIL + query, staffToken());
        assertThat(response.getStatusCode())
                .as("reading the trail: %s", response.getBody())
                .isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    @SuppressWarnings("unchecked")
    private static List<String> idsIn(Map<String, Object> body) {
        return ((List<Map<String, Object>>) body.get("entries"))
                .stream().map(row -> (String) row.get("id")).toList();
    }

    /**
     * A minted token rather than a sign-in.
     *
     * <p>A dozen suites share this address and {@code sign-ins-per-email} is left at its real
     * value of five, so signing in here spends one of those five and fails somebody else's
     * suite with a 401 that has nothing to do with them.
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
