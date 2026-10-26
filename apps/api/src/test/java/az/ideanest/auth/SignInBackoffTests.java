package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.SignInBackoff;
import az.ideanest.shared.ratelimit.RateLimiter.RateLimitDecision;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The per-account sign-in back-off (#587), driven by a clock the test moves.
 *
 * <p>The production numbers, so that what is asserted is the policy a person meets:
 * five free failures, then 30 seconds doubling to a 15-minute ceiling, forgotten a day
 * after the last failure.
 */
class SignInBackoffTests {

    private static final Instant START = Instant.parse("2026-10-26T10:00:00Z");
    private static final String ACCOUNT = "someone@example.com";

    /** A clock the test moves by hand. */
    private static final class MovableClock extends Clock {
        private Instant now = START;

        void advanceBy(Duration amount) {
            now = now.plus(amount);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }

    private final MovableClock clock = new MovableClock();

    private final SignInBackoff backoff = new SignInBackoff(properties(), clock);

    private static AuthProperties properties() {
        AuthProperties.RateLimit limits = new AuthProperties.RateLimit(
                5, 3, 20, 5, 3, 10, 5, 5, 5, 10, 20,
                Duration.ofSeconds(30), Duration.ofMinutes(15), Duration.ofHours(24),
                Duration.ofMinutes(15));
        return new AuthProperties(null, null, null, 12, 256, null, limits, null, null, null, null, false);
    }

    private void fail(int times) {
        for (int attempt = 0; attempt < times; attempt++) {
            assertThat(backoff.admit(ACCOUNT).allowed()).isTrue();
        }
    }

    @Test
    @DisplayName("five failures are free, and the sixth waits thirty seconds rather than fifteen minutes")
    void backsOffInsteadOfLockingOut() {
        fail(5);

        RateLimitDecision refused = backoff.admit(ACCOUNT);
        assertThat(refused.allowed()).isFalse();
        assertThat(refused.retryAfter()).isEqualTo(Duration.ofSeconds(30));

        clock.advanceBy(Duration.ofSeconds(30));
        assertThat(backoff.admit(ACCOUNT).allowed()).isTrue();
    }

    @Test
    @DisplayName("each further failure doubles the wait, up to the ceiling")
    void theWaitDoublesToTheCeiling() {
        fail(5);

        Duration[] waits = {
            Duration.ofSeconds(30), Duration.ofMinutes(1), Duration.ofMinutes(2), Duration.ofMinutes(4),
            Duration.ofMinutes(8), Duration.ofMinutes(15), Duration.ofMinutes(15)
        };
        for (Duration wait : waits) {
            assertThat(backoff.admit(ACCOUNT).retryAfter()).isEqualTo(wait);
            clock.advanceBy(wait);
            assertThat(backoff.admit(ACCOUNT).allowed()).isTrue();
        }
    }

    @Test
    @DisplayName("a refused attempt is not counted, so hammering does not push the owner's chance away")
    void refusalsAreNotCounted() {
        fail(5);

        for (int attempt = 0; attempt < 20; attempt++) {
            clock.advanceBy(Duration.ofSeconds(1));
            assertThat(backoff.admit(ACCOUNT).allowed()).isFalse();
        }

        // Thirty seconds after the fifth failure, however many refusals came between.
        clock.advanceBy(Duration.ofSeconds(10));
        assertThat(backoff.admit(ACCOUNT).allowed()).isTrue();
    }

    @Test
    @DisplayName("a correct password clears the count, so successes never count")
    void aCorrectPasswordClearsEverything() {
        for (int signIn = 0; signIn < 20; signIn++) {
            assertThat(backoff.admit(ACCOUNT).allowed()).isTrue();
            backoff.passwordAccepted(ACCOUNT);
        }

        fail(4);
        backoff.passwordAccepted(ACCOUNT);
        fail(5);
        assertThat(backoff.admit(ACCOUNT).allowed()).isFalse();
    }

    @Test
    @DisplayName("failures are forgotten a day after the last one, and not a moment sooner")
    void failuresAreForgottenAfterTheMemory() {
        fail(5);

        clock.advanceBy(Duration.ofHours(23));
        assertThat(backoff.admit(ACCOUNT).allowed()).isTrue();
        // That attempt was the sixth failure, so the next one backs off again.
        assertThat(backoff.admit(ACCOUNT).allowed()).isFalse();

        clock.advanceBy(Duration.ofHours(24));
        fail(5);
    }

    @Test
    @DisplayName("accounts are independent")
    void accountsDoNotInterfere() {
        fail(5);

        assertThat(backoff.admit("somebody-else@example.com").allowed()).isTrue();
    }
}
