package az.ideanest.subscription;

import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code subscription-renewal-reminders}, as numbers an operator can change — issue #450.
 *
 * <p>Its own prefix, {@code ideanest.subscription.reminders}, rather than fields on a module-wide
 * record: the renewal window of epic #448 is a different rule with a different owner (#449), and a
 * reminder cadence changed for a campaign of churn must not be able to move it.
 *
 * @param schedule the UTC cron the pass runs on, or {@code -} to register it unscheduled. Daily by
 *     default: the leads are measured in days, and a creator cannot tell a reminder sent at nine
 *     from one sent at ten
 * @param leads how long before a period ends the creator is told it is due, largest first. Three
 *     days and one day by default — two reminders before the end, as epic #448 asks. Each is a whole
 *     number of hours, because {@code subscription_reminders.lead_hours} is the claim's key
 * @param lapsedLookBack how long after a period ended the lapse is still announced. Seven days by
 *     default. A bound rather than "every lapsed row", so the first pass after deployment does not
 *     tell every creator whose plan ran out last year that it has just ended
 * @param batchSize the most subscriptions one pass reminds per lead, and the most lapses it
 *     announces. A bound on a pass, not a target: the remainder is a day away, and ordered so the
 *     most urgent goes first
 */
@ConfigurationProperties(prefix = "ideanest.subscription.reminders")
public record SubscriptionReminderProperties(
        String schedule, List<Duration> leads, Duration lapsedLookBack, int batchSize) {

    /** Nine in the morning UTC, one in the afternoon in Baku: read during a working day. */
    private static final String DEFAULT_SCHEDULE = "0 0 9 * * *";

    private static final List<Duration> DEFAULT_LEADS = List.of(Duration.ofDays(3), Duration.ofDays(1));

    private static final Duration DEFAULT_LOOK_BACK = Duration.ofDays(7);

    private static final int DEFAULT_BATCH_SIZE = 500;

    public SubscriptionReminderProperties {
        schedule = schedule == null || schedule.isBlank() ? DEFAULT_SCHEDULE : schedule;
        leads = leads == null || leads.isEmpty() ? DEFAULT_LEADS : leads;
        lapsedLookBack = lapsedLookBack == null ? DEFAULT_LOOK_BACK : lapsedLookBack;
        batchSize = batchSize == 0 ? DEFAULT_BATCH_SIZE : batchSize;

        for (Duration lead : leads) {
            if (lead == null || lead.isNegative() || lead.isZero() || lead.toSecondsPart() != 0
                    || lead.toMinutesPart() != 0) {
                // Stops the process at start-up rather than at nine the next morning. A lead of zero
                // would be a "renewal due" sent after the end, which is the lapse's message.
                throw new IllegalArgumentException(
                        "A renewal reminder lead is a positive whole number of hours, not " + lead);
            }
        }
        if (leads.stream().distinct().count() != leads.size()) {
            throw new IllegalArgumentException("Two renewal reminder leads are the same: " + leads);
        }
        // Largest first, whatever order they were written in: each lead's window ends where the next
        // smaller one begins, and the job reads them in this order.
        leads = leads.stream().sorted(Comparator.reverseOrder()).toList();

        if (lapsedLookBack.isNegative() || lapsedLookBack.isZero()) {
            throw new IllegalArgumentException("A lapse look-back is a positive duration");
        }
        if (batchSize < 1) {
            throw new IllegalArgumentException("A reminder batch holds at least one subscription");
        }
    }
}
