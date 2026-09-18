package az.ideanest.subscription.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.subscription.domain.PaymentMethod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPayment;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.domain.SubscriptionState;
import az.ideanest.subscription.infrastructure.SubscriptionPaymentRepository;
import az.ideanest.subscription.infrastructure.SubscriptionPlanRepository;
import az.ideanest.subscription.infrastructure.SubscriptionRepository;
import az.ideanest.user.application.AccountNotFoundException;
import az.ideanest.user.application.UserDirectory;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Buying, holding and ending a subscription.
 *
 * <h2>Two steps for a paid plan, and why that is not a stub</h2>
 *
 * <p>Nothing on this platform can charge a card. §9.2 ships no payment provider adapter
 * while #60 — confirm §9.3's fourteen capabilities in writing — is unanswered, and
 * {@code PaymentProvider}'s header says plainly why no stub adapter ships in the meantime:
 * an adapter that returned an approval would make the path look finished.
 *
 * <p>So a priced plan is bought into {@link SubscriptionState#PENDING_PAYMENT}, and a
 * member of staff records that the transfer arrived. That is how a platform with no
 * processor actually sells — an invoice and a bank transfer — and it is audited under the
 * name of whoever confirmed it. When #60 lands, the provider's callback replaces
 * {@link #activate} and nothing above it changes: the states, the gate and the pricing
 * page are already the shape a provider needs.
 *
 * <p>A plan priced at zero has no second step. {@link #subscribe} activates it on the
 * spot, because there is no payment to wait for.
 *
 * <h2>One open subscription per account, enforced by an index rather than a read</h2>
 *
 * <p>V62's partial unique index is what makes it true, and {@link #subscribe} turns the
 * violation into a refusal. A read-then-write would let two purchases arriving together
 * both find nothing and both insert.
 *
 * <h2>What was paid is written down separately</h2>
 *
 * <p>{@link #activate} opens the entitlement <em>and</em> writes V73's journal row, in one
 * transaction. The journal is not a second copy of the subscription: it records the money
 * rather than the entitlement, with the plan's code, name and price copied onto it as they
 * stood when the transfer arrived. V73's header argues why a report must not read those
 * through {@code subscription_plans} — an operator repricing or renaming a plan would
 * otherwise rewrite every total the platform has ever published.
 *
 * <p>The same index cannot consult a clock, so an {@code ACTIVE} row whose period ended
 * last week would block the account from buying again. {@link #subscribe} retires it
 * inside its own transaction, immediately before inserting — which is why there is no
 * sweep job doing it on a schedule. V62's header has that argument.
 */
@Service
public class Subscriptions {

    private static final Logger log = LoggerFactory.getLogger(Subscriptions.class);

    private final SubscriptionRepository subscriptions;
    private final SubscriptionPlanRepository plans;
    private final SubscriptionPaymentRepository payments;
    private final PlatformStaff staff;
    private final UserDirectory accounts;
    private final AuditLog audit;
    private final Clock clock;

    public Subscriptions(
            SubscriptionRepository subscriptions,
            SubscriptionPlanRepository plans,
            SubscriptionPaymentRepository payments,
            PlatformStaff staff,
            UserDirectory accounts,
            AuditLog audit,
            Clock clock) {
        this.subscriptions = subscriptions;
        this.plans = plans;
        this.payments = payments;
        this.staff = staff;
        this.accounts = accounts;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * What this account holds, if anything that has not ended.
     *
     * <p>Returns a lapsed subscription too, and that is deliberate: "your Growth plan
     * ended on 3 August" is a different sentence from "you have never subscribed", and a
     * query that filtered on the clock could not tell a creator which one they are in.
     * {@link Subscription#entitlesAt} is what decides whether it still buys anything.
     */
    @Transactional(readOnly = true)
    public Optional<Subscription> heldBy(UUID accountId) {
        return subscriptions.openFor(accountId);
    }

    /** Everything this account has ever held, newest first. */
    @Transactional(readOnly = true)
    public List<Subscription> historyOf(UUID accountId) {
        return subscriptions.historyFor(accountId);
    }

    /**
     * Buys a plan.
     *
     * <p>Three things happen in one transaction: a lapsed row is retired, the purchase is
     * written, and — for a free plan — the entitlement opens. They are one transaction
     * because the first is only safe as part of the second: retiring somebody's expired
     * subscription and then failing to write its replacement would leave an account with
     * nothing, having asked for something.
     *
     * @param planId which plan. Must be on sale; a subscription against an unlisted plan
     *     would be a purchase from a catalogue that no longer offers it
     * @throws AlreadySubscribedException when the account holds one that has not ended.
     *     Changing plan is cancel-then-subscribe, because upgrading mid-period needs a
     *     provider that can refund a part-month
     */
    @Transactional
    public Subscription subscribe(UUID accountId, UUID planId) {
        SubscriptionPlan plan = plans.findById(planId).orElseThrow(() -> new UnknownPlanException(planId));
        if (!plan.isListed()) {
            throw new PlanNotOnSaleException(planId);
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Optional<Subscription> open = subscriptions.openFor(accountId);
        if (open.isPresent()) {
            Subscription existing = open.get();
            if (!existing.hasLapsedBy(now)) {
                throw new AlreadySubscribedException(existing.getState() == SubscriptionState.PENDING_PAYMENT);
            }
            // Its period ran out and the index does not know. Retired here rather than by
            // a job, by the person it was in the way of, at the moment it was in the way.
            existing.expire(now);
            subscriptions.saveAndFlush(existing);
        }

        Subscription bought = plan.requiresPayment()
                ? Subscription.awaitingPayment(Identifiers.newIdentifier(), accountId, plan, now)
                : Subscription.activeFrom(Identifiers.newIdentifier(), accountId, plan, now);

        Subscription saved;
        try {
            saved = subscriptions.saveAndFlush(bought);
        } catch (DataIntegrityViolationException e) {
            // Two purchases arrived together. The index caught it; the loser is told they
            // already have one rather than shown a 500.
            throw new AlreadySubscribedException(false);
        }

        log.info(
                "Account {} subscribed to plan {} ({}), state {}",
                accountId,
                plan.getId(),
                plan.getCode(),
                saved.getState());
        return saved;
    }

    /**
     * The creator's own cancellation: keep the period, do not renew.
     *
     * <p>The entitlement runs to {@code current_period_end}. Taking it away the moment
     * they click would be charging for a month and then withdrawing it, and a creator with
     * a live campaign would lose the ability to submit the next one for a period they have
     * already paid for.
     *
     * <p>A subscription still waiting for payment is cancelled outright instead — there is
     * no period to run out, and leaving it open would keep a row in the console's queue
     * for a purchase somebody has abandoned.
     */
    @Transactional
    public Subscription cancel(UUID accountId) {
        Subscription subscription = subscriptions.openFor(accountId).orElseThrow(NoSubscriptionException::new);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        if (subscription.getState() == SubscriptionState.PENDING_PAYMENT) {
            subscription.cancelNow(null, now);
        } else {
            subscription.cancelAtPeriodEnd(now);
        }

        log.info("Account {} cancelled subscription {}", accountId, subscription.getId());
        return subscription;
    }

    /* ---------------------------------------------------------------------
     * The console
     * ------------------------------------------------------------------ */

    /**
     * Everything, or just what is waiting for a payment to be recorded.
     *
     * @param awaitingPaymentOnly the queue rather than the archive. The queue is what the
     *     screen opens on, because it is the only part of this that is somebody's work
     */
    @Transactional(readOnly = true)
    public List<Subscription> forConsole(UUID staffId, boolean awaitingPaymentOnly) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        return awaitingPaymentOnly
                ? subscriptions.inState(SubscriptionState.PENDING_PAYMENT)
                : subscriptions.recent();
    }

    /**
     * Records that the payment arrived, and opens the period.
     *
     * <p>The period starts now rather than when the plan was chosen, so a creator who
     * waited three days for a transfer to clear gets the month they paid for.
     *
     * <h3>Two writes, one transaction</h3>
     *
     * <p>The entitlement opens and V73's journal gets a row, and they commit together or
     * not at all. An entitlement without a receipt is revenue the platform cannot account
     * for; a receipt without an entitlement is a creator who paid and cannot publish.
     * Either alone is found weeks later by somebody reconciling a bank statement, which is
     * the worst time to find it.
     *
     * <p>The journal row is not the audit row and neither replaces the other. The audit
     * entry says a privileged action was taken and by whom; the journal says what money
     * arrived, for which plan, at what price — and it survives the account being closed,
     * which V62 cascades the subscription away with.
     *
     * @param method how it arrived. Null means {@link PaymentMethod#BANK_TRANSFER}, which
     *     is the only way anything arrives while #60 is unanswered
     * @param receivedAt when the money arrived. Null means now. May be earlier than now,
     *     because a transfer that cleared on the 31st belongs in the month it cleared
     * @param reference the transfer reference or invoice number. Not required by the
     *     column and required here in spirit only — refusing an activation for a missing
     *     reference would leave a paying creator waiting while somebody looks one up
     * @param note anything else worth recording, kept on both the subscription and the
     *     journal row
     * @throws SubscriptionNotAwaitingPaymentException when a colleague got there first
     * @throws PaymentNotYetReceivedException when {@code receivedAt} is in the future
     */
    @Transactional
    public Subscription activate(
            UUID staffId,
            UUID subscriptionId,
            PaymentMethod method,
            Instant receivedAt,
            String reference,
            String note) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        Subscription subscription = subscriptions
                .findById(subscriptionId)
                .orElseThrow(() -> new SubscriptionNotFoundException(subscriptionId));

        if (subscription.getState() != SubscriptionState.PENDING_PAYMENT) {
            throw new SubscriptionNotAwaitingPaymentException(subscriptionId, subscription.getState());
        }

        SubscriptionPlan plan = plans.findById(subscription.getPlanId())
                .orElseThrow(() -> new UnknownPlanException(subscription.getPlanId()));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant arrived = receivedAt == null ? now : receivedAt.truncatedTo(ChronoUnit.MICROS);
        if (arrived.isAfter(now)) {
            throw new PaymentNotYetReceivedException(receivedAt);
        }

        subscription.activate(plan, staffId, note, now);

        SubscriptionPayment payment = payments.save(SubscriptionPayment.received(
                Identifiers.newIdentifier(),
                subscription,
                plan,
                method == null ? PaymentMethod.BANK_TRANSFER : method,
                arrived,
                staffId,
                reference,
                note));

        audit.record(
                AuditAction.SUBSCRIPTION_ACTIVATED,
                subscription.getId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "account=%s; plan=%s; paid=%s; received=%s; payment=%s; until=%s"
                        .formatted(
                                subscription.getAccountId(),
                                plan.getCode(),
                                subscription.getPrice(),
                                arrived,
                                payment.getId(),
                                subscription.getCurrentPeriodEnd()));

        log.info(
                "Subscription {} activated by {}; payment {} recorded",
                subscription.getId(),
                staffId,
                payment.getId());
        return subscription;
    }

    /**
     * Everything one account has held and paid, for the console's account page.
     *
     * <p><strong>Any member of staff, not {@code CONFIGURE_PLATFORM}.</strong> The revenue
     * report needs the capability because it is every subscriber at once; this is one person,
     * on the page where somebody is deciding about that person, and it follows the account
     * page's pledge list — {@code UserAdministrationService.pledgesOf} — which asks the same
     * question and makes the same argument: a moderator weighing a suspension should see what
     * the account has paid the platform, not a page with that section missing because their
     * role does not administer plans.
     *
     * <p><strong>Recorded, and only as counts.</strong> The trail says a member of staff read
     * this account's payments, which is the fact an investigation needs; copying amounts or
     * plan names into {@code audit_logs} would make the row the disclosure it exists to record.
     *
     * <p><strong>Unpaged.</strong> A monthly plan is twelve subscriptions and twelve payments a
     * year at the most. An account with enough rows to need a cursor is one somebody should be
     * looking at for a different reason, which is {@code SubscriptionRepository.historyFor}'s
     * argument too.
     *
     * @throws AccountNotFoundException for an identifier that names nothing and for a deleted
     *     account — the answer the account page's other reads give, so the page fails in one way
     */
    @Transactional(readOnly = true)
    public AccountSubscriptionHistory accountHistory(UUID staffId, UUID accountId) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        if (accounts.find(accountId).isEmpty()) {
            throw new AccountNotFoundException(accountId);
        }

        List<Subscription> held = subscriptions.historyFor(accountId);
        List<PaymentPage.Payment> paid = payments.forAccount(accountId).stream()
                .map(PaymentPage.Payment::recorded)
                .toList();

        audit.recordIndependently(
                AuditAction.ACCOUNTS_SEARCHED,
                accountId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "subscriptions=%d; payments=%d".formatted(held.size(), paid.size()));

        return new AccountSubscriptionHistory(held, paid);
    }

    /**
     * Staff ending a subscription outright — a chargeback, a fraud finding, or a purchase
     * somebody made by mistake.
     *
     * <p>Immediate, unlike the creator's own cancellation, because the reasons are
     * different: a creator who cancels has paid for the period, and an account whose
     * payment was reversed has not.
     *
     * @param reason recorded on the row and on the audit entry. Required: this takes
     *     something away from somebody, and the creator asking why is entitled to an answer
     *     that exists
     */
    @Transactional
    public Subscription end(UUID staffId, UUID subscriptionId, String reason) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        Subscription subscription = subscriptions
                .findById(subscriptionId)
                .orElseThrow(() -> new SubscriptionNotFoundException(subscriptionId));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        subscription.cancelNow(reason, now);

        audit.record(
                AuditAction.SUBSCRIPTION_CANCELED,
                subscription.getId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "account=%s; reason=%s".formatted(subscription.getAccountId(), reason));

        log.info("Subscription {} ended by {}", subscription.getId(), staffId);
        return subscription;
    }
}
