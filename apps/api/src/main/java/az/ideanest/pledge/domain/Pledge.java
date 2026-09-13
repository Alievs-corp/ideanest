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
 * {@code DRAFT} to {@link PledgeState#EXPIRED}; #52 adds {@link #confirm}, which is
 * §6.2's {@code DRAFT --> CONFIRMED}; #56 adds {@link #edit}, which moves no state at
 * all, and {@link #cancelByBacker}, which is {@code CANCELED_BY_BACKER}; #103 adds
 * {@link #cancelByProject}, which is what a halted campaign does to every pledge on
 * it; #76 adds {@link #upgradeTo}, which moves no state at all.
 *
 * <p><strong>#64 and #65 add the collection edges</strong> —
 * {@link #queueForCollection}, {@link #collected}, {@link #chargeFailed} and
 * {@link #dropped}, which are §6.2's {@code CONFIRMED → CHARGE_PENDING → COLLECTED},
 * the {@code CHARGE_FAILED} loop between them, and the {@code DROPPED} that ends it.
 * {@link #chargeUnresolved} is not on that diagram and moves no state: it is a
 * provider that has taken the instruction and not answered, which §9.6 has no row for
 * because §9.6 is about cards that were refused.
 *
 * <p>The refund of an already-collected pledge (#67) and the chargeback (#68) are
 * still absent, and setters that let any caller move the state would be a state
 * machine with no rules in it.
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

    /** No reference yet: {@code payment_methods} is #55, blocked on #60. See V17. */
    @Column(name = "payment_method_id")
    private UUID paymentMethodId;

    @Column(name = "shipping_country")
    private String shippingCountry;

    @Column(name = "is_anonymous", nullable = false)
    private boolean anonymous;

    @Column(name = "is_late_pledge", nullable = false)
    private boolean latePledge;

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

    /**
     * §9.6: how many collection attempts have been made, counted from zero.
     *
     * <p>A counter and not a log. What each attempt <em>was</em> — its decline code, its
     * provider identifier, the moment it happened — is a {@code transactions} row, which
     * V41 made append-only precisely so that this column can be a number nobody has to
     * trust as evidence. What it is used for is the schedule: §9.6 gives the fourth
     * attempt a different notification from the second, and the window a bound.
     *
     * <p>Advanced only when the platform learns something. A provider that could not be
     * reached does not cost a backer one of their four attempts — see
     * {@code CollectionRun}.
     */
    @Column(name = "charge_attempts", nullable = false)
    private int chargeAttempts;

    /** §9.6: when the next attempt may be made. Null unless this pledge is queued. */
    @Column(name = "next_charge_attempt_at")
    private Instant nextChargeAttemptAt;

    /**
     * §9.6's seven days: when the platform stops trying and the pledge is dropped.
     *
     * <p>Frozen when the pledge is queued rather than computed from the campaign's
     * deadline on every read, so that shortening the configured window does not
     * retroactively drop pledges that were inside it when their backer was last told
     * about them. V42 has the argument.
     */
    @Column(name = "charge_window_ends_at")
    private Instant chargeWindowEndsAt;

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
        // §4.5's PL-16 (#81). Decided when the campaign was asked whether it takes
        // pledges at all, and stamped here rather than later: the campaign's window can
        // close between this draft and its confirmation, and a pledge that changed
        // which total it counted towards while the backer was typing their address
        // would be one nobody could explain.
        pledge.latePledge = draft.latePledge();
        return pledge;
    }

    /**
     * §6.2's {@code DRAFT --> CONFIRMED}: the backer is committed.
     *
     * <p><strong>Nothing has been charged.</strong> §9.2 is explicit that no money
     * moves at confirmation and that no ledger entry is written — the card is
     * verified and the verification is voided, and the charge happens at the close of
     * a successful campaign. Today not even the verification happens: it needs a
     * payment provider, which is #55 and is blocked on #60.
     *
     * <p>The reservation's expiry is deliberately left where it is rather than
     * cleared. V17 gives the argument: it is a true statement about the window the
     * backer actually had, and requiring every transition to clear it would be one
     * more thing each of them has to remember for no reader's benefit. What
     * {@code reservationExpiresAt} means to a client is handled where the response is
     * built, which is the only place that knows a confirmed pledge holds no
     * reservation.
     *
     * @param paymentMethodId what the backer said to charge later, or null until #55
     *     exists to give them one. No foreign key — see V17
     * @throws IllegalStateException when this pledge is not a draft. The service
     *     refuses first, with something a client can act on; this is the entity
     *     holding its own invariant against a caller that did not ask
     */
    public void confirm(Instant at, UUID paymentMethodId) {
        if (state != PledgeState.DRAFT) {
            throw new IllegalStateException("A pledge in " + state + " cannot be confirmed");
        }
        this.state = PledgeState.CONFIRMED;
        this.confirmedAt = Objects.requireNonNull(at, "A confirmation happened at a time");
        this.paymentMethodId = paymentMethodId;
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
     * §6.2's {@code DRAFT → COLLECTED}, as IDN-EXT-01 draws it (#39): the provider says the backer
     * paid.
     *
     * <p>One instant for both columns, because under the charge-now model they are one event: the
     * pledge is confirmed by being paid for. {@code CONFIRMED} is never passed through.
     */
    /**
     * §6.2's {@code COLLECTED → REFUNDED} (IDN-EXT-01, #40): the backer's money went back in full.
     */
    public void refunded() {
        if (state != PledgeState.COLLECTED) {
            throw new IllegalStateException("A pledge in " + state + " has nothing collected to refund");
        }
        this.state = PledgeState.REFUNDED;
    }

    public void paid(Instant at) {
        if (state != PledgeState.DRAFT) {
            throw new IllegalStateException("A pledge in " + state + " cannot be paid for");
        }
        Objects.requireNonNull(at, "A payment happened at a time");
        this.state = PledgeState.COLLECTED;
        this.confirmedAt = at;
        this.collectedAt = at;
        this.chargeAttempts = chargeAttempts + 1;
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
     * @param paymentMethodId what to charge later, echoed unchanged when the backer
     *     did not name a new one. Nothing resolves it until #55
     * @throws IllegalStateException when this pledge is in a state no backer may
     *     change. The service refuses first, with something a client can act on;
     *     this is the entity holding its own invariant against a caller that did not
     *     ask
     */
    public void edit(
            PledgeQuote quote,
            UUID rewardTierId,
            String shippingCountry,
            boolean anonymous,
            UUID paymentMethodId) {

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
        this.paymentMethodId = paymentMethodId;
    }

    /**
     * §6.2's {@code CONFIRMED --> CANCELED_BY_BACKER}, and the same edge from a
     * {@code DRAFT}. §4.5's PL-10.
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
        if (state != PledgeState.CONFIRMED && state != PledgeState.CHARGE_PENDING && state != PledgeState.COLLECTED) {
            throw new IllegalStateException("A pledge in " + state + " cannot be upgraded");
        }
        this.rewardTierId = Objects.requireNonNull(rewardTierId, "An upgrade is to some tier");
    }

    /**
     * §6.2's {@code CONFIRMED --> CANCELED_BY_PROJECT}, and the same edge from a
     * {@code DRAFT} — #103.
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
        if (state != PledgeState.DRAFT && state != PledgeState.CONFIRMED) {
            throw new IllegalStateException("A pledge in " + state + " cannot be canceled by its campaign");
        }
        this.state = PledgeState.CANCELED_BY_PROJECT;
        this.canceledAt = Objects.requireNonNull(at, "A cancellation happened at a time");
    }

    /**
     * §6.2's {@code CONFIRMED → CHARGE_PENDING}: the campaign succeeded and this pledge
     * is queued for collection.
     *
     * <p><strong>The bulk path does not come through here.</strong> A campaign with four
     * thousand backers is queued by one conditional {@code UPDATE} —
     * {@code PledgeRepository#queueConfirmedPledges} — because loading four thousand
     * entities to move each one's state is four thousand round trips inside the
     * transaction that opens a campaign's collection. This exists for the single-pledge
     * case and, more usefully, so that the invariant lives on the entity where a reader
     * looks for it.
     *
     * @param firstAttemptAt when the first attempt may be made. §9.6's first row is
     *     "immediately after close", so in practice the pass's own instant
     * @param windowEndsAt §9.6's seven days. See {@link #getChargeWindowEndsAt()}
     * @throws IllegalStateException when this pledge is not confirmed. Every other state
     *     is deliberate rather than an oversight: a draft never committed, a cancelled
     *     pledge is over, and one already queued or collected must not have its attempt
     *     count reset — which is what queuing it a second time would do
     */
    public void queueForCollection(Instant firstAttemptAt, Instant windowEndsAt) {
        if (state != PledgeState.CONFIRMED) {
            throw new IllegalStateException("A pledge in " + state + " cannot be queued for collection");
        }
        Objects.requireNonNull(firstAttemptAt, "A queued pledge has a first attempt");
        Objects.requireNonNull(windowEndsAt, "§9.6 bounds the window; a pledge queued without one is never dropped");
        if (windowEndsAt.isBefore(firstAttemptAt)) {
            throw new IllegalArgumentException("A retry window that ends before it starts drops the pledge at once");
        }
        this.state = PledgeState.CHARGE_PENDING;
        this.chargeAttempts = 0;
        this.nextChargeAttemptAt = firstAttemptAt;
        this.chargeWindowEndsAt = windowEndsAt;
    }

    /**
     * §6.2's {@code CHARGE_PENDING → COLLECTED}: the card was charged.
     *
     * <p><strong>The schedule is cleared, and V42's constraint is why it must be.</strong>
     * A collected pledge that kept a {@code next_charge_attempt_at} would be picked up by
     * the next pass and charged again; the database refuses the row rather than trusting
     * this method to remember.
     *
     * @param at when the charge was approved. {@code transactions.created_at} is written
     *     in the same commit, so the two cannot disagree
     */
    public void collected(Instant at) {
        requireBeingCollected();
        this.state = PledgeState.COLLECTED;
        this.collectedAt = Objects.requireNonNull(at, "A collection happened at a time");
        this.chargeAttempts = chargeAttempts + 1;
        this.nextChargeAttemptAt = null;
        this.chargeWindowEndsAt = null;
    }

    /**
     * §6.2's {@code CHARGE_PENDING → CHARGE_FAILED}, and the self-edge back from it: the
     * provider refused, and §9.6 says when to try again.
     *
     * <p>The attempt is counted here and nowhere else, which is what makes "this backer
     * has had three of their four attempts" a number rather than an estimate.
     *
     * @param nextAttemptAt the next slot in §9.6's schedule. Never null even on the last
     *     attempt — V42 refuses a queued pledge with no schedule, and the pledge stays
     *     queued until the window elapses and {@link #dropped} ends it. A pledge that is
     *     out of attempts is one whose next slot falls past its window
     */
    public void chargeFailed(Instant nextAttemptAt) {
        requireBeingCollected();
        this.state = PledgeState.CHARGE_FAILED;
        this.chargeAttempts = chargeAttempts + 1;
        this.nextChargeAttemptAt = Objects.requireNonNull(nextAttemptAt, "A failed attempt is followed by another");
    }

    /**
     * The provider accepted the instruction and has not decided: come back to the
     * <em>same</em> attempt later.
     *
     * <p><strong>The attempt is deliberately not counted.</strong> §9.6 gives a backer
     * four chances at their card, and an answer nobody has received yet is not one of
     * them. Keeping the number where it is also keeps the idempotency key where it is —
     * see {@code CollectionRun} — so the next call asks the provider about the charge it
     * already has rather than making a second one.
     *
     * <p>The state does not move either. {@code CHARGE_FAILED} would say the card was
     * refused, which is precisely what is not known.
     */
    public void chargeUnresolved(Instant recheckAt) {
        requireBeingCollected();
        this.nextChargeAttemptAt = Objects.requireNonNull(recheckAt, "An unresolved charge is asked about again");
    }

    /**
     * §6.2's {@code CHARGE_FAILED → DROPPED}: §9.6's seven days elapsed.
     *
     * <p>The end of the line for this pledge, and the reason §9.6's rule that success is
     * "decided at the deadline and never revisited" matters: dropping a pledge reduces
     * what the creator is paid and does not reopen the question of whether the campaign
     * funded.
     *
     * <p><strong>A dropped pledge does not give its reward place back.</strong> That is
     * deliberate, and it is the decision §4.11's AD-02 already makes about a halted
     * campaign: the tier's remaining count is a fact about a campaign that has closed,
     * and crediting it would make a sold-out tier look available on a page nobody can
     * pledge from. The pledge manager (#72) is where a creator decides what to do with
     * the place.
     */
    public void dropped(Instant at) {
        requireBeingCollected();
        this.state = PledgeState.DROPPED;
        this.canceledAt = Objects.requireNonNull(at, "A pledge stopped being active at a time");
        this.nextChargeAttemptAt = null;
        this.chargeWindowEndsAt = null;
    }

    /** Whether this pledge is queued for collection or waiting on §9.6's next attempt. */
    public boolean isBeingCollected() {
        return state == PledgeState.CHARGE_PENDING || state == PledgeState.CHARGE_FAILED;
    }

    /** Whether §9.6's window has run out as of {@code now}. */
    public boolean isPastItsChargeWindow(Instant now) {
        return isBeingCollected() && chargeWindowEndsAt != null && !chargeWindowEndsAt.isAfter(now);
    }

    /**
     * The guard the four collection transitions share.
     *
     * <p>One method rather than four copies, because the set of states from which a
     * collection may move is the rule — and a copy of it that drifts is a pledge
     * collected twice or refunded from a state that never charged.
     */
    private void requireBeingCollected() {
        if (!isBeingCollected()) {
            throw new IllegalStateException("A pledge in " + state + " is not being collected");
        }
    }

    /** Whether this pledge is still holding a place. */
    public boolean isDraft() {
        return state == PledgeState.DRAFT;
    }

    /** Whether the backer has committed, which is what decides how their place is counted. */
    public boolean isConfirmed() {
        return state == PledgeState.CONFIRMED;
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

    public UUID getPaymentMethodId() {
        return paymentMethodId;
    }

    public String getShippingCountry() {
        return shippingCountry;
    }

    public boolean isAnonymous() {
        return anonymous;
    }

    public boolean isLatePledge() {
        return latePledge;
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

    /** §9.6: how many attempts have been made. See the field. */
    public int getChargeAttempts() {
        return chargeAttempts;
    }

    public Instant getNextChargeAttemptAt() {
        return nextChargeAttemptAt;
    }

    public Instant getChargeWindowEndsAt() {
        return chargeWindowEndsAt;
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
