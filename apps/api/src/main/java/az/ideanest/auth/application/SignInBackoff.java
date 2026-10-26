package az.ideanest.auth.application;

import az.ideanest.auth.AuthProperties;
import az.ideanest.shared.ratelimit.RateLimiter.RateLimitDecision;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * How long a failed sign-in makes the next one wait — §17.3's per-account sign-in
 * control, as a back-off per account <em>and address</em> under a looser ceiling per
 * account (#587).
 *
 * <h2>Why not a window</h2>
 *
 * <p>It used to be "five attempts per address per fifteen minutes", counted before the
 * password was checked. That had two faults. Successes counted, so somebody who signed
 * in on five devices in a quarter of an hour was refused on the sixth. And a refusal
 * lasted the whole window, so anybody who knew an address could keep its owner out
 * indefinitely with five wrong passwords every fifteen minutes, from anywhere.
 *
 * <h2>Why per address as well as per account</h2>
 *
 * <p>A back-off keyed on the account alone keeps the second fault in a milder form:
 * while it runs every attempt is refused before the password is checked, the owner's
 * included, so one wrong password each time it expires keeps the account shut. So the
 * back-off is keyed on the account together with the client's address. Five failures
 * from one address are free; past them each further attempt <em>from that address</em>
 * waits {@code signInBackoff} after the previous failure, doubling up to
 * {@code signInBackoffCeiling}. Somebody who mistypes waits seconds; somebody guessing
 * from one address gets about a hundred tries a day; and the owner, signing in from
 * any other address, is not refused for it.
 *
 * <h2>The ceiling, and what it costs</h2>
 *
 * <p>Keyed per address alone, the back-off would let somebody with many addresses guess
 * without bound. So failures against the account are also counted across every address
 * together, and once {@code signInFailuresPerAccount} of them fall inside
 * {@code signInFailuresPerAccountWindow} — fifty in an hour — the account refuses every
 * attempt, from anywhere, until the oldest leaves the window. That bounds distributed
 * guessing at fifty an hour, twelve hundred a day.
 *
 * <p><strong>The trade-off, stated plainly:</strong> while the ceiling holds, the owner is
 * refused too. One address cannot hold it — its own back-off and the per-address budget
 * keep it to about a dozen failures in the first hour against one account and four an
 * hour after that. Ten addresses spending their free failures close the account for an
 * hour, and keeping it shut takes a dozen or more failing continuously, where it used to
 * take one wrong password. That is a narrower lockout, not none: no count bounds a
 * botnet's guesses without letting a botnet spend the account's allowance.
 *
 * <h2>Two-factor codes count</h2>
 *
 * <p>A correct password on an account with two-factor on proves the password and
 * nothing more: the attempt it cost is given back, but earlier failures stand until a
 * code completes the sign-in. A wrong code counts as a failure, against the address
 * the challenge's password came from — the one this back-off gates — and against the
 * ceiling. Without that, each correct password bought a fresh challenge with five
 * guesses, and somebody holding a stolen password could guess codes without bound.
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
    private static final int MAX_TRACKED_KEYS = 100_000;

    /** No back-off grows past doubling this many times; the ceiling has long since applied. */
    private static final int MAX_DOUBLINGS = 30;

    private final Map<Source, Failures> failures = new ConcurrentHashMap<>();
    private final Map<String, Deque<Instant>> accountFailures = new ConcurrentHashMap<>();
    private final AuthProperties.RateLimit limits;
    private final Clock clock;

    public SignInBackoff(AuthProperties properties, Clock clock) {
        this.limits = properties.rateLimit();
        this.clock = clock;
    }

    /** One account, as tried from one address. */
    private record Source(String account, String address) {
    }

    /**
     * Failures from one source, and when the latest happened.
     *
     * @param count failures still remembered
     * @param last when the most recent attempt that reached the password was admitted
     */
    private record Failures(int count, Instant last) {
    }

    /**
     * Admits an attempt against {@code account} from {@code address}, counting it as a
     * failure until told otherwise, or refuses it because the account has reached its
     * ceiling or this address is still backing off.
     *
     * <p>A refused attempt is not counted. It never reached the password, so it taught
     * the caller nothing, and counting it would let somebody hammering the endpoint
     * push the next chance further away with every request.
     */
    public RateLimitDecision admit(String account, String address) {
        Instant now = clock.instant();
        if (failures.size() >= MAX_TRACKED_KEYS || accountFailures.size() >= MAX_TRACKED_KEYS) {
            forgetExpired(now);
        }

        RateLimitDecision ceiling = claimUnderCeiling(account, now);
        if (!ceiling.allowed()) {
            return ceiling;
        }

        RateLimitDecision[] decision = new RateLimitDecision[1];
        // compute() holds the entry for the duration, which is what makes the
        // check and the count one step for concurrent requests from one source.
        failures.compute(new Source(account, address), (ignored, current) -> {
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

        if (!decision[0].allowed()) {
            // Refused by this address's back-off, so the claim on the ceiling did not
            // reach the password either.
            releaseCeilingClaim(account);
        }
        return decision[0];
    }

    /**
     * The password was right, so the attempt {@link #admit} claimed was not a failure
     * and is given back. <strong>Earlier failures stand</strong>: the password may not be
     * the whole sign-in — with two-factor on it buys a challenge, not a session — and
     * only {@link #signedIn} says the account has been proved.
     *
     * <p>Also called for the refusals that come after the password has been accepted
     * (a suspension, a maintenance window), for the same reason.
     */
    public void passwordAccepted(String account, String address) {
        releaseCeilingClaim(account);
        failures.computeIfPresent(new Source(account, address), (ignored, current) ->
                current.count() <= 1 ? null : new Failures(current.count() - 1, current.last()));
    }

    /**
     * Everything the account asks for was proved — the password, and a code if it has
     * two-factor on — so the failures from this address no longer count: a person who
     * has just done that is not the one guessing from it.
     *
     * <p>Not the ceiling. It counts failures from every address together, and the owner
     * signing in from one says nothing about who is failing from the others.
     */
    public void signedIn(String account, String address) {
        failures.remove(new Source(account, address));
    }

    /**
     * A two-factor code was wrong. It counts as a failed sign-in from {@code address}
     * — the address the challenge's password came from — and towards the ceiling.
     *
     * <p>Counted even past the ceiling: the guess was made, and the one challenge that
     * can still be outstanding is what bounds how many more there can be.
     */
    public void codeRejected(String account, String address) {
        Instant now = clock.instant();

        Deque<Instant> recent = accountFailures.computeIfAbsent(account, ignored -> new ArrayDeque<>());
        synchronized (recent) {
            forgetOlderThanTheWindow(recent, now);
            recent.addLast(now);
            while (recent.size() > limits.signInFailuresPerAccount()) {
                recent.pollFirst();
            }
        }

        failures.compute(new Source(account, address), (ignored, current) -> {
            int count = current == null || isForgotten(current, now) ? 0 : current.count();
            return new Failures(count + 1, now);
        });
    }

    /**
     * Claims one of the account's failures under the ceiling, or refuses because they
     * are all spent.
     */
    private RateLimitDecision claimUnderCeiling(String account, Instant now) {
        int ceiling = limits.signInFailuresPerAccount();
        Duration window = limits.signInFailuresPerAccountWindow();

        Deque<Instant> recent = accountFailures.computeIfAbsent(account, ignored -> new ArrayDeque<>());
        // InMemoryRateLimiter's locking: one account's deque, never the whole map.
        synchronized (recent) {
            forgetOlderThanTheWindow(recent, now);
            if (recent.size() >= ceiling) {
                return RateLimitDecision.refuse(
                        ceiling, window, Duration.between(now, recent.peekFirst().plus(window)));
            }
            recent.addLast(now);
            return RateLimitDecision.allow(
                    ceiling, ceiling - recent.size(), window, Duration.between(now, recent.peekFirst().plus(window)));
        }
    }

    private void releaseCeilingClaim(String account) {
        Deque<Instant> recent = accountFailures.get(account);
        if (recent == null) {
            return;
        }
        synchronized (recent) {
            recent.pollLast();
        }
    }

    private void forgetOlderThanTheWindow(Deque<Instant> recent, Instant now) {
        Instant windowStart = now.minus(limits.signInFailuresPerAccountWindow());
        while (!recent.isEmpty() && !recent.peekFirst().isAfter(windowStart)) {
            recent.pollFirst();
        }
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
     * Drops what has been forgotten anyway and, if that is not enough, what is not
     * holding anybody back yet.
     *
     * <p>Never a source that is backing off or an account at its ceiling: dropping one
     * would hand whoever filled the map a fresh set of guesses against exactly the
     * accounts they were working on. Losing a count below the threshold costs at most
     * that threshold again, and reaching a hundred thousand sources at or past it takes
     * half a million failures, which the per-address budget makes slow.
     */
    private void forgetExpired(Instant now) {
        failures.entrySet().removeIf(entry -> isForgotten(entry.getValue(), now));
        if (failures.size() >= MAX_TRACKED_KEYS) {
            failures.entrySet().removeIf(entry -> entry.getValue().count() < limits.signInsPerEmail());
        }

        accountFailures.entrySet().removeIf(entry -> {
            Deque<Instant> recent = entry.getValue();
            synchronized (recent) {
                forgetOlderThanTheWindow(recent, now);
                return recent.isEmpty();
            }
        });
        if (accountFailures.size() >= MAX_TRACKED_KEYS) {
            accountFailures.entrySet().removeIf(entry -> {
                Deque<Instant> recent = entry.getValue();
                synchronized (recent) {
                    return recent.size() < limits.signInFailuresPerAccount();
                }
            });
        }
    }
}
