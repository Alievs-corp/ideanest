package az.ideanest.subscription;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Creator plans — issue #449.
 *
 * @param renewalWindow how long before a period ends the creator may pay for the next one. Long
 *     enough to cover the first reminder, short enough that nobody pays for a period months ahead
 */
@ConfigurationProperties(prefix = "ideanest.subscription")
public record SubscriptionProperties(Duration renewalWindow) {

    public SubscriptionProperties {
        renewalWindow = renewalWindow == null ? Duration.ofDays(7) : renewalWindow;
        if (renewalWindow.isNegative() || renewalWindow.isZero()) {
            throw new IllegalArgumentException("ideanest.subscription.renewal-window must be positive, not " + renewalWindow);
        }
    }
}
