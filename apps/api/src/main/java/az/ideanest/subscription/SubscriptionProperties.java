package az.ideanest.subscription;

import java.time.Period;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Creator plans — issue #449.
 *
 * @param renewalWindow how long before a period ends the creator may pay for the next one, as
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
public record SubscriptionProperties(Period renewalWindow) {

    public SubscriptionProperties {
        renewalWindow = renewalWindow == null ? Period.ofMonths(1) : renewalWindow;
        boolean negative = renewalWindow.getYears() < 0 || renewalWindow.getMonths() < 0 || renewalWindow.getDays() < 0;
        if (negative || renewalWindow.isZero()) {
            throw new IllegalArgumentException("ideanest.subscription.renewal-window must be positive, not " + renewalWindow);
        }
    }
}
