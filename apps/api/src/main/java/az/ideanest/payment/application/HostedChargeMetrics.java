package az.ideanest.payment.application;

import az.ideanest.payment.domain.PaymentEventType;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * What {@code hosted-charge-sweep} did and could not do — #356.
 *
 * <ul>
 *   <li>{@code ideanest.payment.hosted.sweep.settled{outcome}}: pages the sweep settled, which is to
 *       say callbacks that never arrived. A few are a provider's bad hour; every payment is a callback
 *       address that is wrong.
 *   <li>{@code ideanest.payment.hosted.attention{reason}}: unsettled pages, within the sweep's window,
 *       whose last answer needs somebody — {@code returned}, paid and given back without the platform
 *       hearing, or {@code unanswered}, a provider that cannot be asked. Set by each pass, so it is the
 *       last pass's view; zero on an instance that has not run one, which is why {@code alerts.yml}
 *       takes the maximum across instances.
 *   <li>{@code ideanest.payment.hosted.anomalies{reason}} (#587): a payment the platform did not
 *       expect, each also logged at ERROR — {@code duplicate}, a second payment for a pledge already
 *       collected, which the campaign-refunds job returns; {@code amount_mismatch}, a provider reporting
 *       an amount or currency other than the page was opened for, recorded failed; {@code aged_out}, a
 *       page still pending when the sweep stops asking about it. A counter rather than a gauge: each
 *       is one event, and {@code alerts.yml} fires on any increase.
 * </ul>
 */
@Component
public class HostedChargeMetrics {

    private final Counter collected;
    private final Counter failed;
    private final AtomicLong returned = new AtomicLong();
    private final AtomicLong unanswered = new AtomicLong();
    private final Counter duplicate;
    private final Counter amountMismatch;
    private final Counter agedOut;

    public HostedChargeMetrics(MeterRegistry registry) {
        this.collected = settled(registry, "collected");
        this.failed = settled(registry, "failed");
        attention(registry, "returned", returned);
        attention(registry, "unanswered", unanswered);
        this.duplicate = anomaly(registry, "duplicate");
        this.amountMismatch = anomaly(registry, "amount_mismatch");
        this.agedOut = anomaly(registry, "aged_out");
    }

    /** #587: a second payment settled for a pledge that was already collected. */
    public void duplicate() {
        duplicate.increment();
    }

    /** #587: the provider reported an amount or currency the page was not opened for. */
    public void amountMismatch() {
        amountMismatch.increment();
    }

    /** #587: a page still pending when the sweep stopped asking about it. */
    public void agedOut() {
        agedOut.increment();
    }

    public void settled(PaymentEventType type) {
        (type == PaymentEventType.CHARGE_SUCCEEDED ? collected : failed).increment();
    }

    public void attention(long returnedPages, long unansweredPages) {
        returned.set(returnedPages);
        unanswered.set(unansweredPages);
    }

    private static Counter settled(MeterRegistry registry, String outcome) {
        return Counter.builder("ideanest.payment.hosted.sweep.settled")
                .description("Payment pages the sweep settled because their callback never came")
                .tag("outcome", outcome)
                .register(registry);
    }

    private static Counter anomaly(MeterRegistry registry, String reason) {
        return Counter.builder("ideanest.payment.hosted.anomalies")
                .description("Payments the platform did not expect, each logged at ERROR")
                .tag("reason", reason)
                .register(registry);
    }

    private static void attention(MeterRegistry registry, String reason, AtomicLong value) {
        Gauge.builder("ideanest.payment.hosted.attention", value, AtomicLong::get)
                .description("Unsettled payment pages whose last check needs somebody")
                .tag("reason", reason)
                .register(registry);
    }
}
