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
 * </ul>
 */
@Component
public class HostedChargeMetrics {

    private final Counter collected;
    private final Counter failed;
    private final AtomicLong returned = new AtomicLong();
    private final AtomicLong unanswered = new AtomicLong();

    public HostedChargeMetrics(MeterRegistry registry) {
        this.collected = settled(registry, "collected");
        this.failed = settled(registry, "failed");
        attention(registry, "returned", returned);
        attention(registry, "unanswered", unanswered);
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

    private static void attention(MeterRegistry registry, String reason, AtomicLong value) {
        Gauge.builder("ideanest.payment.hosted.attention", value, AtomicLong::get)
                .description("Unsettled payment pages whose last check needs somebody")
                .tag("reason", reason)
                .register(registry);
    }
}
