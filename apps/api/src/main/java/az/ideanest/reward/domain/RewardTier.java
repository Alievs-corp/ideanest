package az.ideanest.reward.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

/**
 * What a backer selects and pays for.
 *
 * <p><strong>Stock is read here and never written.</strong>
 * {@link #getClaimedQuantity()} and {@link #getReservedQuantity()} are mapped as
 * non-insertable and non-updatable columns: the pledge module (epic #50) and
 * reservation (#51) own them, and the campaign editor must not be able to move
 * them. A tier that could edit its own claimed count is a tier that can decide it
 * still has stock — and the database's
 * {@code reward_tiers_stock_is_within_the_limit} constraint would then be
 * enforcing an invariant against a number the editor had adjusted to fit.
 *
 * <p>The consequence is that a duplicate cannot copy them, which is the correct
 * behaviour and is not a special case anywhere: {@link #duplicateAt(int)} makes a
 * row that the database defaults to zero.
 *
 * <p>{@link Version} rather than a pessimistic lock. Two writers to one tier are
 * ordinary — the creator editing the description while a checkout reserves a place
 * — and unlike a state transition the loser has something useful to do, which is
 * re-read and retry. A row lock would instead make a backer's checkout wait on a
 * creator's autosave.
 *
 * <p>Money is {@link BigDecimal} against {@code numeric(14,2)}. This is the number
 * a card is charged.
 */
