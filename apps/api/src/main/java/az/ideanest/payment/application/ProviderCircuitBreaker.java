package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.ProviderUnavailableException;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §9.3's warning, made operational: stop asking a provider that has stopped answering
 * (#64, fed by the live calls since #470).
 *
 * <p>"If the primary is unavailable on the day a large campaign closes, the entire
 * business stops." The answer to that is a second provider, which is #61's interface
 * and an adapter nobody has written. <strong>This is not that answer</strong>, and it
 * is worth saying so plainly rather than letting the name imply otherwise. What it does
 * is bound the damage of an outage: a backer is told at once that payments are down
 * rather than after a timeout, the sweeps stop asking about every pending page and
 * refund in turn, and the health screen ({@link PaymentProviderStatus}) says the
 * provider is out rather than that every configured one is up.
 *
 * <h2>Who feeds it</h2>
 *
 * <p>Every provider call in this package goes through {@link #call}: the payment pages
 * for a pledge and for a plan, the payout card page, refunds, the sweeps' look-ups and
 * payouts. All but the payout also ask {@link #isAvailable} first and, when it is open,
 * take the path they already had for an unreachable provider. A payout does not: that
 * path records a send that may have happened, which a refusal here is not.
 *
 * <h2>Only unavailability counts</h2>
 *
 * <p>A decline never opens the breaker. Declines are an ordinary share of card
 * payments, so a breaker that counted them would open on a perfectly healthy day.
 * What counts is {@code ProviderUnavailableException}: the platform could not ask,
 * which is a statement about the provider rather than about anybody's card.
 *
 * <h2>Per replica, in memory, and that is a real bound</h2>
 *
 * <p>There is no shared state here: each replica counts its own failures and opens its
 * own breaker. A fleet of three therefore makes up to three times the threshold before
 * every replica has stopped, and a replica that restarts starts counting again. Both
 * are accepted rather than solved: a row in PostgreSQL would mean a write on every
 * provider call to save a handful of failed ones.
 *
 * <p>The state is also deliberately not durable. A breaker that survived a restart
 * would mean a deploy during an outage came up already refusing payments, with
 * nothing in the new process's logs to say why.
 *
 * <h2>Half-open is one call, not a state</h2>
 *
 * <p>When the cooldown elapses the breaker simply closes and the next call tries. There
 * is no probe and no half-open counter: the "probe" is the next backer or the next
 * sweep pass, and if the provider is still down the breaker opens again after the
 * threshold.
 */
@Component
public class ProviderCircuitBreaker {

    private static final Logger log = LoggerFactory.getLogger(ProviderCircuitBreaker.class);

    private final PaymentProperties.CircuitBreaker properties;
    private final Clock clock;

    /**
     * Per provider, because §9.3 asks for two of them and one being down says nothing
     * about the other.
     */
    private final Map<ProviderName, AtomicInteger> consecutiveFailures = new ConcurrentHashMap<>();

    private final Map<ProviderName, Instant> openUntil = new ConcurrentHashMap<>();

    public ProviderCircuitBreaker(PaymentProperties properties, Clock clock) {
        this.properties = properties.circuitBreaker();
        this.clock = clock;
    }

    /**
     * Whether the platform should ask this provider anything at all right now.
     *
     * <p>Asked once per call rather than once per pass, so that a breaker which opens
     * part-way through a batch stops the rest of it.
     */
    public boolean isAvailable(ProviderName provider) {
        Instant until = openUntil.get(provider);
        if (until == null) {
            return true;
        }
        if (clock.instant().isBefore(until)) {
            return false;
        }
        // The cooldown has elapsed. Closing here rather than in a timer means the breaker
        // costs nothing while nobody is paying, and it means the state is only ever
        // changed by a thread that is about to make a call.
        openUntil.remove(provider);
        consecutiveFailures.remove(provider);
        log.info("The circuit breaker for {} has closed; it will be asked again.", provider);
        return true;
    }

    /**
     * One call to a provider, counted: any answer is {@link #recordAnswered}, and
     * {@code ProviderUnavailableException} is {@link #recordUnavailable} and rethrown.
     *
     * <p>Anything else the call throws, such as a provider that does not offer it, says
     * nothing about whether the provider is up and is not counted.
     */
    public <T> T call(ProviderName provider, Supplier<T> request) {
        T answer;
        try {
            answer = request.get();
        } catch (ProviderUnavailableException e) {
            recordUnavailable(provider);
            throw e;
        }
        recordAnswered(provider);
        return answer;
    }

    /**
     * A call that reached the provider and came back, whatever it said.
     *
     * <p>Called on an approval <em>and</em> on a decline, which is the point: a decline
     * is evidence that the provider is up. Resetting on it is what stops a run of
     * declines from an ordinary campaign accumulating towards the threshold in between
     * two genuine outages.
     */
    public void recordAnswered(ProviderName provider) {
        consecutiveFailures.remove(provider);
    }

    /**
     * A call the platform could not complete.
     *
     * @return whether this failure opened the breaker, so that the caller can say so once
     *     rather than the breaker logging on every subsequent refusal
     */
    public boolean recordUnavailable(ProviderName provider) {
        int failures = consecutiveFailures
                .computeIfAbsent(provider, ignored -> new AtomicInteger())
                .incrementAndGet();
        if (failures < properties.failureThreshold()) {
            return false;
        }
        Instant until = clock.instant().plus(properties.cooldown());
        // putIfAbsent, so that several threads crossing the threshold together do not each
        // extend the cooldown -- an outage would otherwise hold the breaker open for the
        // cooldown times the number of concurrent charges.
        boolean opened = openUntil.putIfAbsent(provider, until) == null;
        if (opened) {
            log.error(
                    "The circuit breaker for {} has opened after {} consecutive failures; "
                            + "it is not asked again until {}.",
                    provider,
                    failures,
                    until);
        }
        return opened;
    }

    /** Whether this provider's breaker is open, for a test and for the operator's read. */
    public boolean isOpen(ProviderName provider) {
        return !isAvailable(provider);
    }

    /**
     * Forgets everything about every provider.
     *
     * <p>For tests, which share a Spring context across classes and would otherwise
     * inherit a breaker another test opened. There is no operational caller: an operator
     * who wants the breaker closed waits out a cooldown measured in seconds.
     */
    public void reset() {
        consecutiveFailures.clear();
        openUntil.clear();
    }
}
