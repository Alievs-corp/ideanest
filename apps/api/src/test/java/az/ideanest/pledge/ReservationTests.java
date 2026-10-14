package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.pledge.application.DraftPledge;
import az.ideanest.pledge.application.PledgeAlreadyExistsException;
import az.ideanest.pledge.application.ReservationCleanerJob;
import az.ideanest.pledge.application.ReservationService;
import az.ideanest.pledge.application.RewardSoldOutException;
import az.ideanest.pledge.application.UnknownRewardTierException;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.money.Money;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.AdjustableClock;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Reservation, under the conditions it exists for.
 *
 * <p><strong>The test that carries the issue is
 * {@link #exactlyTheRemainingPlacesAreSold()}.</strong> Every other property of
 * reservation could be checked by calling a method and reading what it returned;
 * that one cannot, because the failure it is about only happens when two checkouts
 * read "one place left" at the same moment. So it runs real threads, through the
 * real service, against the real PostgreSQL container, and asserts that the number
 * of winners is exactly the number of places — the assertion that would have failed
 * under every implementation that checks and then writes.
 *
 * <p>Three things are asserted about that run, and they fail differently:
 *
 * <ul>
 *   <li>the count of successful reservations equals the places available — too many
 *       is an oversold reward, too few is a lost sale;
 *   <li>{@code claimed_quantity + reserved_quantity} equals the limit exactly, which
 *       is what V7's constraint bounds and what a backer's page reads;
 *   <li>the number of DRAFT pledges holding the tier equals
 *       {@code reserved_quantity}. The constraint cannot catch this one: a
 *       reservation that forgot to increment would satisfy every check in the
 *       database and would sell the same place twice.
 * </ul>
 *
 * <p><strong>{@link #exactlyTheRemainingAddonPlacesAreSold()} is the same test for
 * #203's half of the problem.</strong> An add-on is a {@code reward_tiers} row with
 * {@code is_addon} set, so it has the same counters and the same constraint — and
 * until #203 nothing ever wrote them, so the constraint could not catch anything and
 * sixteen backers could each take the last of nine. It differs from the reward-tier
 * race in the one way that made it a separate piece of work: each backer asks for
 * <em>three</em> places rather than one, so what is serialised is
 * {@code reserved + n <= limit} and the answer is three winners rather than nine.
 *
 * <p>Time is the injected {@link AdjustableClock} rather than a sleep. A test that
 * waits five minutes for a TTL is a test nobody runs, and a test that shortens the
 * TTL to a second asserts a rule against a configuration nothing runs on.
 */
class ReservationTests extends AbstractIntegrationTest {

    /**
     * Distinguishes the accounts these tests create; see {@code PledgeSchemaTests}
     * for why it is a counter and not a slice of the identifier.
     */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    /**
     * How many backers race for the last places.
     *
     * <p>Comfortably more than the connection pool, so that the threads genuinely
     * contend for the tier's row rather than queueing politely one at a time, and
     * comfortably more than the places on offer, so that most of them have to lose.
     */
    private static final int RACERS = 16;

    @Autowired
    private ReservationService reservations;

    @Autowired
    private ReservationCleanerJob cleaner;

    @Autowired
    private PledgeProperties properties;

    @Autowired
    private AdjustableClock clock;

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
    void clearPledgesAndReleaseTheClock() {
        jdbc().update("DELETE FROM pledge_addons");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM reward_tiers");
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
        // The clock is a bean the whole suite shares. A test that froze it and did
        // not let it go would stop every session, token, and story version after it.
        clock.reset();
    }

    // -----------------------------------------------------------------------
    // The point of the issue
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("sixteen backers race for eight places and exactly eight of them win")
    void exactlyTheRemainingPlacesAreSold() throws InterruptedException {
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 10);
        // Two places are already confirmed, so the arithmetic under test is
        // claimed + reserved against the limit and not reserved alone. This is what
        // #52's confirmation will write; nothing else does.
        jdbc().update("UPDATE reward_tiers SET claimed_quantity = 2 WHERE id = ?", tierId);

        Race race = raceForPlaces(projectId, tierId, backers(RACERS));

        // Anything other than a sold-out refusal is a bug: a constraint violation
        // would mean the tier oversold, a deadlock would mean the statement order is
        // wrong, and a timeout would mean a lock is held across something slow.
        assertThat(race.unexpected()).isEmpty();

        assertThat(race.reserved()).isEqualTo(8);
        assertThat(race.soldOut()).isEqualTo(RACERS - 8);

        // Exactly full, never over. V7's constraint would have refused a transaction
        // that went past it, which is why "over" cannot be observed here -- but "under"
        // could, and it would be a place nobody can buy.
        assertThat(reservedQuantity(tierId)).isEqualTo(8);
        assertThat(committedQuantity(tierId)).isEqualTo(10);

        // The count and the rows agree. No constraint checks this: a reservation that
        // took a place without recording it, or recorded one it never took, would pass
        // every check in the database and sell the same place twice.
        assertThat(draftsHolding(tierId)).isEqualTo(8);
    }

    @Test
    @DisplayName("an unlimited tier refuses nobody")
    void anUnlimitedTierNeverRefuses() throws InterruptedException {
        UUID projectId = insertProject();
        // Null limit is unlimited, which is the common case. The conditional update
        // has to let every one of these through rather than reading null as zero.
        UUID tierId = insertTier(projectId, null);

        Race race = raceForPlaces(projectId, tierId, backers(RACERS));

        assertThat(race.unexpected()).isEmpty();
        assertThat(race.soldOut()).isZero();
        assertThat(race.reserved()).isEqualTo(RACERS);

        // The count is still kept. §5.3 lets a creator add a limit later, and the
        // floor it may be lowered to is the places already taken.
        assertThat(reservedQuantity(tierId)).isEqualTo(RACERS);
    }

    // -----------------------------------------------------------------------
    // The same point, for add-ons — #203
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("sixteen backers race for nine add-on places three at a time and exactly three of them win")
    void exactlyTheRemainingAddonPlacesAreSold() throws InterruptedException {
        UUID projectId = insertProject();
        UUID addonId = insertAddon(projectId, 10);
        // One is already confirmed, so nine are left and the arithmetic under test is
        // claimed + reserved + n against the limit rather than reserved alone.
        jdbc().update("UPDATE reward_tiers SET claimed_quantity = 1 WHERE id = ?", addonId);

        Race race = raceForAddonPlaces(projectId, addonId, 3, backers(RACERS));

        // Anything other than a sold-out refusal is a bug: a constraint violation would
        // mean the add-on oversold, a deadlock would mean the statement order is wrong.
        assertThat(race.unexpected()).isEmpty();

        // **This is the assertion #203 exists for.** Nine places, three at a time, is
        // three winners -- and under the implementation that quoted an add-on without
        // holding it, every one of the sixteen would have won and the creator would owe
        // forty-eight of something they have nine of.
        assertThat(race.reserved()).isEqualTo(3);
        assertThat(race.soldOut()).isEqualTo(RACERS - 3);

        assertThat(reservedQuantity(addonId)).isEqualTo(9);
        assertThat(committedQuantity(addonId)).isEqualTo(10);

        // The count and the rows agree. No constraint in V7 checks this: a reservation
        // that took places without recording them, or recorded ones it never took,
        // would satisfy every check in the database and sell the same mug twice.
        assertThat(addonQuantityHeld(addonId)).isEqualTo(9);
    }

    @Test
    @DisplayName("an add-on with too few left refuses the whole quantity rather than selling what it has")
    void anAddonSellsAllOfTheQuantityOrNoneOfIt() {
        UUID projectId = insertProject();
        UUID addonId = insertAddon(projectId, 2);

        // Three asked for, two available. Two is not the answer: the backer was quoted
        // for three, would be charged for three, and the creator would be told to ship
        // three.
        assertThatThrownBy(() -> reservations.draft(draftWithAddon(projectId, insertBacker(), addonId, 3)))
                .isInstanceOf(RewardSoldOutException.class);

        assertThat(reservedQuantity(addonId)).isZero();
        assertThat(addonQuantityHeld(addonId)).isZero();

        // And exactly two is still sold, so the refusal above was about the quantity
        // and not about the add-on being closed.
        assertThatCode(() -> reservations.draft(draftWithAddon(projectId, insertBacker(), addonId, 2)))
                .doesNotThrowAnyException();
        assertThat(reservedQuantity(addonId)).isEqualTo(2);
    }

    @Test
    @DisplayName("an unlimited add-on refuses nobody and still counts every place")
    void anUnlimitedAddonNeverRefuses() throws InterruptedException {
        UUID projectId = insertProject();
        UUID addonId = insertAddon(projectId, null);

        Race race = raceForAddonPlaces(projectId, addonId, 2, backers(RACERS));

        assertThat(race.unexpected()).isEmpty();
        assertThat(race.soldOut()).isZero();
        assertThat(race.reserved()).isEqualTo(RACERS);

        // §5.3 lets a creator add a limit later, and the floor it may be lowered to is
        // the places already taken -- which for an add-on is the quantities, not the
        // pledges.
        assertThat(reservedQuantity(addonId)).isEqualTo(RACERS * 2);
    }

    @Test
    @DisplayName("a draft holding both a reward and an add-on holds one place on the tier and n on the add-on")
    void aRewardAndAnAddonAreHeldTogether() {
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 5);
        UUID addonId = insertAddon(projectId, 5);

        reservations.draft(new DraftPledge(
                projectId,
                insertBacker(),
                tierId,
                List.of(new DraftPledge.AddonSelection(addonId, 3)),
                Money.of(new BigDecimal("19.99"), "AZN"),
                null,
                false,
                null,
                Identifiers.newIdentifier().toString()));

        // §7.2 gives a pledge one reward_tier_id, so the reward is always one place;
        // PL-04 gives the add-on a quantity, so it is three.
        assertThat(reservedQuantity(tierId)).isEqualTo(1);
        assertThat(reservedQuantity(addonId)).isEqualTo(3);
    }

    @Test
    @DisplayName("a lapsed draft gives its add-on places back, not only its reward's")
    void anExpiredReservationGivesBackItsAddonPlacesToo() {
        clock.freeze();
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 1);
        UUID addonId = insertAddon(projectId, 4);

        Pledge held = reservations.draft(new DraftPledge(
                projectId,
                insertBacker(),
                tierId,
                List.of(new DraftPledge.AddonSelection(addonId, 4)),
                Money.of(new BigDecimal("19.99"), "AZN"),
                null,
                false,
                null,
                Identifiers.newIdentifier().toString()));
        assertThat(reservedQuantity(addonId)).isEqualTo(4);

        // Somebody else cannot have one while this checkout is holding all four.
        assertThatThrownBy(() -> reservations.draft(draftWithAddon(projectId, insertBacker(), addonId, 1)))
                .isInstanceOf(RewardSoldOutException.class);

        clock.advance(ttl().plusSeconds(1));
        assertThat(cleaner.releaseExpiredReservations(clock.instant())).isEqualTo(1);

        assertThat(state(held.getId())).isEqualTo("EXPIRED");
        // **Both, and this is the half the sweep never used to do.** A sweep that gave
        // back the reward's place and left the add-on's held would leak stock nothing
        // would ever release, and no constraint in V7 can see stock that is merely
        // never given back.
        assertThat(reservedQuantity(tierId)).isZero();
        assertThat(reservedQuantity(addonId)).isZero();

        // And they are genuinely back on sale, which is the whole point of the sweep.
        assertThatCode(() -> reservations.draft(draftWithAddon(projectId, insertBacker(), addonId, 4)))
                .doesNotThrowAnyException();
        assertThat(reservedQuantity(addonId)).isEqualTo(4);
    }

    // -----------------------------------------------------------------------
    // Time
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a lapsed reservation is released by the sweep and its place is sold again")
    void anExpiredReservationGivesItsPlaceBack() {
        clock.freeze();
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 1);
        UUID first = insertBacker();
        UUID second = insertBacker();

        Pledge held = reservations.reserve(projectId, first, tierId);
        assertThat(reservedQuantity(tierId)).isEqualTo(1);
        // §4.5's five minutes, from the injected clock and not from a literal in the
        // service. Truncated to microseconds because that is what the column holds.
        assertThat(held.getReservationExpiresAt())
                .isEqualTo(clock.instant().truncatedTo(ChronoUnit.MICROS).plus(ttl()));

        // The tier is full while somebody is holding it. This is the refusal §10.4
        // answers as REWARD_SOLD_OUT.
        assertThatThrownBy(() -> reservations.reserve(projectId, second, tierId))
                .isInstanceOf(RewardSoldOutException.class);

        // Nothing has changed except the time.
        clock.advance(ttl().plusSeconds(1));
        assertThat(cleaner.releaseExpiredReservations(clock.instant())).isEqualTo(1);

        assertThat(state(held.getId())).isEqualTo("EXPIRED");
        // §6.2 has no timestamp of its own for a lapse, and this is the column that
        // means "the pledge stopped being active". See V17.
        assertThat(canceledAt(held.getId())).isNotNull();
        assertThat(reservedQuantity(tierId)).isZero();

        // And the place is genuinely back on sale, which is the whole point of
        // releasing it.
        assertThatCode(() -> reservations.reserve(projectId, second, tierId)).doesNotThrowAnyException();
        assertThat(reservedQuantity(tierId)).isEqualTo(1);
    }

    @Test
    @DisplayName("a backer whose own reservation lapsed can start again without waiting for the sweep")
    void aLapsedDraftDoesNotLockItsOwnBackerOut() {
        clock.freeze();
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 1);
        UUID backerId = insertBacker();

        Pledge first = reservations.reserve(projectId, backerId, tierId);

        // §7.2: one pledge per backer per campaign. While the first is live, a second
        // would be two places held by somebody who can only take one.
        assertThatThrownBy(() -> reservations.reserve(projectId, backerId, tierId))
                .isInstanceOf(PledgeAlreadyExistsException.class);

        clock.advance(ttl().plusSeconds(1));

        // Without the sweep having run. The backer is the person whose reservation
        // lapsed, and making them wait up to a minute to be allowed to try again would
        // be a refusal caused entirely by our own scheduling.
        Pledge second = reservations.reserve(projectId, backerId, tierId);

        assertThat(second.getId()).isNotEqualTo(first.getId());
        assertThat(state(first.getId())).isEqualTo("EXPIRED");
        // One released and one taken, not two held: the release and the reservation
        // are in one transaction.
        assertThat(reservedQuantity(tierId)).isEqualTo(1);
        assertThat(draftsHolding(tierId)).isEqualTo(1);
    }

    @Test
    @DisplayName("the sweep releases at most one batch and comes back for the rest")
    void theSweepIsBoundedByItsBatchSize() {
        clock.freeze();
        int batch = properties.reservation().cleanupBatchSize();
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, null);

        for (UUID backerId : backers(batch + 1)) {
            reservations.reserve(projectId, backerId, tierId);
        }
        clock.advance(ttl().plusSeconds(1));

        // A campaign that closed with thousands of checkouts in flight must not be one
        // transaction. The bound is what stops a pass from overlapping its own next
        // tick, and the remainder is found a minute later.
        Instant now = clock.instant();
        assertThat(cleaner.releaseExpiredReservations(now)).isEqualTo(batch);
        assertThat(cleaner.releaseExpiredReservations(now)).isEqualTo(1);
        assertThat(cleaner.releaseExpiredReservations(now)).isZero();

        assertThat(reservedQuantity(tierId)).isZero();
    }

    @Test
    @DisplayName("a pledge confirmed before its window closed is not expired by the sweep")
    void theSweepLeavesConfirmedPledgesAlone() {
        clock.freeze();
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 1);

        Pledge held = reservations.reserve(projectId, insertBacker(), tierId);
        // What #52's confirmation will do. Written here because the endpoint does not
        // exist yet and the property being checked is the sweep's, not its.
        jdbc().update("UPDATE pledges SET state = 'CONFIRMED', confirmed_at = now() WHERE id = ?", held.getId());

        clock.advance(ttl().plusSeconds(1));

        // The sweep looks only at drafts. A pledge somebody has committed to must
        // never be expired out from under them by a timer, and its place must not be
        // handed to somebody else.
        assertThat(cleaner.releaseExpiredReservations(clock.instant())).isZero();
        assertThat(state(held.getId())).isEqualTo("CONFIRMED");
        assertThat(reservedQuantity(tierId)).isEqualTo(1);
    }

    // -----------------------------------------------------------------------
    // What is refused, and how the refusals differ
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a tier that is not this campaign's is a different refusal from a full one")
    void anUnknownTierIsNotSoldOut() {
        UUID projectId = insertProject();
        UUID backerId = insertBacker();
        UUID theirTier = insertTier(insertProject(), 100);

        // Nothing to offer instead of a tier that does not exist, which is why this is
        // not REWARD_SOLD_OUT: §10.4's answer to that carries the alternatives that
        // are left.
        assertThatThrownBy(() -> reservations.reserve(projectId, backerId, Identifiers.newIdentifier()))
                .isInstanceOf(UnknownRewardTierException.class);

        // A tier under somebody else's campaign is the same mistake. V17's composite
        // foreign key would refuse the row; this is what makes the refusal answerable.
        assertThatThrownBy(() -> reservations.reserve(projectId, backerId, theirTier))
                .isInstanceOf(UnknownRewardTierException.class);

        assertThat(draftsHolding(theirTier)).isZero();
    }

    @Test
    @DisplayName("a pledge without a reward holds no place and still expires")
    void aPledgeWithoutARewardHoldsNothing() {
        clock.freeze();
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId, 1);

        // §4.5's PL-02: support without a reward. There is nothing limited to hold, so
        // nothing is reserved -- and the tier next to it is untouched.
        Pledge support = reservations.reserve(projectId, insertBacker(), null);

        assertThat(support.getRewardTierId()).isNull();
        assertThat(support.getTotalAmount()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(reservedQuantity(tierId)).isZero();

        // It still lapses. An abandoned checkout that never expired would block its
        // backer from this campaign for ever, tier or no tier.
        assertThat(support.getReservationExpiresAt()).isNotNull();
        clock.advance(ttl().plusSeconds(1));
        assertThat(cleaner.releaseExpiredReservations(clock.instant())).isEqualTo(1);
        assertThat(state(support.getId())).isEqualTo("EXPIRED");
    }

    // -----------------------------------------------------------------------
    // The race
    // -----------------------------------------------------------------------

    /**
     * The same race, for §4.5's PL-04: every backer asks for {@code quantity} of one
     * add-on at once, on a pledge with no reward of its own.
     *
     * <p>No reward tier, deliberately. The add-on's counters are the thing under test,
     * and a reward tier in the selection would give the checkout a second row it could
     * be refused by — a run where every backer lost because the <em>tier</em> ran out
     * would look exactly like a run where the add-on behaved.
     */
    private Race raceForAddonPlaces(UUID projectId, UUID addonId, int quantity, List<UUID> backers)
            throws InterruptedException {

        return race(backers, backerId -> reservations.draft(draftWithAddon(projectId, backerId, addonId, quantity)));
    }

    /**
     * Every backer calls {@link ReservationService#reserve} at once, and what each of
     * them was told is counted.
     */
    private Race raceForPlaces(UUID projectId, UUID tierId, List<UUID> backers) throws InterruptedException {
        return race(backers, backerId -> reservations.reserve(projectId, backerId, tierId));
    }

    /**
     * One checkout per backer, all released together, with what each was told counted.
     *
     * <p>The latch is what makes it a race. Submitting the tasks is not enough: a pool
     * that starts the first thread before the last one is queued would let the early
     * ones finish before the late ones begin, and the test would pass against an
     * implementation with no concurrency control at all.
     */
    private Race race(List<UUID> backers, Checkout checkout) throws InterruptedException {
        ExecutorService pool = Executors.newFixedThreadPool(backers.size());
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(backers.size());
        AtomicInteger reserved = new AtomicInteger();
        AtomicInteger soldOut = new AtomicInteger();
        List<Throwable> unexpected = Collections.synchronizedList(new ArrayList<>());

        try {
            for (UUID backerId : backers) {
                pool.execute(() -> {
                    try {
                        start.await();
                        checkout.run(backerId);
                        reserved.incrementAndGet();
                    } catch (RewardSoldOutException e) {
                        soldOut.incrementAndGet();
                    } catch (Throwable t) {
                        // Kept rather than logged: an exception swallowed inside a
                        // thread is a test that passes while the thing it is about
                        // is broken.
                        unexpected.add(t);
                    } finally {
                        finished.countDown();
                    }
                });
            }

            start.countDown();
            // Generous, because it is a deadlock detector rather than a performance
            // assertion: sixteen short transactions against a local container take
            // milliseconds, and anything approaching this means they are waiting on
            // each other.
            assertThat(finished.await(60, TimeUnit.SECONDS))
                    .withFailMessage("The reservations did not finish; something is holding a lock")
                    .isTrue();
        } finally {
            pool.shutdownNow();
        }

        return new Race(reserved.get(), soldOut.get(), List.copyOf(unexpected));
    }

    /** One backer's attempt, so that both races can share {@link #race}. */
    private interface Checkout {
        void run(UUID backerId);
    }

    /** What sixteen simultaneous checkouts were told. */
    private record Race(int reserved, int soldOut, List<Throwable> unexpected) {
    }

    // -----------------------------------------------------------------------
    // Fixtures and readings
    // -----------------------------------------------------------------------

    private Duration ttl() {
        return properties.reservation().ttl();
    }

    private List<UUID> backers(int count) {
        List<UUID> backers = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            backers.add(insertBacker());
        }
        return backers;
    }

    private UUID insertBacker() {
        UUID id = Identifiers.newIdentifier();
        String marker = "reservation-" + SEQUENCE.incrementAndGet();
        jdbc().update(
                        "INSERT INTO users (id, email, name, slug) VALUES (?, ?::citext, ?, ?)",
                        id,
                        marker + "@example.com",
                        "Test Backer",
                        marker);
        return id;
    }

    private UUID insertProject() {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        "INSERT INTO projects (id, creator_id, slug, title) VALUES (?, ?, ?, ?)",
                        id,
                        insertBacker(),
                        "a-campaign-" + SEQUENCE.incrementAndGet(),
                        "A campaign");
        return id;
    }

    /**
     * @param limitQuantity null is unlimited, which is the common case. The column is
     *     left out of the statement rather than bound to null, so that the row is the
     *     one the editor would have written and the driver is not asked to guess the
     *     type of a null
     */
    private UUID insertTier(UUID projectId, Integer limitQuantity) {
        UUID id = Identifiers.newIdentifier();
        if (limitQuantity == null) {
            jdbc().update(
                            "INSERT INTO reward_tiers (id, project_id, title, amount) VALUES (?, ?, ?, ?)",
                            id,
                            projectId,
                            "An unlimited reward",
                            new BigDecimal("19.99"));
            return id;
        }
        jdbc().update(
                        """
                        INSERT INTO reward_tiers (id, project_id, title, amount, limit_quantity)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        id,
                        projectId,
                        "A limited reward",
                        new BigDecimal("19.99"),
                        limitQuantity);
        return id;
    }

    /**
     * An add-on: the same {@code reward_tiers} row with {@code is_addon} set, which is
     * exactly what V7 makes it and exactly why it carries the same three counters.
     *
     * @param limitQuantity null is unlimited, for {@link #insertTier}'s reason
     */
    private UUID insertAddon(UUID projectId, Integer limitQuantity) {
        UUID id = insertTier(projectId, limitQuantity);
        jdbc().update("UPDATE reward_tiers SET is_addon = true WHERE id = ?", id);
        return id;
    }

    /** A support-only pledge that takes {@code quantity} of one add-on. §4.5's PL-02 plus PL-04. */
    private DraftPledge draftWithAddon(UUID projectId, UUID backerId, UUID addonId, int quantity) {
        return new DraftPledge(
                projectId,
                backerId,
                null,
                List.of(new DraftPledge.AddonSelection(addonId, quantity)),
                // The tier's own currency, which is what selectionFor quotes against.
                Money.of(new BigDecimal("1.00"), "AZN"),
                null,
                false,
                null,
                Identifiers.newIdentifier().toString());
    }

    /**
     * How many of an add-on the live drafts say they are holding.
     *
     * <p>The counterpart of {@link #draftsHolding} for a tier whose lines carry a
     * quantity: what has to match {@code reserved_quantity} is the sum of the
     * quantities, not the number of pledges.
     */
    private int addonQuantityHeld(UUID addonId) {
        return read(
                """
                SELECT coalesce(sum(addon.quantity), 0)
                  FROM pledge_addons addon
                  JOIN pledges pledge ON pledge.id = addon.pledge_id
                 WHERE addon.reward_tier_id = ? AND pledge.state = 'DRAFT'
                """,
                addonId);
    }

    private int reservedQuantity(UUID tierId) {
        return read("SELECT reserved_quantity FROM reward_tiers WHERE id = ?", tierId);
    }

    private int committedQuantity(UUID tierId) {
        return read("SELECT claimed_quantity + reserved_quantity FROM reward_tiers WHERE id = ?", tierId);
    }

    private int draftsHolding(UUID tierId) {
        return read("SELECT count(*) FROM pledges WHERE reward_tier_id = ? AND state = 'DRAFT'", tierId);
    }

    private int read(String sql, UUID id) {
        Integer value = jdbc().queryForObject(sql, Integer.class, id);
        return value == null ? 0 : value;
    }

    private String state(UUID pledgeId) {
        return jdbc().queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledgeId);
    }

    private Instant canceledAt(UUID pledgeId) {
        return jdbc().queryForObject("SELECT canceled_at FROM pledges WHERE id = ?", Instant.class, pledgeId);
    }
}
