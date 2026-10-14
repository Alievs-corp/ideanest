package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.pledge.application.DraftPledge;
import az.ideanest.pledge.application.PledgePayments;
import az.ideanest.pledge.application.PledgeService;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.money.Money;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.Campaigns;
import java.math.BigDecimal;
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
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * The producer half of {@code pledge.confirmed} (#235): what paying for a pledge
 * announces, and when it does not.
 *
 * <p>Since #45 the producer is {@code PledgePayments#recordPaid} — the provider saying the
 * backer paid, IDN-EXT-01's {@code DRAFT → COLLECTED}. Until then it was the stored-card
 * model's {@code confirm}, which moved a draft to {@code CONFIRMED} with nothing charged;
 * the contract these tests hold the event to did not change with the producer.
 *
 * <p><strong>Against the real {@code Outbox} and the real database.</strong> Nothing
 * here is mocked, because every property being checked is a property of a transaction
 * — that the event and the state change commit together, and that they roll back
 * together — and a mock cannot have one.
 *
 * <p>The ones that carry the issue:
 *
 * <ul>
 *   <li>{@link #theEventRollsBackWithThePledge()} is the whole point of the outbox. It
 *       is the assertion that fails under every implementation that records the event
 *       beside the transaction rather than inside it, including the two that look
 *       correct: publishing after the commit and publishing before it.
 *   <li>{@link #aRedeliveredPaymentAnnouncesNothing()} is the way one payment arrives
 *       twice — the provider delivering its callback again. It may not produce a second
 *       event: the recording sits on the path that transitions, not the one that finds
 *       the pledge already collected.
 *   <li>{@link #theTotalCrossesAsAStringObjectAndNeverANumber()} — money over a JSON
 *       boundary, which {@code CLAUDE.md} §3 makes not optional to test. Asserted
 *       against the committed bytes, because the bytes are what a consumer receives.
 * </ul>
 *
 * <p><strong>Nothing here imports {@code az.ideanest.analytics}.</strong> The consumer
 * declares its own record of the same six fields and the two do not see each other, so
 * a test that reached across would be quietly holding the two modules together with a
 * Java type instead of with the JSON they actually share. {@link ConsumerShape} below
 * mirrors the consumer's declaration instead.
 *
 * <p><strong>And the field names are asserted literally, because nothing else asserts
 * them.</strong> {@code ModuleBoundaryTests} checks that no module reaches into
 * another's {@code domain} or {@code infrastructure} and that the modules are acyclic;
 * neither rule has anything to say about two records in two modules agreeing on six
 * names. A rename would compile on both sides and pass every structural assertion here
 * — {@link ConsumerShape} would have been renamed with it — and break every consumer in
 * production. {@link #thePayloadCarriesExactlyTheAgreedFieldNames()} is the only thing
 * standing in front of that.
 */
class PledgeConfirmedEventTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts and campaigns these tests create; see {@code PledgeSchemaTests}. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    /** What the tier costs, and therefore what the pledge is worth. */
    private static final String PRICE = "45.00";

    @Autowired
    private PledgeService pledges;

    @Autowired
    private PledgePayments payments;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private PlatformTransactionManager transactions;

    private JdbcTemplate jdbc;

    private UUID projectId;
    private UUID rewardTierId;
    private Account backer;

    @BeforeEach
    void aLiveCampaignAndABackerWhoCanReachIt() {
        String handle = "pledge-event-" + SEQUENCE.incrementAndGet();
        UUID creatorId = Campaigns.creator(dataSource, handle);
        projectId = Campaigns.seed(dataSource, creatorId, handle).state("LIVE").insert();
        rewardTierId = insertTier(projectId);

        // Registered before the clock is frozen: signing in mints a token whose window
        // is measured against the same clock, and a suite that froze it first would be
        // asserting about the event while depending on the auth module's timing.
        backer = account();

        // Frozen so that "the instant of the transition" is a value this test holds
        // rather than one it has to accept whatever it turns out to be.
        clock.freeze();
    }

    @AfterEach
    void clearCheckoutsAndTheOutbox() {
        // In dependency order rather than by cascade, because this is the cleanup and
        // not the assertion -- PledgeSchemaTests is where the cascades are checked.
        // outbox_events first and unconditionally: it has no foreign key to anything on
        // purpose (V19), so nothing else removes it, and OutboxTests counts every row.
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM pledge_addons");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM idempotency_keys");
        jdbc().update("DELETE FROM reward_tiers WHERE project_id = ?", projectId);
        jdbc().update("DELETE FROM projects WHERE id = ?", projectId);
        // The clock is a bean the whole suite shares. A test that froze it and did not
        // let it go would stop every session, token, and reservation after it.
        clock.reset();
    }

    // -----------------------------------------------------------------------
    // What is recorded
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("paying records exactly one pledge.confirmed against the pledge")
    void payingRecordsOnePledgeConfirmedEvent() {
        UUID pledgeId = draft(null);

        pay(pledgeId);

        List<Map<String, Object>> events = eventsFor(pledgeId);
        assertThat(events).hasSize(1);
        // The ordering key of §8.3, which is what makes events about one pledge arrive
        // in the order they happened and events about different pledges independent.
        assertThat(events.get(0).get("aggregate_type")).isEqualTo("pledge");
        assertThat(events.get(0).get("event_type")).isEqualTo("pledge.confirmed");
        assertThat(events.get(0).get("aggregate_id")).isEqualTo(pledgeId);
        // Recorded, not published: the relay's schedule is `-` in the test profile, and
        // a producer's job ends at the committed row.
        assertThat(events.get(0).get("state")).isEqualTo("PENDING");
    }

    @Test
    @DisplayName("the payload deserialises into the shape the consumer reads, with the right values")
    void thePayloadCarriesWhatTheConsumerNeeds() {
        UUID pledgeId = draft("aB7-xY9_Qz");
        Instant confirmedAt = now();

        pay(pledgeId);

        ConsumerShape event = json.readValue(payloadOf(pledgeId), ConsumerShape.class);
        assertThat(event.pledgeId()).isEqualTo(pledgeId);
        assertThat(event.projectId()).isEqualTo(projectId);
        assertThat(event.backerId()).isEqualTo(backer.id());
        assertThat(event.total()).isEqualTo(Money.of(new BigDecimal(PRICE), "AZN"));
        // §4.5's checkout accepts it, and it is the fallback attribution uses when a
        // backer followed a link on a device that never reached the capture endpoint.
        assertThat(event.referrerCode()).isEqualTo("aB7-xY9_Qz");

        // The instant of the transition, from the injected Clock -- and the same one the
        // row records. A consumer applying a rule as of "now" would produce a different
        // answer for an event delivered late, which is why it travels on the event.
        assertThat(event.confirmedAt()).isEqualTo(confirmedAt);
        assertThat(event.confirmedAt()).isEqualTo(confirmedAtOf(pledgeId));
    }

    @Test
    @DisplayName("the payload carries those six field names and nothing else")
    void thePayloadCarriesExactlyTheAgreedFieldNames() {
        // The contract between two modules that may not share a Java type is the JSON,
        // so the names are asserted as names. Renaming one compiles, passes every other
        // test here, and silently stops every consumer from reading it.
        UUID pledgeId = draft("aB7-xY9_Qz");

        pay(pledgeId);

        assertThat(parse(payloadOf(pledgeId)))
                .containsOnlyKeys("pledgeId", "projectId", "backerId", "total", "referrerCode", "confirmedAt");
    }

    @Test
    @DisplayName("a pledge that carries no referrer code omits the field rather than sending a null")
    void aPledgeWithoutAReferrerCodeOmitsIt() {
        // `default-property-inclusion: non_null`, which is the whole API's convention
        // and applies here too. The consumer ignores unknown properties and reads an
        // absent one as null, so absence and null are the same fact -- but which of the
        // two crosses the wire is part of the shape, and it is pinned here rather than
        // discovered by a consumer that refused the message.
        UUID pledgeId = draft(null);

        pay(pledgeId);

        assertThat(parse(payloadOf(pledgeId))).doesNotContainKey("referrerCode");
        assertThat(json.readValue(payloadOf(pledgeId), ConsumerShape.class).referrerCode())
                .isNull();
    }

    // -----------------------------------------------------------------------
    // The money
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the total crosses as a string object and never as a JSON number")
    void theTotalCrossesAsAStringObjectAndNeverANumber() {
        UUID pledgeId = draft(null);

        pay(pledgeId);

        // Asserted against the committed bytes rather than against a parsed object: a
        // JSON number is an IEEE 754 double in every mainstream parser, and a payload
        // that had been serialised as one would still deserialise into a Money here.
        String payload = payloadOf(pledgeId);
        assertThat(payload).contains("\"total\":{\"amount\":\"45.00\",\"currency\":\"AZN\"}");

        // And through the parser, which is what tells a string from a number.
        assertThat(amountIn(parse(payload))).isInstanceOf(String.class).isEqualTo("45.00");
    }

    // -----------------------------------------------------------------------
    // Paid twice
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a redelivered payment finds the pledge collected and announces nothing")
    void aRedeliveredPaymentAnnouncesNothing() {
        // A provider delivers its callback again, or the sweep asks about a page whose
        // callback did arrive. The recording has to sit after the check that finds the
        // pledge already collected, on the path that actually transitions.
        UUID pledgeId = draft(null);
        pay(pledgeId);

        pay(pledgeId);

        assertThat(eventCountFor(pledgeId)).isEqualTo(1);
        assertThat(stateOf(pledgeId)).isEqualTo("COLLECTED");
    }

    // -----------------------------------------------------------------------
    // The transaction
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the event rolls back with the pledge when the transaction fails")
    void theEventRollsBackWithThePledge() {
        UUID pledgeId = draft(null);

        // Something after the transition fails, which is the case the outbox exists
        // for: a message sent for a pledge that then rolled back is unsendable once
        // sent, and a message sent only after the commit is lost when the process dies
        // in between. Recorded in the transaction, it is neither.
        assertThatThrownBy(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                    payments.recordPaid(pledgeId, now());
                    throw new IllegalStateException("Something after the transition failed");
                }))
                .isInstanceOf(IllegalStateException.class);

        assertThat(eventCountFor(pledgeId)).isZero();
        assertThat(stateOf(pledgeId)).isEqualTo("DRAFT");
        // And the place went back with them, which is what says the whole transaction
        // rolled back rather than the outbox row alone.
        assertThat(reservedQuantity(rewardTierId)).isEqualTo(1);
        assertThat(claimedQuantity(rewardTierId)).isZero();
    }

    // -----------------------------------------------------------------------
    // The shape the consumer reads
    // -----------------------------------------------------------------------

    /**
     * The consumer's declaration, mirrored rather than imported.
     *
     * <p>{@code az.ideanest.analytics.application.PledgeConfirmed} declares these six
     * components, and this test may not name it — see the class comment. What makes the
     * mirror worth having anyway is that it is deserialised by the application's own
     * {@code ObjectMapper}: a {@code total} serialised as a JSON number, or a
     * {@code confirmedAt} in a format nothing can parse, fails here exactly as it would
     * fail in the consumer.
     */
    record ConsumerShape(
            UUID pledgeId,
            UUID projectId,
            UUID backerId,
            Money total,
            String referrerCode,
            Instant confirmedAt) {
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Account(String accessToken, UUID id) {
    }

    private Account account() {
        String marker = "pledge-event-backer-" + SEQUENCE.incrementAndGet();
        String email = marker + "@example.com";

        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email, "password", PASSWORD, "name", "Test backer"),
                String.class);

        Map<String, Object> signedIn = parse(rest.exchange(
                        "/v1/auth/login",
                        HttpMethod.POST,
                        new HttpEntity<>(
                                Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                        String.class)
                .getBody());

        UUID id = jdbc().queryForObject("SELECT id FROM users WHERE email = ?::citext", UUID.class, email);
        return new Account((String) signedIn.get("accessToken"), id);
    }

    /** One limited reward tier, so that the rollback test has a place to watch go back. */
    private UUID insertTier(UUID projectId) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        """
                        INSERT INTO reward_tiers (id, project_id, title, amount, limit_quantity)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        id,
                        projectId,
                        "A boxed set",
                        new BigDecimal(PRICE),
                        3);
        return id;
    }

    /** A draft holding the tier's place, priced at exactly the tier. */
    private UUID draft(String referrerCode) {
        return pledges.draft(new DraftPledge(
                        projectId,
                        backer.id(),
                        rewardTierId,
                        List.of(),
                        Money.of(new BigDecimal(PRICE), "AZN"),
                        null,
                        false,
                        referrerCode,
                        Identifiers.newIdentifier().toString()))
                .pledge()
                .getId();
    }

    /**
     * The provider's word that the backer paid, as {@code HostedChargeEvents} passes it on: in a
     * transaction of its own, because {@code recordPaid} runs only inside the caller's.
     */
    private void pay(UUID pledgeId) {
        new TransactionTemplate(transactions).executeWithoutResult(status -> payments.recordPaid(pledgeId, now()));
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    // -----------------------------------------------------------------------
    // Reading the rows
    // -----------------------------------------------------------------------

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    private List<Map<String, Object>> eventsFor(UUID pledgeId) {
        return jdbc().queryForList(
                        """
                        SELECT aggregate_type, aggregate_id, event_type, state
                          FROM outbox_events
                         WHERE aggregate_id = ?
                         ORDER BY sequence_no
                        """,
                        pledgeId);
    }

    private int eventCountFor(UUID pledgeId) {
        Integer count = jdbc().queryForObject(
                "SELECT count(*) FROM outbox_events WHERE aggregate_id = ?", Integer.class, pledgeId);
        return count == null ? 0 : count;
    }

    /** The bytes the transaction committed, which is what a consumer receives. */
    private String payloadOf(UUID pledgeId) {
        return jdbc().queryForObject(
                "SELECT payload FROM outbox_events WHERE aggregate_id = ? AND event_type = 'pledge.confirmed'",
                String.class,
                pledgeId);
    }

    private String stateOf(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    private Instant confirmedAtOf(UUID pledgeId) {
        return jdbc().queryForObject("SELECT confirmed_at FROM pledges WHERE id = ?", Instant.class, pledgeId);
    }

    private int reservedQuantity(UUID tierId) {
        return count("SELECT reserved_quantity FROM reward_tiers WHERE id = ?", tierId);
    }

    private int claimedQuantity(UUID tierId) {
        return count("SELECT claimed_quantity FROM reward_tiers WHERE id = ?", tierId);
    }

    private int count(String sql, UUID id) {
        Integer value = jdbc().queryForObject(sql, Integer.class, id);
        return value == null ? 0 : value;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(String body) {
        return json.readValue(body, Map.class);
    }

    /** The amount inside the {@code total} object, as whatever JSON type it arrived as. */
    @SuppressWarnings("unchecked")
    private static Object amountIn(Map<String, Object> payload) {
        return ((Map<String, Object>) payload.get("total")).get("amount");
    }
}
