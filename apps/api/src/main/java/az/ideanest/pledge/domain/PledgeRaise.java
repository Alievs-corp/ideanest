package az.ideanest.pledge.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

/**
 * One attempt to raise a paid pledge while its campaign is taking pledges — #171, V83.
 *
 * <h2>Why a row, and not an edit of the pledge</h2>
 *
 * <p>A {@code COLLECTED} pledge has been paid for, so raising it means taking more money, and the
 * money is taken on the provider's page in a second request that may never come. The pledge must not
 * change before the provider says the difference was paid: a backer who closes the page has raised
 * nothing, and a pledge that already showed the new total would be a promise about money that never
 * arrived. So the new selection is written here, priced, with the places it needs held, and it is
 * copied onto the pledge only when the charge settles.
 *
 * <h2>What it is measured against</h2>
 *
 * <p>{@link #getBaseVersion()} is the pledge's version when the raise was quoted, and
 * {@link #getAmount()} is the difference between the pledge's total then and the new total. The raise
 * is applied only to that same pledge: anything that has moved it since would make the difference a
 * difference from a pledge that no longer exists, and the charge is returned instead
 * ({@link PledgeRaiseState#UNAPPLIED}).
 */
@Entity
@Table(name = "pledge_raises")
public class PledgeRaise {

