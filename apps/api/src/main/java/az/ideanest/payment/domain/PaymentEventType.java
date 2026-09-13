package az.ideanest.payment.domain;

/**
 * What a provider's webhook is about, in the platform's vocabulary rather than in the
 * provider's.
 *
 * <p><strong>Normalisation is the adapter's job and this enum is where it lands.</strong>
 * §9.3 requires at least two providers, and the two will not agree on the name of
 * anything: one sends {@code payment.captured} and the other {@code TRANSACTION_OK}.
 * If those strings reached the ingestion, every handler would carry a table of
 * synonyms and adding a third provider would mean editing all of them.
 *
 * <p>{@link #UNRECOGNISED} is what makes that safe. A provider sends every event type
 * it has, most of which the platform has not asked for, and an adapter that threw on
 * one would turn a provider's product announcement into a 500 and a retry storm
 * against an endpoint that has nothing to say. An unrecognised event is verified,
 * recorded, and answered 200 — see {@code provider_webhook_events.state}'s
 * {@code IGNORED}.
 */
public enum PaymentEventType {

    /** §9.2's phase two settled. The one event the collection path waits on. */
    CHARGE_SUCCEEDED,

    /** The provider decided against a charge it had accepted. §9.6's schedule takes it from there. */
    CHARGE_FAILED,

    /** #67's refund settled. */
    REFUND_SUCCEEDED,

    /** §9.8's first step: the provider notifies us of a dispute. #68's. */
    CHARGEBACK_OPENED,

    /** §9.8's fifth step, in our favour. */
    CHARGEBACK_WON,

    /** §9.8's fifth step, against us. §9.8's sixth deducts it from the payout. */
    CHARGEBACK_LOST,

    /** #69's transfer reached the creator's bank. */
    PAYOUT_PAID,

    /** It did not, and §6.3 has the payout to move back. */
    PAYOUT_FAILED,

    /**
     * Verified, recorded, and nothing to do about it.
     *
     * <p>Not an error and not a gap to be filled in later: most of what a provider
     * emits is about products the platform does not use. See the class comment.
     */
    /** IDN-EXT-01 (#44): the provider registered a creator's payout card. */
    PAYOUT_CARD_REGISTERED,

    /** IDN-EXT-01 (#44): the provider did not register it. */
    PAYOUT_CARD_FAILED,

    UNRECOGNISED
}
