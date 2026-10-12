package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderName;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * How long each provider still reverses a charge — issue #399.
 *
 * <p>Payriff refunds a payment for thirty days and not after. A refund of an older charge sent to it
 * anyway is refused, and a refused refund is offered again every {@code retry-after} for ever. So a
 * refund past its provider's window is never sent: {@code RefundService} routes it to a bank transfer.
 *
 * <p><strong>A provider with no window configured has none</strong>, which is the default and the
 * behaviour before #399. The switch is configuration rather than code because the states a routed
 * refund enters are unknown to the release before this one (V99): it is turned on once every node
 * knows them.
 *
 * <p>Measured from {@code transactions.created_at}, which is when the platform recorded the charge —
 * the provider's webhook, normally seconds after the payment and occasionally hours. The configured
 * window is therefore shorter than the provider's by a margin.
 */
@Component
public class RefundWindows {

    private Map<ProviderName, Duration> windows;

    public RefundWindows(PaymentProperties properties) {
        this.windows = properties.refunds().windows();
    }

    /** The provider's window, or empty when it has none. */
    public Optional<Duration> of(ProviderName provider) {
        return Optional.ofNullable(windows.get(provider));
    }

    /** Whether this charge is older than its provider's refund window at {@code now}. */
    public boolean isClosed(PaymentTransaction charge, Instant now) {
        return charge.getCreatedAt() != null
                && of(charge.getProvider())
                        .map(window -> charge.getCreatedAt().plus(window).isBefore(now))
                        .orElse(false);
    }
}
