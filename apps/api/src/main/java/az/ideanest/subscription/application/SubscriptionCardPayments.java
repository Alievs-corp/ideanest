package az.ideanest.subscription.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.payment.application.SubscriptionChargeSettlement;
import az.ideanest.payment.application.SubscriptionCheckout;
import az.ideanest.payment.application.SubscriptionPaymentPage;
import az.ideanest.payment.application.SubscriptionPaymentRequest;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.outbox.Outbox;
import az.ideanest.subscription.SubscriptionProperties;
import az.ideanest.subscription.domain.PaymentMethod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPayment;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.domain.SubscriptionState;
import az.ideanest.subscription.infrastructure.SubscriptionPaymentRepository;
import az.ideanest.subscription.infrastructure.SubscriptionPlanRepository;
import az.ideanest.subscription.infrastructure.SubscriptionRepository;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * A creator plan paid by card — issue #449, epic #448.
 *
 * <h2>The creator confirms every period</h2>
 *
 * <p>Nothing is charged without the creator on the provider's page. The first period of a pending
 * subscription is paid the same way a renewal is, and a renewal is offered only inside the renewal
 * window before the period ends ({@link SubscriptionProperties#renewalWindow()}). No card is stored
 * and nothing is collected on a schedule: the epic argues why.
 *
 * <h2>What the money means is decided when it arrives</h2>
 *
 * <p>{@link #paid} reads the subscription under a row lock and decides there, not from what the
 * page was opened for. A pending subscription opens its first period; an active one, lapsed or
 * not, gains one more period; one that has ended can take nothing, and the payment is left for a
 * person to refund. So two pages paid for one period are two periods rather than a refusal of
 * money already taken.
 *
 * <p>The period, the receipt ({@code subscription_payments}), the audit row and
 * {@code subscription.paid} commit with the page's settlement in the webhook's transaction.
 */
@Service
public class SubscriptionCardPayments implements SubscriptionChargeSettlement {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionCardPayments.class);

    private final SubscriptionRepository subscriptions;
    private final SubscriptionPlanRepository plans;
    private final SubscriptionPaymentRepository payments;
    private final SubscriptionCheckout checkout;
    private final SubscriptionProperties properties;
    private final AuditLog audit;
    private final Outbox outbox;
    private final Clock clock;

    public SubscriptionCardPayments(
            SubscriptionRepository subscriptions,
            SubscriptionPlanRepository plans,
            SubscriptionPaymentRepository payments,
            SubscriptionCheckout checkout,
            SubscriptionProperties properties,
            AuditLog audit,
            Outbox outbox,
            Clock clock) {
        this.subscriptions = subscriptions;
        this.plans = plans;
        this.payments = payments;
        this.checkout = checkout;
        this.properties = properties;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    /**
     * Opens the provider's page for whatever this account owes now.
     *
     * <p>Not transactional: the provider is asked in the middle, and a connection is not held across
     * a call to another service.
     *
     * @throws NoSubscriptionException when the account holds nothing
     * @throws NoPaymentDueException when what it holds has nothing to pay for now
     * @throws az.ideanest.payment.application.SubscriptionCheckoutUnavailableException when no
     *     provider can take the payment now
     */
    public SubscriptionPaymentPage pay(UUID accountId, String language, URI successUrl, URI errorUrl) {
        Instant now = clock.instant();
        Subscription held = subscriptions.openFor(accountId).orElseThrow(NoSubscriptionException::new);
        Subscription.DuePayment due = held.paymentDueAt(now, properties.renewalWindow())
                .orElseThrow(() -> new NoPaymentDueException(reasonNothingIsDue(held, now)));
        SubscriptionPlan plan = plans.findById(held.getPlanId())
                .orElseThrow(() -> new UnknownPlanException(held.getPlanId()));

        return checkout.open(
                new SubscriptionPaymentRequest(
                        held.getId(),
                        accountId,
                        held.getPrice(),
                        plan.getName(),
                        due == Subscription.DuePayment.RENEWAL),
                language,
                successUrl,
                errorUrl);
    }

    /** What {@link #pay} would pay for now, for the client to offer the right button. Empty when nothing. */
    public Optional<Subscription.DuePayment> dueFor(Subscription subscription, Instant now) {
        return subscription.paymentDueAt(now, properties.renewalWindow());
    }

    /** When renewing this subscription's period is first offered, or null. */
    public Instant renewalOpensAt(Subscription subscription) {
        return subscription.renewalOpensAt(properties.renewalWindow());
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public Outcome paid(PaidSubscriptionCharge charge) {
        Optional<Subscription> found = subscriptions.lockById(charge.subscriptionId());
        if (found.isEmpty() || !found.get().isOpen()) {
            log.error(
                    "Plan payment {} arrived for subscription {}, which is {}.",
                    charge.providerTransactionId(),
                    charge.subscriptionId(),
                    found.map(s -> s.getState().name()).orElse("gone"));
            return Outcome.UNAPPLIED;
        }
        Subscription subscription = found.get();
        SubscriptionPlan plan = plans.findById(subscription.getPlanId())
                .orElseThrow(() -> new UnknownPlanException(subscription.getPlanId()));
        Instant now = charge.paidAt().truncatedTo(ChronoUnit.MICROS);

        boolean renewal = subscription.getState() == SubscriptionState.ACTIVE;
        if (renewal) {
            subscription.renew(now);
        } else {
            subscription.activatePaid(plan, now);
        }
        subscriptions.save(subscription);

        SubscriptionPayment payment = payments.save(SubscriptionPayment.received(
                Identifiers.newIdentifier(),
                subscription,
                plan,
                PaymentMethod.CARD,
                now,
                null,
                charge.provider() + " " + charge.providerTransactionId(),
                null));

        audit.record(
                renewal ? AuditAction.SUBSCRIPTION_RENEWED : AuditAction.SUBSCRIPTION_ACTIVATED,
                subscription.getId(),
                AuditActor.system(),
                AuditOutcome.SUCCEEDED,
                "account=%s; plan=%s; paid=%s; provider=%s; order=%s; payment=%s; until=%s"
                        .formatted(
                                subscription.getAccountId(),
                                plan.getCode(),
                                subscription.getPrice(),
                                charge.provider(),
                                charge.providerTransactionId(),
                                payment.getId(),
                                subscription.getCurrentPeriodEnd()));

        outbox.record(
                SubscriptionPaidEvent.AGGREGATE_TYPE,
                subscription.getId(),
                SubscriptionPaidEvent.EVENT_TYPE,
                new SubscriptionPaidEvent(
                        subscription.getId(),
                        subscription.getAccountId(),
                        plan.getId(),
                        plan.getName(),
                        subscription.getPrice(),
                        renewal,
                        subscription.getCurrentPeriodEnd(),
                        now));

        log.info(
                "Subscription {} {} by card (order {}); paid until {}.",
                subscription.getId(),
                renewal ? "renewed" : "activated",
                charge.providerTransactionId(),
                subscription.getCurrentPeriodEnd());
        return renewal ? Outcome.RENEWED : Outcome.ACTIVATED;
    }

    private NoPaymentDueException.Reason reasonNothingIsDue(Subscription held, Instant now) {
        if (held.getPrice().amount().signum() == 0) {
            return NoPaymentDueException.Reason.FREE_PLAN;
        }
        if (!held.entitlesAt(now)) {
            return NoPaymentDueException.Reason.LAPSED;
        }
        return NoPaymentDueException.Reason.RENEWAL_NOT_OPEN;
    }
}
