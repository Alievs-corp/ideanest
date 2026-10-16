package az.ideanest.payment.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.ProviderName;
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
import java.time.Duration;
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
 * <p>The provider is asked outside any transaction, and only after the row has been claimed under its
 * lock (V108). A refund whose answer never arrives leaves the claim in place: the money may already be on
 * its way back, so the bank-transfer route is refused, and the next card refund asks the provider whether
 * the payment was returned before it sends anything. Every request carries the same key, so a provider
 * that de-duplicates on it names the same refund. The claim is cleared only when the provider definitely
 * refuses.
 */
@Service
public class UnappliedPlanPayments {

    private static final Logger log = LoggerFactory.getLogger(UnappliedPlanPayments.class);

    static final String REASON_CODE = "PLAN_NOT_APPLIED";

    /**
     * How long a claimed card refund is left to finish before a second press may ask again. Longer than any
     * provider call is allowed to take, so two members of staff pressing together do not both send.
     */
    static final Duration ATTEMPT_LEASE = Duration.ofSeconds(90);

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
            Instant cardRefundUntil,
            Instant cardRefundStartedAt) {
    }

    /** Oldest first: the card window closes on those first. */
    public List<Unapplied> list(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        return charges.unapplied().stream().map(this::describe).toList();
    }

    /**
     * Returns the payment to the card that paid it, in full.
     *
     * <p>Idempotent, which the money requires. The row is claimed before the provider is asked; a retry of a
     * claimed row asks the provider whether the payment was already returned and records that instead of
     * sending a second refund. A refusal clears the claim; an unanswered request keeps it.
     *
     * @throws PlanRefundRefusedException when it is not waiting to be returned, the window has closed, the
     *     provider refused or could not be reached, a refund was sent and not confirmed, or another refund
     *     of it is under way
     */
    public Unapplied refundToCard(UUID staffId, UUID chargeId) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Claim claim = claim(staffId, chargeId, now);

        PaymentProvider provider = providers.byName(claim.provider()).orElse(null);
        if (provider == null || !breaker.isAvailable(provider.name())) {
            if (!claim.retry()) {
                release(chargeId);
            }
            throw new PlanRefundRefusedException(
                    claim.retry() ? PlanRefundRefusedException.Reason.UNCONFIRMED
                            : PlanRefundRefusedException.Reason.PROVIDER_UNAVAILABLE,
                    chargeId,
                    provider == null ? "no adapter" : "circuit breaker open");
        }

        if (claim.retry()) {
            // An earlier request may have been carried out. Asked first, so a refund the provider already
            // made is recorded rather than sent again.
            PaymentLookup lookup;
            try {
                lookup = breaker.call(provider.name(), () -> provider.lookUpPayment(claim.providerTransactionId()));
            } catch (ProviderUnavailableException e) {
                throw unconfirmed(staffId, chargeId, e.getMessage());
            }
            if (lookup.state() == PaymentLookup.State.RETURNED) {
                log.info("Plan payment {} was already returned by an earlier, unanswered refund.", chargeId);
                return record(staffId, chargeId, SubscriptionCharge.RefundMethod.CARD, claim.providerTransactionId(),
                        "confirmed from the provider after an unanswered refund", now);
            }
            if (lookup.state() == PaymentLookup.State.PENDING) {
                throw unconfirmed(staffId, chargeId, "the provider still reports the refund in progress");
            }
        }

        RefundResult result;
        try {
            result = breaker.call(provider.name(), () -> provider.refund(new RefundRequest(
                    chargeId,
                    claim.providerTransactionId(),
                    claim.amount(),
                    REASON_CODE,
                    refundKey(chargeId))));
        } catch (ProviderUnavailableException e) {
            // The provider may have carried it out. The claim stays, which keeps the bank transfer closed.
            throw unconfirmed(staffId, chargeId, e.getMessage());
        }
        if (result.isWindowClosed()) {
            release(chargeId);
            throw new PlanRefundRefusedException(
                    PlanRefundRefusedException.Reason.CARD_WINDOW_CLOSED, chargeId, result.failureMessage());
        }
        if (result.outcome() != ProviderOutcome.APPROVED) {
            release(chargeId);
            throw new PlanRefundRefusedException(
                    PlanRefundRefusedException.Reason.PROVIDER_REFUSED, chargeId, result.failureMessage());
        }
        return record(staffId, chargeId, SubscriptionCharge.RefundMethod.CARD, claim.providerTransactionId(), null, now);
    }

    /** What the provider is asked with, read under the claim's lock. */
    private record Claim(ProviderName provider, String providerTransactionId, Money amount, boolean retry) {
    }

    /**
     * Marks the card refund as sent, under the row's lock, before anybody asks the provider.
     *
     * <p>A first request checks the card window here; a retry leaves that to the provider, because the
     * refund it is retrying may already have been made inside the window.
     */
    private Claim claim(UUID staffId, UUID chargeId, Instant now) {
        return transaction.execute(status -> {
            SubscriptionCharge charge = charges.lockById(chargeId).orElseThrow(() ->
                    new PlanRefundRefusedException(PlanRefundRefusedException.Reason.NOT_FOUND, chargeId, null));
            if (charge.getStatus() != SubscriptionCharge.Status.UNAPPLIED) {
                throw new PlanRefundRefusedException(PlanRefundRefusedException.Reason.NOT_UNAPPLIED, chargeId, null);
            }
            Instant started = charge.getCardRefundStartedAt();
            boolean retry = started != null;
            if (retry && started.plus(ATTEMPT_LEASE).isAfter(now)) {
                throw new PlanRefundRefusedException(PlanRefundRefusedException.Reason.IN_PROGRESS, chargeId, null);
            }
            if (!retry) {
                Instant until = cardRefundUntil(charge);
                if (until != null && until.isBefore(now)) {
                    throw new PlanRefundRefusedException(
                            PlanRefundRefusedException.Reason.CARD_WINDOW_CLOSED, chargeId, null);
                }
            }
            charge.cardRefundStarted(staffId, now);
            charges.save(charge);
            return new Claim(charge.getProvider(), charge.getProviderTransactionId(), charge.getAmount(), retry);
        });
    }

    /** The provider said no for certain: nothing left, so either route is open again. */
    private void release(UUID chargeId) {
        transaction.executeWithoutResult(status -> charges.lockById(chargeId).ifPresent(charge -> {
            if (charge.getStatus() == SubscriptionCharge.Status.UNAPPLIED) {
                charge.cardRefundReleased();
                charges.save(charge);
            }
        }));
    }

    /** Audited, because a refund that may have been made is what somebody reconciling the provider asks about. */
    private PlanRefundRefusedException unconfirmed(UUID staffId, UUID chargeId, String why) {
        audit.recordIndependently(
                AuditAction.PLAN_PAYMENT_REFUNDED,
                chargeId,
                AuditActor.moderator(staffId),
                AuditOutcome.FAILED,
                "unconfirmed; " + why);
        log.warn("Plan payment {}'s card refund is unconfirmed: {}", chargeId, why);
        return new PlanRefundRefusedException(PlanRefundRefusedException.Reason.UNCONFIRMED, chargeId, why);
    }

    /** The same for every request about this payment, so a provider that de-duplicates names one refund. */
    static String refundKey(UUID chargeId) {
        return "plan-refund-" + chargeId;
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
            if (method == SubscriptionCharge.RefundMethod.BANK_TRANSFER && charge.cardRefundUnsettled()) {
                // A card refund may already have returned this money. Paying it again by hand is the double
                // payment V108 exists to prevent; the card refund is settled first.
                throw new PlanRefundRefusedException(
                        PlanRefundRefusedException.Reason.CARD_REFUND_UNSETTLED, chargeId, null);
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
        if (charge.cardRefundUnsettled()) {
            throw new PlanRefundRefusedException(PlanRefundRefusedException.Reason.CARD_REFUND_UNSETTLED, chargeId, null);
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
                cardRefundUntil(charge),
                charge.cardRefundUnsettled() ? charge.getCardRefundStartedAt() : null);
    }
}
