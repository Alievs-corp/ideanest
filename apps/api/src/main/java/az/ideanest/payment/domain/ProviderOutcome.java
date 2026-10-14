package az.ideanest.payment.domain;

/**
 * What a provider said about a call: one vocabulary for all four of them.
 *
 * <p>§9.4 gives tokenisation, charging, refunding and paying out their own result
 * types, and each of those four could have had its own outcome enum. It has one,
 * for the reason §8.4 gives about retry policies: two vocabularies for one idea is
 * one too many, and here the idea genuinely is one — the platform asked a provider
 * to move money and the provider either did, refused, or has not decided.
 *
 * <p>The cost is that a value can be unreachable for a particular call. A payout
 * that a provider answers synchronously never returns {@link #PENDING}. That is
 * cheaper than the alternative, which is four almost-identical enums and four
 * switches that have to be kept in step.
 */
public enum ProviderOutcome {

    /**
     * The provider did it. For a charge this is the only outcome that moves money,
     * and therefore the only one that posts to the ledger.
     */
    APPROVED,

    /**
     * The provider refused, and said why. <strong>A business answer, not an
     * error</strong> — §9.6 puts collection failure at 5–15% of pledges, so a
     * decline is the ordinary case this feature is built around and never an
     * exception. {@code failureCode} is populated; an adapter that returns this
     * without one is refused by the result type's own constructor.
     */
    DECLINED,

    /**
     * The provider accepted the instruction and has not decided yet; the answer will
     * arrive over a webhook.
     *
     * <p><strong>Not the same as an error, and the difference is money.</strong> A
     * transport failure means the platform does not know whether the provider was
     * reached; this means it was, and that the charge may still succeed. Retrying a
     * {@code PENDING} charge is how a backer gets charged twice, which is why a pending
     * payment is left where it is to wait for the provider's callback or the hosted-charge
     * sweep rather than being asked for again.
     */
    PENDING
}
