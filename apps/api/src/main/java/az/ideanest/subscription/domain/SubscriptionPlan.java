package az.ideanest.subscription.domain;

import az.ideanest.shared.ReaderLocale;
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
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * One thing the platform sells a creator — V62's row.
 *
 * <p><strong>Editable in place, unlike {@code FeeSchedule}, and the difference is worth
 * carrying in the reader's head.</strong> A fee schedule may not be edited because a past
 * payout was computed against it. A plan may be, because what a subscriber was charged is
 * copied onto their own {@link Subscription} at purchase — so editing this row cannot
 * reach backwards into anybody's bill.
 *
 * <p>What editing it <em>does</em> reach is the limits of everybody currently on it, which
 * are read live. V62 argues why that asymmetry is the right way round: raising a limit is
 * a gift to every subscriber, which is what an operator raising a limit means, and
 * lowering one reaches nobody retroactively because the gate refuses only new submissions.
 *
 * <p><strong>A plan is never deleted.</strong> {@link #isListed} is how one leaves the
 * catalogue. Deleting it would either orphan its subscribers or cascade them away, and
 * V62's foreign key restricts so that the sentence is enforced rather than merely
 * intended.
 *
 * <p><strong>Null limits mean no limit</strong>, in both of them. {@link
 * az.ideanest.shared.access.PublishingAllowance} has the argument against a sentinel.
 */
@Entity
@Table(name = "subscription_plans")
public class SubscriptionPlan {

    /** V62's {@code subscription_plans_code_shape}, stated once more where it is applied. */
    private static final String CODE_SHAPE = "^[A-Z][A-Z0-9_]{1,39}$";

    private static final int NAME_MAX = 120;

    private static final int DESCRIPTION_MAX = 2000;

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final TypeReference<TreeMap<String, Text>> TRANSLATIONS = new TypeReference<>() {};

    /**
     * A plan's name and description in one language other than {@link ReaderLocale#PRIMARY}.
     *
     * @param description null when the language has none, and the reader then gets the
     *     primary language's
     */
    public record Text(String name, String description) {
    }

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "code", nullable = false, updatable = false)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    /**
     * V111's column: {@link Text} by locale code, never holding the primary language, which
     * is {@link #name} and {@link #description}. Mapped as a string and read through
     * {@link #getTranslations()} so that Hibernate compares the column by value.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "translations", nullable = false)
    private String translations = "{}";

    @Convert(converter = MoneyAmountConverter.class)
    @Column(name = "price", nullable = false)
    private BigDecimal price;

    @Column(name = "currency", nullable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_period", nullable = false)
    private BillingPeriod billingPeriod;

    @Column(name = "max_active_campaigns")
    private Integer maxActiveCampaigns;

    @Convert(converter = MoneyAmountConverter.class)
    @Column(name = "goal_ceiling")
    private BigDecimal goalCeiling;

    @Column(name = "listed", nullable = false)
    private boolean listed;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Null means "shipped with the platform". V62 says why that is nullable. */
    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    protected SubscriptionPlan() {
        // Hibernate.
    }

    private SubscriptionPlan(UUID id, String code, Instant now, UUID createdBy) {
        this.id = id;
        this.code = code;
        this.createdAt = now;
        this.updatedAt = now;
        this.createdBy = createdBy;
        this.listed = true;
    }

    /**
     * A new plan, with everything the catalogue needs to offer it.
     *
     * <p>Every field at once rather than a builder or a sequence of setters, because a
     * half-written plan is one the pricing page may draw: there is no draft state here and
     * no reason for one.
     *
     * @param code upper case, unique, and immutable afterwards — it is what an operator, a
     *     log line and a support conversation agree on, and renaming it would break all
     *     three at once. The display {@link #getName()} is what changes when the marketing
     *     does
     * @param translations the name and description in the other languages; may be empty
     * @param price may be zero, which means a free tier. May not be negative
     * @param maxActiveCampaigns null for no limit
     * @param goalCeiling null for no ceiling. In {@code price}'s currency, because a plan
     *     with two currencies in it is a comparison nobody can make honestly
     * @param createdBy the member of staff who added it. Required here even though the
     *     column is nullable: null is reserved for the rows V62 seeds, and a console write
     *     that arrived with no actor is one nobody is answerable for
     */
    public static SubscriptionPlan create(
            UUID id,
            String code,
            String name,
            String description,
            Map<String, Text> translations,
            Money price,
            BillingPeriod billingPeriod,
            Integer maxActiveCampaigns,
            BigDecimal goalCeiling,
            int sortOrder,
            Instant now,
            UUID createdBy) {

        Objects.requireNonNull(id, "A plan needs an identifier");
        Objects.requireNonNull(now, "A plan is created at some instant");
        Objects.requireNonNull(createdBy, "A plan the console wrote names who wrote it");

        SubscriptionPlan plan = new SubscriptionPlan(id, requireCode(code), now, createdBy);
        plan.price(price);
        plan.rename(name, description);
        plan.translate(translations);
        plan.billingPeriod = Objects.requireNonNull(billingPeriod, "A plan bills over some period");
        plan.limits(maxActiveCampaigns, goalCeiling);
        plan.sortOrder = sortOrder;
        return plan;
    }

    /** What the pricing page calls it. */
    public void rename(String name, String description) {
        this.name = requireName(name);
        this.description = trimmedOrNull(description, DESCRIPTION_MAX);
    }

    /**
     * What the pricing page calls it in the other languages. Replaces every translation:
     * a language left out is read in the primary language from now on.
     *
     * @param translations by locale code. The primary language is refused here because it
     *     is {@link #rename}'s, and a language the platform does not have is refused because
     *     nobody could ever read it
     */
    public void translate(Map<String, Text> translations) {
        TreeMap<String, Text> checked = new TreeMap<>();
        if (translations != null) {
            translations.forEach((locale, text) -> {
                if (!ReaderLocale.supported(locale) || ReaderLocale.PRIMARY.equals(locale)) {
                    throw new IllegalArgumentException("A plan is translated into en, ru or tr, not " + locale);
                }
                if (text == null) {
                    return;
                }
                checked.put(locale, new Text(requireName(text.name()), trimmedOrNull(text.description(), DESCRIPTION_MAX)));
            });
        }
        this.translations = JSON.writeValueAsString(checked);
    }

    /**
     * What it costs from now on.
     *
     * <p>Reaches nobody who has already bought — see the class comment. A subscriber's
     * price is on their own row and this cannot touch it.
     */
    public void price(Money price) {
        Objects.requireNonNull(price, "A plan has a price, even if it is zero");
        if (price.amount().signum() < 0) {
            throw new IllegalArgumentException("A plan cannot cost less than nothing");
        }
        this.price = price.amount();
        this.currency = price.currency();
    }

    /**
     * What it allows.
     *
     * <p>Applies to everybody on the plan immediately, which is the asymmetry V62 argues
     * for at length.
     *
     * @param maxActiveCampaigns null for no limit; otherwise at least one, because a plan
     *     permitting zero campaigns is a plan that is sold and does nothing
     * @param goalCeiling null for no ceiling; otherwise above zero
     */
    public void limits(Integer maxActiveCampaigns, BigDecimal goalCeiling) {
        if (maxActiveCampaigns != null && maxActiveCampaigns < 1) {
            throw new IllegalArgumentException("A plan that permits no campaigns is a plan nobody can use");
        }
        if (goalCeiling != null && goalCeiling.signum() <= 0) {
            throw new IllegalArgumentException("A goal ceiling is above zero, or it is absent");
        }
        this.maxActiveCampaigns = maxActiveCampaigns;
        this.goalCeiling = goalCeiling;
    }

    /** Whether the pricing page offers it. Unlisting leaves every subscriber where they are. */
    public void list(boolean listed) {
        this.listed = listed;
    }

    public void sortAt(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    /** Stamped by {@code SubscriptionPlans} after any of the above, in the same transaction. */
    public void touch(Instant now) {
        this.updatedAt = Objects.requireNonNull(now, "An edit happens at some instant");
    }

    /** When a period bought now would end. */
    public Instant periodEndFrom(Instant start) {
        return billingPeriod.endOf(start);
    }

    /**
     * Whether buying this needs a payment recorded against it.
     *
     * <p>False for a free plan, which activates on the spot: a queue entry for a
     * subscription that costs nothing is work a member of staff does for no reason.
     */
    public boolean requiresPayment() {
        return price.signum() > 0;
    }

    public UUID getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    /** Every translation, by locale code. Empty when the plan is in the primary language only. */
    public Map<String, Text> getTranslations() {
        if (translations == null || translations.isBlank()) {
            return Map.of();
        }
        return JSON.readValue(translations, TRANSLATIONS);
    }

    /** The name a reader of {@code locale} sees: theirs when the plan has it, the primary one otherwise. */
    public String nameIn(String locale) {
        Text text = getTranslations().get(locale);
        return text == null ? name : text.name();
    }

    /** The description a reader of {@code locale} sees, falling back the way {@link #nameIn} does. */
    public String descriptionIn(String locale) {
        Text text = getTranslations().get(locale);
        return text == null || text.description() == null ? description : text.description();
    }

    /** The price, assembled at the entity's edge — {@code MoneyAmountConverter} says why. */
    public Money getPrice() {
        return Money.of(price, currency);
    }

    public BillingPeriod getBillingPeriod() {
        return billingPeriod;
    }

    public Integer getMaxActiveCampaigns() {
        return maxActiveCampaigns;
    }

    public BigDecimal getGoalCeiling() {
        return goalCeiling;
    }

    /** The ceiling as money, or null when there is no ceiling. */
    public Money getGoalCeilingMoney() {
        return Money.orNull(goalCeiling, currency);
    }

    public boolean isListed() {
        return listed;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    private static String requireCode(String code) {
        String normalised = code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
        if (!normalised.matches(CODE_SHAPE)) {
            // Upper-cased rather than refused for its case, so that an operator typing
            // "growth" gets the plan they meant instead of a validation error about
            // something they do not think of as part of the name. Everything else about
            // the shape is refused, because a code with a space in it is one that will be
            // spelled two ways.
            throw new IllegalArgumentException(
                    "A plan code is 2 to 40 characters of A-Z, 0-9 and underscore, starting with a letter");
        }
        return normalised;
    }

    private static String requireName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty() || trimmed.length() > NAME_MAX) {
            throw new IllegalArgumentException("A plan needs a name of 1 to " + NAME_MAX + " characters");
        }
        return trimmed;
    }

    private static String trimmedOrNull(String value, int max) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.length() > max) {
            throw new IllegalArgumentException("That text is longer than " + max + " characters");
        }
        return trimmed;
    }
}
