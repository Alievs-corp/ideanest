package az.ideanest.auth.application;

import az.ideanest.auth.AuthProperties;
import az.ideanest.shared.ratelimit.RateLimiter.RateLimitDecision;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * How long one account makes the next password wait — §17.3's per-account sign-in
 * control, as a back-off rather than a lockout (#587).
 *
 * <h2>Why not a window</h2>
 *
 * <p>It used to be "five attempts per address per fifteen minutes", counted before the
 * password was checked. That had two faults. Successes counted, so somebody who signed
 * in on five devices in a quarter of an hour was refused on the sixth. And a refusal
 * lasted the whole window, so anybody who knew an address could keep its owner out
 * indefinitely with five wrong passwords every fifteen minutes, from anywhere.
 *
 * <p>Here only failures count, a correct password clears them, and once the free
 * attempts are spent each further one waits {@code signInBackoff} after the previous
 * failure, doubling each time up to {@code signInBackoffCeiling}. Somebody who mistypes
 * waits seconds rather than a quarter of an hour; somebody guessing gets roughly a
 * hundred tries a day instead of the window's four hundred and eighty, and the cost
 * keeps rising for as long as they keep going.
 *
 * <h2>Counted before the password is checked</h2>
 *
 * <p>An attempt is claimed as a failure when it is admitted and given back by
 * {@link #passwordAccepted} if it turns out not to be one. Checking first and counting
 * afterwards would read better and is wrong: a client firing a hundred requests at
 * once would have every one of them pass the check before the first failure was
 * recorded, and the back-off would bound nothing.
 *
 * <h2>One instance</h2>
 *
 * <p>Held in this process's heap, with exactly {@code InMemoryRateLimiter}'s limitation
 * and for its reason: correct for the single instance this platform runs, and to be
 * moved to shared storage before there are two (§17.3, docs/architecture.md).
 */
@Component
public class SignInBackoff {

    /** A bound on memory, for the reason {@code InMemoryRateLimiter} gives. */
    private static final int MAX_TRACKED_ACCOUNTS = 100_000;

    /** No back-off grows past doubling this many times; the ceiling has long since applied. */
    private static final int MAX_DOUBLINGS = 30;

    private final Map<String, Failures> failures = new ConcurrentHashMap<>();
    private final AuthProperties.RateLimit limits;
    private final Clock clock;

    public SignInBackoff(AuthProperties properties, Clock clock) {
        this.limits = properties.rateLimit();
        this.clock = clock;
    }

    /**
     * Failures against one account, and when the latest happened.
     *
     * @param count failures still remembered
     * @param last when the most recent was admitted
     */
    private record Failures(int count, Instant last) {
    }

    /**
     * Admits an attempt against {@code account}, counting it as a failure until told
     * otherwise, or refuses it because the account is still backing off.
     *
     * <p>A refused attempt is not counted. It never reached the password, so it taught
     * the caller nothing, and counting it would let somebody hammering the endpoint
     * push the owner's next chance further away with every request.
     */
    public RateLimitDecision admit(String account) {
        Instant now = clock.instant();
        if (failures.size() >= MAX_TRACKED_ACCOUNTS) {
            forgetExpired(now);
        }

        RateLimitDecision[] decision = new RateLimitDecision[1];
        // compute() holds the entry for the duration, which is what makes the
        // check and the count one step for concurrent requests on one account.
        failures.compute(account, (ignored, current) -> {
            Failures remembered = current == null || isForgotten(current, now) ? null : current;
            int count = remembered == null ? 0 : remembered.count();
            int free = limits.signInsPerEmail();

            if (remembered != null && count >= free) {
                Instant opensAt = remembered.last().plus(delayAfter(count - free + 1));
                if (now.isBefore(opensAt)) {
                    decision[0] = RateLimitDecision.refuse(
                            free, limits.signInBackoffCeiling(), Duration.between(now, opensAt));
                    return remembered;
                }
            }

            int counted = count + 1;
            decision[0] = RateLimitDecision.allow(
                    free,
                    Math.max(0, free - counted),
                    limits.signInBackoffCeiling(),
                    counted < free ? limits.signInFailureMemory() : delayAfter(counted - free + 1));
            return new Failures(counted, now);
        });
        return decision[0];
    }

    /**
     * The password was right, so nothing this account has been through counts any
     * more: a person who has just proved they hold it is not the one guessing.
     *
     * <p>Called for every outcome but a wrong password — a session, a two-factor
     * challenge, and the refusals that come after the password has been accepted
     * (a suspension, a maintenance window). Each of those proved the password.
     */
    public void passwordAccepted(String account) {
        failures.remove(account);
    }

    /**
     * The wait before the attempt after {@code nth} back-off failure: the first
     * {@code signInBackoff}, doubling each time, never past the ceiling.
     */
    private Duration delayAfter(int nth) {
        int doublings = Math.min(Math.max(nth - 1, 0), MAX_DOUBLINGS);
        Duration delay = limits.signInBackoff().multipliedBy(1L << doublings);
        return delay.compareTo(limits.signInBackoffCeiling()) > 0 ? limits.signInBackoffCeiling() : delay;
    }

    private boolean isForgotten(Failures remembered, Instant now) {
        return !now.isBefore(remembered.last().plus(limits.signInFailureMemory()));
    }

    /**
     * Drops what has been forgotten anyway and, if that is not enough, the accounts
     * that are not backing off yet.
     *
     * <p>Never an account that is: dropping it would hand whoever filled the map a
     * fresh set of free guesses against exactly the accounts they were working on.
     * Losing a count below the threshold costs at most that threshold again, and
     * reaching a hundred thousand accounts at or past it takes half a million
     * failures, which the per-address budget makes slow.
     */
    private void forgetExpired(Instant now) {
        failures.entrySet().removeIf(entry -> isForgotten(entry.getValue(), now));
        if (failures.size() >= MAX_TRACKED_ACCOUNTS) {
            failures.entrySet().removeIf(entry -> entry.getValue().count() < limits.signInsPerEmail());
        }
    }
}
