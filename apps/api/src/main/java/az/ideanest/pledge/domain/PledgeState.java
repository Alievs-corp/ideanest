package az.ideanest.pledge.domain;

import java.util.Set;

/**
 * §6.2's pledge state machine, as a vocabulary.
 *
 * <p><strong>The transitions are not here.</strong> This issue (#51) owns two of
 * them — nothing to {@link #DRAFT}, and {@link #DRAFT} to {@link #EXPIRED} when
 * the reservation lapses — and the other ten belong to confirmation (#52),
 * collection, and the pledge manager. A half-written transition table that
 * silently permits the states nobody has implemented yet would be worse than none,
 * because it would look like the rule.
 *
 * <p>Stored as text rather than as a PostgreSQL enum type, like every other state
 * column in the schema: adding a value to an enum type is a migration that cannot
 * run inside a transaction on older servers, and the check constraint gives the
 * same refusal without that.
 *
 * <p>The stored-card model's {@code CONFIRMED}, {@code CHARGE_PENDING}, {@code CHARGE_FAILED}
 * and {@code DROPPED} are gone (#470): IDN-EXT-01 charges a pledge when it is made
 * ({@code DRAFT → COLLECTED}), and V107 ended every pledge still in them as {@link #EXPIRED}.
 */
public enum PledgeState {

    /**
     * A reservation. Stock is held, nothing has been charged, and the place goes
     * back when {@code reservation_expires_at} passes.
     */
    DRAFT,

    /** The reservation TTL elapsed before the backer confirmed. The place was released. */
    EXPIRED,

    CANCELED_BY_BACKER,

    CANCELED_BY_PROJECT,

    COLLECTED,

    REFUNDED,

    CHARGEBACK,

    FULFILLED;

    /**
     * The states in which a backer counts as having pledged to a campaign.
     *
     * <p><strong>The same set as {@code pledges_project_backer_active_key}</strong>,
     * which is the partial unique index enforcing §7.2's "one pledge per backer per
     * project". Duplicated here on purpose and not derived from anything: the
     * database is where the rule is enforced, and this is how the application can
     * say why a request was refused before the index refuses it. V17 carries the
     * argument, and V107 took the stored-card states out of both.
     *
     * <p>The two lists disagreeing is the failure mode worth naming, and
     * {@code PledgeSchemaTests} is what stops it: it asserts the index against this
     * set rather than against a copy of it.
     */
    public static final Set<PledgeState> ACTIVE = Set.of(DRAFT, COLLECTED, FULFILLED);

    /**
     * The states a backer may still change or withdraw. §4.5's PL-09 and PL-10.
     *
     * <p><strong>One.</strong> A {@link #DRAFT} is a checkout in progress: changing it
     * is what the backer is in the middle of doing, and withdrawing it is abandoning a
     * purchase nobody has been charged for. A paid pledge is changed by a raise.
     *
     * <p><strong>Every other state is out, and none of them is an oversight.</strong>
     * {@link #EXPIRED} and the two cancellations are over; a pledge that ended cannot
     * be edited back into existence, and the backer's move is to pledge again, which
     * {@code pledges_project_backer_active_key} now permits precisely because those
     * states are not active. {@link #COLLECTED} onwards money has moved: changing the
     * amount then is a refund or a second charge, not an edit.
     *
     * <p><strong>This set is half of the rule, not the whole of it.</strong> The
     * other half is the campaign — PL-09 says "until the deadline" — and it cannot
     * be stated here, because whether a campaign is still taking pledges is a fact
     * about {@code projects} and this module may not read it.
     * {@code PledgeService#edit} composes the two, and it is the only place that
     * does.
     */
    public static final Set<PledgeState> EDITABLE = Set.of(DRAFT);

    /** Whether a pledge in this state still stands between its backer and a second one. */
    public boolean isActive() {
        return ACTIVE.contains(this);
    }

    /**
     * Whether a backer may still change or withdraw a pledge in this state.
     *
     * <p>Only the pledge's half of the rule. See {@link #EDITABLE}.
     */
    public boolean isEditable() {
        return EDITABLE.contains(this);
    }
}
