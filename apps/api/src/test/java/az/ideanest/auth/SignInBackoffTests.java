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
 * five free failures per account and address, then 30 seconds doubling to a 15-minute
 * ceiling, forgotten a day after the last failure; and fifty failures an hour per account
 * across every address.
 */
class SignInBackoffTests {

    private static final Instant START = Instant.parse("2026-10-26T10:00:00Z");
    private static final String ACCOUNT = "someone@example.com";
    private static final String ADDRESS = "203.0.113.7";
    private static final String OWNER_ADDRESS = "198.51.100.20";

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
                5, 3, 20, 5, 3, 10, 5, 5, 5, 10, 20, 50,
                Duration.ofSeconds(30), Duration.ofMinutes(15), Duration.ofHours(24), Duration.ofHours(1),
                Duration.ofMinutes(15));
        return new AuthProperties(null, null, null, 12, 256, null, limits, null, null, null, null, false, false);
    }

    private void fail(int times) {
        failFrom(ADDRESS, times);
    }

    private void failFrom(String address, int times) {
        for (int attempt = 0; attempt < times; attempt++) {
            assertThat(backoff.admit(ACCOUNT, address).allowed()).isTrue();
        }
    }

    private RateLimitDecision attempt() {
        return backoff.admit(ACCOUNT, ADDRESS);
    }

    @Test
    @DisplayName("five failures are free, and the sixth waits thirty seconds rather than fifteen minutes")
    void backsOffInsteadOfLockingOut() {
        fail(5);

        RateLimitDecision refused = attempt();
        assertThat(refused.allowed()).isFalse();
        assertThat(refused.retryAfter()).isEqualTo(Duration.ofSeconds(30));

        clock.advanceBy(Duration.ofSeconds(30));
        assertThat(attempt().allowed()).isTrue();
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
            assertThat(attempt().retryAfter()).isEqualTo(wait);
            clock.advanceBy(wait);
            assertThat(attempt().allowed()).isTrue();
        }
    }

    @Test
    @DisplayName("a refused attempt is not counted, so hammering does not push the owner's chance away")
    void refusalsAreNotCounted() {
        fail(5);

        for (int attempt = 0; attempt < 20; attempt++) {
            clock.advanceBy(Duration.ofSeconds(1));
            assertThat(attempt().allowed()).isFalse();
        }

        // Thirty seconds after the fifth failure, however many refusals came between.
        clock.advanceBy(Duration.ofSeconds(10));
        assertThat(attempt().allowed()).isTrue();
    }

    @Test
    @DisplayName("a completed sign-in clears the count, so successes never count")
    void aCompletedSignInClearsTheAddress() {
        for (int signIn = 0; signIn < 60; signIn++) {
            signInCorrectly();
        }

        fail(4);
        signInCorrectly();
        fail(5);
        assertThat(attempt().allowed()).isFalse();
    }

    /** A correct password with no second factor to follow: what TokenController does. */
    private void signInCorrectly() {
        assertThat(attempt().allowed()).isTrue();
        backoff.passwordAccepted(ACCOUNT, ADDRESS);
        backoff.signedIn(ACCOUNT, ADDRESS);
    }

    @Test
    @DisplayName("failures are forgotten a day after the last one, and not a moment sooner")
    void failuresAreForgottenAfterTheMemory() {
        fail(5);

        clock.advanceBy(Duration.ofHours(23));
        assertThat(attempt().allowed()).isTrue();
        // That attempt was the sixth failure, so the next one backs off again.
        assertThat(attempt().allowed()).isFalse();

        clock.advanceBy(Duration.ofHours(24));
        fail(5);
    }

    @Test
    @DisplayName("accounts are independent")
    void accountsDoNotInterfere() {
        fail(5);

        assertThat(backoff.admit("somebody-else@example.com", ADDRESS).allowed()).isTrue();
    }

    // ------------------------------------------------------------------
    // Per address, under a ceiling per account
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a stranger's failures hold back the stranger's address, not the owner's")
    void theOwnerIsNotHeldBackByAStranger() {
        fail(5);
        assertThat(attempt().allowed()).isFalse();

        // The review finding: while the account backed off as a whole, one wrong
        // password each time it opened kept its owner out indefinitely.
        assertThat(backoff.admit(ACCOUNT, OWNER_ADDRESS).allowed()).isTrue();
        backoff.passwordAccepted(ACCOUNT, OWNER_ADDRESS);
        backoff.signedIn(ACCOUNT, OWNER_ADDRESS);

        // And the owner signing in elsewhere does not open the stranger's address.
        assertThat(attempt().allowed()).isFalse();
    }

    @Test
    @DisplayName("fifty failures in an hour from many addresses close the account, from everywhere")
    void theCeilingHoldsAcrossAddresses() {
        for (int address = 0; address < 10; address++) {
            failFrom("192.0.2." + address, 5);
        }

        // A fresh address, with its own five free failures untouched, is still refused.
        RateLimitDecision refused = backoff.admit(ACCOUNT, OWNER_ADDRESS);
        assertThat(refused.allowed()).isFalse();
        assertThat(refused.limit()).isEqualTo(50);
        assertThat(refused.retryAfter()).isEqualTo(Duration.ofHours(1));

        // Refusals are not counted, so hammering does not hold the ceiling shut.
        for (int attempt = 0; attempt < 20; attempt++) {
            assertThat(backoff.admit(ACCOUNT, "192.0.2.200").allowed()).isFalse();
        }

        // A sliding hour: once the first failures leave it, the account opens again.
        clock.advanceBy(Duration.ofHours(1));
        assertThat(backoff.admit(ACCOUNT, OWNER_ADDRESS).allowed()).isTrue();
    }

    @Test
    @DisplayName("a completed sign-in does not hand back the account's ceiling")
    void signingInDoesNotResetTheCeiling() {
        for (int address = 0; address < 9; address++) {
            failFrom("192.0.2." + address, 5);
        }

        // Correct passwords are not failures, so they never reach the ceiling...
        for (int signIn = 0; signIn < 10; signIn++) {
            assertThat(backoff.admit(ACCOUNT, OWNER_ADDRESS).allowed()).isTrue();
            backoff.passwordAccepted(ACCOUNT, OWNER_ADDRESS);
            backoff.signedIn(ACCOUNT, OWNER_ADDRESS);
        }

        // ...and do not wipe the failures from everywhere else either.
        failFrom("192.0.2.100", 5);
        assertThat(backoff.admit(ACCOUNT, "192.0.2.101").allowed()).isFalse();
    }

    // ------------------------------------------------------------------
    // Two-factor
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a correct password that only buys a two-factor challenge does not clear the failures")
    void aChallengeDoesNotClearTheBackoff() {
        fail(4);

        // The password was right, but the code is still to come: the attempt is given
        // back and nothing else is.
        assertThat(attempt().allowed()).isTrue();
        backoff.passwordAccepted(ACCOUNT, ADDRESS);

        fail(1);
        assertThat(attempt().allowed()).isFalse();
    }

    @Test
    @DisplayName("wrong two-factor codes count as failed sign-ins, and a completed challenge clears them")
    void wrongCodesCount() {
        for (int code = 0; code < 5; code++) {
            backoff.codeRejected(ACCOUNT, ADDRESS);
        }
        assertThat(attempt().allowed()).isFalse();

        clock.advanceBy(Duration.ofSeconds(30));
        assertThat(attempt().allowed()).isTrue();
        backoff.passwordAccepted(ACCOUNT, ADDRESS);
        backoff.signedIn(ACCOUNT, ADDRESS);

        fail(5);
    }

    @Test
    @DisplayName("wrong two-factor codes from many addresses reach the account's ceiling")
    void wrongCodesReachTheCeiling() {
        // A stolen password, sent from ten addresses, each challenge spent on five
        // wrong codes. Each password attempt is given back; the codes are not.
        for (int address = 0; address < 10; address++) {
            String from = "192.0.2." + address;
            assertThat(backoff.admit(ACCOUNT, from).allowed()).isTrue();
            backoff.passwordAccepted(ACCOUNT, from);
            for (int code = 0; code < 5; code++) {
                backoff.codeRejected(ACCOUNT, from);
            }
        }

        assertThat(backoff.admit(ACCOUNT, "192.0.2.100").allowed()).isFalse();
    }
}
