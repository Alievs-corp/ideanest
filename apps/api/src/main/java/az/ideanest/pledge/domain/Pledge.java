package az.ideanest.pledge.domain;

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
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

/**
 * What a backer commits to — and, while it is a {@link PledgeState#DRAFT}, the
 * reservation that holds a limited reward's place for them.
 *
 * <p><strong>A draft is the reservation.</strong> §6.2 gives the state machine
 * {@code [*] -> DRAFT} and {@code DRAFT -> EXPIRED: reservation TTL}, so there is
 * no separate reservation record to keep in step with this one: the row that says
 * what the backer is buying is the row that holds the stock, and
 * {@link #getReservationExpiresAt()} is when it stops. V17 has the argument for
 * why that lives in PostgreSQL rather than in a Redis key, which is what §4.5's
 * capability table says.
 *
 * <p><strong>{@link Version}, not a row lock.</strong> Two writers to one pledge
 * are ordinary — the sweep expiring a draft while its owner confirms it, a backer
 * editing in one tab and confirming in another — and the loser has something
 * useful to do about it, which is to re-read and tell the backer their
 * reservation lapsed. A pessimistic lock would instead hold a row across a
 * checkout that is waiting on a human being and a payment provider.
 *
 * <p>What this version does <em>not</em> do is keep the stock count correct. That
 * is a conditional {@code UPDATE} on {@code reward_tiers} and V7's
 * {@code reward_tiers_stock_is_within_the_limit} — a version on this row cannot
 * say anything about a place on another one.
 *
 * <p><strong>The total is the database's.</strong> {@code total_amount} is a
 * generated column, mapped read-only, so it cannot disagree with the parts it is
 * made of. Every amount is {@link BigDecimal} against {@code numeric(14,2)}: this
 * is the number a card is charged.
 *
 * <p><strong>What is deliberately absent</strong> is every transition except the
 * ones that are built. #51 owns nothing to {@link PledgeState#DRAFT} and
 * {@code DRAFT} to {@link PledgeState#EXPIRED}; #39 adds {@link #paid}, which is
 * IDN-EXT-01's {@code DRAFT --> COLLECTED}; #56 adds {@link #edit}, which moves no state
 * at all, and {@link #cancelByBacker}, which is {@code CANCELED_BY_BACKER}; #103 adds
 * {@link #cancelByProject}, which is what a halted campaign does to every pledge on
 * it; #76 adds {@link #upgradeTo}, which moves no state at all; #40 and #175 add
 * {@link #refunded} and {@link #chargedBack}.
 *
 * <p><strong>The stored-card model's edges and states are gone</strong> (#45, #470): V107
 * ended every pledge still in them as {@code EXPIRED}. Setters that let any caller move the
 * state would be a state machine with no rules in it.
 */
