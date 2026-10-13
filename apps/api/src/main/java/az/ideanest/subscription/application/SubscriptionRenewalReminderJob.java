package az.ideanest.subscription.application;

import az.ideanest.shared.jobs.ScheduledJob;
import az.ideanest.subscription.SubscriptionReminderProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * {@code subscription-renewal-reminders} — #450, epic #448.
 *
 * <p>Nothing renews a plan by itself: the creator renews it, on Payriff's page, or it lapses. So the
 * platform tells them twice before the end ({@code SUBSCRIPTION_RENEWAL_DUE}, three days and one day
 * before by default) and once after it ({@code SUBSCRIPTION_LAPSED}), for every priced plan that is
 * {@code ACTIVE} and that its creator has not cancelled.
 *
 * <h2>One reminder per subscription, per period, per lead — decided by the database</h2>
 *
 * <p>V103's {@code subscription_reminders} row is the claim, inserted in the transaction that records
 * the outbox event; a pass run twice, or on two replicas, finds the key taken and sends nothing. A
 * renewal moves {@code current_period_end} (#449), so the next period's reminders are new keys.
 *
 * <h2>Each lead owns a window, so one pass sends at most one reminder per subscription</h2>
 *
 * <p>Largest first, and a lead's window ends where the next smaller one's begins: with three days and
 * one, a plan ending in two days is the three-day lead's and one ending in twenty hours is the one-day
 * lead's. A plan bought, or a job resumed, with twenty hours to run is reminded once rather than twice
 * in one morning. A window a daily pass happens to step over costs that one reminder, never a burst.
 *
 * <h2>The lapse is bounded by a look-back</h2>
 *
 * <p>Only periods that ended in the last {@code lapsed-look-back} (a week by default) are announced, so
 * the first pass after deployment does not tell everybody whose plan ran out last year. Nothing here
 * marks a row {@code EXPIRED}: V62 explains why no job does, and a notice is not a state change.
 */
@Component
public class SubscriptionRenewalReminderJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionRenewalReminderJob.class);

    private final SubscriptionReminderSender sender;
    private final SubscriptionReminderProperties properties;
    private final Clock clock;

    public SubscriptionRenewalReminderJob(
            SubscriptionReminderSender sender, SubscriptionReminderProperties properties, Clock clock) {
        this.sender = sender;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "subscription-renewal-reminders";
    }

    @Override
    public String schedule() {
        return properties.schedule();
    }

    /*
     * Not paused during maintenance, like `deadline-reminder` and `payout-destination-reminders`: it only
     * records outbox events, and what leaves the platform is `notification-sender`'s, which does pause.
     */

    @Override
    public void run() {
        remind(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /**
     * One pass: every lead, then the lapses.
     *
     * @return how many creators this pass told something
     */
    public int remind(Instant now) {
        List<Duration> leads = properties.leads();
        int told = 0;

        for (int index = 0; index < leads.size(); index++) {
            Duration lead = leads.get(index);
            Duration floor = index + 1 < leads.size() ? leads.get(index + 1) : Duration.ZERO;
            for (UUID subscriptionId : sender.due(lead, floor, now, properties.batchSize())) {
                try {
                    if (sender.remindDue(subscriptionId, lead, floor, now)) {
                        told++;
                    }
                } catch (RuntimeException e) {
                    // One subscription per transaction, and one failure does not stop the rest: the
                    // reminder stays unclaimed and the next pass tries it again.
                    log.error("Could not remind subscription {} at the {} lead; it stays unclaimed.",
                            subscriptionId, lead, e);
                }
            }
        }

        for (UUID subscriptionId : sender.lapsed(properties.lapsedLookBack(), now, properties.batchSize())) {
            try {
                if (sender.announceLapse(subscriptionId, properties.lapsedLookBack(), now)) {
                    told++;
                }
            } catch (RuntimeException e) {
                log.error("Could not announce the lapse of subscription {}; it stays unclaimed.", subscriptionId, e);
            }
        }

        if (told > 0) {
            log.info("subscription-renewal-reminders: {} creators told about their plan.", told);
        }
        return told;
    }
}
