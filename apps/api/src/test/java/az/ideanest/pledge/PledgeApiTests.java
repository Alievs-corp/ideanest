package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.pledge.application.DraftPledge;
import az.ideanest.pledge.application.PledgeService;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.idempotency.IdempotencyKeySweeper;
import az.ideanest.shared.idempotency.IdempotencyProperties;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.Campaigns;
import tools.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
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
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The checkout over HTTP: drafting a pledge, reading it, confirming it, changing it,
 * and withdrawing it.
 *
 * <p><strong>{@link #aRefusedEditCostsTheBackerNothing()} is the one #56 turns
 * on.</strong> An edit that is refused because the tier the backer wanted has sold
 * out must leave them holding the pledge and the place they already had. That is the
 * whole reason {@code ReservationService#edit} takes the new place before it releases
 * the old one, and the assertion that fails under the opposite — and more natural —
 * ordering, which keeps the stock counts tidier and costs somebody their reward.
 *
 * <p><strong>Three of these carry #52.</strong>
 *
 * <ul>
 *   <li>{@link #aReplayedKeyReturnsTheOriginalResponse()} is what #52 is for. It
 *       asserts the two bodies are <em>equal as bytes</em> rather than equivalent as
 *       objects, because "the same response" is the promise and a re-serialisation
 *       that happens to agree today is not it.
 *   <li>{@link #twoIdenticalRequestsAtOnceProduceOnePledge()} is the property no
 *       amount of careful code can give without the database. Two real threads, one
 *       key, one PostgreSQL, and exactly one pledge — the assertion that fails under
 *       every implementation that reads before it writes.
 *   <li>{@link #confirmingMovesTheHeldPlaceToAClaimedOne()} checks both stock columns
 *       either side of one statement, which is the invariant
 *       {@code RewardTierRepository#commitPlaces} exists to hold.
 * </ul>
 *
 * <p><strong>Five of these carry #203</strong>, which is the same set of questions
 * asked about an add-on's stock rather than a reward tier's: it is held at the draft
 * ({@link #aDraftCarriesTheWholeQuote()}), refused when there is not enough
 * ({@link #aSoldOutAddonOffersOtherAddons()}), committed at confirmation
 * ({@link #confirmingMovesTheAddonPlacesAsWell()}), given back on cancellation
 * ({@link #cancellingReleasesTheAddonPlacesToo()}), and moved by the difference on an
 * edit ({@link #editingAnAddonQuantityMovesTheDifference()}). The property that no two
 * backers can hold the same last places is not here — it needs real threads, and it
 * lives with the reward tier's in {@code ReservationTests}.
 *
 * <p>Money is asserted as the strings the API answers with, never parsed into a
 * double. §10.3 makes the amount a string precisely so that a client cannot do
 * otherwise, and a test that parsed it would be checking a value the contract does
 * not promise.
 *
 * <p>Time is the injected {@link AdjustableClock}. A test that waits five minutes for
 * a reservation, or a day for §17.2's retention, is a test nobody runs.
 */
class PledgeApiTests extends AbstractIntegrationTest {

    /** Distinguishes the accounts these tests create; see {@code PledgeSchemaTests} for why it is a counter. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AdjustableClock clock;

    @Autowired
    private PledgeProperties properties;

    @Autowired
    private IdempotencyKeySweeper sweeper;

    @Autowired
    private IdempotencyProperties idempotency;

    /**
     * Used by one test, which needs a checkout it can hold open across another
     * request. Every other test goes through HTTP, because that is what a backer
     * does.
     */
    @Autowired
    private PledgeService pledges;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    @AfterEach
    void clearCheckouts() {
        // In dependency order rather than by cascade, because that is the cleanup and
        // not the assertion -- PledgeSchemaTests is where the cascades are checked.
        //
        // outbox_events is first and is not a cascade at all: since #235 a confirmation
        // records `pledge.confirmed`, and V19 deliberately gives that table no foreign
        // key to the aggregate it describes, so nothing else here removes the row. A
        // suite that left them behind would fail OutboxTests, which counts every row in
        // the table and has no cleanup of its own before the count.
        jdbc().update("DELETE FROM outbox_events");
        jdbc().update("DELETE FROM pledge_addons");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM idempotency_keys");
        jdbc().update("DELETE FROM shipping_rules");
        jdbc().update("DELETE FROM reward_tiers");
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
        // The clock is a bean the whole suite shares. A test that froze it and did not
        // let it go would stop every session, token, and reservation after it.
        clock.reset();
    }

    // -----------------------------------------------------------------------
    // The money
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a draft answers with all five amounts and the total the database generated")
    void aDraftCarriesTheWholeQuote() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> {
            tier.put("shippingType", "DOMESTIC");
            tier.put("limitQuantity", 10);
        });
        shipTo(creator, rewardId, "AZ", "5.00", "2.00");
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> {
            tier.put("shippingType", "DOMESTIC");
            tier.put("isAddon", true);
        });
        shipTo(creator, addonId, "AZ", "3.00", "1.00");
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "50.00");
        body.put("shippingCountry", "AZ");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 2)));

        ResponseEntity<String> created = post("/v1/pledges/draft", backer, newKey(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        Map<String, Object> pledge = parse(created);
        assertThat(pledge.get("state")).isEqualTo("DRAFT");
        assertThat(pledge.get("rewardTierId")).isEqualTo(rewardId.toString());
        assertThat(pledge.get("shippingCountry")).isEqualTo("AZ");

        // PL-01 the tier, PL-03 the bonus above it, PL-04 two add-ons, PL-05 the
        // postage on both lines -- the first unit at the rate and each one after it at
        // the additional rate -- and PL-06 the sum. Exact at two decimal places, which
        // is the arithmetic a double gets wrong and a card is charged for.
        assertThat(amount(pledge, "base")).isEqualTo("45.00");
        assertThat(amount(pledge, "addons")).isEqualTo("30.00");
        assertThat(amount(pledge, "bonus")).isEqualTo("5.00");
        assertThat(amount(pledge, "shipping")).isEqualTo("9.00");
        // Zero until #78, and deliberately present rather than omitted -- see TaxPolicy.
        assertThat(amount(pledge, "tax")).isEqualTo("0.00");
        assertThat(amount(pledge, "total")).isEqualTo("89.00");

        // The add-on lines and not only their sum: a total cannot be unpacked, and
        // the creator has to know what to put in the box. V18 creates the table.
        assertThat(addons(pledge)).containsExactly(Map.of("rewardTierId", addonId.toString(), "quantity", 2));

        // And the five columns are what the row holds, so the generated total above is
        // PostgreSQL's answer rather than one this response computed.
        assertThat(totalOf(id(pledge))).isEqualByComparingTo(new BigDecimal("89.00"));
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
        // And two on the add-on, because PL-04 selects a quantity (#203). One place for
        // the reward because §7.2 gives a pledge one reward_tier_id; n for the add-on
        // because the backer chose n and the creator has to ship n.
        assertThat(reservedQuantity(addonId)).isEqualTo(2);
    }

    @Test
    @DisplayName("a support-only pledge is priced at what the backer chose to give")
    void aPledgeWithoutARewardIsAllBase() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Map<String, Object> pledge =
                parse(post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, null, "25.00")));

        // §4.5's PL-02. The whole amount is the base and the bonus is nothing: a
        // support-only pledge read as a bonus on a reward nobody took would make every
        // "raised through rewards" report wrong.
        assertThat(pledge.get("rewardTierId")).isNull();
        assertThat(amount(pledge, "base")).isEqualTo("25.00");
        assertThat(amount(pledge, "bonus")).isEqualTo("0.00");
        assertThat(amount(pledge, "total")).isEqualTo("25.00");
    }

    @Test
    @DisplayName("a contribution below the reward's price is refused rather than rounded up")
    void aContributionBelowTheTierIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> {});
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<String> refused =
                post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, rewardId, "40.00"));

        // Charging the tier's price anyway would take more than the number the backer
        // was looking at when they pressed the button.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(code(refused)).isEqualTo("CONTRIBUTION_BELOW_REWARD_PRICE");
        assertThat(draftCount()).isZero();
    }

    @Test
    @DisplayName("a posted reward to a country nobody priced is refused")
    void anUnpricedDestinationIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("shippingType", "DOMESTIC"));
        shipTo(creator, rewardId, "AZ", "5.00", "0.00");
        Campaigns.launch(dataSource, projectId);

        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");
        body.put("shippingCountry", "GE");

        ResponseEntity<String> refused = post("/v1/pledges/draft", account("backer"), newKey(), body);

        // Quoting it at zero would make the creator pay the carrier out of their own
        // funding, and nobody would notice until the parcel was posted.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(code(refused)).isEqualTo("SHIPPING_DESTINATION_UNPRICED");
        assertThat(meta(refused).get("shippingCountry")).isEqualTo("GE");
        // And the place was never taken: the selection is priced before anything is
        // held, so a quote that cannot be made costs nobody a place.
        assertThat(reservedQuantity(rewardId)).isZero();
    }

    // -----------------------------------------------------------------------
    // Idempotency
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("§10.3: a replayed key returns the original response, byte for byte")
    void aReplayedKeyReturnsTheOriginalResponse() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 5));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        String key = newKey();
        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");

        ResponseEntity<String> first = post("/v1/pledges/draft", backer, key, body);
        ResponseEntity<String> replay = post("/v1/pledges/draft", backer, key, body);

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        // The same status and the same bytes. Not a 409, and not a second pledge: a
        // client that retried because it never saw the first answer is entitled to
        // that answer.
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(replay.getBody()).isEqualTo(first.getBody());

        // Once, not twice. One pledge, and one place taken off the tier -- which is
        // the failure the header exists to prevent.
        assertThat(draftCount()).isEqualTo(1);
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("§10.4: the same key with a different body is a conflict")
    void aKeyReusedForADifferentRequestIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        String key = newKey();

        assertThat(post("/v1/pledges/draft", backer, key, draftBody(projectId, null, "25.00"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        ResponseEntity<String> reused = post("/v1/pledges/draft", backer, key, draftBody(projectId, null, "50.00"));

        // Neither answer would be safe. Replaying the first would tell the client a
        // fifty-manat pledge was made when a twenty-five-manat one was; executing the
        // second would make the key mean nothing.
        assertThat(reused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(reused)).isEqualTo("IDEMPOTENCY_KEY_REUSED");
        assertThat(draftCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("two spellings of one amount are one request, because the fingerprint is of the parsed body")
    void anEquivalentBodyIsTheSameRequest() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        String key = newKey();

        ResponseEntity<String> first = post("/v1/pledges/draft", backer, key, draftBody(projectId, null, "25.00"));
        // "25" and "25.00" are the same money -- Money normalises both to two decimal
        // places on the way in -- so fingerprinting the parsed request rather than the
        // raw bytes is what stops a client's own formatting from reading as a
        // different intention.
        ResponseEntity<String> again = post("/v1/pledges/draft", backer, key, draftBody(projectId, null, "25"));

        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(again.getBody()).isEqualTo(first.getBody());
        assertThat(draftCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a missing Idempotency-Key is refused, not silently unprotected")
    void aMissingKeyIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<String> refused =
                post("/v1/pledges/draft", account("backer"), null, draftBody(projectId, null, "25.00"));

        // Treating an absent header as "this client does not want replay protection"
        // would make the guarantee opt-in for exactly the clients most likely to need
        // it.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(code(refused)).isEqualTo("IDEMPOTENCY_KEY_REQUIRED");
        assertThat(draftCount()).isZero();

        // And a key that is not a UUID is a different mistake with a different fix.
        ResponseEntity<String> malformed =
                post("/v1/pledges/draft", account("backer"), "not-a-uuid", draftBody(projectId, null, "25.00"));
        assertThat(malformed.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(code(malformed)).isEqualTo("IDEMPOTENCY_KEY_INVALID");
        assertThat(draftCount()).isZero();
    }

    @Test
    @DisplayName("one backer's key cannot replay another backer's request")
    void keysAreScopedToTheAccountThatSpentThem() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        String key = newKey();
        ResponseEntity<String> mine = post("/v1/pledges/draft", account("backer"), key, draftBody(projectId, null, "25.00"));
        ResponseEntity<String> theirs =
                post("/v1/pledges/draft", account("backer"), key, draftBody(projectId, null, "25.00"));

        // Two accounts, one key, two pledges. Without the account in the unique index
        // the second caller would be handed the first one's pledge -- which names the
        // campaign, the amount, and the reward they chose.
        assertThat(mine.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(theirs.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(theirs.getBody()).isNotEqualTo(mine.getBody());
        assertThat(draftCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("two identical requests arriving at once produce exactly one pledge")
    void twoIdenticalRequestsAtOnceProduceOnePledge() throws InterruptedException {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 5));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        String key = newKey();
        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");

        // Real threads through the real endpoint against the real PostgreSQL. The
        // failure this is about only happens when both requests find no key at the
        // same instant, which no single-threaded test can produce.
        List<ResponseEntity<String>> answers = simultaneously(2, () -> post("/v1/pledges/draft", backer, key, body));

        // **One pledge, and one place.** The unique index decides which request
        // executes; nothing in Java could, because neither transaction can see the
        // other's intention before it is written down.
        assertThat(draftCount()).isEqualTo(1);
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);

        // The winner is answered 201. The loser is either replayed with the winner's
        // response -- if the winner had committed by the time it looked -- or told the
        // first request is still running, which is a retry rather than a failure. Both
        // are correct and which one happens is a matter of microseconds, so the
        // assertion is that it is one of the two and never a second pledge.
        List<HttpStatus> statuses = answers.stream()
                .map(answer -> HttpStatus.valueOf(answer.getStatusCode().value()))
                .sorted()
                .toList();
        assertThat(statuses).first().isEqualTo(HttpStatus.CREATED);
        assertThat(statuses.get(1)).isIn(HttpStatus.CREATED, HttpStatus.CONFLICT);

        ResponseEntity<String> created =
                answers.stream().filter(a -> a.getStatusCode().value() == 201).findFirst().orElseThrow();
        for (ResponseEntity<String> answer : answers) {
            if (answer.getStatusCode().value() == 201) {
                // Every 201 is the same 201 -- the same bytes, not merely the same
                // pledge.
                assertThat(answer.getBody()).isEqualTo(created.getBody());
            } else {
                assertThat(code(answer)).isEqualTo("IDEMPOTENT_REQUEST_IN_PROGRESS");
            }
        }
    }

    @Test
    @DisplayName("a refused request gives its key back, so the client can retry with it")
    void aFailedRequestDoesNotBurnItsKey() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID soldOut = reward(creator, projectId, "The last one", "45.00", tier -> tier.put("limitQuantity", 1));
        Campaigns.launch(dataSource, projectId);

        Account first = account("backer");
        assertThat(post("/v1/pledges/draft", first, newKey(), draftBody(projectId, soldOut, "45.00"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        Account second = account("backer");
        String key = newKey();
        ResponseEntity<String> refused = post("/v1/pledges/draft", second, key, draftBody(projectId, soldOut, "45.00"));
        assertThat(code(refused)).isEqualTo("REWARD_SOLD_OUT");

        // The reason for a refusal can change between one request and the next -- here
        // the first backer's reservation lapses and the sweep gives the place back.
        // Recording the refusal would answer the same key with yesterday's "no" for
        // §17.2's whole day.
        jdbc().update("DELETE FROM pledges");
        jdbc().update("UPDATE reward_tiers SET reserved_quantity = 0 WHERE id = ?", soldOut);

        ResponseEntity<String> retried = post("/v1/pledges/draft", second, key, draftBody(projectId, soldOut, "45.00"));
        assertThat(retried.getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    @Test
    @DisplayName("§17.2: keys are swept after twenty-four hours, a bounded batch at a time")
    void expiredKeysAreSwept() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        clock.freeze();
        for (int i = 0; i < 3; i++) {
            assertThat(post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, null, "25.00"))
                            .getStatusCode())
                    .isEqualTo(HttpStatus.CREATED);
        }
        assertThat(keyCount()).isEqualTo(3);

        // Nothing has expired yet. A sweep that removed a key inside its retention
        // would turn a client's legitimate retry into a second pledge.
        assertThat(sweeper.removeExpiredKeys(clock.instant())).isZero();
        assertThat(keyCount()).isEqualTo(3);

        clock.advance(retention().plusSeconds(1));

        // Bounded: a day of traffic must not be one transaction, so the pass takes at
        // most a batch and comes back for the rest.
        assertThat(sweeper.removeExpiredKeys(clock.instant())).isEqualTo(2);
        assertThat(sweeper.removeExpiredKeys(clock.instant())).isEqualTo(1);
        assertThat(sweeper.removeExpiredKeys(clock.instant())).isZero();
        assertThat(keyCount()).isZero();

        // And the pledges the keys described are untouched. A payment record is not
        // swept because the note about a retry that can no longer happen was.
        assertThat(draftCount()).isEqualTo(3);
    }

    // -----------------------------------------------------------------------
    // What the campaign and the stock refuse
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("§10.4: a sold-out tier is refused with the tiers that are left")
    void aSoldOutTierOffersAlternatives() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID soldOut = reward(creator, projectId, "The last one", "45.00", tier -> tier.put("limitQuantity", 1));
        UUID roomLeft = reward(creator, projectId, "Still available", "20.00", tier -> {});
        UUID secret = reward(creator, projectId, "By invitation", "20.00", tier -> tier.put("isSecret", true));
        UUID addon = reward(creator, projectId, "An extra mug", "5.00", tier -> tier.put("isAddon", true));
        Campaigns.launch(dataSource, projectId);

        assertThat(post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, soldOut, "45.00"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        ResponseEntity<String> refused =
                post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, soldOut, "45.00"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("REWARD_SOLD_OUT");
        assertThat(meta(refused).get("rewardTierId")).isEqualTo(soldOut.toString());

        // What a backer could actually select instead. A secret tier is reachable only
        // through its own link and listing it here would be the disclosure it exists to
        // prevent; an add-on is bought alongside a reward rather than instead of one.
        assertThat(alternatives(refused)).containsExactly(roomLeft.toString());
        assertThat(alternatives(refused)).doesNotContain(secret.toString(), addon.toString(), soldOut.toString());
    }

    @Test
    @DisplayName("§10.4: a sold-out add-on is refused with the add-ons that are left")
    void aSoldOutAddonOffersOtherAddons() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> {});
        UUID soldOut = reward(creator, projectId, "The last mug", "15.00", tier -> {
            tier.put("isAddon", true);
            tier.put("limitQuantity", 1);
        });
        UUID otherAddon = reward(creator, projectId, "A tote bag", "12.00", tier -> tier.put("isAddon", true));
        Campaigns.launch(dataSource, projectId);

        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");
        body.put("addons", List.of(Map.of("rewardTierId", soldOut.toString(), "quantity", 1)));
        assertThat(post("/v1/pledges/draft", account("backer"), newKey(), body).getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        ResponseEntity<String> refused = post("/v1/pledges/draft", account("backer"), newKey(), body);

        // **The refusal names the add-on and not the reward.** Before #203 this request
        // was accepted and the campaign owed two of something it had one of.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("REWARD_SOLD_OUT");
        assertThat(meta(refused).get("rewardTierId")).isEqualTo(soldOut.toString());

        // And what is offered is of the same kind. Handing this backer the campaign's
        // reward tiers -- one of which they are already holding -- would be a list of
        // things that do not answer the question they asked (#203).
        assertThat(alternatives(refused)).containsExactly(otherAddon.toString());
        assertThat(alternatives(refused)).doesNotContain(rewardId.toString(), soldOut.toString());

        // Nothing was taken on the way to the refusal: the reward tier the request also
        // named is untouched, because the transaction rolled back.
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("§7.2: a backer gets one pledge per campaign")
    void aSecondPledgeByTheSameBackerIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> pledge =
                parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00")));

        // A different key, so this is a second intention and not a retry.
        ResponseEntity<String> refused = post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PLEDGE_ALREADY_EXISTS");
        // The pledge they already have, so the client opens it rather than starting a
        // second checkout.
        assertThat(meta(refused).get("pledgeId")).isEqualTo(id(pledge).toString());
        assertThat(meta(refused).get("state")).isEqualTo("DRAFT");
    }

    @Test
    @DisplayName("§7.2: a second pledge that slips past the read is refused by the index, and still as a conflict")
    void aSecondPledgeRefusedByTheIndexIsStillAConflict() throws Exception {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);
        Account backer = account("backer");

        // **This is the race the read at the top of the checkout cannot win.** Two
        // requests from one backer arriving together both find no pledge, both
        // conclude the backer has none, and both insert — an ordinary double-click, or
        // a client retrying with a fresh key instead of the one it already had.
        //
        // Making that deterministic is the point of the transaction held open below,
        // rather than two threads and a hope. The winner's INSERT runs and stays
        // uncommitted, so READ COMMITTED *guarantees* the loser's read cannot see it —
        // it is not a matter of which thread is quicker. The loser therefore reaches
        // its own INSERT and blocks there on the unique index until this transaction
        // commits, which is the only way to be sure the test exercises the index
        // rather than the read it is meant to have slipped past.
        //
        // No reward tier, deliberately: with one, the loser would block on the tier's
        // row lock inside reserveOnePlace instead, and never reach the insert while
        // the winner is still open.
        ExecutorService pool = Executors.newSingleThreadExecutor();
        AtomicReference<Future<ResponseEntity<String>>> loser = new AtomicReference<>();
        AtomicReference<UUID> winner = new AtomicReference<>();

        try {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                winner.set(pledges
                        .draft(new DraftPledge(
                                projectId,
                                backer.id(),
                                null,
                                List.of(),
                                Money.of(new BigDecimal("25.00"), "AZN"),
                                null,
                                false,
                                null,
                                newKey()))
                        .pledge()
                        .getId());

                // A different idempotency key, so this is a second intention and not a
                // retry — a retry would be replayed and never reach the database.
                loser.set(pool.submit(
                        () -> post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"))));

                // Proof that the loser got past the read and is waiting on the index.
                // Without it this block could commit first and the loser would take the
                // read path, which is a different test that already exists above.
                awaitAnInsertBlockedOnPledges();
            });

            ResponseEntity<String> refused = loser.get().get(60, TimeUnit.SECONDS);

            // **A conflict, not a 500.** The index refused it, and the backer is told
            // the same thing in the same shape as if the read had — including the
            // identifier of the pledge they already have, so the client opens it rather
            // than starting a third checkout. Which of the two paths refused them is
            // not something they can tell.
            assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(code(refused)).isEqualTo("PLEDGE_ALREADY_EXISTS");
            assertThat(meta(refused).get("pledgeId")).isEqualTo(winner.get().toString());
            assertThat(meta(refused).get("state")).isEqualTo("DRAFT");

            // One pledge, which is what §7.2's index is for.
            assertThat(draftCount()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * Waits until another backend is blocked on this transaction.
     *
     * <p><strong>The wait is the signal, not the query text.</strong> A statement that
     * hits an occupied unique index waits on the holding transaction's identifier —
     * {@code wait_event_type = 'Lock'}, {@code wait_event = 'transactionid'} — which
     * is exactly the state this test needs to observe before it lets the winner
     * commit. Matching on {@code pg_stat_activity.query} instead does not work: the
     * driver sends the insert through the extended protocol, so the column still
     * shows the connection's earlier {@code SET application_name} while the backend
     * sits blocked. That was the first version of this method, and it timed out
     * against a backend that was blocked exactly as intended.
     *
     * <p>Precise enough because this transaction is the only uncommitted write in the
     * suite while it runs — JUnit runs test classes one at a time here — so a backend
     * waiting on a transaction identifier is the loser waiting on us. Our own pid is
     * excluded, since the poll runs on the winner's connection.
     *
     * <p>Polls rather than sleeping a fixed interval, so it returns the moment the
     * condition holds, which is typically the first tick.
     */
    private void awaitAnInsertBlockedOnPledges() {
        for (int attempt = 0; attempt < 200; attempt++) {
            Integer waiting = jdbc().queryForObject(
                    """
                    SELECT count(*) FROM pg_stat_activity
                     WHERE datname = current_database()
                       AND pid <> pg_backend_pid()
                       AND wait_event_type = 'Lock'
                       AND wait_event = 'transactionid'
                    """,
                    Integer.class);
            if (waiting != null && waiting > 0) {
                return;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while waiting for the blocked insert", interrupted);
            }
        }
        throw new IllegalStateException(
                "Nothing ever blocked on this transaction, so the loser never reached the index"
                        + " and this test proves nothing. Activity was: "
                        + jdbc().queryForList(
                                """
                                SELECT pid, state, wait_event_type, wait_event, left(query, 90) AS query
                                  FROM pg_stat_activity WHERE datname = current_database()
                                """));
    }

    @Test
    @DisplayName("a campaign that is not taking pledges is refused, and one that never launched is a 404")
    void aCampaignThatIsNotLiveIsRefused() {
        Account creator = account("creator");
        UUID unlaunched = project(creator);

        // Never public. Answered as though it did not exist, because a refusal that
        // said "not live" would confirm to anybody holding an identifier that somebody
        // is preparing a campaign.
        ResponseEntity<String> hidden =
                post("/v1/pledges/draft", account("backer"), newKey(), draftBody(unlaunched, null, "25.00"));
        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(code(hidden)).isEqualTo("PROJECT_NOT_FOUND");

        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);
        // Live, and past its deadline: §8.4's finalizer runs every minute and the
        // backer does not. A pledge taken in that minute would be a commitment made
        // after the funding window the backer was shown.
        //
        // The launch instant moves with it, because projects_deadline_follows_launch
        // refuses a campaign that closed before it opened -- which is the constraint
        // doing its job, and is why the row this writes is one the application could
        // have produced.
        jdbc().update(
                        """
                        UPDATE projects
                           SET launched_at = now() - interval '40 days',
                               deadline = now() - interval '1 hour'
                         WHERE id = ?
                        """,
                        projectId);

        ResponseEntity<String> refused =
                post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, null, "25.00"));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PROJECT_NOT_LIVE");
        assertThat(meta(refused).get("state")).isEqualTo("LIVE");
        assertThat(draftCount()).isZero();
    }

    @Test
    @DisplayName("§17.3: a backer may draft ten pledges a minute and no more")
    void theCheckoutIsRateLimited() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        int limit = properties.rateLimit().pledgesPerUser();

        // Every one of these is counted, including the ones refused for having a pledge
        // already: what the limit bounds is the work one caller can demand, and a
        // request that is refused after settling a stale pledge, reading a campaign and
        // locking a tier has already cost all of it.
        for (int attempt = 0; attempt < limit; attempt++) {
            post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"));
        }

        ResponseEntity<String> refused =
                post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        // A client that is told to wait can wait; without the header it retries
        // immediately and the limiter spends the window refusing.
        assertThat(refused.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isNotNull();
    }

    // -----------------------------------------------------------------------
    // Reading one
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a backer reads their own pledge, and somebody else's is a 404")
    void onlyTheBackerReadsTheirPledge() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> {});
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));

        Map<String, Object> read = parse(get("/v1/pledges/" + pledgeId, backer));
        assertThat(id(read)).isEqualTo(pledgeId);
        assertThat(amount(read, "total")).isEqualTo("45.00");

        // Not a 403. A pledge says who gave money and how much, and PL-12's anonymity
        // would mean very little if the pledge behind it could be confirmed to exist by
        // anybody holding its identifier.
        ResponseEntity<String> stranger = get("/v1/pledges/" + pledgeId, account("backer"));
        assertThat(stranger.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(code(stranger)).isEqualTo("PLEDGE_NOT_FOUND");
    }

    // -----------------------------------------------------------------------
    // Confirming
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("confirming moves the held place to a claimed one, in one statement")
    void confirmingMovesTheHeldPlaceToAClaimedOne() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
        assertThat(claimedQuantity(rewardId)).isZero();

        UUID paymentMethodId = UUID.randomUUID();
        ResponseEntity<String> confirmed = post(
                "/v1/pledges/" + pledgeId + "/confirm",
                backer,
                newKey(),
                Map.of("paymentMethodId", paymentMethodId.toString()));

        assertThat(confirmed.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> pledge = parse(confirmed);
        assertThat(pledge.get("state")).isEqualTo("CONFIRMED");
        assertThat(pledge.get("confirmedAt")).isNotNull();
        // Null once it is not a draft. The column keeps its value -- it is a true
        // statement about the window the backer had -- but a confirmed pledge holds no
        // reservation, and a countdown on that screen has nothing to count down to.
        assertThat(pledge.get("reservationExpiresAt")).isNull();
        // Accepted and stored so the shape does not change when #55 lands. Nothing
        // resolves it.
        assertThat(pledge.get("paymentMethodId")).isEqualTo(paymentMethodId.toString());
        // **No card was verified and nothing was charged.** §9.2's phase 1 is #55,
        // blocked on #60, and §9.2 is explicit that no money moves here in any case.
        assertThat(pledge.get("cardVerified")).isEqualTo(false);

        // One place, moved. The sum never changes, which is what stops another checkout
        // from taking a place that has already been sold and stops V7's constraint from
        // refusing a legitimate confirmation of the last one.
        assertThat(reservedQuantity(rewardId)).isZero();
        assertThat(claimedQuantity(rewardId)).isEqualTo(1);
        assertThat(committedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("confirming moves the add-on's places too, all of them in one statement")
    void confirmingMovesTheAddonPlacesAsWell() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> {
            tier.put("isAddon", true);
            tier.put("limitQuantity", 4);
        });
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 3)));
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), body)));
        assertThat(reservedQuantity(addonId)).isEqualTo(3);
        assertThat(claimedQuantity(addonId)).isZero();

        assertThat(post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // Three places, moved together. A confirmation that committed the reward and
        // left the add-on reserved would leave a reservation against a pledge that is
        // not a draft -- the row §8.4's sweep hunts for -- and the sweep would then
        // hand three mugs somebody has committed to buying to the next person.
        assertThat(reservedQuantity(rewardId)).isZero();
        assertThat(claimedQuantity(rewardId)).isEqualTo(1);
        assertThat(reservedQuantity(addonId)).isZero();
        assertThat(claimedQuantity(addonId)).isEqualTo(3);
        // And the sum never moved, which is what stops another checkout taking a place
        // that is already sold.
        assertThat(committedQuantity(addonId)).isEqualTo(3);
    }

    @Test
    @DisplayName("a replayed confirmation returns the original response and commits one place")
    void aReplayedConfirmationCommitsOnce() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));

        String key = newKey();
        ResponseEntity<String> first = post("/v1/pledges/" + pledgeId + "/confirm", backer, key, Map.of());
        ResponseEntity<String> replay = post("/v1/pledges/" + pledgeId + "/confirm", backer, key, Map.of());

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replay.getBody()).isEqualTo(first.getBody());

        // The replay is not a second transition, which is what the count proves: a
        // re-execution would have tried to commit a place the tier no longer holds.
        assertThat(claimedQuantity(rewardId)).isEqualTo(1);
        assertThat(reservedQuantity(rewardId)).isZero();

        // A *different* request asking for the same transition is a different matter:
        // §6.2 has no edge out of CONFIRMED for a backer, and answering it with a
        // success would say a transition happened when it did not.
        ResponseEntity<String> again = post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of());
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(again)).isEqualTo("PLEDGE_NOT_DRAFT");
        assertThat(meta(again).get("state")).isEqualTo("CONFIRMED");
    }

    @Test
    @DisplayName("a draft whose five minutes ran out cannot be confirmed")
    void confirmingAfterTheReservationLapsedIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        clock.freeze();
        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));

        // Without the sweep having run: the clock decides, not the state. A draft whose
        // window closed forty seconds ago is still DRAFT in the table, and confirming it
        // would commit a place the tier has already promised to give back.
        clock.advance(properties.reservation().ttl().plusSeconds(1));

        ResponseEntity<String> refused = post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("RESERVATION_EXPIRED");
        assertThat(claimedQuantity(rewardId)).isZero();
        // Still held, and still a draft: the sweep releases it within the minute, and
        // doing it here would be a write rolled back by the refusal that caused it.
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
        assertThat(state(pledgeId)).isEqualTo("DRAFT");
    }

    @Test
    @DisplayName("confirming somebody else's pledge is a 404")
    void confirmingAStrangersPledgeIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        UUID pledgeId = id(parse(
                post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, null, "25.00"))));

        ResponseEntity<String> refused =
                post("/v1/pledges/" + pledgeId + "/confirm", account("backer"), newKey(), Map.of());

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(code(refused)).isEqualTo("PLEDGE_NOT_FOUND");
        assertThat(state(pledgeId)).isEqualTo("DRAFT");
    }

    // -----------------------------------------------------------------------
    // Editing (#56)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("editing a draft's contribution and add-ons re-quotes the whole total")
    void editingADraftRequotesIt() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> {
            tier.put("shippingType", "DOMESTIC");
            tier.put("limitQuantity", 10);
        });
        shipTo(creator, rewardId, "AZ", "5.00", "2.00");
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> {
            tier.put("shippingType", "DOMESTIC");
            tier.put("isAddon", true);
        });
        shipTo(creator, addonId, "AZ", "3.00", "1.00");
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "50.00");
        body.put("shippingCountry", "AZ");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 2)));
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), body)));

        // More support, one fewer mug. Both amounts change and so does the postage,
        // because the second mug was charged at the additional-item rate.
        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("contribution", Map.of("amount", "60.00", "currency", "AZN"));
        edit.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 1)));

        ResponseEntity<String> edited = patch("/v1/pledges/" + pledgeId, backer, newKey(), edit);
        assertThat(edited.getStatusCode()).isEqualTo(HttpStatus.OK);

        Map<String, Object> pledge = parse(edited);
        // **The whole response, not the fields that changed.** A client that merged a
        // partial body would keep the old total, which is the number a card is charged.
        assertThat(pledge.get("state")).isEqualTo("DRAFT");
        assertThat(pledge.get("rewardTierId")).isEqualTo(rewardId.toString());
        assertThat(amount(pledge, "base")).isEqualTo("45.00");
        assertThat(amount(pledge, "addons")).isEqualTo("15.00");
        assertThat(amount(pledge, "bonus")).isEqualTo("15.00");
        assertThat(amount(pledge, "shipping")).isEqualTo("8.00");
        assertThat(amount(pledge, "tax")).isEqualTo("0.00");
        assertThat(amount(pledge, "total")).isEqualTo("83.00");
        assertThat(addons(pledge)).containsExactly(Map.of("rewardTierId", addonId.toString(), "quantity", 1));

        // The row agrees, so the total above is PostgreSQL's generated column and not
        // a number this response computed.
        assertThat(totalOf(pledgeId)).isEqualByComparingTo(new BigDecimal("83.00"));

        // The reward did not change, so the place did not move.
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
        // The add-on's quantity did, so the difference did (#203): two held, one
        // wanted, one given back. Only the difference moves -- an edit that re-took
        // both places and then released both would be the same number here and a
        // window in which the add-on looked full to everybody else.
        assertThat(reservedQuantity(addonId)).isEqualTo(1);
    }

    @Test
    @DisplayName("raising an add-on's quantity takes the extra places and lowering it gives them back")
    void editingAnAddonQuantityMovesTheDifference() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 5));
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> {
            tier.put("isAddon", true);
            tier.put("limitQuantity", 10);
        });
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 2)));
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), body)));
        assertThat(reservedQuantity(addonId)).isEqualTo(2);

        // Up by three.
        Map<String, Object> more = new LinkedHashMap<>();
        more.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 5)));
        assertThat(patch("/v1/pledges/" + pledgeId, backer, newKey(), more).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(reservedQuantity(addonId)).isEqualTo(5);

        // Down by four.
        Map<String, Object> fewer = new LinkedHashMap<>();
        fewer.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 1)));
        assertThat(patch("/v1/pledges/" + pledgeId, backer, newKey(), fewer).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(reservedQuantity(addonId)).isEqualTo(1);

        // Removed altogether: every place goes back, and the reward's place stays.
        Map<String, Object> none = new LinkedHashMap<>();
        none.put("addons", List.of());
        Map<String, Object> pledge = parse(patch("/v1/pledges/" + pledgeId, backer, newKey(), none));
        assertThat(addons(pledge)).isEmpty();
        assertThat(reservedQuantity(addonId)).isZero();
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("an edit that asks for more of a full add-on is refused and the backer keeps what they had")
    void aRefusedAddonEditCostsTheBackerNothing() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 5));
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> {
            tier.put("isAddon", true);
            tier.put("limitQuantity", 3);
        });
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 2)));
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), body)));

        // Somebody else takes the third and last mug.
        Map<String, Object> theirs = draftBody(projectId, null, "15.00");
        theirs.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 1)));
        assertThat(post("/v1/pledges/draft", account("backer"), newKey(), theirs).getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        assertThat(reservedQuantity(addonId)).isEqualTo(3);

        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 3)));
        ResponseEntity<String> refused = patch("/v1/pledges/" + pledgeId, backer, newKey(), edit);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("REWARD_SOLD_OUT");
        // The add-on is named, not the reward: the backer asked for a third mug and the
        // reward tier had nothing to do with it.
        assertThat(meta(refused).get("rewardTierId")).isEqualTo(addonId.toString());

        // **aRefusedEditCostsTheBackerNothing's assertion, one line down.** The extra
        // place was taken before anything was released, so a refusal leaves the pledge
        // holding exactly its two mugs and its reward.
        assertThat(reservedQuantity(addonId)).isEqualTo(3);
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);

        Map<String, Object> unchanged = parse(get("/v1/pledges/" + pledgeId, backer));
        assertThat(addons(unchanged)).containsExactly(Map.of("rewardTierId", addonId.toString(), "quantity", 2));
        assertThat(amount(unchanged, "addons")).isEqualTo("30.00");
    }

    @Test
    @DisplayName("an edit that mentions one field leaves every other field alone")
    void anEditOnlyChangesWhatItMentions() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 5));
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> tier.put("isAddon", true));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "50.00");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 1)));
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), body)));

        // RFC 7396: a field that is not mentioned is left alone. Bound to an ordinary
        // record, "hide my name" and "give up my reward" would arrive identically, and
        // this request would strip the reward and the mug off the pledge.
        Map<String, Object> pledge =
                parse(patch("/v1/pledges/" + pledgeId, backer, newKey(), Map.of("isAnonymous", true)));

        assertThat(pledge.get("isAnonymous")).isEqualTo(true);
        assertThat(pledge.get("rewardTierId")).isEqualTo(rewardId.toString());
        assertThat(addons(pledge)).containsExactly(Map.of("rewardTierId", addonId.toString(), "quantity", 1));
        assertThat(amount(pledge, "total")).isEqualTo("65.00");
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("an explicit null reward gives the place back and leaves a support-only pledge")
    void clearingTheRewardReleasesThePlace() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 5));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);

        // The other half of the distinction the test above depends on: null is a
        // change and not an absence. §4.5's PL-02 -- the backer keeps supporting the
        // campaign and gives up the reward.
        //
        // **Raw JSON rather than a Map**, and it has to be: this service configures
        // Jackson with `default-property-inclusion: non_null`, so serialising a map
        // with a null value drops the key entirely and the request would arrive as an
        // absent field -- testing the opposite of what it says. A real client sends
        // the two bytes `null`, so the test does too.
        String edit =
                """
                {"rewardTierId": null, "contribution": {"amount": "30.00", "currency": "AZN"}}
                """;

        Map<String, Object> pledge = parse(patch("/v1/pledges/" + pledgeId, backer, newKey(), edit));

        assertThat(pledge.get("rewardTierId")).isNull();
        // The whole of a support-only pledge is its base, and the bonus is nothing --
        // otherwise every "raised through rewards" report reads it as a bonus on a
        // reward nobody took.
        assertThat(amount(pledge, "base")).isEqualTo("30.00");
        assertThat(amount(pledge, "bonus")).isEqualTo("0.00");
        assertThat(amount(pledge, "total")).isEqualTo("30.00");
        // Given back, and to the right column.
        assertThat(reservedQuantity(rewardId)).isZero();
        assertThat(claimedQuantity(rewardId)).isZero();
    }

    @Test
    @DisplayName("switching a draft's reward takes the new place and gives the old one back")
    void switchingTiersMovesTheReservedPlace() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID chosen = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        UUID wanted = reward(creator, projectId, "The deluxe one", "70.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, chosen, "45.00"))));
        assertThat(reservedQuantity(chosen)).isEqualTo(1);
        assertThat(reservedQuantity(wanted)).isZero();

        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("rewardTierId", wanted.toString());
        edit.put("contribution", Map.of("amount", "70.00", "currency", "AZN"));

        Map<String, Object> pledge = parse(patch("/v1/pledges/" + pledgeId, backer, newKey(), edit));

        assertThat(pledge.get("rewardTierId")).isEqualTo(wanted.toString());
        assertThat(amount(pledge, "total")).isEqualTo("70.00");
        // Still a draft: an edit changes what is being bought, not whether the backer
        // has committed to buying it.
        assertThat(pledge.get("state")).isEqualTo("DRAFT");

        // One place moved, and both tiers agree about it. A reservation left behind on
        // the old tier is a place nothing would ever release.
        assertThat(reservedQuantity(chosen)).isZero();
        assertThat(reservedQuantity(wanted)).isEqualTo(1);
    }

    @Test
    @DisplayName("switching a confirmed pledge's reward moves a claimed place, not a reserved one")
    void switchingTiersOnAConfirmedPledgeMovesAClaimedPlace() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID chosen = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        UUID wanted = reward(creator, projectId, "The deluxe one", "70.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, chosen, "45.00"))));
        assertThat(post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(claimedQuantity(chosen)).isEqualTo(1);
        assertThat(reservedQuantity(chosen)).isZero();

        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("rewardTierId", wanted.toString());
        edit.put("contribution", Map.of("amount", "70.00", "currency", "AZN"));

        Map<String, Object> pledge = parse(patch("/v1/pledges/" + pledgeId, backer, newKey(), edit));

        // **A committed backer's place is claimed on both sides of the move.** Routing
        // it through reserved_quantity would leave a reservation against a pledge that
        // is not a draft, which is exactly the row §8.4's sweep hunts for -- and the
        // sweep would then release a place belonging to somebody who had confirmed.
        assertThat(pledge.get("state")).isEqualTo("CONFIRMED");
        assertThat(pledge.get("rewardTierId")).isEqualTo(wanted.toString());
        assertThat(claimedQuantity(chosen)).isZero();
        assertThat(reservedQuantity(chosen)).isZero();
        assertThat(claimedQuantity(wanted)).isEqualTo(1);
        assertThat(reservedQuantity(wanted)).isZero();
    }

    @Test
    @DisplayName("IDN-EXT-01: a confirmed pledge may be raised")
    void aConfirmedPledgeMayBeRaised() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"))));
        assertThat(post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        Map<String, Object> more = new LinkedHashMap<>();
        more.put("contribution", Map.of("amount", "40.00", "currency", "AZN"));
        ResponseEntity<String> raised = patch("/v1/pledges/" + pledgeId, backer, newKey(), more);

        assertThat(raised.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(parse(raised).get("state")).isEqualTo("CONFIRMED");
        assertThat(totalAmountOf(pledgeId)).isEqualByComparingTo("40.00");
    }

    @Test
    @DisplayName("IDN-EXT-01: an edit that would lower a confirmed pledge is refused before any place moves")
    void loweringAConfirmedPledgeIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID deluxe = reward(creator, projectId, "The deluxe one", "70.00", tier -> tier.put("limitQuantity", 3));
        UUID cheaper = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, deluxe, "70.00"))));
        assertThat(post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        Map<String, Object> down = new LinkedHashMap<>();
        down.put("rewardTierId", cheaper.toString());
        down.put("contribution", Map.of("amount", "45.00", "currency", "AZN"));
        ResponseEntity<String> refused = patch("/v1/pledges/" + pledgeId, backer, newKey(), down);

        // A decrease is a partial cancellation under another verb, so it is refused on
        // the same ground. Both amounts are on the body, as strings.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PLEDGE_DECREASE_NOT_ALLOWED");
        assertThat(meta(refused).get("current")).isEqualTo("70.00");
        assertThat(meta(refused).get("requested")).isEqualTo("45.00");

        // Nothing moved: the pledge, its amount and both tiers are as they were.
        assertThat(state(pledgeId)).isEqualTo("CONFIRMED");
        assertThat(totalAmountOf(pledgeId)).isEqualByComparingTo("70.00");
        assertThat(claimedQuantity(deluxe)).isEqualTo(1);
        assertThat(claimedQuantity(cheaper)).isZero();
        assertThat(reservedQuantity(cheaper)).isZero();
    }

    @Test
    @DisplayName("an edit to a sold-out tier is refused and the backer keeps the pledge and the place they had")
    void aRefusedEditCostsTheBackerNothing() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID held = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        UUID full = reward(creator, projectId, "The last deluxe one", "70.00", tier -> tier.put("limitQuantity", 1));
        UUID roomLeft = reward(creator, projectId, "Still available", "20.00", tier -> {});
        Campaigns.launch(dataSource, projectId);

        // Somebody else takes the only deluxe place while this backer is deciding.
        assertThat(post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, full, "70.00"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, held, "45.00"))));
        assertThat(reservedQuantity(held)).isEqualTo(1);

        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("rewardTierId", full.toString());
        edit.put("contribution", Map.of("amount", "70.00", "currency", "AZN"));

        String key = newKey();
        ResponseEntity<String> refused = patch("/v1/pledges/" + pledgeId, backer, key, edit);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("REWARD_SOLD_OUT");
        assertThat(meta(refused).get("rewardTierId")).isEqualTo(full.toString());
        // The same dead-end avoidance the draft gets: a refusal that names nothing at
        // the moment somebody is trying to give money is a checkout that stops.
        assertThat(alternatives(refused)).contains(roomLeft.toString());

        // **This is the assertion the endpoint exists to satisfy.** The new place was
        // taken before the old one was given back, so a failure leaves the backer
        // holding what they already had rather than nothing at all. Releasing first
        // would have left them with no reward and no place, having asked for a better
        // one and been told no.
        assertThat(reservedQuantity(held)).isEqualTo(1);
        // And the sold-out tier is untouched: still exactly the other backer's place.
        assertThat(reservedQuantity(full)).isEqualTo(1);
        assertThat(claimedQuantity(full)).isZero();

        Map<String, Object> unchanged = parse(get("/v1/pledges/" + pledgeId, backer));
        assertThat(unchanged.get("state")).isEqualTo("DRAFT");
        assertThat(unchanged.get("rewardTierId")).isEqualTo(held.toString());
        assertThat(amount(unchanged, "total")).isEqualTo("45.00");

        // The key is given back, because the reason for the refusal can change: the
        // other backer's reservation lapses and the place comes free. Recording the
        // refusal would answer this key with "sold out" for §17.2's whole day.
        jdbc().update("UPDATE reward_tiers SET reserved_quantity = 0 WHERE id = ?", full);
        assertThat(patch("/v1/pledges/" + pledgeId, backer, key, edit).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("editing a pledge on a campaign past its deadline is refused")
    void editingAfterTheDeadlineIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));

        // §4.5's PL-09 is "until the deadline". The launch instant moves with it,
        // because projects_deadline_follows_launch refuses a campaign that closed
        // before it opened.
        jdbc().update(
                        """
                        UPDATE projects
                           SET launched_at = now() - interval '40 days',
                               deadline = now() - interval '1 hour'
                         WHERE id = ?
                        """,
                        projectId);

        ResponseEntity<String> refused =
                patch("/v1/pledges/" + pledgeId, backer, newKey(), Map.of("isAnonymous", true));

        // **PROJECT_NOT_LIVE rather than PLEDGE_NOT_EDITABLE**, which is a deliberate
        // deviation from the epic's contract and is recorded in the pull request. One
        // fact -- this campaign has closed -- gets one answer across every endpoint
        // that asks about it, and this problem detail carries the deadline, which is
        // what lets a client say when rather than merely no.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PROJECT_NOT_LIVE");
        assertThat(meta(refused).get("deadline")).isNotNull();

        // Nothing moved.
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
        assertThat(state(pledgeId)).isEqualTo("DRAFT");
    }

    @Test
    @DisplayName("a pledge whose state has moved past editing is refused with its state")
    void editingAPledgeThatIsOverIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"))));
        assertThat(delete("/v1/pledges/" + pledgeId, backer, newKey()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        ResponseEntity<String> refused =
                patch("/v1/pledges/" + pledgeId, backer, newKey(), Map.of("isAnonymous", true));

        // A cancelled pledge cannot be edited back into existence. The state is in meta
        // because the client's next move depends on it.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PLEDGE_NOT_EDITABLE");
        assertThat(meta(refused).get("state")).isEqualTo("CANCELED_BY_BACKER");
    }

    @Test
    @DisplayName("a draft whose five minutes ran out cannot be edited")
    void editingAfterTheReservationLapsedIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        clock.freeze();
        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));

        clock.advance(properties.reservation().ttl().plusSeconds(1));

        ResponseEntity<String> refused = patch(
                "/v1/pledges/" + pledgeId,
                backer,
                newKey(),
                Map.of("contribution", Map.of("amount", "60.00", "currency", "AZN")));

        // The same answer confirming gives, and for the same reason: the clock decides
        // rather than the state, and re-pricing a place the tier has already promised
        // to give back would be quoting a reservation that is gone.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("RESERVATION_EXPIRED");
        assertThat(totalOf(pledgeId)).isEqualByComparingTo(new BigDecimal("45.00"));
    }

    @Test
    @DisplayName("editing a draft does not extend the window it holds its place for")
    void anEditDoesNotRestartTheReservationClock() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        clock.freeze();
        Account backer = account("backer");
        Map<String, Object> drafted =
                parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00")));
        UUID pledgeId = id(drafted);
        String lapsesAt = (String) drafted.get("reservationExpiresAt");
        assertThat(lapsesAt).isNotNull();

        clock.advance(Duration.ofMinutes(2));
        Map<String, Object> edited = parse(patch(
                "/v1/pledges/" + pledgeId,
                backer,
                newKey(),
                Map.of("contribution", Map.of("amount", "60.00", "currency", "AZN"))));

        // **The window is measured from when the draft was made, not from when it was
        // last touched.** Restarting it here would let one backer hold a limited
        // tier's last place indefinitely by changing their mind every four minutes --
        // and it would look like an ordinary checkout rather than like abuse. The
        // backer gets what is left of their five minutes, and if it runs out the sweep
        // releases the place and they start again.
        assertThat(edited.get("reservationExpiresAt")).isEqualTo(lapsesAt);
        assertThat(amount(edited, "total")).isEqualTo("60.00");
    }

    @Test
    @DisplayName("§10.3: a replayed edit returns the original response and edits once")
    void aReplayedEditRunsOnce() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));
        long drafted = versionOf(pledgeId);

        String key = newKey();
        Map<String, Object> edit = Map.of("contribution", Map.of("amount", "60.00", "currency", "AZN"));

        ResponseEntity<String> first = patch("/v1/pledges/" + pledgeId, backer, key, edit);
        ResponseEntity<String> replay = patch("/v1/pledges/" + pledgeId, backer, key, edit);

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The same bytes, not merely an equivalent pledge.
        assertThat(replay.getBody()).isEqualTo(first.getBody());

        // **Once.** A second execution would write the row again, and the version is
        // what proves it did not -- the amounts alone could not, because applying the
        // same edit twice lands on the same numbers.
        assertThat(versionOf(pledgeId)).isEqualTo(drafted + 1);
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);

        // And one key does not carry two different edits.
        ResponseEntity<String> reused = patch(
                "/v1/pledges/" + pledgeId,
                backer,
                key,
                Map.of("contribution", Map.of("amount", "80.00", "currency", "AZN")));
        assertThat(reused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(reused)).isEqualTo("IDEMPOTENCY_KEY_REUSED");
    }

    @Test
    @DisplayName("editing somebody else's pledge is a 404")
    void editingAStrangersPledgeIsRefused() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        UUID pledgeId = id(parse(
                post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, rewardId, "45.00"))));

        // Not a 403. A pledge says who gave money and how much, so confirming that one
        // exists is itself the disclosure -- PledgeNotFoundException carries the
        // argument, and PL-12's anonymity depends on it.
        ResponseEntity<String> refused =
                patch("/v1/pledges/" + pledgeId, account("backer"), newKey(), Map.of("isAnonymous", true));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(code(refused)).isEqualTo("PLEDGE_NOT_FOUND");

        ResponseEntity<String> alsoRefused = delete("/v1/pledges/" + pledgeId, account("backer"), newKey());
        assertThat(alsoRefused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        // Untouched by either.
        assertThat(state(pledgeId)).isEqualTo("DRAFT");
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("an edit requires an Idempotency-Key, like every other payment mutation")
    void editingRequiresAKey() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"))));

        ResponseEntity<String> refused =
                patch("/v1/pledges/" + pledgeId, backer, null, Map.of("isAnonymous", true));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(code(refused)).isEqualTo("IDEMPOTENCY_KEY_REQUIRED");

        assertThat(delete("/v1/pledges/" + pledgeId, backer, null).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        // Neither request did anything.
        assertThat(state(pledgeId)).isEqualTo("DRAFT");
    }

    // -----------------------------------------------------------------------
    // Cancelling (#56)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("cancelling a draft gives back a reserved place")
    void cancellingADraftReleasesAReservedPlace() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);

        ResponseEntity<String> cancelled = delete("/v1/pledges/" + pledgeId, backer, newKey());

        assertThat(cancelled.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(cancelled.getBody()).isNull();

        // §6.2's CANCELED_BY_BACKER, and not EXPIRED: a backer who decided is a
        // different fact from a timer that ran out, and every screen reporting why a
        // place came back has to tell them apart.
        assertThat(state(pledgeId)).isEqualTo("CANCELED_BY_BACKER");
        assertThat(canceledAtOf(pledgeId)).isNotNull();
        // A draft was holding a *reserved* place, so that is the column that moves.
        assertThat(reservedQuantity(rewardId)).isZero();
        assertThat(claimedQuantity(rewardId)).isZero();
    }

    @Test
    @DisplayName("IDN-EXT-01: a confirmed pledge cannot be cancelled, and keeps its claimed place")
    void aConfirmedPledgeCannotBeCancelled() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));
        assertThat(post("/v1/pledges/" + pledgeId + "/confirm", backer, newKey(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(claimedQuantity(rewardId)).isEqualTo(1);
        assertThat(reservedQuantity(rewardId)).isZero();

        ResponseEntity<String> refused = delete("/v1/pledges/" + pledgeId, backer, newKey());

        // **A backer cannot cancel a pledge** (IDN-EXT-01, #35). A confirmed pledge is a
        // charged one, it may only be raised, and every refund is campaign-level (§9.7).
        // Its own code rather than PLEDGE_NOT_EDITABLE: the pledge can still be raised.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PLEDGE_CANNOT_BE_CANCELLED");
        assertThat(meta(refused).get("state")).isEqualTo("CONFIRMED");

        // Nothing moved: the pledge stands and still holds its claimed place.
        assertThat(state(pledgeId)).isEqualTo("CONFIRMED");
        assertThat(canceledAtOf(pledgeId)).isNull();
        assertThat(claimedQuantity(rewardId)).isEqualTo(1);
        assertThat(reservedQuantity(rewardId)).isZero();
    }

    @Test
    @DisplayName("abandoning a draft gives back its add-on places, and a confirmed pledge keeps its own")
    void cancellingReleasesTheAddonPlacesToo() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        UUID addonId = reward(creator, projectId, "An enamel mug", "15.00", tier -> {
            tier.put("isAddon", true);
            tier.put("limitQuantity", 6);
        });
        Campaigns.launch(dataSource, projectId);

        // A draft gives back reserved places.
        Account first = account("backer");
        Map<String, Object> body = draftBody(projectId, rewardId, "45.00");
        body.put("addons", List.of(Map.of("rewardTierId", addonId.toString(), "quantity", 2)));
        UUID draft = id(parse(post("/v1/pledges/draft", first, newKey(), body)));
        assertThat(reservedQuantity(addonId)).isEqualTo(2);

        assertThat(delete("/v1/pledges/" + draft, first, newKey()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(reservedQuantity(addonId)).isZero();
        assertThat(claimedQuantity(addonId)).isZero();

        // IDN-EXT-01 (#35): a confirmed pledge cannot be cancelled, so its claimed
        // add-on places stay exactly where they are.
        Account second = account("backer");
        UUID confirmed = id(parse(post("/v1/pledges/draft", second, newKey(), body)));
        assertThat(post("/v1/pledges/" + confirmed + "/confirm", second, newKey(), Map.of())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(claimedQuantity(addonId)).isEqualTo(2);

        ResponseEntity<String> refused = delete("/v1/pledges/" + confirmed, second, newKey());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(code(refused)).isEqualTo("PLEDGE_CANNOT_BE_CANCELLED");

        assertThat(state(confirmed)).isEqualTo("CONFIRMED");
        assertThat(claimedQuantity(addonId)).isEqualTo(2);
        assertThat(reservedQuantity(addonId)).isZero();
        assertThat(claimedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("a replayed cancellation answers 204 and releases the place exactly once")
    void aReplayedCancellationIsStillNoContent() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 2));
        Campaigns.launch(dataSource, projectId);

        // Two backers, so that a place released twice is visible as a count of zero
        // where it should be one. With a single backer the guard on the statement
        // hides the second release and the test proves nothing.
        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));
        assertThat(post("/v1/pledges/draft", account("backer"), newKey(), draftBody(projectId, rewardId, "45.00"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        assertThat(reservedQuantity(rewardId)).isEqualTo(2);

        String key = newKey();
        assertThat(delete("/v1/pledges/" + pledgeId, backer, key).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        // **The retry is 204, not 404.** The pledge is no longer in an active state and
        // there is nothing left to find by the key on the row, which is exactly why
        // idempotency_keys records the answer rather than the resource.
        assertThat(delete("/v1/pledges/" + pledgeId, backer, key).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        // And a client that lost its key and minted a fresh one is answered the same
        // way: "it is cancelled" is true however many times it is asked.
        assertThat(delete("/v1/pledges/" + pledgeId, backer, newKey()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        // One place back, not three. The other backer still holds theirs.
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
        assertThat(state(pledgeId)).isEqualTo("CANCELED_BY_BACKER");
    }

    @Test
    @DisplayName("§7.2: cancelling frees the backer to pledge again")
    void cancellingLetsTheBackerPledgeAgain() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID rewardId = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID first = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))));

        // While it stands, the index refuses a second one.
        assertThat(code(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"))))
                .isEqualTo("PLEDGE_ALREADY_EXISTS");

        assertThat(delete("/v1/pledges/" + first, backer, newKey()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        // **CANCELED_BY_BACKER is not one of pledges_project_backer_active_key's six**,
        // deliberately: an ended commitment must not cost somebody the campaign for
        // ever. V17 carries the argument for which six are in.
        ResponseEntity<String> again =
                post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, rewardId, "45.00"));
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(id(parse(again))).isNotEqualTo(first);

        // One cancelled, one live, one place held.
        assertThat(reservedQuantity(rewardId)).isEqualTo(1);
    }

    @Test
    @DisplayName("cancelling a support-only pledge moves no stock at all")
    void cancellingASupportOnlyPledgeTouchesNoTier() {
        Account creator = account("creator");
        UUID projectId = project(creator);
        UUID untouched = reward(creator, projectId, "A boxed set", "45.00", tier -> tier.put("limitQuantity", 3));
        Campaigns.launch(dataSource, projectId);

        Account backer = account("backer");
        UUID pledgeId = id(parse(post("/v1/pledges/draft", backer, newKey(), draftBody(projectId, null, "25.00"))));

        assertThat(delete("/v1/pledges/" + pledgeId, backer, newKey()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(state(pledgeId)).isEqualTo("CANCELED_BY_BACKER");
        assertThat(reservedQuantity(untouched)).isZero();
        assertThat(claimedQuantity(untouched)).isZero();
    }

    // -----------------------------------------------------------------------
    // Running requests at the same time
    // -----------------------------------------------------------------------

    /**
     * Runs one request from several threads at once and collects what each was told.
     *
     * <p>The latch is what makes it a race. Submitting the tasks is not enough: a pool
     * that starts the first thread before the last one is queued would let the early
     * one finish before the late one begins, and the test would pass against an
     * implementation with no concurrency control at all.
     */
    private List<ResponseEntity<String>> simultaneously(int threads, Request request) throws InterruptedException {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(threads);
        List<ResponseEntity<String>> answers = Collections.synchronizedList(new ArrayList<>());
        List<Throwable> unexpected = Collections.synchronizedList(new ArrayList<>());

        try {
            for (int i = 0; i < threads; i++) {
                pool.execute(() -> {
                    try {
                        start.await();
                        answers.add(request.send());
                    } catch (Throwable t) {
                        // Kept rather than logged: an exception swallowed inside a
                        // thread is a test that passes while the thing it is about is
                        // broken.
                        unexpected.add(t);
                    } finally {
                        finished.countDown();
                    }
                });
            }
            start.countDown();
            // Generous, because it is a deadlock detector rather than a performance
            // assertion.
            assertThat(finished.await(60, TimeUnit.SECONDS))
                    .withFailMessage("The requests did not finish; something is holding a lock")
                    .isTrue();
        } finally {
            pool.shutdownNow();
        }

        assertThat(unexpected).isEmpty();
        return List.copyOf(answers);
    }

    /** One HTTP call, so that {@link #simultaneously} can make several of them at once. */
    private interface Request {
        ResponseEntity<String> send();
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Account(String accessToken, UUID id) {
    }

    private Account account(String role) {
        String marker = role + "-" + SEQUENCE.incrementAndGet();
        String email = marker + "@example.com";

        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email, "password", PASSWORD, "name", "Test " + role),
                String.class);

        Map<String, Object> signedIn = parse(rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                String.class));

        UUID id = jdbc().queryForObject("SELECT id FROM users WHERE email = ?::citext", UUID.class, email);
        return new Account((String) signedIn.get("accessToken"), id);
    }

    private UUID project(Account creator) {
        return id(parse(post("/v1/projects", creator, null, Map.of("title", "A campaign"))));
    }

    /**
     * A reward tier, before the campaign launches.
     *
     * <p>Before, because §5.3 freezes a tier's price once the campaign is live and the
     * shipping table with it. A fixture that created tiers afterwards would be testing
     * the lock rather than the checkout.
     */
    private UUID reward(Account creator, UUID projectId, String title, String price, TierFields extra) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("price", Map.of("amount", price, "currency", "AZN"));
        extra.applyTo(body);
        return id(parse(post("/v1/projects/" + projectId + "/rewards", creator, null, body)));
    }

    /** Extra fields on a tier, so each test says only what it cares about. */
    private interface TierFields {
        void applyTo(Map<String, Object> body);
    }

    private void shipTo(Account creator, UUID rewardId, String country, String amount, String additional) {
        rest.exchange(
                "/v1/rewards/" + rewardId + "/shipping-rules",
                HttpMethod.PUT,
                new HttpEntity<>(
                        Map.of(
                                "rules",
                                List.of(Map.of(
                                        "countryCode", country,
                                        "amount", amount,
                                        "additionalItemAmount", additional))),
                        bearer(creator.accessToken())),
                String.class);
    }

    /** The smallest body {@code POST /v1/pledges/draft} accepts. */
    private static Map<String, Object> draftBody(UUID projectId, UUID rewardTierId, String contribution) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        if (rewardTierId != null) {
            body.put("rewardTierId", rewardTierId.toString());
        }
        body.put("contribution", Map.of("amount", contribution, "currency", "AZN"));
        return body;
    }

    /** A fresh {@code Idempotency-Key}. §10.3 makes it a UUID. */
    private static String newKey() {
        return UUID.randomUUID().toString();
    }

    // -----------------------------------------------------------------------
    // HTTP
    // -----------------------------------------------------------------------

    private ResponseEntity<String> post(String path, Account account, String idempotencyKey, Object body) {
        HttpHeaders headers = bearer(account.accessToken());
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
    }

    private ResponseEntity<String> get(String path, Account account) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(bearer(account.accessToken())), String.class);
    }

    private ResponseEntity<String> patch(String path, Account account, String idempotencyKey, Object body) {
        HttpHeaders headers = bearer(account.accessToken());
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(path, HttpMethod.PATCH, new HttpEntity<>(body, headers), String.class);
    }

    /** No body, by design: §10.2 makes cancellation a DELETE and the key is a header. */
    private ResponseEntity<String> delete(String path, Account account, String idempotencyKey) {
        HttpHeaders headers = bearer(account.accessToken());
        if (idempotencyKey != null) {
            headers.set("Idempotency-Key", idempotencyKey);
        }
        return rest.exchange(path, HttpMethod.DELETE, new HttpEntity<>(headers), String.class);
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

    private static UUID id(Map<String, Object> resource) {
        return UUID.fromString((String) resource.get("id"));
    }

    /** One of the six amounts, as the string §10.3 requires it to be. */
    @SuppressWarnings("unchecked")
    private static String amount(Map<String, Object> pledge, String line) {
        Map<String, Object> amounts = (Map<String, Object>) pledge.get("amounts");
        return (String) ((Map<String, Object>) amounts.get(line)).get("amount");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> addons(Map<String, Object> pledge) {
        return (List<Map<String, Object>>) pledge.get("addons");
    }

    private String code(ResponseEntity<String> response) {
        return (String) parse(response).get("code");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> meta(ResponseEntity<String> response) {
        return (Map<String, Object>) parse(response).get("meta");
    }

    @SuppressWarnings("unchecked")
    private List<String> alternatives(ResponseEntity<String> response) {
        return (List<String>) meta(response).get("availableAlternatives");
    }

    /**
     * §17.2's twenty-four hours, read from the same properties the sweeper uses so
     * that the test cannot drift from the rule by carrying a number of its own.
     */
    private Duration retention() {
        return idempotency.retention();
    }

    private int reservedQuantity(UUID rewardTierId) {
        return count("SELECT reserved_quantity FROM reward_tiers WHERE id = ?", rewardTierId);
    }

    private int claimedQuantity(UUID rewardTierId) {
        return count("SELECT claimed_quantity FROM reward_tiers WHERE id = ?", rewardTierId);
    }

    private int committedQuantity(UUID rewardTierId) {
        return count("SELECT claimed_quantity + reserved_quantity FROM reward_tiers WHERE id = ?", rewardTierId);
    }

    private int count(String sql, UUID id) {
        Integer value = jdbc().queryForObject(sql, Integer.class, id);
        return value == null ? 0 : value;
    }

    private int draftCount() {
        Integer value = jdbc().queryForObject("SELECT count(*) FROM pledges", Integer.class);
        return value == null ? 0 : value;
    }

    private int keyCount() {
        Integer value = jdbc().queryForObject("SELECT count(*) FROM idempotency_keys", Integer.class);
        return value == null ? 0 : value;
    }

    private BigDecimal totalOf(UUID pledgeId) {
        return jdbc().queryForObject("SELECT total_amount FROM pledges WHERE id = ?", BigDecimal.class, pledgeId);
    }

    private String state(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    /**
     * The row's optimistic-lock counter.
     *
     * <p>What makes "the edit ran once" assertable. Two applications of one edit land
     * on the same amounts, so the numbers cannot tell a replay from a re-execution
     * and this can.
     */
    private long versionOf(UUID pledgeId) {
        Long value = jdbc().queryForObject("SELECT version FROM pledges WHERE id = ?", Long.class, pledgeId);
        return value == null ? -1 : value;
    }

    private Instant canceledAtOf(UUID pledgeId) {
        return jdbc().queryForObject("SELECT canceled_at FROM pledges WHERE id = ?", Instant.class, pledgeId);
    }

    private BigDecimal totalAmountOf(UUID pledgeId) {
        return jdbc().queryForObject(
                "SELECT total_amount FROM pledges WHERE id = ?", BigDecimal.class, pledgeId);
    }
}
