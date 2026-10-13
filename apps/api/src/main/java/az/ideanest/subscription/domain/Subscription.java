package az.ideanest.subscription.domain;

import az.ideanest.shared.money.Money;
import az.ideanest.shared.money.MoneyAmountConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * What one account has bought, and until when — V62's row.
 *
 * <h2>The price is copied here; the limits are not</h2>
 *
 * <p>{@link #price}, {@link #currency} and {@link #billingPeriod} are snapshots taken at
 * purchase. The limits are read live from the plan, every time. V62's header has the full
 * argument; the short form is that a price that moved under a subscriber is a bill they
 * never agreed to, whereas a limit that moved is either a gift or a change that reaches
 * only their next submission.
 *
 * <h2>{@code ACTIVE} is not the same as entitled</h2>
 *
 * <p>{@link #entitlesAt} is the only question worth asking, and it consults the clock as
 * well as the state. V62 explains why no job marks a lapsed row {@code EXPIRED} on a
 * schedule: nothing reads the state without the period, so the job would exist to make a
 * column agree with a clock its readers already consult.
 *
 * <h2>A creator's cancellation is not staff's</h2>
 *
 * <p>{@link #cancelAtPeriodEnd} leaves the row {@code ACTIVE} and stops it renewing: the
 * creator paid for the month and taking it back the moment they click would be charging
 * for something and then withdrawing it. {@link #cancelNow} is the other one, and it is
 * staff ending a subscription — for a chargeback, a fraud finding, or a request to undo a
 * purchase somebody made by mistake.
 */
@Entity
@Table(name = "subscriptions")
public class Subscription {

    private static final int NOTE_MAX = 2000;

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private SubscriptionState state;

    @Convert(converter = MoneyAmountConverter.class)
    @Column(name = "price", nullable = false, updatable = false)
    private BigDecimal price;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_period", nullable = false, updatable = false)
    private BillingPeriod billingPeriod;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "current_period_end")
    private Instant currentPeriodEnd;

    @Column(name = "cancel_at_period_end", nullable = false)
    private boolean cancelAtPeriodEnd;

    @Column(name = "canceled_at")
    private Instant canceledAt;

    @Column(name = "activated_by")
    private UUID activatedBy;

    @Column(name = "note")
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Subscription() {
        // Hibernate.
    }

    private Subscription(UUID id, UUID accountId, SubscriptionPlan plan, Instant now) {
        this.id = id;
        this.accountId = accountId;
        this.planId = plan.getId();
        this.price = plan.getPrice().amount();
        this.currency = plan.getPrice().currency();
        this.billingPeriod = plan.getBillingPeriod();
        this.cancelAtPeriodEnd = false;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * A purchase of a plan that costs something.
     *
     * <p>Starts in {@link SubscriptionState#PENDING_PAYMENT} with no window at all, which
     * is what V62's {@code subscriptions_active_has_a_window} check requires: a row with a
     * start and no end is one the entitlement query treats as never expiring, and a row
     * with a window and no payment would be a free subscription with a price on it.
     */
    public static Subscription awaitingPayment(UUID id, UUID accountId, SubscriptionPlan plan, Instant now) {
        Subscription subscription = new Subscription(id, requireAccount(accountId), requirePlan(plan), require(now));
        subscription.state = SubscriptionState.PENDING_PAYMENT;
        return subscription;
    }

    /**
     * A purchase of a plan that costs nothing.
     *
     * <p>No {@link #activatedBy}: nobody activated it, and naming the creator there would
     * make the column mean two different things depending on the price.
     */
    public static Subscription activeFrom(UUID id, UUID accountId, SubscriptionPlan plan, Instant now) {
        Subscription subscription = new Subscription(id, requireAccount(accountId), requirePlan(plan), require(now));
        subscription.state = SubscriptionState.ACTIVE;
        subscription.startedAt = now;
        subscription.currentPeriodEnd = plan.periodEndFrom(now);
        return subscription;
    }

    /**
     * Records that the payment arrived and opens the period.
     *
     * <p>The period starts <em>now</em> rather than at {@link #createdAt}, so a creator
     * who waited three days for a transfer to clear gets the month they paid for rather
     * than twenty-seven days of it.
     *
     * @param activatedBy the member of staff who confirmed it. Never the creator
     * @param note the transfer reference, the invoice number — whatever makes the
     *     confirmation checkable afterwards
     * @throws IllegalStateException if it is not waiting for payment. Not a refusal type,
     *     because the service checks first and this is the assertion that the check
     *     happened
     */
    public void activate(SubscriptionPlan plan, UUID activatedBy, String note, Instant now) {
        if (state != SubscriptionState.PENDING_PAYMENT) {
            throw new IllegalStateException("Only a subscription waiting for payment can be activated");
        }
        this.state = SubscriptionState.ACTIVE;
        this.startedAt = require(now);
        this.currentPeriodEnd = requirePlan(plan).periodEndFrom(now);
        this.activatedBy = Objects.requireNonNull(activatedBy, "Somebody recorded this payment");
        this.note = trimmedOrNull(note);
        this.updatedAt = now;
    }

    /**
     * Opens the first period because the provider said the card was charged — #449.
     *
     * <p>{@link #activate} without a member of staff: nobody confirmed this by hand, and naming
     * the creator in {@link #activatedBy} would make the column mean two things.
     */
    public void activatePaid(SubscriptionPlan plan, Instant now) {
        if (state != SubscriptionState.PENDING_PAYMENT) {
            throw new IllegalStateException("Only a subscription waiting for payment can be activated");
        }
        this.state = SubscriptionState.ACTIVE;
        this.startedAt = require(now);
        this.currentPeriodEnd = requirePlan(plan).periodEndFrom(now);
        this.updatedAt = now;
    }

    /**
     * One more period, paid for by the creator — #449.
     *
     * <p>From the end of the running period, so renewing early loses no days; from now if the
     * period has already run out, so a renewal paid late is not a period that is partly over
     * before it starts. Paying is also the clearest way of withdrawing a cancellation, so it
     * clears one.
     *
     * <p>The price and billing period are this row's own snapshot: what the creator renews is what
     * they bought, whatever the plan costs new buyers today.
     */
    public void renew(Instant now) {
        if (state != SubscriptionState.ACTIVE) {
            throw new IllegalStateException("Only an active subscription can be renewed");
        }
        Instant from = currentPeriodEnd.isAfter(require(now)) ? currentPeriodEnd : now;
        this.currentPeriodEnd = billingPeriod.endOf(from);
        this.cancelAtPeriodEnd = false;
        this.canceledAt = null;
        this.updatedAt = now;
    }

    /**
     * What a card payment made now would buy — #449. Empty when nothing is due.
     *
     * <p>The first period of a subscription waiting for payment, or the next period of a priced one
     * that is still running and whose end is inside the renewal window. A lapsed subscription is
     * bought again rather than renewed, through {@code Subscriptions.subscribe}.
     *
     * @param renewalWindow how long before the end of a period renewing it is offered
     */
    public Optional<DuePayment> paymentDueAt(Instant now, Duration renewalWindow) {
        if (state == SubscriptionState.PENDING_PAYMENT) {
            return Optional.of(DuePayment.FIRST_PERIOD);
        }
        if (price.signum() > 0 && entitlesAt(now) && !now.isBefore(renewalOpensAt(renewalWindow))) {
            return Optional.of(DuePayment.RENEWAL);
        }
        return Optional.empty();
    }

    /** When renewing this period is first offered, or null for a row with no running period. */
    public Instant renewalOpensAt(Duration renewalWindow) {
        if (state != SubscriptionState.ACTIVE || currentPeriodEnd == null || price.signum() == 0) {
            return null;
        }
        return currentPeriodEnd.minus(renewalWindow);
    }

    /** What paying for this subscription now would be for. */
    public enum DuePayment {
        FIRST_PERIOD,
        RENEWAL
    }

    /**
     * The creator's cancellation: keep what was paid for, do not renew.
     *
     * <p>Idempotent. A creator who clicks twice has said the same thing twice, and a
     * refusal on the second would be the platform arguing with them about something they
     * have already achieved.
     */
    public void cancelAtPeriodEnd(Instant now) {
        this.cancelAtPeriodEnd = true;
        this.canceledAt = this.canceledAt == null ? require(now) : this.canceledAt;
        this.updatedAt = now;
    }

    /**
     * Staff ending a subscription outright, entitlement and all.
     *
     * <p>Also what closes a {@link SubscriptionState#PENDING_PAYMENT} row nobody ever paid
     * for, which is the ordinary case: somebody chose a plan and changed their mind.
     */
    public void cancelNow(String reason, Instant now) {
        this.state = SubscriptionState.CANCELED;
        this.canceledAt = require(now);
        this.note = trimmedOrNull(reason);
        this.updatedAt = now;
        // The window is left as it was. It says what was bought, and blanking it would
        // lose the only record of the period somebody is asking for their money back for.
    }

    /**
     * Retires a row whose period ran out, so the account may subscribe again.
     *
     * <p>Called by {@code Subscriptions.subscribe} on the row standing in its way, and by
     * nothing else — V62's unique index cannot consult a clock, and this is what makes the
     * absence of a sweep job safe.
     */
    public void expire(Instant now) {
        this.state = SubscriptionState.EXPIRED;
        this.updatedAt = require(now);
    }

    /**
     * Whether this entitles its account to publish at that instant.
     *
     * <p>The state <em>and</em> the clock. Half-open at the end: a subscription whose
     * period ends at noon does not entitle at noon, matching every other window on this
     * platform ({@code FeeSchedule.coversInstant}) so that no reader has to remember which
     * boundary belongs to which table.
     */
    public boolean entitlesAt(Instant when) {
        return state == SubscriptionState.ACTIVE
                && currentPeriodEnd != null
                && currentPeriodEnd.isAfter(require(when));
    }

    /** Whether its period has run out while it was still marked active. */
    public boolean hasLapsedBy(Instant when) {
        return state == SubscriptionState.ACTIVE && !entitlesAt(when);
    }

    /** Whether it is still in the way of a new purchase — V62's partial unique index, in Java. */
    public boolean isOpen() {
        return state == SubscriptionState.PENDING_PAYMENT || state == SubscriptionState.ACTIVE;
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getPlanId() {
        return planId;
    }

    public SubscriptionState getState() {
        return state;
    }

    /** What this account was charged, which is not necessarily what the plan costs today. */
    public Money getPrice() {
        return Money.of(price, currency);
    }

    public BillingPeriod getBillingPeriod() {
        return billingPeriod;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getCurrentPeriodEnd() {
        return currentPeriodEnd;
    }

    public boolean isCancelAtPeriodEnd() {
        return cancelAtPeriodEnd;
    }

    public Instant getCanceledAt() {
        return canceledAt;
    }

    public UUID getActivatedBy() {
        return activatedBy;
    }

    public String getNote() {
        return note;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    private static UUID requireAccount(UUID accountId) {
        return Objects.requireNonNull(accountId, "A subscription belongs to an account");
    }

    private static SubscriptionPlan requirePlan(SubscriptionPlan plan) {
        return Objects.requireNonNull(plan, "A subscription is against a plan");
    }

    private static Instant require(Instant now) {
        return Objects.requireNonNull(now, "This happens at some instant");
    }

    private static String trimmedOrNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        // Truncated rather than refused. This is a note beside an audit row that carries
        // the same fact, and losing the whole activation because somebody pasted a long
        // bank statement into the reference field would be the wrong trade.
        return trimmed.length() <= NOTE_MAX ? trimmed : trimmed.substring(0, NOTE_MAX);
    }
}
