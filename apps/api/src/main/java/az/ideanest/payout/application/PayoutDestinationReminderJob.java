package az.ideanest.payout.application;

import az.ideanest.payout.PayoutProperties;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.compliance.PayoutDestinations;
import az.ideanest.shared.jobs.ScheduledJob;
import az.ideanest.shared.outbox.Outbox;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@code payout-destination-reminders} — IDN-EXT-01 (#41), §6.3's {@code WAITING_FOR_DESTINATION}.
 *
 * <p>A payout whose hold is over and whose creator has not given a VÖEN and a business card that can be
 * paid stays on the platform's account; the creator is reminded weekly until they do. Daily, and a
 * payout is reminded on the days that are whole weeks after its hold ended — so the cadence needs no
 * column recording the last reminder, and a pass that did not run one day costs one reminder rather
 * than sending a burst of them the next.
 */
@Component
public class PayoutDestinationReminderJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(PayoutDestinationReminderJob.class);

    private static final int PAGE = 500;

    private final PayoutRepository payouts;
    private final PayoutDestinations destinations;
    private final Outbox outbox;
    private final PayoutProperties properties;
    private final Clock clock;

    public PayoutDestinationReminderJob(
            PayoutRepository payouts,
            PayoutDestinations destinations,
            Outbox outbox,
            PayoutProperties properties,
            Clock clock) {
        this.payouts = payouts;
        this.destinations = destinations;
        this.outbox = outbox;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "payout-destination-reminders";
    }

    @Override
    public String schedule() {
        return properties.destinationReminderSchedule();
    }

    @Override
    public void run() {
        remind(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /** @return how many creators this pass reminded */
    @Transactional
    public int remind(Instant now) {
        int reminded = 0;
        for (Payout payout : payouts.inFlightPastHold(now, PageRequest.ofSize(PAGE))) {
            long days = Duration.between(payout.payableAt(), now).toDays();
            if (days % 7 != 0) {
                continue;
            }
            if (!destinations.standingOf(payout.creatorId()).asksTheCreatorForSomething()) {
                continue;
            }
            outbox.record(
                    PayoutDetailsNeededEvent.AGGREGATE_TYPE,
                    payout.id(),
                    PayoutDetailsNeededEvent.EVENT_TYPE,
                    new PayoutDetailsNeededEvent(payout.projectId(), payout.creatorId(), payout.id(), payout.payableAt(), now));
            reminded++;
        }
        if (reminded > 0) {
            log.info("payout-destination-reminders: {} creators reminded.", reminded);
        }
        return reminded;
    }
}
