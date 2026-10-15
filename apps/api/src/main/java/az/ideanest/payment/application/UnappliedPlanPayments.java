package az.ideanest.payment.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.SubscriptionCharge;
import az.ideanest.payment.infrastructure.SubscriptionChargeRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Plan payments the platform took and could not apply, and their return — issue #457.
 *
 * <p>A card payment that arrives for a subscription that has ended is settled {@code UNAPPLIED}
 * (#449): the money is in and buys nothing. Staff return it to the card through the provider while
 * the provider's refund window is open, or record the bank transfer that returned it after.
 *
 * <p>The provider is asked outside any transaction. The row is then locked and checked again, so two
 * members of staff returning the same payment record it once; the provider's refund is keyed on the
 * page, so a second request names the same refund.
 */
@Service
public class UnappliedPlanPayments {

    private static final Logger log = LoggerFactory.getLogger(UnappliedPlanPayments.class);

    static final String REASON_CODE = "PLAN_NOT_APPLIED";

    private final SubscriptionChargeRepository charges;
    private final PaymentProviders providers;
    private final RefundWindows windows;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final TransactionTemplate transaction;
    private final ProviderCircuitBreaker breaker;
    private final Clock clock;

    public UnappliedPlanPayments(
            SubscriptionChargeRepository charges,
            PaymentProviders providers,
            RefundWindows windows,
            PlatformStaff staff,
            AuditLog audit,
            PlatformTransactionManager transactionManager,
            ProviderCircuitBreaker breaker,
            Clock clock) {
        this.charges = charges;
        this.providers = providers;
        this.windows = windows;
        this.staff = staff;
        this.audit = audit;
        this.transaction = new TransactionTemplate(transactionManager);
        this.breaker = breaker;
        this.clock = clock;
    }

    /** One payment waiting to go back, and until when it can go back to the card. */
    public record Unapplied(
            UUID id,
            UUID subscriptionId,
            UUID accountId,
            Money amount,
            String provider,
            String providerTransactionId,
            Instant paidAt,
            Instant cardRefundUntil) {
    }

    /** Oldest first: the card window closes on those first. */
    public List<Unapplied> list(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        return charges.unapplied().stream().map(this::describe).toList();
    }

    /**
     * Returns the payment to the card that paid it, in full.
     *
     * @throws PlanRefundRefusedException when it is not waiting to be returned, the window has
     *     closed, or the provider refused or could not be reached
     */
    public Unapplied refundToCard(UUID staffId, UUID chargeId) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        SubscriptionCharge charge = unapplied(chargeId);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant until = cardRefundUntil(charge);
        if (until != null && until.isBefore(now)) {
            throw new PlanRefundRefusedException(PlanRefundRefusedException.Reason.CARD_WINDOW_CLOSED, chargeId, null);
        }
        PaymentProvider provider = providers.byName(charge.getProvider())
                .orElseThrow(() -> new PlanRefundRefusedException(
                        PlanRefundRefusedException.Reason.PROVIDER_UNAVAILABLE, chargeId, "no adapter"));
        if (!breaker.isAvailable(provider.name())) {
            throw new PlanRefundRefusedException(
                    PlanRefundRefusedException.Reason.PROVIDER_UNAVAILABLE, chargeId, "circuit breaker open");
        }

        RefundResult result;
        try {
            result = breaker.call(provider.name(), () -> provider.refund(new RefundRequest(
                    chargeId,
                    charge.getProviderTransactionId(),
                    charge.getAmount(),
                    REASON_CODE,
                    "plan-refund-" + chargeId)));
        } catch (ProviderUnavailableException e) {
            throw new PlanRefundRefusedException(
                    PlanRefundRefusedException.Reason.PROVIDER_UNAVAILABLE, chargeId, e.getMessage());
        }
        if (result.isWindowClosed()) {
            throw new PlanRefundRefusedException(
                    PlanRefundRefusedException.Reason.CARD_WINDOW_CLOSED, chargeId, result.failureMessage());
        }
        if (result.outcome() != ProviderOutcome.APPROVED) {
            throw new PlanRefundRefusedException(
                    PlanRefundRefusedException.Reason.PROVIDER_REFUSED, chargeId, result.failureMessage());
        }
        return record(staffId, chargeId, SubscriptionCharge.RefundMethod.CARD, charge.getProviderTransactionId(), null, now);
    }

    /**
     * Records the bank transfer that returned the payment, once the card window has closed.
     *
     * @param reference the bank's reference for the transfer
     */
    public Unapplied recordBankTransfer(UUID staffId, UUID chargeId, String reference, String note) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        unapplied(chargeId);
        return record(
                staffId,
                chargeId,
                SubscriptionCharge.RefundMethod.BANK_TRANSFER,
                reference,
                note,
                clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    private Unapplied record(
            UUID staffId, UUID chargeId, SubscriptionCharge.RefundMethod method, String reference, String note, Instant now) {
        return transaction.execute(status -> {
            SubscriptionCharge charge = charges.lockById(chargeId).orElseThrow(() ->
                    new PlanRefundRefusedException(PlanRefundRefusedException.Reason.NOT_FOUND, chargeId, null));
            if (charge.getStatus() != SubscriptionCharge.Status.UNAPPLIED) {
                throw new PlanRefundRefusedException(PlanRefundRefusedException.Reason.NOT_UNAPPLIED, chargeId, null);
            }
            charge.refunded(method, staffId, reference, note, now);
            charges.save(charge);
            audit.record(
                    AuditAction.PLAN_PAYMENT_REFUNDED,
                    chargeId,
                    AuditActor.moderator(staffId),
                    AuditOutcome.SUCCEEDED,
                    "subscription=%s; account=%s; amount=%s; method=%s; order=%s; reference=%s"
                            .formatted(
                                    charge.getSubscriptionId(),
                                    charge.getAccountId(),
                                    charge.getAmount(),
                                    method,
                                    charge.getProviderTransactionId(),
                                    reference));
            log.info("Plan payment {} returned by {} ({}).", charge.getProviderTransactionId(), staffId, method);
            return describe(charge);
        });
    }

    private SubscriptionCharge unapplied(UUID chargeId) {
        SubscriptionCharge charge = charges.findById(chargeId).orElseThrow(() ->
                new PlanRefundRefusedException(PlanRefundRefusedException.Reason.NOT_FOUND, chargeId, null));
        if (charge.getStatus() != SubscriptionCharge.Status.UNAPPLIED) {
            throw new PlanRefundRefusedException(PlanRefundRefusedException.Reason.NOT_UNAPPLIED, chargeId, null);
        }
        return charge;
    }

    private Instant cardRefundUntil(SubscriptionCharge charge) {
        Instant paid = charge.getSettledAt();
        return paid == null ? null : windows.of(charge.getProvider()).map(paid::plus).orElse(null);
    }

    private Unapplied describe(SubscriptionCharge charge) {
        return new Unapplied(
                charge.getId(),
                charge.getSubscriptionId(),
                charge.getAccountId(),
                charge.getAmount(),
                charge.getProvider().name(),
                charge.getProviderTransactionId(),
                charge.getSettledAt(),
                cardRefundUntil(charge));
    }
}
