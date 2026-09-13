package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * {@code campaign-refunds} — IDN-EXT-01 (#40): every backer refunded in full.
 *
 * <p>§9.7's four cases that refund everybody are three campaign states: {@code UNSUCCESSFUL} (day 8
 * below 80%, or an extension ended below it), {@code SUSPENDED}, and {@code CANCELED}. A pass refunds
 * a bounded batch of their paid pledges, oldest collection first, each in its own transactions so one
 * refusal does not stop the rest; then it settles platform refunds whose outcome was lost from the
 * provider's {@code returned} status.
 *
 * <p>A sweep rather than a listener on the campaign's event, because a refund is a provider call and
 * a campaign of thousands of backers must not be one delivery that either succeeds entirely or is
 * retried entirely. A refused refund is tried again after {@code retry-after}, not on the next minute.
 */
@Component
public class CampaignRefundJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(CampaignRefundJob.class);

    private final RefundRepository refunds;
    private final RefundService service;
    private final PaymentProperties.Refunds properties;
    private final Clock clock;

    public CampaignRefundJob(RefundRepository refunds, RefundService service, PaymentProperties properties, Clock clock) {
        this.refunds = refunds;
        this.service = service;
        this.properties = properties.refunds();
        this.clock = clock;
    }

    @Override
    public String name() {
        return "campaign-refunds";
    }

    @Override
    public String schedule() {
        return properties.schedule();
    }

    @Override
    public void run() {
        refundDue(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /** @return how many refunds this pass settled as succeeded */
    public int refundDue(Instant now) {
        int refunded = 0;
        List<Object[]> owed = refunds.owedCampaignRefunds(now.minus(properties.retryAfter()), properties.perPass());
        for (Object[] row : owed) {
            UUID pledgeId = UUID.fromString((String) row[0]);
            RefundReason reason = "UNSUCCESSFUL".equals(row[1]) ? RefundReason.CAMPAIGN_FAILED : RefundReason.CAMPAIGN_HALTED;
            try {
                if (service.issueForCampaign(pledgeId, reason).map(Refund::state).filter(s -> s.name().equals("SUCCEEDED")).isPresent()) {
                    refunded++;
                }
            } catch (RuntimeException e) {
                log.error("Could not refund pledge {}; the next pass tries again.", pledgeId, e);
            }
        }

        for (Refund unresolved : refunds.unresolvedCampaignRefunds(
                now.minus(properties.unresolvedAfter()), PageRequest.ofSize(properties.perPass()))) {
            try {
                service.reconcile(unresolved);
            } catch (RuntimeException e) {
                log.error("Could not reconcile refund {}; the next pass tries again.", unresolved.id(), e);
            }
        }
        if (!owed.isEmpty()) {
            log.info("campaign-refunds: {} of {} owed pledges refunded this pass.", refunded, owed.size());
        }
        return refunded;
    }
}
