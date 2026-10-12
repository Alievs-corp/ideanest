package az.ideanest.shared.compliance;

/**
 * What kind of thing a creator's payout destination is — epic #392, issue #394.
 *
 * <p>The payout module has to know which of two routes a payout takes before it takes either:
 * a provider token is sent to through the provider's API, and a bank account is paid by a
 * member of staff from IdeyaNest's own account and recorded afterwards. Asking the standing is
 * not enough, because both kinds are verified the same way and stand the same way.
 */
public enum DestinationKind {

    /** A token a payment provider issued for the creator's card or account. Sent to by API. */
    PROVIDER_TOKEN,

    /**
     * An IBAN the creator entered, held encrypted by the platform. Paid by bank transfer.
     *
     * <p>The constant's name is also the value {@code payout_destinations.provider} holds for
     * such a row, and the payment module's {@code ProviderName.BANK_TRANSFER} —
     * {@code PayoutDestinationSchemaTests} keeps the three spellings equal.
     */
    BANK_TRANSFER
}
