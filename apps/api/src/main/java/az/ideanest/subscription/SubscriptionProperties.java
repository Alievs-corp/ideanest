package az.ideanest.subscription;

import java.time.Period;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Creator plans — issue #449.
 *
 * <p>{@code ideanest.subscription.renewal-window} and its {@code SUBSCRIPTION_RENEWAL_WINDOW} were
 * retired with #660 on purpose, and nothing reads them: before #660 they held a seven-day
 * {@code Duration}, and a deployment still setting them must neither fail to start ({@code PT168H}
 * is not a calendar period) nor silently keep the seven-day rule ({@code P7D}). The window is
 * {@code ideanest.subscription.extension-window} / {@code SUBSCRIPTION_EXTENSION_WINDOW}.
 *
 * @param extensionWindow how long before a period ends the creator may pay for the next one, as
 *     calendar time (#660). One month by default: the owner's rule is that a running subscription
 *     may be extended once its last month begins, so a monthly one can be extended as soon as it
 *     is bought and a yearly one only in its twelfth month. A {@link Period} and not a
 *     {@code Duration}, because a month before 31 March is 28 or 29 February, not thirty days
 *     before it. ISO-8601 ({@code P1M}, {@code P7D}); a time-based value such as {@code PT168H} is
 *     not a calendar period and fails at start-up. The renewal reminders keep their own lead
 *     times ({@link SubscriptionReminderProperties#leads()}), so this does not send a reminder a
 *     month early
 */
@ConfigurationProperties(prefix = "ideanest.subscription")
public record SubscriptionProperties(Period extensionWindow) {

    public SubscriptionProperties {
        extensionWindow = extensionWindow == null ? Period.ofMonths(1) : extensionWindow;
        boolean negative =
                extensionWindow.getYears() < 0 || extensionWindow.getMonths() < 0 || extensionWindow.getDays() < 0;
        if (negative || extensionWindow.isZero()) {
            throw new IllegalArgumentException(
                    "ideanest.subscription.extension-window must be positive, not " + extensionWindow);
        }
    }
}
