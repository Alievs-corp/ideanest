package az.ideanest.payment.domain;

import az.ideanest.shared.Identifiers;
import az.ideanest.shared.money.Money;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** What a creator owes after a chargeback lost once they were paid — IDN-EXT-01 (#43). See V80. */
@Entity
@Table(name = "creator_debts")
public class CreatorDebt {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "creator_id", nullable = false, updatable = false)
    private UUID creatorId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "dispute_id", nullable = false, updatable = false)
    private UUID disputeId;

    @Column(name = "amount", nullable = false, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Column(name = "recovered", nullable = false)
    private BigDecimal recovered;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    protected CreatorDebt() {
    }

    public static CreatorDebt owed(UUID creatorId, UUID projectId, UUID disputeId, Money amount, Instant at) {
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("A debt is a positive amount, and this one is " + amount);
        }
        CreatorDebt debt = new CreatorDebt();
        debt.id = Identifiers.newIdentifier();
        debt.creatorId = Objects.requireNonNull(creatorId, "creatorId");
        debt.projectId = Objects.requireNonNull(projectId, "projectId");
        debt.disputeId = Objects.requireNonNull(disputeId, "disputeId");
        debt.amount = amount.amount();
        debt.currency = amount.currency();
        debt.recovered = BigDecimal.ZERO.setScale(2);
        debt.createdAt = Objects.requireNonNull(at, "at");
        return debt;
    }

    /** What is still owed. */
    public Money outstanding() {
        return Money.of(amount.subtract(recovered), currency);
    }

    /**
     * Applies up to {@code available} towards this debt.
     *
     * @return what was applied, never more than was outstanding
     */
    public Money recover(Money available, Instant at) {
        Money owed = outstanding();
        Money applied = available.isGreaterThan(owed) ? owed : available;
        this.recovered = recovered.add(applied.amount());
        if (recovered.compareTo(amount) == 0) {
            this.settledAt = Objects.requireNonNull(at, "at");
        }
        return applied;
    }

    public UUID id() {
        return id;
    }

    public UUID creatorId() {
        return creatorId;
    }

    public Instant settledAt() {
        return settledAt;
    }
}
