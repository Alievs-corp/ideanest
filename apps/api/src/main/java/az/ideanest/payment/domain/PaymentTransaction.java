package az.ideanest.payment.domain;

import az.ideanest.shared.Identifiers;
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
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.generator.EventType;
import org.hibernate.type.SqlTypes;

/**
 * §7.2's {@code transactions}: one call to a payment provider, and what it said.
 *
 * <p><strong>Insert only.</strong> V41 makes that true of the database with a
 * statement-level trigger; here it is expressed as every column being
 * {@code updatable = false}, no setters, and static factories that produce a
 * <em>finished</em> row. There is no {@code markSucceeded}, because §7.2 says
 * corrections are new rows and because a mutable status is how a ledger stops being
 * evidence.
 *
 * <p><strong>Named {@code PaymentTransaction} rather than {@code Transaction}.</strong>
 * The unqualified word already means something in every file that touches Spring —
 * {@code @Transactional}, {@code TransactionTemplate}, the transaction this row is
 * written in — and a class called {@code Transaction} in a service where a
 * transaction is also a unit of work is an import somebody gets wrong at three in the
 * morning. The table keeps §7.2's name.
 *
 * <p><strong>A declined charge is a row.</strong> The most common mistake in this
 * shape of table is to write only the successes, and it costs exactly the thing §9.6
 * is built on: without the declines there is no attempt history, no decline code, and
 * no way to tell a card that was refused four times from a card nobody tried.
 */
