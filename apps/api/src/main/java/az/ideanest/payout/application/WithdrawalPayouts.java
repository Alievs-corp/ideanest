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
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Optional<Payout> requested = price(projectId, now, now.plus(properties.hold()), "withdrawal", automatic);
        requested.ifPresent(payout -> outbox.record(
                PayoutRequestedEvent.AGGREGATE_TYPE,
                payout.id(),
                PayoutRequestedEvent.EVENT_TYPE,
                new PayoutRequestedEvent(projectId, payout.creatorId(), payout.id(), payout.payableAt(), automatic, now)));
        return requested;
    }

    /**
     * Recalculates the payout in flight after its figures moved — IDN-EXT-01 (#43), an upheld dispute.
     *
     * <p>The payout in flight is cancelled and a new one priced from the funds as they now stand,
     * <strong>keeping the hold's end</strong>: a dispute refunds one backer and does not restart the
     * fourteen days for everybody else. Nobody is told again; the backers were told when it was
     * requested. Empty when nothing is left to pay.
     */
    @Transactional
    public Optional<Payout> recalculate(UUID projectId) {
        Optional<Payout> inFlight = payouts.inFlightFor(projectId);
        if (inFlight.isEmpty()) {
            return Optional.empty();
        }
        Payout held = payouts.findAndLock(inFlight.get().id()).orElseThrow();
        Instant payableAt = held.payableAt();
        held.cancelled();
        payouts.saveAndFlush(held);
        return price(projectId, clock.instant().truncatedTo(ChronoUnit.MICROS), payableAt, "recalculated", false);
    }

    private Optional<Payout> price(UUID projectId, Instant now, Instant payableAt, String why, boolean automatic) {
        ProjectSummary campaign = projects
                .summaryOf(projectId)
                .orElseThrow(() -> new UnknownPayoutCampaignException(projectId));

        CampaignFunds funds = gateway.fundsOf(projectId, properties.currency());
        if (!funds.net().isPositive()) {
            log.warn("Campaign {} has nothing collected left to pay out ({}).", projectId, why);
            return Optional.empty();
        }
        FeeBreakdown breakdown = fees.priceOf(funds.collected(), now, projectId);
        Money net = breakdown.net().minus(funds.refunded());
        if (!net.isPositive()) {
            log.warn("Campaign {} has nothing left to pay out after fees and refunds ({}).", projectId, why);
            return Optional.empty();
        }

        Payout priced = payouts.save(Payout.calculated(
                projectId,
                campaign.creatorId(),
                funds.collected(),
                breakdown.platformFee(),
                breakdown.processingFee(),
                funds.refunded(),
                net,
                breakdown.scheduleId(),
                payableAt,
                service.approvalsRequiredFor(net),
                why + "-" + projectId + "-" + now.toEpochMilli()));

        audit.record(
                AuditAction.PAYOUT_CALCULATED,
                priced.id(),
                AuditActor.system(),
                AuditOutcome.SUCCEEDED,
                "%s; automatic=%s; project=%s; gross=%s; fees=%s; refunded=%s; net=%s"
                        .formatted(why, automatic, projectId, funds.collected(), breakdown.totalFees(), funds.refunded(), net));
        log.info("Payout {} {} for campaign {}; payable at {}.", priced.id(), why, projectId, priced.payableAt());
        return Optional.of(priced);
    }
}