@Entity
@Table(name = "reward_tiers")
public class RewardTier {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "description")
    private String description;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount;

    /**
     * The campaign's currency, denormalised. A price without a currency on it is
     * not a price, and a pledge is quoted from this row rather than from a join.
     */
    @Column(name = "currency", nullable = false)
    private String currency;

    /** A month, expressed as a date. See the column comment in V7. */
    @Column(name = "estimated_delivery")
    private LocalDate estimatedDelivery;

    /** Null is unlimited, which is the common case. */
    @Column(name = "limit_quantity")
    private Integer limitQuantity;

    @Generated(event = EventType.INSERT)
    @Column(name = "claimed_quantity", nullable = false, insertable = false, updatable = false)
    private int claimedQuantity;

    @Generated(event = EventType.INSERT)
    @Column(name = "reserved_quantity", nullable = false, insertable = false, updatable = false)
    private int reservedQuantity;

    @Enumerated(EnumType.STRING)
    @Column(name = "shipping_type", nullable = false)
    private ShippingType shippingType;

    @Column(name = "is_early_bird", nullable = false)
    private boolean earlyBird;

    @Column(name = "is_featured", nullable = false)
    private boolean featured;

    @Column(name = "is_secret", nullable = false)
    private boolean secret;

    @Column(name = "secret_token")
    private String secretToken;

    @Column(name = "is_addon", nullable = false)
    private boolean addon;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "available_from")
    private Instant availableFrom;

    @Column(name = "available_until")
    private Instant availableUntil;

    /** A ready image upload of the creator's, or null. V112. */
    @Column(name = "image_media_id")
    private UUID imageMediaId;

    /** A ready video upload of at most {@code reward-max-duration}, or null. V112. */
    @Column(name = "video_media_id")
    private UUID videoMediaId;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Generated(event = {EventType.INSERT, EventType.UPDATE})
    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected RewardTier() {
        // JPA.
    }

    private RewardTier(UUID id, UUID projectId, String title, BigDecimal amount, String currency, int sortOrder) {
        this.id = id;
        this.projectId = projectId;
        this.title = title;
        this.amount = amount;
        this.currency = currency;
        this.sortOrder = sortOrder;
        this.shippingType = ShippingType.NONE;
    }

    /**
     * A new tier: a title, a price, and a place in the list.
     *
     * <p>Those three and nothing else are required. A price is required where the
     * campaign's goal is not, because a tier with no price is not something a
     * backer can select — an unpriced draft tier would have to be excluded from
     * every list and every total, which is a state worth not having.
     *
     * <p>{@link ShippingType#NONE} is the default rather than
     * {@link ShippingType#DOMESTIC}: a creator who has not said how a reward is
     * delivered has not promised to ship it anywhere, and defaulting to shipping
     * would ask a backer for an address the creator never intended to use.
     */
    public static RewardTier of(UUID projectId, String title, BigDecimal amount, String currency, int sortOrder) {
        return new RewardTier(Identifiers.newIdentifier(), projectId, title, amount, currency, sortOrder);
    }

    /**
     * A copy of this tier, ready to be edited into a different one.
     *
     * <p>Everything the creator wrote, and none of what backers did: the
     * identifier is new, the counts are the database's zeroes because they are not
     * insertable, the version starts again, and a secret tier gets a
     * <strong>new</strong> token. Copying the token would give two tiers one
     * private link, so revoking one would revoke the other and a link already
     * distributed would start resolving to a tier nobody meant to share.
     *
     * <p>The title is copied verbatim rather than suffixed. A creator duplicates a
     * tier in order to change it, and renaming is the first thing they do; a
     * "(copy)" they have to delete is an edit the platform imposed, and it can
     * push the title past its sixty-character limit.
     *
     * <p><strong>The image and the video are not copied.</strong> Replacing or removing a
     * tier's media deletes the upload once nothing refers to it, so a shared row would
     * work, but the copy is made to be changed, and a creator who replaces the copy's
     * picture expects a picture of their own rather than the original's.
     */
    public RewardTier duplicateAt(int sortOrder) {
        RewardTier copy = new RewardTier(Identifiers.newIdentifier(), projectId, title, amount, currency, sortOrder);
        copy.description = description;
        copy.estimatedDelivery = estimatedDelivery;
        copy.limitQuantity = limitQuantity;
        copy.shippingType = shippingType;
        copy.earlyBird = earlyBird;
        copy.featured = featured;
        copy.addon = addon;
        copy.availableFrom = availableFrom;
        copy.availableUntil = availableUntil;
        if (secret) {
            copy.makeSecret();
        }
        return copy;
    }

    /**
     * How many places are already committed: claimed plus reserved.
     *
     * <p>The floor a limit may be lowered to. §5.3 permits increasing a quantity
     * freely and decreasing it only above what is already taken, and reserved
     * places are as taken as claimed ones — a checkout in progress is somebody
     * entering their card details.
     */
    public int committedQuantity() {
        return claimedQuantity + reservedQuantity;
    }

    /** Whether anybody has claimed a place. §5.3 forbids deleting a tier once they have. */
    public boolean hasBackers() {
        return claimedQuantity > 0;
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    /**
     * The price, which is an amount and the currency it is in at once.
     *
     * <p>One method rather than two, for the reason {@code ProjectEditingService}
     * gives about the goal: a currency changed without the amount reprices the
     * reward.
     */
    public void setPrice(BigDecimal amount, String currency) {
        this.amount = Objects.requireNonNull(amount, "A reward has a price");
        this.currency = Objects.requireNonNull(currency, "A price has a currency");
    }

    public LocalDate getEstimatedDelivery() {
        return estimatedDelivery;
    }

    public void setEstimatedDelivery(LocalDate estimatedDelivery) {
        this.estimatedDelivery = estimatedDelivery;
    }

    public Integer getLimitQuantity() {
        return limitQuantity;
    }

    /**
     * @throws IllegalArgumentException when the new limit is below what is already
     *     committed. The database refuses the same row; this is the entity holding
     *     its own invariant, so that a caller which skipped the service's
     *     validation still cannot oversell the tier
     */
    public void setLimitQuantity(Integer limitQuantity) {
        if (limitQuantity != null && limitQuantity < committedQuantity()) {
            throw new IllegalArgumentException(
                    "A limit cannot be lowered below the " + committedQuantity() + " places already taken");
        }
        this.limitQuantity = limitQuantity;
    }

    public int getClaimedQuantity() {
        return claimedQuantity;
    }

    public int getReservedQuantity() {
        return reservedQuantity;
    }

    /** How many places are left, or null when the tier is unlimited. */
    public Integer getRemainingQuantity() {
        return limitQuantity == null ? null : limitQuantity - committedQuantity();
    }

    public ShippingType getShippingType() {
        return shippingType;
    }

    public void setShippingType(ShippingType shippingType) {
        this.shippingType = Objects.requireNonNull(shippingType, "A tier is delivered somehow, even if that is NONE");
    }

    public boolean isEarlyBird() {
        return earlyBird;
    }

    public void setEarlyBird(boolean earlyBird) {
        this.earlyBird = earlyBird;
    }

    public boolean isFeatured() {
        return featured;
    }

    public void setFeatured(boolean featured) {
        this.featured = featured;
    }

    public boolean isSecret() {
        return secret;
    }

    public String getSecretToken() {
        return secretToken;
    }

    /**
     * Hides the tier from the public list and mints the link that reaches it.
     *
     * <p>The flag and the token move together because the database requires it:
     * a secret tier without a token is one nobody can select, and a token on a
     * public tier is a link the creator believes is private and is not.
     *
     * <p>Calling this on a tier that is already secret is deliberately a no-op
     * rather than a rotation. An autosave that sent {@code isSecret: true} twice
     * would otherwise invalidate a link the creator had already sent out.
     */
    public void makeSecret() {
        if (!secret) {
            this.secret = true;
            this.secretToken = SecretTokens.generate();
        }
    }

    /** Puts the tier back in the public list and destroys its link. */
    public void makePublic() {
        this.secret = false;
        this.secretToken = null;
    }

    public boolean isAddon() {
        return addon;
    }

    public void setAddon(boolean addon) {
        this.addon = addon;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Instant getAvailableFrom() {
        return availableFrom;
    }

    public Instant getAvailableUntil() {
        return availableUntil;
    }

    /**
     * The window the tier can be selected in, both ends at once.
     *
     * <p>Together because the database refuses a window that closes before it
     * opens, and two setters would let a caller pass through that state in
     * whichever order the patch happened to list the fields.
     */
    public void available(Instant from, Instant until) {
        if (from != null && until != null && !until.isAfter(from)) {
            throw new IllegalArgumentException("An availability window has to close after it opens");
        }
        this.availableFrom = from;
        this.availableUntil = until;
    }

    public UUID getImageMediaId() {
        return imageMediaId;
    }

    public void setImageMediaId(UUID imageMediaId) {
        this.imageMediaId = imageMediaId;
    }

    public UUID getVideoMediaId() {
        return videoMediaId;
    }

    public void setVideoMediaId(UUID videoMediaId) {
        this.videoMediaId = videoMediaId;
    }

    public long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        return other instanceof RewardTier tier && Objects.equals(id, tier.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        // No title and no token: one is confidential before launch and the other
        // is a link that must not appear in a log.
        return "RewardTier[id=" + id + ", project=" + projectId + "]";
    }
}
