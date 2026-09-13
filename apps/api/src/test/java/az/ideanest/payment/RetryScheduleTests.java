package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.payment.application.RetrySchedule;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * §9.6's table, asserted (#65).
 *
 * <table border="1">
 *   <caption>§9.6, verbatim</caption>
 *   <tr><th>Attempt</th><th>Timing</th><th>Channel</th></tr>
 *   <tr><td>1</td><td>Immediately after close</td><td>—</td></tr>
 *   <tr><td>2</td><td>+24 hours</td><td>Email and push</td></tr>
 *   <tr><td>3</td><td>+72 hours</td><td>Email, push, in-app banner</td></tr>
 *   <tr><td>4</td><td>+5 days</td><td>Email, final warning</td></tr>
 *   <tr><td>—</td><td>+7 days</td><td>Pledge dropped</td></tr>
 * </table>
 *
 * <p>A plain unit test with properties built by hand, so that the numbers under test are
 * §9.6's rather than {@code application-test.yml}'s. A schedule test that read its own
 * expectations out of configuration would pass whatever the configuration said.
 */
class RetryScheduleTests {

    /** Midnight, so that the arithmetic below is readable rather than merely correct. */
    private static final Instant CLOSED = Instant.parse("2026-03-01T00:00:00Z");

    private final RetrySchedule schedule = new RetrySchedule(properties());

    @Test
    @DisplayName("§9.6's first attempt is immediately after the close")
    void theFirstAttemptIsImmediate() {
        assertThat(schedule.firstAttemptAt(CLOSED)).isEqualTo(CLOSED);
    }

    /**
     * <strong>The timings are measured from the close, not from the previous attempt.</strong>
     *
     * <p>The distinction is the whole of this test. Read as intervals, "+24 hours" then
     * "+72 hours" then "+5 days" would put the fourth attempt at nine days — past the
     * seven-day window, so the last two attempts would never happen and the schedule
     * would silently be a two-attempt one.
     */
    @Test
    @DisplayName("the four attempts fall at +0, +24h, +72h and +5 days from the close")
    void theAttemptsFallWhereTheTableSays() {
        assertThat(schedule.nextAttemptAt(CLOSED, 1)).isEqualTo(CLOSED.plus(Duration.ofHours(24)));
        assertThat(schedule.nextAttemptAt(CLOSED, 2)).isEqualTo(CLOSED.plus(Duration.ofHours(72)));
        assertThat(schedule.nextAttemptAt(CLOSED, 3)).isEqualTo(CLOSED.plus(Duration.ofDays(5)));
    }

    @Test
    @DisplayName("every attempt falls inside the seven-day window")
    void everyAttemptIsInsideTheWindow() {
        Instant windowEnds = schedule.windowEndsAt(CLOSED);

        assertThat(windowEnds).isEqualTo(CLOSED.plus(Duration.ofDays(7)));
        for (int attemptsMade = 0; attemptsMade < 4; attemptsMade++) {
            assertThat(schedule.nextAttemptAt(CLOSED, attemptsMade))
                    .as("attempt %d is scheduled before the pledge would be dropped", attemptsMade + 1)
                    .isBefore(windowEnds);
        }
    }

    /**
     * V42 refuses a queued pledge with no {@code next_charge_attempt_at}, so the schedule
     * cannot answer "there is no next attempt" with null. It answers with the moment the
     * pledge will be dropped, which is both true and outside every window the sweep looks
     * inside.
     */
    @Test
    @DisplayName("after the last attempt the next one is the end of the window")
    void theScheduleRunsOutAtTheWindow() {
        assertThat(schedule.nextAttemptAt(CLOSED, 4)).isEqualTo(schedule.windowEndsAt(CLOSED));
        assertThat(schedule.nextAttemptAt(CLOSED, 9)).isEqualTo(schedule.windowEndsAt(CLOSED));
    }

    @Test
    @DisplayName("the close is recoverable from the window a pledge carries")
    void theCloseIsRecoverableFromTheWindow() {
        // The pledge freezes the end of its window rather than the close, so this
        // subtraction is what the collection run measures the next slot from. If the two
        // ever disagreed, every retry after the first would be scheduled against the
        // wrong origin.
        assertThat(schedule.closedAtFrom(schedule.windowEndsAt(CLOSED))).isEqualTo(CLOSED);
    }

    @Test
    @DisplayName("an undecided charge is asked about again long before the next attempt would be")
    void anUndecidedChargeIsRecheckedSoon() {
        Instant now = CLOSED.plus(Duration.ofMinutes(3));

        assertThat(schedule.recheckAt(now)).isEqualTo(now.plus(Duration.ofHours(1)));
        assertThat(schedule.recheckAt(now))
                .as("the platform is waiting on an answer, not on a backer to change their card")
                .isBefore(schedule.nextAttemptAt(CLOSED, 1));
    }

    // ------------------------------------------------------------------
    // §9.6's channel column
    // ------------------------------------------------------------------

    /**
     * <strong>§9.6's table gives attempt 1 no channel, and §9.2's diagram disagrees.</strong>
     *
     * <p>The sequence diagram in §9.2 shows "notify — update your card" immediately after
     * the first decline and <em>then</em> "four retries across seven days". The table is
     * followed, because it is the more specific artefact and the one that carries the
     * timings the rest of this class implements — and because attempt 2 is only
     * twenty-four hours behind, so the backer is told, and told once rather than twice
     * about one card in a day. {@code docs/architecture.md} §9.6 records the
     * disagreement.
     */
    @Test
    @DisplayName("the first attempt's failure is not announced; every later one is")
    void theFirstFailureIsSilent() {
        assertThat(schedule.notifiesBacker(1)).isFalse();
        assertThat(schedule.notifiesBacker(2)).isTrue();
        assertThat(schedule.notifiesBacker(3)).isTrue();
        assertThat(schedule.notifiesBacker(4)).isTrue();
    }

    /**
     * "The last one" is a fact about the configured schedule rather than the number four.
     *
     * <p>Asserted against a five-attempt schedule as well, because the failure this
     * prevents is silent: adding a fifth attempt while the warning stays on the fourth
     * means a backer is told "this is the final notice" and then charged again.
     */
    @Test
    @DisplayName("the final warning is the last attempt of whatever schedule is configured")
    void theFinalWarningFollowsTheSchedule() {
        assertThat(schedule.isFinalAttempt(3)).isFalse();
        assertThat(schedule.isFinalAttempt(4)).isTrue();

        RetrySchedule five = new RetrySchedule(propertiesWith(List.of(
                Duration.ZERO,
                Duration.ofHours(24),
                Duration.ofHours(72),
                Duration.ofDays(5),
                Duration.ofDays(6))));
        assertThat(five.isFinalAttempt(4)).isFalse();
        assertThat(five.isFinalAttempt(5)).isTrue();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static PaymentProperties properties() {
        return propertiesWith(List.of(
                Duration.ZERO, Duration.ofHours(24), Duration.ofHours(72), Duration.ofDays(5)));
    }

    private static PaymentProperties propertiesWith(List<Duration> delays) {
        return new PaymentProperties(
                null,
                new PaymentProperties.Collection(
                        "-", "-", 20, 100, 200, Duration.ofDays(7), delays, Duration.ofHours(1), "IdeaNest"),
                null,
                null,
                null,
                null);
    }
}
