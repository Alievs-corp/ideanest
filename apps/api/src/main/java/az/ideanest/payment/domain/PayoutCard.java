package az.ideanest.payment.domain;

/**
 * A payout card the provider says it registered, or refused to — IDN-EXT-01 (#44).
 *
 * <p>Carried on the {@link PaymentEvent} rather than in its stored body, because the holder's name
 * is removed from every body before it is stored (§17.2) and it is exactly what the payout
 * destination is matched against: the name on the card has to agree with the creator's legal name.
 *
 * @param cardId the provider's identifier for the card, the one a payout is later sent to
 * @param cardMask the masked number, as the provider masked it. Null when it sends none
 * @param holderName the cardholder's name as the provider read it. Null when it sends none
 */
public record PayoutCard(String cardId, String cardMask, String holderName) {

    public PayoutCard {
        if (cardId == null || cardId.isBlank()) {
            throw new IllegalArgumentException("A payout card event names the card");
        }
    }
}
