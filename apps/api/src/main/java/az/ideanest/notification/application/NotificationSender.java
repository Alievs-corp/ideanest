package az.ideanest.notification.application;

import az.ideanest.notification.NotificationProperties;
import az.ideanest.notification.application.NotificationDispatch.Outcome;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The other half of the notification queue: something that drains it.
 *
 * <p>{@code NotificationFanOut} writes rows in the dispatch transaction and deliberately
 * sends nothing, because a sent email cannot be rolled back. That makes the rows a
 * promise, and a promise is worth nothing until a process keeps it. This is that process
 * — a poll that asks {@link NotificationDispatch} for one notification at a time until
 * the queue is empty or the pass is spent.
 *
 * <p>{@code OutboxRelay} is the same class one hop earlier and its reasoning is not
 * repeated here: a poll rather than {@code LISTEN}/{@code NOTIFY} because the poll has to
 * exist anyway to be the guarantee; safe on more than one replica because
 * {@code claimNext} is {@code FOR UPDATE SKIP LOCKED}, so two senders divide the queue
 * rather than meeting on a row; a {@link ScheduledJob} rather than {@code @Scheduled} so
 * that the tick takes a lease and is counted when it throws.
 *
 * <h2>What this class must not do, and why the pass is shaped the way it is</h2>
 *
 * <p><strong>One notification per transaction, and the transaction is inside the loop,
 * not around it.</strong> {@link NotificationDispatch#sendNext} is {@code @Transactional}
 * and is called through the proxy from here, which is the only reason that boundary
 * exists at all. A pass that opened one transaction and sent a hundred messages would
 * re-send all hundred on a rollback after the ninety-ninth.
 *
 * <p><strong>A refusal does not end the pass.</strong> Every notification still waiting
 * is somebody else's, and stopping on the first one a channel refused would let one bad
 * address hold up the queue — {@code OutboxRelay} and {@code ReservationCleanerJob} both
 * carry on for the same reason. The refused row has already been counted and given a next
 * attempt by the time this sees the outcome.
 *
 * <p><strong>The pass is bounded by {@code batchSize}.</strong> A backlog built up while
 * a transport was down must not become one pass that overlaps its own next tick. The
 * remainder is one tick away.
 *
 * <p><strong>Nothing here retries.</strong> A retry is the next pass finding the row
 * eligible again, which is the whole point of {@code next_attempt_at}: a loop that
 * retried in place would hold a lease while it slept and would lose the backoff on a
 * restart.
 */
@Component
public class NotificationSender implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(NotificationSender.class);

    private final NotificationDispatch dispatch;
    private final NotificationProperties properties;
    private final Clock clock;

    public NotificationSender(NotificationDispatch dispatch, NotificationProperties properties, Clock clock) {
        this.dispatch = dispatch;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Paused while a maintenance window is in force (#214). It is the process that delivers
     * email and push; what fan-out queues meanwhile waits for it.
     */
    @Override
    public boolean pausesDuringMaintenance() {
        return true;
    }

    /** §8.4's {@code notification-sender}. */
    @Override
    public String name() {
        return "notification-sender";
    }

    /**
     * From configuration, so that the test profile can set it to {@code -} and drive
     * {@link #sendPending(Instant)} with the instant it wants. A sender firing in the
     * background of a suite sends the very rows a test is about to assert are pending,
     * on another thread, which is the hardest kind of flake to reproduce.
     */
    @Override
    public String schedule() {
        return properties.delivery().sendSchedule();
    }

    @Override
    public void run() {
        sendPending(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /** One pass over the queue, to the channels the application is wired with. */
    public int sendPending(Instant now) {
        return pass(now, null);
    }

    /**
     * One pass over the queue, to a given set of channels.
     *
     * @param now the instant this pass judges eligibility and backoff against, so that
     *     every row in it is judged against one moment rather than against a clock that
     *     moved while the pass was running
     * @param senders what to hand each channel's messages to. See
     *     {@link NotificationDispatch#sendNext(Instant, Map)} for why this is a parameter
     * @return how many notifications this pass sent
     */
    public int sendPending(Instant now, Map<NotificationChannel, ChannelSender> senders) {
        return pass(now, Objects.requireNonNull(senders, "A pass sends to some set of channels"));
    }

    private int pass(Instant now, Map<NotificationChannel, ChannelSender> senders) {
        int sent = 0;
        int failed = 0;

        for (int attempted = 0; attempted < properties.delivery().batchSize(); attempted++) {
            Outcome outcome = senders == null ? dispatch.sendNext(now) : dispatch.sendNext(now, senders);
            if (outcome == Outcome.NOTHING_TO_DO) {
                break;
            }
            if (outcome == Outcome.SENT) {
                sent++;
            } else {
                failed++;
            }
        }

        if (failed > 0) {
            log.warn("Notification pass sent {} and could not send {}.", sent, failed);
        } else if (sent > 0) {
            log.debug("Notification pass sent {}.", sent);
        }
        return sent;
    }
}
