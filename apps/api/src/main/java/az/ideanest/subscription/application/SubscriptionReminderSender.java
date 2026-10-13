package az.ideanest.subscription.application;

import az.ideanest.shared.outbox.Outbox;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.domain.SubscriptionState;
import az.ideanest.subscription.infrastructure.SubscriptionPlanRepository;
import az.ideanest.subscription.infrastructure.SubscriptionReminderRepository;
import az.ideanest.subscription.infrastructure.SubscriptionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One subscription, one reminder, claimed and recorded in one transaction — #450.
 *
 * <p>{@code DeadlineReminderSender}'s shape, for its reason: the {@code subscription_reminders} row and
 * the outbox event are one fact. A claim with no event is a creator never told; an event with no claim
 * is a reminder every morning. And one subscription per transaction rather than one pass, so a failure
 * on one row does not roll back the creators already reminded.
 *
 * <p>What this does not decide is whether the creator wants the message, or by which channel: that is
 * §4.10's table and their preferences, in the notification module.
 */
@Service
public class SubscriptionReminderSender {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionReminderSender.class);

    private static final long MINUTES_PER_DAY = Duration.ofDays(1).toMinutes();

    private final SubscriptionRepository subscriptions;
    private final SubscriptionPlanRepository plans;
    private final SubscriptionReminderRepository reminders;
    private final Outbox outbox;

    public SubscriptionReminderSender(
            SubscriptionRepository subscriptions,
            SubscriptionPlanRepository plans,
            SubscriptionReminderRepository reminders,
            Outbox outbox) {
        this.subscriptions = subscriptions;
        this.plans = plans;
        this.reminders = reminders;
        this.outbox = outbox;
    }

    /** Candidates for a lead whose window is {@code (now + floor, now + lead]}. Re-checked by the claim. */
    @Transactional(readOnly = true)
    public List<UUID> due(Duration lead, Duration floor, Instant now, int batchSize) {
        return reminders.due(hoursOf(lead), now.plus(floor), now.plus(lead), batchSize);
    }

    /** Candidates for a lapse notice whose period ended inside {@code (now - lookBack, now]}. */
    @Transactional(readOnly = true)
    public List<UUID> lapsed(Duration lookBack, Instant now, int batchSize) {
        return reminders.lapsed(now.minus(lookBack), now, batchSize);
    }

    /**
     * Tells a creator their plan is due, or does nothing because it no longer is or somebody else did.
     *
     * <p><strong>The row is re-read and re-checked here</strong>: between the candidate read and this
     * transaction the creator may have cancelled, renewed (which moves the period end, #449), or had
     * the subscription ended by staff, and a reminder contradicting what they just did is the one
     * this sweep must never send.
     *
     * @return true when this call reminded the creator
     */
    @Transactional
    public boolean remindDue(UUID subscriptionId, Duration lead, Duration floor, Instant now) {
        Subscription subscription = subscriptions.findById(subscriptionId).orElse(null);
        if (subscription == null || !isPricedAndRunning(subscription)) {
            return false;
        }
        Instant end = subscription.getCurrentPeriodEnd();
        if (!end.isAfter(now.plus(floor)) || end.isAfter(now.plus(lead))) {
            // Outside this lead's window now: renewed, or the clock moved past the next lead's floor.
            return false;
        }
        if (!reminders.claim(subscriptionId, end, SubscriptionReminderRepository.RENEWAL_DUE, hoursOf(lead), now)) {
            return false;
        }

        UUID eventId = outbox.record(
                SubscriptionRenewalDueEvent.AGGREGATE_TYPE,
                subscriptionId,
                SubscriptionRenewalDueEvent.EVENT_TYPE,
                new SubscriptionRenewalDueEvent(
                        subscriptionId,
                        subscription.getAccountId(),
                        subscription.getPlanId(),
                        planNameOf(subscription),
                        subscription.getPrice(),
                        end,
                        daysLeft(now, end),
                        now));
        log.debug("Subscription {} is due at {} ({}h lead); recorded outbox event {}.",
                subscriptionId, end, hoursOf(lead), eventId);
        return true;
    }

    /**
     * Tells a creator their plan lapsed, or does nothing because it did not, it was renewed or bought
     * again since, or somebody else did.
     *
     * @return true when this call told the creator
     */
    @Transactional
    public boolean announceLapse(UUID subscriptionId, Duration lookBack, Instant now) {
        Subscription subscription = subscriptions.findById(subscriptionId).orElse(null);
        if (subscription == null || !isPricedAndRunning(subscription)) {
            return false;
        }
        Instant end = subscription.getCurrentPeriodEnd();
        if (end.isAfter(now) || !end.isAfter(now.minus(lookBack))) {
            return false;
        }
        if (!reminders.claim(subscriptionId, end, SubscriptionReminderRepository.LAPSED, 0, now)) {
            return false;
        }

        UUID eventId = outbox.record(
                SubscriptionLapsedEvent.AGGREGATE_TYPE,
                subscriptionId,
                SubscriptionLapsedEvent.EVENT_TYPE,
                new SubscriptionLapsedEvent(
                        subscriptionId,
                        subscription.getAccountId(),
                        subscription.getPlanId(),
                        planNameOf(subscription),
                        subscription.getPrice(),
                        end,
                        now));
        log.debug("Subscription {} lapsed at {}; recorded outbox event {}.", subscriptionId, end, eventId);
        return true;
    }

    /**
     * {@code ACTIVE}, not cancelled by its creator, and priced. A free plan has nothing to renew and
     * nothing to pay, and a creator who cancelled has already said they do not want it renewed —
     * epic #448: they get no reminders, and are not told it lapsed either, because it ended as asked.
     */
    private static boolean isPricedAndRunning(Subscription subscription) {
        return subscription.getState() == SubscriptionState.ACTIVE
                && !subscription.isCancelAtPeriodEnd()
                && subscription.getPrice().amount().signum() > 0
                && subscription.getCurrentPeriodEnd() != null;
    }

    /**
     * The plan as the catalogue names it now. The subscription snapshots the price and not the name
     * (V62), so a renamed plan is reminded under its new name at its old price — which is what the
     * pricing page the reminder links to shows too.
     */
    private String planNameOf(Subscription subscription) {
        return plans.findById(subscription.getPlanId()).map(SubscriptionPlan::getName).orElse(null);
    }

    /** Whole days from now to the end, rounded up: twenty hours left is one day left, never zero. */
    static int daysLeft(Instant now, Instant end) {
        long minutes = Duration.between(now, end).toMinutes();
        return (int) Math.max(1, Math.ceilDiv(minutes, MINUTES_PER_DAY));
    }

    private static int hoursOf(Duration lead) {
        return Math.toIntExact(lead.toHours());
    }
}
