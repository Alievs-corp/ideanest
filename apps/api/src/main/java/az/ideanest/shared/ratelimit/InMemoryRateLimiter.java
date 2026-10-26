package az.ideanest.shared.ratelimit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * A sliding-window rate limiter held in this process's heap.
 *
 * <p><strong>This is correct for one instance and wrong for two.</strong> Two
 * replicas each enforce the limit separately, so the effective limit is the
 * configured one multiplied by the number of instances — "5 per 15 minutes"
 * across three replicas is fifteen — and a client that reconnects lands wherever
 * the load balancer sends it. The shared counter belongs in the shared storage
 * of #134; until then this is honest protection against a script and no
 * protection against a botnet, and the deployment is single-instance anyway.
 * Nothing outside this package knows which it is talking to, which is what makes
 * that swap a bean definition rather than an edit to every call site.
 *
 * <p>A sliding window rather than a fixed one because a fixed window lets twice
 * the limit through across a boundary: five attempts at 14:59:59 and five more
 * at 15:00:00 is ten in one second against a limit of five per fifteen minutes.
 */
@Component
public class InMemoryRateLimiter implements RateLimiter {

    /**
     * A bound on memory. Each entry is a key and at most {@code limit}
     * timestamps; without a cap, an attacker varying the key — a different
     * email address per request — turns the limiter itself into the attack.
     */
    private static final int MAX_TRACKED_KEYS = 100_000;

    private final Map<String, Deque<Instant>> attempts = new ConcurrentHashMap<>();
    private final Clock clock;

    public InMemoryRateLimiter(Clock clock) {
        this.clock = clock;
    }

    @Override
    public RateLimitDecision recordAttempt(String key, int limit, Duration window) {
        Instant now = clock.instant();
        Instant windowStart = now.minus(window);

        if (attempts.size() >= MAX_TRACKED_KEYS) {
            evictExpired(windowStart);
        }

        Deque<Instant> timestamps = attempts.computeIfAbsent(key, ignored -> new ArrayDeque<>());

        // One key is one client, so contention is between that client's own
        // concurrent requests. Locking the deque keeps the count exact under
        // them; locking the whole map would serialise every unrelated caller.
        synchronized (timestamps) {
            while (!timestamps.isEmpty() && timestamps.peekFirst().isBefore(windowStart)) {
                timestamps.pollFirst();
            }

            boolean allowed = timestamps.size() < limit;
            timestamps.addLast(now);
            // Bounded so that a client hammering an endpoint cannot grow its own
            // entry without limit. The oldest is the least useful.
            while (timestamps.size() > limit) {
                timestamps.pollFirst();
            }

            // The oldest attempt still counted is the one whose expiry hands the
            // caller its next unit back, so one instant answers both "when may a
            // refused caller retry" and "how long is this remaining count good for".
            Instant oldest = timestamps.peekFirst();
            Duration untilReset = Duration.between(now, oldest.plus(window));
            Duration resetAfter = untilReset.isNegative() ? Duration.ZERO : untilReset;

            if (allowed) {
                return RateLimitDecision.allow(limit, limit - timestamps.size(), window, resetAfter);
            }
            return RateLimitDecision.refuse(limit, window, resetAfter);
        }
    }

    @Override
    public void refund(String key) {
        Deque<Instant> timestamps = attempts.get(key);
        if (timestamps == null) {
            return;
        }
        synchronized (timestamps) {
            timestamps.pollLast();
        }
    }

    private void evictExpired(Instant windowStart) {
        attempts.entrySet().removeIf(entry -> {
            Deque<Instant> timestamps = entry.getValue();
            synchronized (timestamps) {
                Instant newest = timestamps.peekLast();
                return newest == null || newest.isBefore(windowStart);
            }
        });
    }
}