@Entity
@Table(name = "transactions")
public class PaymentTransaction {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Null on a payout and present on everything else; V41's check pairs the two. */
    @Column(name = "pledge_id", updatable = false)
    private UUID pledgeId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, updatable = false)
    private TransactionType type;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, updatable = false)
    private TransactionStatus status;

    @Convert(converter = MoneyAmountConverter.class)
    @Column(name = "amount", nullable = false, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider", nullable = false, updatable = false)
    private ProviderName provider;

    @Column(name = "provider_transaction_id", updatable = false)
    private String providerTransactionId;

    /**
     * The provider's answer, verbatim.
     *
     * <p>{@code jsonb} in PostgreSQL and a {@link String} here: nothing in Java reads
     * inside it, and parsing a document into objects only to serialise them again would
     * be two more places for a provider's field to be renamed. V41 has the argument for
     * why this column is {@code jsonb} while {@code outbox_events.payload} is
     * {@code text}.
     *
     * <p><strong>Redacted by the adapter before it gets here.</strong> §17.2's rule is
     * that card data never traverses these servers, and a column somebody has to
     * remember to sanitise is a column that eventually holds a PAN.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "provider_response", updatable = false)
    private String providerResponse;

    @Column(name = "failure_code", updatable = false)
    private String failureCode;

    @Column(name = "failure_message", updatable = false)
    private String failureMessage;

    @Column(name = "attempt_number", nullable = false, updatable = false)
    private int attemptNumber;

    @Column(name = "idempotency_key", nullable = false, updatable = false)
    private String idempotencyKey;

    /**
     * #436 (V101): whether a campaign-outcome refund of this charge returns it less the provider's fee
     * posted with it. Decided when the charge is recorded, from the words the backer was shown, and
     * like every other column here never changed: a refund months later reads this, not the setting.
     */
    @Column(name = "provider_fee_withheld_on_refund", nullable = false, updatable = false)
    private boolean providerFeeWithheldOnRefund;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected PaymentTransaction() {
        // Hibernate's.
    }

    private PaymentTransaction(
            UUID pledgeId,
            UUID projectId,
            TransactionType type,
            TransactionStatus status,
            Money amount,
            ProviderName provider,
            String providerTransactionId,
            String providerResponse,
            String failureCode,
            String failureMessage,
            int attemptNumber,
            String idempotencyKey,
            boolean providerFeeWithheldOnRefund) {
        // v7, like every other identifier the application mints: time-ordered, so this
        // table's primary key index stays local as it becomes the largest in the schema.
        this.id = Identifiers.newIdentifier();
        this.pledgeId = pledgeId;
        this.projectId = projectId;
        this.type = type;
        this.status = status;
        this.amount = amount.amount();
        this.currency = amount.currency();
        this.provider = provider;
        this.providerTransactionId = providerTransactionId;
        this.providerResponse = providerResponse;
        this.failureCode = failureCode;
        this.failureMessage = truncate(failureMessage);
        this.attemptNumber = attemptNumber;
        this.idempotencyKey = idempotencyKey;
        this.providerFeeWithheldOnRefund = providerFeeWithheldOnRefund;
    }

    /**
     * A collection attempt, recorded from what the provider said.
     *
     * <p>One factory for all three outcomes rather than one per outcome, because the
     * mapping from {@link ProviderOutcome} to {@link TransactionStatus} is the thing
     * that must not vary between call sites: an approval recorded as {@code PENDING}
     * would be collected money nobody credits, and a decline recorded as
     * {@code SUCCEEDED} would be a backer credited for a charge that never happened.
     *
     * @param attemptNumber which of §9.6's attempts, counted from one
     * @param idempotencyKey the key the provider was given, so that the platform's
     *     record and the provider's can be matched even when the call itself was lost
     * @param providerFeeWithheldOnRefund #436: whether this charge was taken under the rule that a
     *     failed, suspended or cancelled campaign refunds it less the provider's fee. A parameter with
     *     no default, so every place that records a charge says which words it was taken under
     */
    public static PaymentTransaction charge(
            UUID pledgeId,
            UUID projectId,
            Money amount,
            ProviderName provider,
            ChargeResult result,
            int attemptNumber,
            String idempotencyKey,
            boolean providerFeeWithheldOnRefund) {
        return new PaymentTransaction(
                pledgeId,
                projectId,
                TransactionType.CHARGE,
                TransactionStatus.of(result.outcome()),
                amount,
                provider,
                result.providerTransactionId(),
                result.rawResponse(),
                result.failureCode(),
                result.failureMessage(),
                attemptNumber,
                idempotencyKey,
                providerFeeWithheldOnRefund);
    }

    /**
     * A collection attempt the platform could not complete: the provider was
     * unreachable, or answered something nobody can read.
     *
     * <p><strong>Recorded, and that is the point of having it.</strong> The tempting
     * alternative is to write nothing and retry, and it loses the one fact that matters
     * afterwards: the platform sent an instruction and does not know what became of it.
     * A row with the idempotency key on it is what lets the same key be replayed safely
     * and what lets a reconciliation against the provider's statement find a charge the
     * platform never saw succeed.
     *
     * <p>It is a {@code FAILED} row and not a {@code PENDING} one, deliberately.
     * {@code PENDING} means the provider accepted the instruction, which is precisely
     * what is not known here.
     */
    public static PaymentTransaction unreachable(
            UUID pledgeId,
            UUID projectId,
            Money amount,
            ProviderName provider,
            String failureMessage,
            int attemptNumber,
            String idempotencyKey) {
        return new PaymentTransaction(
                pledgeId,
                projectId,
                TransactionType.CHARGE,
                TransactionStatus.FAILED,
                amount,
                provider,
                null,
                null,
                UNREACHABLE,
                failureMessage,
                attemptNumber,
                idempotencyKey,
                false);
    }

    /**
     * A refund attempt, recorded from what the provider said — #67.
     *
     * <p>A {@code REFUND} row for a <strong>positive</strong> amount, never a
     * {@code CHARGE} row for a negative one. V41 is explicit about this: direction is a
     * property of what kind of call it was, and a signed amount would be a second and
     * silently disagreeing answer to the question {@code type} already answers.
     *
     * <p>{@code attemptNumber} is fixed at one. §9.6's schedule counts collection
     * attempts against a pledge, and a refund is not one of them — a refund that fails is
     * retried by staff issuing another, which is a new decision and a new
     * {@code refunds} row rather than the next attempt at an old one.
     */
    public static PaymentTransaction refund(
            UUID pledgeId,
            UUID projectId,
            Money amount,
            ProviderName provider,
            RefundResult result,
            String idempotencyKey) {
        return new PaymentTransaction(
                pledgeId,
                projectId,
                TransactionType.REFUND,
                TransactionStatus.of(result.outcome()),
                amount,
                provider,
                result.providerTransactionId(),
                result.rawResponse(),
                result.failureCode(),
                result.failureMessage(),
                1,
                idempotencyKey,
                false);
    }

    /**
     * A payout attempt, recorded from what the provider said — #69.
     *
     * <p><strong>The pledge is null and the campaign is not.</strong> V41 says so in the
     * check that pairs them: everything except a payout names a pledge, and a payout is
     * about a campaign and a creator rather than about any single one.
     */
    public static PaymentTransaction payout(
            UUID projectId,
            Money amount,
            ProviderName provider,
            PayoutResult result,
            String idempotencyKey) {
        return new PaymentTransaction(
                null,
                projectId,
                TransactionType.PAYOUT,
                TransactionStatus.of(result.outcome()),
                amount,
                provider,
                result.providerTransactionId(),
                result.rawResponse(),
                result.failureCode(),
                result.failureMessage(),
                1,
                idempotencyKey,
                false);
    }

    /**
     * The failure code on a row the provider never answered.
     *
     * <p>A code of the platform's own, and it has to be: V41 requires a
     * {@code FAILED} row to say why, and there is no provider code because there was no
     * provider answer. Distinguishable from every real decline precisely because no
     * provider will ever send it, which is what lets §9.6's schedule tell "the card was
     * refused" from "we could not ask".
     */
    public static final String UNREACHABLE = "provider_unreachable";

    /** §7.2's {@code failure_message} is bounded at 1,000; a provider's prose is not. */
    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        String trimmed = message.strip();
        return trimmed.length() <= 1000 ? trimmed : trimmed.substring(0, 1000);
    }

    public UUID getId() {
        return id;
    }

    public UUID getPledgeId() {
        return pledgeId;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public TransactionType getType() {
        return type;
    }

    public TransactionStatus getStatus() {
        return status;
    }

    /** The amount and its currency, assembled at the entity's edge. */
    public Money getAmount() {
        return Money.of(amount, currency);
    }

    public ProviderName getProvider() {
        return provider;
    }

    public String getProviderTransactionId() {
        return providerTransactionId;
    }

    public String getFailureCode() {
        return failureCode;
    }

    public String getFailureMessage() {
        return failureMessage;
    }

    public int getAttemptNumber() {
        return attemptNumber;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    /** #436: whether a campaign-outcome refund of this charge withholds the provider's fee. */
    public boolean isProviderFeeWithheldOnRefund() {
        return providerFeeWithheldOnRefund;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    /** Whether this row is money that actually moved, and therefore has a ledger posting. */
    public boolean moved() {
        return status == TransactionStatus.SUCCEEDED;
    }
}
