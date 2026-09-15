package az.ideanest.payment.application;

import java.util.UUID;

/**
 * IDN-EXT-01 (#44): the provider registered a creator's payout card.
 *
 * <p>Published through the outbox, and consumed by the compliance module, which owns payout
 * destinations and may not be called from here. The card identifier is what a payout is sent to;
 * the holder's name is what the destination is matched against, and it travels here because it is
 * removed from the stored webhook body.
 *
 * @param displayHint the masked tail the creator recognises the card by, or null
 * @param holderName the cardholder's name as the provider read it, or null when it sent none
 */
public record PayoutCardRegisteredEvent(
        UUID creatorId, String provider, String cardId, String displayHint, String holderName) {

    public static final String AGGREGATE_TYPE = "payout-card";
    public static final String EVENT_TYPE = "payout-card.registered";
}