@Entity
@Table(name = "pledges")
public class Pledge {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "backer_id", nullable = false, updatable = false)
    private UUID backerId;

    /** Null is a pledge without a reward — §4.5's PL-02, support only. */
    @Column(name = "reward_tier_id")
    private UUID rewardTierId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private PledgeState state;

    /** The reward tier's price, as it stood when the draft was made. */
    @Column(name = "base_amount", nullable = false)
    private BigDecimal baseAmount;

    @Column(name = "addons_amount", nullable = false)
    private BigDecimal addonsAmount;

    /** §4.5's PL-03: support above the tier's price, at the backer's choice. */
    @Column(name = "bonus_amount", nullable = false)
    private BigDecimal bonusAmount;

    @Column(name = "shipping_amount", nullable = false)
    private BigDecimal shippingAmount;

    @Column(name = "tax_amount", nullable = false)
    private BigDecimal taxAmount;

    /**
     * The sum of the five above, computed by PostgreSQL.
     *
     * <p>Read-only in every direction — not insertable, not updatable, and read
     * back after both. A generated column that the application also wrote would be
     * two answers to one question, and the one on the backer's receipt would be
     * whichever the last statement happened to leave.
     */
    @Generated(event = {EventType.INSERT, EventType.UPDATE})
    @Column(name = "total_amount", nullable = false, insertable = false, updatable = false)
    private BigDecimal totalAmount;

    @Column(name = "currency", nullable = false)
    private String currency;

    /**
     * §21.2's rate retention (#327): what this pledge was approximated in, if anything.
     *
     * <p>Null for a backer who was shown the campaign's own currency, which is most of them
     * and is the honest record — there was no approximation to keep. V60's
     * {@code pledges_display_currency_differs} refuses the case where it would equal
     * {@link #currency}, because recording a rate of 1 would be recording a conversion that
     * did not happen.
     */
    @Column(name = "display_currency")
    private String displayCurrency;

    /**
     * Units of {@link #currency} per ONE unit of {@link #displayCurrency}, as of confirmation.
     *
     * <p><strong>The rate and never the converted amount.</strong> The amount is a product of
     * {@link #totalAmount} and this, and storing both would be storing a figure that can
     * disagree with its own inputs — which is the failure the generated column above exists
     * to prevent and which no constraint could catch here.
     *
     * <p>Not rounded like money and deliberately not a {@code Money}: it is a ratio at ten
     * decimal places, and {@code MoneyRounding} would take it to two and put a thirteen per
     * cent error into the lira.
     */
    @Column(name = "display_rate")
    private BigDecimal displayRate;

    @Column(name = "shipping_country")
    private String shippingCountry;

    @Column(name = "is_anonymous", nullable = false)
    private boolean anonymous;

    @Column(name = "referrer_code")
    private String referrerCode;

    /**
     * §10.3's {@code Idempotency-Key}: which request made this pledge.
     *
     * <p>The guarantee itself lives in {@code shared.idempotency}, which records the
     * response as well as the key and covers the three mutations that create no row
     * to find. This column is the second line under it: V17's partial unique index
     * means that even a failure of that machinery cannot produce two pledges from
     * one key.
     */
    @Column(name = "idempotency_key")
    private String idempotencyKey;

    /**
     * When this draft stops holding its place.
     *
     * <p>Always set on a draft — {@code pledges_drafts_are_time_bounded} refuses
     * one without it, because a reservation with no end is a place held for ever
     * on the one kind of tier where that matters.
     */
    @Column(name = "reservation_expires_at")
    private Instant reservationExpiresAt;

    @Column(name = "confirmed_at")
    private Instant confirmedAt;

    @Column(name = "collected_at")
    private Instant collectedAt;

    /** Also when a lapsed reservation was released; see V17. */
    @Column(name = "canceled_at")
    private Instant canceledAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Generated(event = {EventType.INSERT, EventType.UPDATE})
    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected Pledge() {
        // JPA.
    }

    /**
     * A new draft: the reservation, priced at the tier it holds.
     *
     * <p>The expiry is passed in rather than computed here. The TTL is
     * configuration (§4.5 puts it at five minutes) and the instant comes from the
     * injected {@code Clock}; an entity that read {@code Instant.now()} would make
     * the rule untestable without waiting five minutes for it.
     *
     * <p>Only the base amount is taken. Add-ons, shipping, and tax are the rest of
     * checkout (#52 and #54) and are zero here rather than null, so the generated
     * total is a number from the moment the row exists.
     *
     * @param rewardTierId null for a pledge without a reward, which reserves
     *     nothing because there is nothing limited to hold
     */
    public static Pledge draft(
            UUID projectId,
            UUID backerId,
            UUID rewardTierId,
            BigDecimal baseAmount,
            String currency,
            Instant reservationExpiresAt) {
        Pledge pledge = new Pledge();
        pledge.id = Identifiers.newIdentifier();
        pledge.projectId = Objects.requireNonNull(projectId, "A pledge backs a campaign");
        pledge.backerId = Objects.requireNonNull(backerId, "A pledge is made by somebody");
        pledge.rewardTierId = rewardTierId;
        pledge.state = PledgeState.DRAFT;
        pledge.baseAmount = Objects.requireNonNull(baseAmount, "A pledge has an amount");
        pledge.addonsAmount = BigDecimal.ZERO;
        pledge.bonusAmount = BigDecimal.ZERO;
        pledge.shippingAmount = BigDecimal.ZERO;
        pledge.taxAmount = BigDecimal.ZERO;
        pledge.currency = Objects.requireNonNull(currency, "An amount has a currency");
        pledge.reservationExpiresAt =
                Objects.requireNonNull(reservationExpiresAt, "A reservation is time bounded");
        return pledge;
    }

    /**
     * A new draft priced from a whole checkout: the reward, the add-ons, the bonus,
     * the shipping, and the tax.
     *
     * <p>The counterpart of {@link #draft(UUID, UUID, UUID, BigDecimal, String,
     * Instant)} above, which prices only the tier because #51 had no checkout to
     * quote from. Both write a DRAFT holding a place for the same window; the
     * difference is how much of §4.5's PL-01 to PL-06 has been decided by the time
     * the row is written.
     *
     * <p>The total is not passed and could not be: {@code total_amount} is a
     * generated column, so PostgreSQL adds the five up and the entity reads the
     * answer back. {@link PledgeQuote} has already checked the same sum, which is
     * what makes the two definitions unable to disagree.
     */
    public static Pledge draft(NewPledge draft) {
        PledgeQuote quote = draft.quote();

        Pledge pledge = new Pledge();
        pledge.id = Identifiers.newIdentifier();
        pledge.projectId = draft.projectId();
        pledge.backerId = draft.backerId();
        pledge.rewardTierId = draft.rewardTierId();
        pledge.state = PledgeState.DRAFT;
        pledge.baseAmount = quote.baseAmount();
        pledge.addonsAmount = quote.addonsAmount();
        pledge.bonusAmount = quote.bonusAmount();
        pledge.shippingAmount = quote.shippingAmount();
        pledge.taxAmount = quote.taxAmount();
        pledge.currency = quote.currency();
        pledge.shippingCountry = draft.shippingCountry();
        pledge.anonymous = draft.anonymous();
        pledge.referrerCode = draft.referrerCode();
        pledge.idempotencyKey = draft.idempotencyKey();
        pledge.reservationExpiresAt = draft.reservationExpiresAt();
        return pledge;
    }

    /**
     * IDN-EXT-01 (#39): keep a draft's places while the backer is on the provider's payment page.
     *
     * <p>Only ever later. The reservation is what stops §8.4's sweep giving the places back, and a
     * backer typing a card number must not lose the reward they chose to a five-minute timer set
     * before they reached the card form. A second attempt that asks for less time does not shorten
     * the first one's hold.
     */
    public void holdForPayment(Instant until) {
        if (state != PledgeState.DRAFT) {
            throw new IllegalStateException("A pledge in " + state + " holds nothing to keep");
        }
        Objects.requireNonNull(until, "A hold ends at some point");
        if (reservationExpiresAt == null || until.isAfter(reservationExpiresAt)) {
            this.reservationExpiresAt = until;
        }
    }

    /**
     * §6.2's {@code COLLECTED → REFUNDED} (IDN-EXT-01, #40): the backer's money went back in full.
     */
    public void refunded() {
        if (state != PledgeState.COLLECTED) {
            throw new IllegalStateException("A pledge in " + state + " has nothing collected to refund");
        }
        this.state = PledgeState.REFUNDED;
    }

    /**
     * §6.2's {@code COLLECTED → CHARGEBACK} (#175): the card network took the backer's money back, and
     * nothing of it is left with the platform.
     */
    public void chargedBack() {
        if (state != PledgeState.COLLECTED) {
            throw new IllegalStateException("A pledge in " + state + " has nothing collected to charge back");
        }
        this.state = PledgeState.CHARGEBACK;
    }

    /**
     * §6.2's {@code DRAFT → COLLECTED}, as IDN-EXT-01 draws it (#39): the provider says the backer
     * paid.
     *
     * <p>One instant for both columns, because under the charge-now model they are one event: the
     * pledge is confirmed by being paid for.
     */
    public void paid(Instant at) {
        if (state != PledgeState.DRAFT) {
            throw new IllegalStateException("A pledge in " + state + " cannot be paid for");
        }
        Objects.requireNonNull(at, "A payment happened at a time");
        this.state = PledgeState.COLLECTED;
        this.confirmedAt = at;
        this.collectedAt = at;
    }

    /**
     * §4.5's PL-09: a new selection, re-quoted, on a pledge that keeps its state.
     *
     * <p><strong>The state does not move and must not.</strong> A draft that is
     * edited is still a draft and a confirmed pledge that is edited is still
     * confirmed — an edit changes what the backer is buying, not whether they have
     * committed to buying it. Sending a confirmed pledge back to {@code DRAFT} to
     * re-price it would put a committed backer behind a five-minute timer and hand
     * their place to §8.4's sweep.
     *
     * <p><strong>{@code reservationExpiresAt} is deliberately left alone.</strong>
     * The five minutes bound how long one backer may hold a limited tier's place out
     * of the market, and §4.5's PL-13 measures them from when the draft was
     * <em>made</em>. Restarting the clock on every edit would let one backer hold the
     * last early-bird place indefinitely by changing their mind every four minutes —
     * and it would look like an ordinary checkout, not like abuse. The cost is real
     * and is the right way round: a backer who spends their window deciding gets
     * what is left of it, and if it runs out the sweep releases the place and they
     * start again, which is the outcome the window exists to produce. Clearing it
     * is not even representable — {@code pledges_drafts_are_time_bounded} refuses a
     * draft without one.
     *
     * <p>The total is not passed and could not be: {@code total_amount} is generated,
     * so PostgreSQL adds the five up and this reads the answer back.
     *
     * @param rewardTierId the tier after the edit, or null for a pledge that has
     *     given up its reward and is now support only
     * @throws IllegalStateException when this pledge is in a state no backer may
     *     change. The service refuses first, with something a client can act on;
     *     this is the entity holding its own invariant against a caller that did not
     *     ask
     */
    public void edit(
            PledgeQuote quote,
            UUID rewardTierId,
            String shippingCountry,
            boolean anonymous) {

        if (!state.isEditable()) {
            throw new IllegalStateException("A pledge in " + state + " cannot be edited");
        }
        Objects.requireNonNull(quote, "An edited pledge is re-quoted");

        this.rewardTierId = rewardTierId;
        this.baseAmount = quote.baseAmount();
        this.addonsAmount = quote.addonsAmount();
        this.bonusAmount = quote.bonusAmount();
        this.shippingAmount = quote.shippingAmount();
        this.taxAmount = quote.taxAmount();
        this.currency = quote.currency();
        this.shippingCountry = shippingCountry;
        this.anonymous = anonymous;
    }

    /**
     * #171: a paid pledge, raised while its campaign takes pledges, once the difference was paid.
     *
     * <p>{@link #edit} for a {@code COLLECTED} pledge, and deliberately a second method rather than a
     * wider state check on the first: an edit re-prices a pledge nobody has paid for yet, and this
     * writes a selection somebody has just paid the difference for. The state does not move — the
     * backer was paid up before and is paid up after — and the total may only go up, because the
     * money for the old total and for the difference is all that stands behind it.
     *
     * <p>The anonymity flag and the card are not touched: a raise changes what is bought, not who is
     * shown or how it was paid.
     *
     * @throws IllegalStateException when this pledge is not {@code COLLECTED}, or the quote would not
     *     raise it. {@code PledgeRaiseService} decides both first; this is the entity keeping its own
     *     invariant against a caller that did not ask
     */
    public void raise(PledgeQuote quote, UUID rewardTierId, String shippingCountry) {
        if (state != PledgeState.COLLECTED) {
            throw new IllegalStateException("A pledge in " + state + " cannot be raised");
        }
        Objects.requireNonNull(quote, "A raised pledge is re-quoted");
        if (quote.totalAmount().compareTo(totalAmount) <= 0) {
            throw new IllegalStateException("A raise of a pledge of " + totalAmount + " to " + quote.totalAmount()
                    + " is not a raise");
        }
        if (!quote.currency().equals(currency)) {
            throw new IllegalStateException("A pledge in " + currency + " cannot be raised in " + quote.currency());
        }

        this.rewardTierId = rewardTierId;
        this.baseAmount = quote.baseAmount();
        this.addonsAmount = quote.addonsAmount();
        this.bonusAmount = quote.bonusAmount();
        this.shippingAmount = quote.shippingAmount();
        this.taxAmount = quote.taxAmount();
        this.shippingCountry = shippingCountry;
    }

    /**
     * {@code DRAFT --> CANCELED_BY_BACKER}. §4.5's PL-10.
     *
     * <p><strong>Nothing is refunded, because nothing was collected.</strong> §9.7 is
     * explicit for this row — "backer changes their mind while live: cancel, nothing
     * was collected" — and §9.2 puts the only collection at the close of a successful
     * campaign. A pledge cancelled while the campaign runs has never been charged, so
     * there is no transaction to reverse and no ledger entry to write. Cancelling
     * something that <em>has</em> been collected is a refund and is #67's.
     *
     * <p><strong>A draft may be cancelled too, and §6.2 did not draw that
     * edge.</strong> It draws {@code DRAFT --> EXPIRED: reservation TTL}, which is
     * what happens when nobody does anything. A backer who abandons a checkout
     * deliberately is a different fact, and recording it as {@code EXPIRED} would say
     * a timer ran out when somebody made a decision — the two are told apart on every
     * screen that reports why a place came back. {@code docs/architecture.md} §6.2 is
     * amended in the same change rather than left describing a machine that is no
     * longer the machine.
     *
     * <p>{@code canceled_at} is the timestamp V17 already set aside for "the pledge
     * stopped being active", which the sweep writes for an expiry and this writes for
     * a cancellation. The state column is what tells them apart.
     *
     * @throws IllegalStateException when this pledge is in a state no backer may
     *     withdraw. The service refuses first; this is the entity holding its own
     *     invariant
     */
    public void cancelByBacker(Instant at) {
        if (!state.isEditable()) {
            throw new IllegalStateException("A pledge in " + state + " cannot be canceled by its backer");
        }
        this.state = PledgeState.CANCELED_BY_BACKER;
        this.canceledAt = Objects.requireNonNull(at, "A cancellation happened at a time");
    }

    /**
     * §4.8's PM-09 (#76): the pledge is now for a better reward tier.
     *
     * <p><strong>The tier moves and none of the amounts do.</strong> That is the whole
     * difference between this and {@link #edit}, and V39 argues it: §5.1 judged the
     * campaign by comparing what it raised against its goal at its deadline, and V29
     * froze that comparison — so rewriting {@code base_amount} months later would change
     * a number the platform has already reported. What the backer owes for the upgrade
     * is a {@link PledgeSupplement}, charged separately.
     *
     * <p>The consequence is stated rather than discovered: after an upgrade the pledge's
     * {@code base_amount} is no longer the price of the tier named beside it. The tier
     * is what will be shipped; the amount is what the campaign raised; and the
     * difference between them is the supplement.
     *
     * <p>No state moves. An upgrade is not a transition on §6.2 — the backer was
     * committed before it and is committed after it — and the places are moved by
     * {@code ReservationService}, which owns every statement that touches stock.
     *
     * @throws IllegalStateException when this pledge is in a state that cannot buy
     *     anything more. The service refuses first, with something a client can act on;
     *     this is the entity holding its own invariant against a caller that did not ask
     */
    public void upgradeTo(UUID rewardTierId) {
        if (state != PledgeState.COLLECTED) {
            throw new IllegalStateException("A pledge in " + state + " cannot be upgraded");
        }
        this.rewardTierId = Objects.requireNonNull(rewardTierId, "An upgrade is to some tier");
    }

    /**
     * {@code DRAFT --> CANCELED_BY_PROJECT} — #103.
     *
     * <p>What happens to every pledge on a campaign the creator cancelled or trust and
     * safety suspended. The backer did nothing; the campaign stopped, and the state
     * column is the only place that difference survives — "I changed my mind" and "the
     * campaign was taken down" are the same absence of a pledge and completely different
     * things to be told.
     *
     * <p><strong>Nothing is refunded, because nothing was collected.</strong> §9.2 puts
     * the only collection at the close of a successful campaign, and a campaign that was
     * stopped never reached one. Reversing a pledge that really was collected is
     * {@code COLLECTED --> REFUNDED}, which is #67's;
     * {@code PledgeCancellationService} refuses to take this edge from those states for
     * exactly that reason.
     *
     * <p><strong>A draft may be cancelled this way too, and §6.2 did not draw that
     * edge</strong> — the same amendment #56 made for {@code CANCELED_BY_BACKER}, for the
     * same reason: a checkout in progress on a campaign that has just been suspended is
     * not going to be finished, and leaving it to expire would hold a limited tier's
     * place for another five minutes on a campaign nobody can back.
     * {@code docs/architecture.md} §6.2 is amended in the same change.
     *
     * @throws IllegalStateException when this pledge is in a state a halt does not end.
     *     The service decides first, and skips rather than refusing; this is the entity
     *     holding its own invariant against a caller that did not ask
     */
    public void cancelByProject(Instant at) {
        if (state != PledgeState.DRAFT) {
            throw new IllegalStateException("A pledge in " + state + " cannot be canceled by its campaign");
        }
        this.state = PledgeState.CANCELED_BY_PROJECT;
        this.canceledAt = Objects.requireNonNull(at, "A cancellation happened at a time");
    }

    /** Whether this pledge is still holding a place. */
    public boolean isDraft() {
        return state == PledgeState.DRAFT;
    }

    /** Whether this backer has already withdrawn this pledge. See {@code PledgeService#cancel}. */
    public boolean isCanceledByBacker() {
        return state == PledgeState.CANCELED_BY_BACKER;
    }

    /** Whether this is a draft whose reservation has run out as of {@code now}. */
    public boolean hasLapsed(Instant now) {
        return isDraft() && reservationExpiresAt != null && !reservationExpiresAt.isAfter(now);
    }

    /** Whether it stands between its backer and a second pledge on the same campaign. */
    public boolean isActive() {
        return state.isActive();
    }

    /** Whether this draft is holding a place on a limited tier, rather than backing without a reward. */
    public boolean holdsAPlace() {
        return rewardTierId != null;
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public UUID getBackerId() {
        return backerId;
    }

    public UUID getRewardTierId() {
        return rewardTierId;
    }

    public PledgeState getState() {
        return state;
    }

    public BigDecimal getBaseAmount() {
        return baseAmount;
    }

    public BigDecimal getAddonsAmount() {
        return addonsAmount;
    }

    public BigDecimal getBonusAmount() {
        return bonusAmount;
    }

    public BigDecimal getShippingAmount() {
        return shippingAmount;
    }

    public BigDecimal getTaxAmount() {
        return taxAmount;
    }

    /** What the backer will be charged. Maintained by the database from the five parts. */
    public BigDecimal getTotalAmount() {
        return totalAmount;
    }

    public String getCurrency() {
        return currency;
    }

    /** §21.2 (#327): the currency this pledge was approximated in, or null. */
    public String getDisplayCurrency() {
        return displayCurrency;
    }

    /** §21.2 (#327): units of {@link #getCurrency()} per one unit of the display currency. */
    public BigDecimal getDisplayRate() {
        return displayRate;
    }

    /**
     * Records the approximation this backer was shown — §21.2's rate retention (#327).
     *
     * <p>Written at confirmation and never again. It is a fact about a moment: "this is what
     * we told them it would cost", asked months later by somebody holding a complaint that
     * the figure moved. A later refresh of the rate must not rewrite it, which is why there
     * is no path to this method outside {@code PledgeService#confirm}.
     *
     * <p>Both halves together or neither. A currency with no rate beside it would be a claim
     * that an approximation was shown without saying what it was, and V60's
     * {@code pledges_display_rate_is_whole} refuses it — this refuses it earlier, with a
     * message naming the values.
     */
    public void recordDisplayRate(String displayCurrency, BigDecimal displayRate) {
        if ((displayCurrency == null) != (displayRate == null)) {
            throw new IllegalArgumentException(
                    "A display currency and its rate are recorded together, and this is "
                            + displayCurrency + " at " + displayRate);
        }
        if (displayCurrency != null && displayCurrency.equals(currency)) {
            // An amount is not an approximation of itself. ExchangeRates answers that case
            // with an empty Optional, so reaching here means a caller went around it.
            throw new IllegalArgumentException(
                    "A pledge in " + currency + " was not approximated in " + displayCurrency);
        }
        if (displayRate != null && displayRate.signum() <= 0) {
            throw new IllegalArgumentException("A rate is positive, and this one is " + displayRate.toPlainString());
        }
        this.displayCurrency = displayCurrency;
        this.displayRate = displayRate;
    }

    public String getShippingCountry() {
        return shippingCountry;
    }

    public boolean isAnonymous() {
        return anonymous;
    }

    public String getReferrerCode() {
        return referrerCode;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public Instant getReservationExpiresAt() {
        return reservationExpiresAt;
    }

    public Instant getConfirmedAt() {
        return confirmedAt;
    }

    public Instant getCollectedAt() {
        return collectedAt;
    }

    public Instant getCanceledAt() {
        return canceledAt;
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
        return other instanceof Pledge pledge && Objects.equals(id, pledge.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        // No amounts and no backer: a log line about a pledge should not be a
        // record of what somebody spent.
        return "Pledge[id=" + id + ", project=" + projectId + ", state=" + state + "]";
    }
}
