package az.ideanest.shared.ratelimit;

import java.time.Duration;

/**
 * A counter with a window, used to make guessing expensive.
 *
 * <p>The interface exists so that the in-memory implementation can be replaced
 * by a Redis one without touching a caller. That replacement is not optional
 * once there is more than one instance: see {@link InMemoryRateLimiter}.
 */
public interface RateLimiter {

    /**
     * Records an attempt against {@code key} and says whether it is allowed.
     *
     * <p>Counts the attempt either way. A limiter that stops counting once the
     * limit is reached lets a client that keeps hammering slide back under the
     * limit as the window moves, which is the opposite of what it is for.
     */
    RateLimitDecision recordAttempt(String key, int limit, Duration window);

    /**
     * Gives back the most recent attempt recorded against {@code key}.
     *
     * <p>For a budget that is meant to count failures, where whether an attempt
     * failed is only known after the work it guards. Counting first and refunding
     * a success is what keeps that budget exact under concurrency: checking first
     * and counting afterwards lets a client fire a hundred requests at once and
     * have every one of them pass the check before the first failure is counted.
     * Sign-in is the caller (#587). A key with nothing recorded is left alone.
     */
    void refund(String key);

    /**
     * The outcome, and enough of the policy behind it to tell the caller where it
     * stands.
     *
     * <p><strong>It carries the policy as well as the verdict</strong> so that
     * {@link RateLimits} can report §10.3's rate-limit headers without asking the
     * limiter a second question. The alternative — a bare boolean, and a second call
     * to read the counter — would report a number that a concurrent request from the
     * same client had already moved, which is a header that is wrong exactly when the
     * client is close enough to the limit to care.
     *
     * @param allowed whether this attempt may proceed. The attempt is counted either
     *     way; see {@link #recordAttempt}
     * @param limit the budget this decision was made against, so the caller can be
     *     told what it is spending
     * @param remaining what is left of that budget after this attempt, never negative
     * @param window the period the budget is allowed over
     * @param resetAfter how long until the budget grows again — the moment the oldest
     *     attempt still being counted leaves the window. On a refusal that is exactly
     *     how long the caller has to wait, which is what {@link #retryAfter()} returns
     */
    record RateLimitDecision(boolean allowed, int limit, int remaining, Duration window, Duration resetAfter) {

        public static RateLimitDecision allow(int limit, int remaining, Duration window, Duration resetAfter) {
            return new RateLimitDecision(true, limit, remaining, window, resetAfter);
        }

        public static RateLimitDecision refuse(int limit, Duration window, Duration resetAfter) {
            return new RateLimitDecision(false, limit, 0, window, resetAfter);
        }

        /**
         * How long to wait before retrying, and zero when nothing was refused.
         *
         * <p>Derived rather than stored: a refusal lasts until the window gives a unit
         * back, so "when may I retry" and "when does the budget grow" are one instant
         * with two names, and storing both is two chances for them to disagree.
         */
        public Duration retryAfter() {
            return allowed ? Duration.ZERO : resetAfter;
        }
    }
}
