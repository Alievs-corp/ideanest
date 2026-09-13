package az.ideanest.payout.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.fee.application.FeeBreakdown;
import az.ideanest.fee.application.FeeSchedules;
import az.ideanest.payment.application.CampaignFunds;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payout.PayoutProperties;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A withdrawal's payout, requested by the platform — IDN-EXT-01 (#41), §6.3.
 *
 * <p>The same figure {@code PayoutService#calculate} produces — funds, fees, refunds, the signatures
 * it needs, the hold — requested by the campaign's withdrawal rather than by a member of finance, so
 * nobody has to notice that a creator withdrew. Staff approval and sending stay as they are: the hold
 * is the fourteen days in which an administrator checks the VÖEN and the business card, and
 * {@code approve} refuses until both stand.
 */
@Service
public class WithdrawalPayouts {

    private static final Logger log = LoggerFactory.getLogger(WithdrawalPayouts.class);

    private final PayoutRepository payouts;
    private final PayoutService service;
    private final PayoutGateway gateway;
    private final FeeSchedules fees;
    private final ProjectSummaries projects;
    private final AuditLog audit;
    private final Outbox outbox;
    private final PayoutProperties properties;
    private final Clock clock;

    public WithdrawalPayouts(
            PayoutRepository payouts,
            PayoutService service,
            PayoutGateway gateway,
            FeeSchedules fees,
            ProjectSummaries projects,
            AuditLog audit,
            Outbox outbox,
            PayoutProperties properties,
            Clock clock) {
        this.payouts = payouts;
        this.service = service;
        this.gateway = gateway;
        this.fees = fees;
        this.projects = projects;
        this.audit = audit;
        this.outbox = outbox;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Requests the payout of a withdrawn campaign, with the hold, and announces it.
     *
     * <p>Idempotent on the campaign: a redelivered withdrawal finds the payout already in flight and
     * requests nothing again. Empty when nothing is payable — a campaign whose money was all refunded.
     */
    @Transactional
    public Optional<Payout> request(UUID projectId, boolean automatic) {
        Optional<Payout> existing = payouts.inFlightFor(projectId);
        if (existing.isPresent()) {
            return existing;
        }
        ProjectSummary campaign = projects
                .summaryOf(projectId)
                .orElseThrow(() -> new UnknownPayoutCampaignException(projectId));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        CampaignFunds funds = gateway.fundsOf(projectId, properties.currency());
        if (!funds.net().isPositive()) {
            log.warn("Campaign {} was withdrawn with nothing collected to pay out.", projectId);
            return Optional.empty();
        }
        FeeBreakdown breakdown = fees.priceOf(funds.collected(), now, projectId);
        Money net = breakdown.net().minus(funds.refunded());
        if (!net.isPositive()) {
            log.warn("Campaign {} was withdrawn with nothing left to pay out after fees and refunds.", projectId);
            return Optional.empty();
        }

        Payout requested = payouts.save(Payout.calculated(
                projectId,
                campaign.creatorId(),
                funds.collected(),
                breakdown.platformFee(),
                breakdown.processingFee(),
                funds.refunded(),
                net,
                breakdown.scheduleId(),
                now.plus(properties.hold()),
                service.approvalsRequiredFor(net),
                "withdrawal-" + projectId + "-" + now.toEpochMilli()));

        audit.record(
                AuditAction.PAYOUT_CALCULATED,
                requested.id(),
                AuditActor.system(),
                AuditOutcome.SUCCEEDED,
                "withdrawal; automatic=%s; project=%s; gross=%s; fees=%s; refunded=%s; net=%s"
                        .formatted(automatic, projectId, funds.collected(), breakdown.totalFees(), funds.refunded(), net));
        outbox.record(
                PayoutRequestedEvent.AGGREGATE_TYPE,
                requested.id(),
                PayoutRequestedEvent.EVENT_TYPE,
                new PayoutRequestedEvent(projectId, campaign.creatorId(), requested.id(), requested.payableAt(), automatic, now));
        log.info("Payout {} requested by the withdrawal of campaign {}; payable at {}.", requested.id(), projectId, requested.payableAt());
        return Optional.of(requested);
    }
}