    /** What prefixes {@link #getChargeKey()}. A client's key is a UUID and can never start with it. */
    public static final String CHARGE_KEY_PREFIX = "pledge-raise-";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "pledge_id", nullable = false, updatable = false)
    private UUID pledgeId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private PledgeRaiseState state;

    @Column(name = "charge_key", nullable = false, updatable = false)
    private String chargeKey;

    @Column(name = "base_version", nullable = false, updatable = false)
    private long baseVersion;

    @Column(name = "from_reward_tier_id", updatable = false)
    private UUID fromRewardTierId;

    @Column(name = "to_reward_tier_id", updatable = false)
    private UUID toRewardTierId;

    @Column(name = "shipping_country", updatable = false)
    private String shippingCountry;

    @Column(name = "base_amount", nullable = false, updatable = false)
    private BigDecimal baseAmount;

    @Column(name = "addons_amount", nullable = false, updatable = false)
    private BigDecimal addonsAmount;

    @Column(name = "bonus_amount", nullable = false, updatable = false)
    private BigDecimal bonusAmount;

    @Column(name = "shipping_amount", nullable = false, updatable = false)
    private BigDecimal shippingAmount;

    @Column(name = "tax_amount", nullable = false, updatable = false)
    private BigDecimal taxAmount;

    @Column(name = "from_total", nullable = false, updatable = false)
    private BigDecimal fromTotal;

    @Column(name = "to_total", nullable = false, updatable = false)
    private BigDecimal toTotal;

    @Column(name = "amount", nullable = false, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Column(name = "hold_expires_at", nullable = false, updatable = false)
    private Instant holdExpiresAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected PledgeRaise() {
        // JPA.
    }

    /**
     * A raise the backer is about to pay for.
     *
     * @param pledge the pledge as it stands, which is what the difference is measured from
     * @param quote the new selection, priced
     * @param toRewardTierId the tier after the raise, or null for a pledge that is support only
     * @param shippingCountry the destination after the raise
     * @param holdExpiresAt until when the places are held for the payment
     * @throws IllegalArgumentException when the quote is not more than the pledge's total — the
     *     service refuses first, with a code; this is the entity keeping its own invariant
     */
    public static PledgeRaise pending(
            Pledge pledge, PledgeQuote quote, UUID toRewardTierId, String shippingCountry, Instant holdExpiresAt) {

        Objects.requireNonNull(pledge, "A raise raises a pledge");
        Objects.requireNonNull(quote, "A raise is priced");
        BigDecimal difference = quote.totalAmount().subtract(pledge.getTotalAmount());
        if (difference.signum() <= 0) {
            throw new IllegalArgumentException("A raise costs more than the pledge already does");
        }
        if (!quote.currency().equals(pledge.getCurrency())) {
            throw new IllegalArgumentException("A raise is priced in the pledge's own currency");
        }

        PledgeRaise raise = new PledgeRaise();
        raise.id = Identifiers.newIdentifier();
        raise.pledgeId = pledge.getId();
        raise.projectId = pledge.getProjectId();
        raise.state = PledgeRaiseState.PENDING;
        raise.chargeKey = CHARGE_KEY_PREFIX + raise.id;
        raise.baseVersion = pledge.getVersion();
        raise.fromRewardTierId = pledge.getRewardTierId();
        raise.toRewardTierId = toRewardTierId;
        raise.shippingCountry = shippingCountry;
        raise.baseAmount = quote.baseAmount();
        raise.addonsAmount = quote.addonsAmount();
        raise.bonusAmount = quote.bonusAmount();
        raise.shippingAmount = quote.shippingAmount();
        raise.taxAmount = quote.taxAmount();
        raise.fromTotal = pledge.getTotalAmount();
        raise.toTotal = quote.totalAmount();
        raise.amount = difference;
        raise.currency = quote.currency();
        raise.holdExpiresAt = Objects.requireNonNull(holdExpiresAt, "A hold ends at some point");
        return raise;
    }

    /** The difference was paid and the pledge now carries the new selection. */
    public void succeeded(Instant at) {
        if (state != PledgeRaiseState.PENDING && state != PledgeRaiseState.EXPIRED) {
            throw new IllegalStateException("A raise in " + state + " cannot be applied");
        }
        end(PledgeRaiseState.SUCCEEDED, at);
    }

    /** The provider said the payment failed. */
    public void failed(Instant at) {
        if (state != PledgeRaiseState.PENDING && state != PledgeRaiseState.EXPIRED) {
            throw new IllegalStateException("A raise in " + state + " cannot fail");
        }
        end(PledgeRaiseState.FAILED, at);
    }

    /** Nobody paid within the window. */
    public void expired(Instant at) {
        requirePending();
        end(PledgeRaiseState.EXPIRED, at);
    }

    /** The payment page could not be opened. */
    public void abandoned(Instant at) {
        requirePending();
        end(PledgeRaiseState.ABANDONED, at);
    }

    /** Paid for, and could not be applied: the charge is owed back. */
    public void unapplied(Instant at) {
        if (state != PledgeRaiseState.PENDING && state != PledgeRaiseState.EXPIRED) {
            throw new IllegalStateException("A raise in " + state + " was not waiting for a payment");
        }
        end(PledgeRaiseState.UNAPPLIED, at);
    }

    private void requirePending() {
        if (state != PledgeRaiseState.PENDING) {
            throw new IllegalStateException("A raise in " + state + " is not pending");
        }
    }

    private void end(PledgeRaiseState next, Instant at) {
        this.state = next;
        this.endedAt = Objects.requireNonNull(at, "A raise ended at some time");
    }

    public boolean isPending() {
        return state == PledgeRaiseState.PENDING;
    }

    /** Whether a settled payment may still move this raise: it was waiting for one, or stopped waiting. */
    public boolean awaitsPayment() {
        return state == PledgeRaiseState.PENDING || state == PledgeRaiseState.EXPIRED;
    }

    /** Whether this is pending and its hold has run out as of {@code now}. */
    public boolean hasLapsed(Instant now) {
        return isPending() && !holdExpiresAt.isAfter(now);
    }

    /** The new selection as {@link Pledge#edit} takes it. */
    public PledgeQuote quote() {
        return new PledgeQuote(baseAmount, addonsAmount, bonusAmount, shippingAmount, taxAmount, toTotal, currency);
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

    public PledgeRaiseState getState() {
        return state;
    }

    public String getChargeKey() {
        return chargeKey;
    }

    public long getBaseVersion() {
        return baseVersion;
    }

    public UUID getFromRewardTierId() {
        return fromRewardTierId;
    }

    public UUID getToRewardTierId() {
        return toRewardTierId;
    }

    public String getShippingCountry() {
        return shippingCountry;
    }

    public BigDecimal getFromTotal() {
        return fromTotal;
    }

    public BigDecimal getToTotal() {
        return toTotal;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    public Instant getHoldExpiresAt() {
        return holdExpiresAt;
    }

    public Instant getEndedAt() {
        return endedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof PledgeRaise raise && Objects.equals(id, raise.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        // No amount, for PledgeSupplement's reason.
        return "PledgeRaise[id=" + id + ", pledge=" + pledgeId + ", state=" + state + "]";
    }
}
