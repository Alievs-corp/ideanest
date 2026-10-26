package az.ideanest.shared;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.ratelimit.InMemoryRateLimiter;
import az.ideanest.shared.ratelimit.RateLimiter.RateLimitDecision;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The limiter, driven by a clock the test controls.
 *
 * <p>Testing this by sleeping would make the suite slower than the window it is
 * testing, which is why the clock is injected.
 */
class InMemoryRateLimiterTests {

    private static final Instant START = Instant.parse("2026-08-14T12:00:00Z");
    private static final Duration WINDOW = Duration.ofMinutes(15);

    /** A clock the test moves by hand. */
    private static final class MovableClock extends Clock {
        private Instant now;

        private MovableClock(Instant now) {
            this.now = now;
        }

        void advanceBy(Duration amount) {
            now = now.plus(amount);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }

    @Test
    @DisplayName("attempts are allowed up to the limit and refused after it")
    void refusesPastTheLimit() {
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(new MovableClock(START));

        for (int attempt = 0; attempt < 5; attempt++) {
            assertThat(limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW).allowed()).isTrue();
        }
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW).allowed()).isFalse();
    }

    @Test
    @DisplayName("keys are independent")
    void keysDoNotInterfere() {
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(new MovableClock(START));

        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW);
        }

        // One client exhausting its allowance must not lock out everyone else,
        // which is what a global counter would do.
        assertThat(limiter.recordAttempt("ip:5.6.7.8", 5, WINDOW).allowed()).isTrue();
    }

    @Test
    @DisplayName("the window slides, so a boundary does not grant a second allowance")
    void windowSlidesRatherThanResetting() {
        MovableClock clock = new MovableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW);
        }

        // A fixed window would reset here and let five more through
        // immediately: ten attempts in a moment against a limit of five.
        clock.advanceBy(Duration.ofMinutes(14));
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW).allowed()).isFalse();

        clock.advanceBy(Duration.ofMinutes(16));
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW).allowed()).isTrue();
    }

    @Test
    @DisplayName("a refusal says how long to wait")
    void refusalCarriesRetryAfter() {
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(new MovableClock(START));

        for (int attempt = 0; attempt < 3; attempt++) {
            limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW);
        }
        RateLimitDecision refused = limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW);

        assertThat(refused.allowed()).isFalse();
        assertThat(refused.retryAfter()).isPositive().isLessThanOrEqualTo(WINDOW);
    }

    @Test
    @DisplayName("a decision says how much of the budget is left")
    void decisionsCarryTheRemainingAllowance() {
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(new MovableClock(START));

        // Counted down rather than up, and never below zero, because this is the
        // number a client is handed and asked to act on.
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).remaining()).isEqualTo(2);
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).remaining()).isEqualTo(1);
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).remaining()).isZero();
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).remaining()).isZero();
    }

    @Test
    @DisplayName("a decision carries the policy it was made against")
    void decisionsCarryTheirPolicy() {
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(new MovableClock(START));

        RateLimitDecision decision = limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW);

        // So that whoever reports the limit reports the one that was applied,
        // rather than reading a second copy of the configuration that may have
        // been bound from somewhere else.
        assertThat(decision.limit()).isEqualTo(3);
        assertThat(decision.window()).isEqualTo(WINDOW);
        assertThat(decision.resetAfter()).isEqualTo(WINDOW);
    }

    @Test
    @DisplayName("the allowance grows back when the oldest attempt leaves the window")
    void resetFollowsTheOldestAttempt() {
        MovableClock clock = new MovableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW);
        clock.advanceBy(Duration.ofMinutes(5));

        // Not a full window from now: the first attempt has already served five
        // of its fifteen minutes, and a client told to wait fifteen more would
        // idle through ten minutes of allowance it already had.
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).resetAfter()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    @DisplayName("attempts made while refused keep counting")
    void refusedAttemptsStillCount() {
        MovableClock clock = new MovableClock(START);
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(clock);

        for (int attempt = 0; attempt < 5; attempt++) {
            limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW);
        }

        // Keep hammering for the whole window.
        for (int minute = 0; minute < 15; minute++) {
            clock.advanceBy(Duration.ofMinutes(1));
            assertThat(limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW).allowed()).isFalse();
        }

        // A limiter that stopped counting once refused would let this client
        // back in as the original attempts aged out, which rewards persistence.
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 5, WINDOW).allowed()).isFalse();
    }

    @Test
    @DisplayName("a refunded attempt is given back, and refunding nothing changes nothing")
    void refundGivesTheLatestAttemptBack() {
        InMemoryRateLimiter limiter = new InMemoryRateLimiter(new MovableClock(START));

        // #587's sign-in: counted before the password is checked, given back when it
        // was right. Five successes in a row must leave the budget untouched.
        for (int attempt = 0; attempt < 5; attempt++) {
            assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).allowed()).isTrue();
            limiter.refund("ip:1.2.3.4");
        }
        assertThat(limiter.recordAttempt("ip:1.2.3.4", 3, WINDOW).remaining()).isEqualTo(2);

        limiter.refund("ip:never-seen");
        assertThat(limiter.recordAttempt("ip:never-seen", 3, WINDOW).remaining()).isEqualTo(2);
    }
}
