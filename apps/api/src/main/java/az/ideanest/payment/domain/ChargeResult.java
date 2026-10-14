package az.ideanest.payment.domain;

import java.util.Objects;

/**
 * What the provider said about a charge: a payment page that settled, or a raise.
 *
 * <p><strong>A decline is a result and not an exception</strong>, and that is the
 * single most important thing about this type. Declines are an ordinary share of card
 * payments; modelling them as thrown exceptions would make the ordinary path the
 * exceptional one and would put the decline code into a message string.
 *
 * <p>What <em>is</em> an exception is not being able to ask: a timeout, a connection
 * refused, an answer nobody can parse. Those are {@link ProviderUnavailableException},
 * because the platform then does not know what happened to the money, which is a
 * different situation from knowing that nothing did.
 *
 * @param outcome approved, declined, or accepted and not yet decided
 * @param providerTransactionId the provider's identifier for the call. Present on an
 *     approval and on a decline the provider recorded; null only when the provider
 *     answered without one
 * @param failureCode why it was refused, in the provider's vocabulary, normalised by
 *     the adapter to something short enough for {@code transactions.failure_code}.
 *     Required on a decline and refused on anything else — a code on an approval is a
 *     row every report filtering on the column will read as a failure
 * @param failureMessage the same thing in words, for the support conversation and for
 *     nothing else. <strong>Never shown to a backer</strong>: §4.10's payment-failed
 *     notification says "update your card", because a provider's message is written
 *     for a merchant and half of them name the issuer's internal reason
 * @param rawResponse the provider's answer as JSON, stored verbatim in
 *     {@code transactions.provider_response}. §17.2's redaction happens in the adapter
 *     before this is built, not after
 */
public record ChargeResult(
        ProviderOutcome outcome,
        String providerTransactionId,
        String failureCode,
        String failureMessage,
        String rawResponse) {

    public ChargeResult {
        Objects.requireNonNull(outcome, "A charge result says what the provider decided");
        boolean declined = outcome == ProviderOutcome.DECLINED;
        if (declined == (failureCode == null || failureCode.isBlank())) {
            throw new IllegalArgumentException(
                    declined
                            ? "A decline without a code cannot be told apart from an unread answer"
                            : "A failure code on a " + outcome + " charge would be read as a decline");
        }
    }

    /** Whether money moved. The only outcome that posts to the ledger. */
    public boolean isApproved() {
        return outcome == ProviderOutcome.APPROVED;
    }

    /** Whether the provider refused, which is §9.6's ordinary case rather than an error. */
    public boolean isDeclined() {
        return outcome == ProviderOutcome.DECLINED;
    }

    /** Whether the provider took the instruction and has not answered. See {@link ProviderOutcome#PENDING}. */
    public boolean isPending() {
        return outcome == ProviderOutcome.PENDING;
    }
}
