package az.ideanest.payout.domain;

import az.ideanest.shared.Identifiers;
import az.ideanest.shared.money.Money;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/**
 * What a creator is owed, frozen at the moment it was worked out — V55, issues #69 and
 * #306.
 *
 * <p><strong>Every figure is stored and none is derived.</strong> V55's header has the
 * argument: a payout is derivable from the collections, the refunds and the fee schedule,
 * and every one of those moves. Recomputing on read would produce a different number from
 * the one two people approved, and the approval would then be an approval of nothing in
 * particular.
 *
 * <p>The fee schedule that produced the deductions is named on the row, so the arithmetic
 * can be re-derived years later without depending on what is in force then.
 */
@Entity
@Table(name = "payouts")
public class Payout {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "creator_id", nullable = false, updatable = false)
    private UUID creatorId;

    @Column(name = "gross_amount", nullable = false, updatable = false)
    private BigDecimal grossAmount;

    @Column(name = "platform_fee", nullable = false, updatable = false)
    private BigDecimal platformFee;

    @Column(name = "processing_fee", nullable = false, updatable = false)
    private BigDecimal processingFee;

    @Column(name = "tax_withheld", nullable = false, updatable = false)
    private BigDecimal taxWithheld;

    @Column(name = "refunded_amount", nullable = false, updatable = false)
    private BigDecimal refundedAmount;

    /** IDN-EXT-01 (#43): withheld towards the creator's chargeback debts. See V80. */
    @Column(name = "debt_withheld", nullable = false, updatable = false)
    private BigDecimal debtWithheld = BigDecimal.ZERO;

    @Column(name = "net_amount", nullable = false, updatable = false)
    private BigDecimal netAmount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Column(name = "fee_schedule_id", updatable = false)
    private UUID feeScheduleId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private PayoutState state;

    @Column(name = "payable_at", nullable = false, updatable = false)
    private Instant payableAt;

    @Column(name = "approvals_required", nullable = false, updatable = false)
    private short approvalsRequired;

    @Column(name = "payout_transaction_id")
    private UUID payoutTransactionId;

    @Column(name = "failure_code")
    private String failureCode;

    @Column(name = "failure_message")
    private String failureMessage;

    @Column(name = "calculated_at", nullable = false, insertable = false, updatable = false)
    private Instant calculatedAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    /**
     * V86 (#184's review): when a send ended with the provider unreachable. The instruction may have
     * been carried out, so the payout stays {@code APPROVED} and is only ever sent again under the
     * same key — never cancelled or recalculated, which would price it again under a new one.
     */
    @Column(name = "send_unconfirmed_at")
    private Instant sendUnconfirmedAt;

    /**
     * V98 (#397): when a member of staff opened the creator's account to pay this by bank transfer, and
     * who. The money may have left from then on, so — like {@link #sendUnconfirmedAt} — the payout stays
     * {@code APPROVED} and is neither cancelled nor recalculated until the transfer is recorded or
     * abandoned.
     */
    @Column(name = "bank_transfer_started_at")
    private Instant bankTransferStartedAt;

    @Column(name = "bank_transfer_started_by")
    private UUID bankTransferStartedBy;

    /** V98 (#397): the value date the bank gave the transfer that paid this. Only on a paid payout. */
    @Column(name = "bank_transferred_on")
    private LocalDate bankTransferredOn;

    /**
     * V100 (#418): the masked hint of the account last opened for this transfer, so the creator can be
     * told which account was paid without the account being opened again. Never the number.
     */
    @Column(name = "bank_transfer_account_hint")
    private String bankTransferAccountHint;

    @Column(name = "idempotency_key", nullable = false, updatable = false)
    private String idempotencyKey;

    protected Payout() {
        // Hibernate.
    }

    private Payout(
            UUID projectId,
            UUID creatorId,
            Money gross,
            Money platformFee,
            Money processingFee,
            Money refunded,
            Money net,
            UUID feeScheduleId,
            Instant payableAt,
            short approvalsRequired,
            String idempotencyKey) {

        this.id = Identifiers.newIdentifier();
        this.projectId = Objects.requireNonNull(projectId, "projectId");
        this.creatorId = Objects.requireNonNull(creatorId, "creatorId");
        this.grossAmount = gross.amount();
        this.platformFee = platformFee.amount();
        this.processingFee = processingFee.amount();
        this.taxWithheld = BigDecimal.ZERO;
        this.refundedAmount = refunded.amount();
        this.netAmount = net.amount();
        this.currency = gross.currency();
        this.feeScheduleId = feeScheduleId;
        this.state = PayoutState.CALCULATED;
        this.payableAt = Objects.requireNonNull(payableAt, "payableAt");
        this.approvalsRequired = approvalsRequired;
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey, "idempotencyKey");
    }

    /**
     * The idempotency key a payout is sent under, which Epoint's {@code /refund-request} also takes as
     * its {@code order_id}: why it was priced, the campaign, and when. At most 65 characters for the
     * purposes in use, inside Epoint's 255 (#178).
     */
    public static String idempotencyKeyOf(String purpose, UUID projectId, Instant at) {
        return purpose + "-" + projectId + "-" + at.toEpochMilli();
    }

    /** A figure worked out and not yet payable. */
    public static Payout calculated(
            UUID projectId,
            UUID creatorId,
            Money gross,
            Money platformFee,
            Money processingFee,
            Money refunded,
            Money net,
            UUID feeScheduleId,
            Instant payableAt,
            short approvalsRequired,
            String idempotencyKey) {

        return new Payout(
                projectId,
                creatorId,
                gross,
                platformFee,
                processingFee,
                refunded,
                net,
                feeScheduleId,
                payableAt,
                approvalsRequired,
                idempotencyKey);
    }

    /**
     * The hold has expired and this is waiting on signatures.
     *
     * <p>Called by the queue read rather than by a scheduled job, deliberately. A job that
     * flipped the state would be a second thing to go wrong before anybody could be paid,
     * and the state is derivable from {@code payableAt} and the clock — so the screen
     * moves it when it lists it, which is the only moment anybody cares.
     */
    public void payable() {
        if (state == PayoutState.CALCULATED) {
            state = PayoutState.PENDING_APPROVAL;
        }
    }

    /**
     * Enough people have signed.
     *
     * <p>The count is checked by {@code PayoutService} against
     * {@link #approvalsRequired()}, because the rule is about rows in another table.
     */
    public void approved() {
        state = PayoutState.APPROVED;
    }

    /**
     * A signature was withdrawn and the payout no longer has enough of them - issue #398.
     *
     * <p><strong>Why this is not {@link #payable()}.</strong> That method is called by the
     * queue read on every row it lists, so it has to be a no-op on everything except a held
     * one - {@code PayoutApprovalTests.payableOnlyMovesFromCalculated} asserts exactly that,
     * and widening it would let a listing un-approve a payout two people had signed.
     *
     * <p>Which made it the wrong method for the withdrawal path, and silently so: called
     * with the state at {@code APPROVED} it returned without doing anything, so the guard in
     * {@code PayoutService.withdrawApproval} compiled, ran, and left the payout {@code
     * APPROVED} with one signature of two. The comment above that call said the line
     * prevented precisely that.
     *
     * <p>So this transition is its own method and it is total: it moves an approved payout
     * back to waiting, and it throws on anything else rather than returning quietly. A state
     * machine that ignores the state it is handed cannot be relied on by a caller, and the
     * money is gated on it.
     *
     * @throws IllegalStateException when the payout is not {@code APPROVED}
     */
    public void backToPendingApproval() {
        if (state != PayoutState.APPROVED) {
            throw new IllegalStateException("Payout " + id + " is " + state + ", not APPROVED");
        }
        state = PayoutState.PENDING_APPROVAL;
    }

    /** The provider took it. */
    public void paid(UUID transactionId, Instant at) {
        this.state = PayoutState.PAID;
        this.payoutTransactionId = Objects.requireNonNull(transactionId, "transactionId");
        this.sentAt = Objects.requireNonNull(at, "at");
        this.failureCode = null;
        this.failureMessage = null;
    }

    /**
     * The provider could not be reached, so whether the money moved is unknown (#184's review).
     *
     * <p>Not {@link #failed}: a failed payout is followed by a fresh calculation under a new key, and if
     * this instruction was carried out that would pay the creator twice. It stays {@code APPROVED}, is
     * retried under the same key, and {@link #sendUnconfirmed()} keeps it from being cancelled.
     */
    public void sendUnconfirmedAt(Instant at) {
        if (state != PayoutState.APPROVED) {
            throw new IllegalStateException("Payout " + id + " is " + state + ", not APPROVED");
        }
        this.sendUnconfirmedAt = Objects.requireNonNull(at, "at");
    }

    /** Whether a send ended unreachable, so the money may already have moved. */
    public boolean sendUnconfirmed() {
        return sendUnconfirmedAt != null;
    }

    /**
     * A member of staff has opened the creator's account to pay this by bank transfer — #397.
     *
     * <p>Not a state. V98's header has the argument: it is {@link #sendUnconfirmedAt}'s sibling on the
     * other route, an {@code APPROVED} row whose money may have left. Only an approved payout whose send
     * was never left unanswered can start one, because a send the provider may have carried out is
     * settled from the provider's statement before anybody pays the same money by hand.
     */
    public void bankTransferStarted(UUID staffId, Instant at) {
        if (state != PayoutState.APPROVED || sendUnconfirmed() || bankTransferStartedAt != null) {
            throw new IllegalStateException("Payout " + id + " is " + state + " and cannot start a bank transfer");
        }
        this.bankTransferStartedAt = Objects.requireNonNull(at, "at");
        this.bankTransferStartedBy = Objects.requireNonNull(staffId, "staffId");
    }

    /**
     * Nobody made the transfer after all, and the payout may be cancelled again — #397.
     *
     * <p>A person's statement about their own bank, which is why the service requires a note and audits
     * it. The method only asserts that there was a transfer to abandon.
     */
    public void bankTransferAbandoned() {
        if (state != PayoutState.APPROVED || bankTransferStartedAt == null) {
            throw new IllegalStateException("Payout " + id + " has no bank transfer in progress");
        }
        this.bankTransferStartedAt = null;
        this.bankTransferStartedBy = null;
        this.bankTransferAccountHint = null;
    }

    /**
     * Which account was opened for the transfer in progress, as its masked hint — #418. Written each time
     * the account is opened, so a transfer finished by a colleague after the creator replaced and
     * re-verified their account names the account that was actually shown.
     */
    public void bankTransferAccount(String displayHint) {
        if (!bankTransferInProgress()) {
            throw new IllegalStateException("Payout " + id + " has no bank transfer in progress");
        }
        this.bankTransferAccountHint = displayHint;
    }

    /**
     * The transfer was made, and the bank statement shows it — #397.
     *
     * <p>{@link #paid} with the bank's value date beside it. Only from a started transfer: a payout
     * recorded as paid by bank without one would be a transfer to an account nobody opened here.
     */
    public void paidByBankTransfer(UUID transactionId, LocalDate transferredOn, Instant at) {
        if (state != PayoutState.APPROVED || bankTransferStartedAt == null) {
            throw new IllegalStateException("Payout " + id + " has no bank transfer in progress");
        }
        paid(transactionId, at);
        this.bankTransferredOn = Objects.requireNonNull(transferredOn, "transferredOn");
    }

    /** Whether a member of staff has started paying this by bank transfer and not yet recorded it. */
    public boolean bankTransferInProgress() {
        return state == PayoutState.APPROVED && bankTransferStartedAt != null;
    }

    /**
     * Whether the money may already have left by either route: a send the provider never answered, or a
     * bank transfer started by hand (#184's review, #397). What a dispute, a recalculation and a
     * cancellation ask before they move a payout.
     */
    public boolean moneyMayHaveLeft() {
        return sendUnconfirmed() || bankTransferInProgress();
    }

    /**
     * Everything it would have paid went towards the creator's debts (#184's review).
     *
     * <p>{@code PAID} with nothing sent and no transaction — V86 allows that for a net of zero — so the
     * campaign reads as paid out to every guard that asks, and a redelivered withdrawal cannot price the
     * money the platform kept a second time.
     */
    public void settledAgainstDebts(Instant at) {
        if (state != PayoutState.CALCULATED || netAmount.signum() != 0 || debtWithheld.signum() <= 0) {
            throw new IllegalStateException(
                    "Payout " + id + " is " + state + " with net " + netAmount + ", not wholly withheld");
        }
        this.state = PayoutState.PAID;
        this.sentAt = Objects.requireNonNull(at, "at");
    }

    /** The provider refused. Terminal — see {@link PayoutState#FAILED}. */
    public void failed(String failureCode, String failureMessage, Instant at) {
        this.state = PayoutState.FAILED;
        this.failureCode = Objects.requireNonNull(failureCode, "failureCode");
        this.failureMessage = failureMessage;
        this.sentAt = Objects.requireNonNull(at, "at");
    }

    /**
     * IDN-EXT-01 (#43): withholds part of the net towards the creator's debts, before the payout is saved.
     * The net is what actually leaves, so it goes down by what is withheld.
     */
    public void withholdDebt(Money debt) {
        if (state != PayoutState.CALCULATED) {
            throw new IllegalStateException("Debt is withheld when a payout is priced, not in " + state);
        }
        if (!debt.isPositive() || debt.amount().compareTo(netAmount) > 0) {
            throw new IllegalArgumentException("Withholding " + debt + " from a net of " + netAmount);
        }
        this.debtWithheld = debtWithheld.add(debt.amount());
        this.netAmount = netAmount.subtract(debt.amount());
    }

    /** What was withheld towards the creator's debts. */
    public Money debtWithheld() {
        return Money.of(debtWithheld, currency);
    }

    /** Withdrawn before it was sent. */
    public void cancelled() {
        this.state = PayoutState.CANCELLED;
    }

    /** Whether the hold has run out, as of an instant. */
    public boolean isPayableAt(Instant instant) {
        return !instant.isBefore(payableAt);
    }

    public UUID id() {
        return id;
    }

    public UUID projectId() {
        return projectId;
    }

    public UUID creatorId() {
        return creatorId;
    }

    public Money gross() {
        return Money.of(grossAmount, currency);
    }

    public Money platformFee() {
        return Money.of(platformFee, currency);
    }

    public Money processingFee() {
        return Money.of(processingFee, currency);
    }

    public Money taxWithheld() {
        return Money.of(taxWithheld, currency);
    }

    public Money refunded() {
        return Money.of(refundedAmount, currency);
    }

    public Money net() {
        return Money.of(netAmount, currency);
    }

    public String currency() {
        return currency;
    }

    public UUID feeScheduleId() {
        return feeScheduleId;
    }

    public PayoutState state() {
        return state;
    }

    public Instant payableAt() {
        return payableAt;
    }

    public short approvalsRequired() {
        return approvalsRequired;
    }

    public UUID payoutTransactionId() {
        return payoutTransactionId;
    }

    public String failureCode() {
        return failureCode;
    }

    public String failureMessage() {
        return failureMessage;
    }

    public Instant calculatedAt() {
        return calculatedAt;
    }

    public Instant sentAt() {
        return sentAt;
    }

    public String idempotencyKey() {
        return idempotencyKey;
    }

    public Instant bankTransferStartedAt() {
        return bankTransferStartedAt;
    }

    public UUID bankTransferStartedBy() {
        return bankTransferStartedBy;
    }

    public LocalDate bankTransferredOn() {
        return bankTransferredOn;
    }

    /** The masked hint of the account a bank transfer was made to, or null. */
    public String bankTransferAccountHint() {
        return bankTransferAccountHint;
    }
}
