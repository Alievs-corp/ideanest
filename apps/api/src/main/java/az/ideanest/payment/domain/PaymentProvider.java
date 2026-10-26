package az.ideanest.payment.domain;

import java.util.Map;
import java.util.Optional;

/**
 * §9.4's provider abstraction (#61): one interface, one adapter per provider, so that
 * changing provider is a single file.
 *
 * <p><strong>The rule this interface exists to make enforceable is the last sentence
 * of §9.4: "No provider SDK is called anywhere except behind this interface."</strong>
 * It is not a style preference. §9.3 ends with "integrate at least two providers — if
 * the primary is unavailable on the day a large campaign closes, the entire business
 * stops", and a second provider is only a day's work if the first one's vocabulary
 * never leaked. The moment a decline code, a currency-in-minor-units, or a status
 * string from one provider reaches the payment module, the second integration becomes
 * a rewrite of everything that touched it.
 *
 * <p>{@code PaymentProviderBoundaryTests} checks the rule rather than restating it,
 * the same way {@code ModuleBoundaryTests} checks §16.1's.
 *
 * <h2>What an implementation must guarantee</h2>
 *
 * <ul>
 *   <li><strong>It is a translator, not a decision maker.</strong> An adapter maps
 *       one call to one provider request and one provider response to one result. It
 *       does not retry — a hidden retry inside an adapter is a second charge nobody
 *       counted. It does not consult the database, does not
 *       write a transaction row, and does not post to the ledger.
 *   <li><strong>A refusal is a value; not being able to ask is a throw.</strong> See
 *       {@link ChargeResult} and {@link ProviderUnavailableException} for why the two
 *       cannot be the same thing.
 *   <li><strong>Card data never leaves it.</strong> §17.2 targets SAQ A. Anything a
 *       provider returns is redacted inside the adapter before it becomes a
 *       {@code rawResponse}, because that string is stored and logged.
 *   <li><strong>It is stateless and thread-safe.</strong> A single bean serves every
 *       payment page, refund and payout concurrently.
 * </ul>
 */
public interface PaymentProvider {

    /** Which provider this adapter speaks to. The value stored on every row it produces. */
    ProviderName name();

    /**
     * §9.7's reversal, in full or in part. #67 owns the caller.
     *
     * <p>An adapter whose {@link ProviderCapabilities#partialRefund()} is false may
     * assume it is only ever handed the full amount; the caller is what checks.
     *
     * @throws ProviderUnavailableException when the provider could not be reached
     */
    RefundResult refund(RefundRequest request);

    /**
     * §9.5's last arrow: send the creator their net. #69 owns the caller.
     *
     * @throws ProviderUnavailableException when the provider could not be reached
     */
    PayoutResult payout(PayoutRequest request);

    /**
     * §9.3's R-07: verify the signature and return a normalised event.
     *
     * <p><strong>One call and not two, deliberately.</strong> Verification and parsing
     * are inseparable here because the only way to obtain a {@link PaymentEvent} is to
     * go through the method that checks — so there is no ordering for a caller to get
     * wrong and no path on which an unverified body becomes an instruction. §17.2 asks
     * for a signature check and a timestamp check against replay, and both belong to
     * the adapter because both are expressed in the provider's own header format.
     *
     * @param rawBody the request body exactly as it arrived. <strong>Bytes, not a
     *     parsed document</strong>: a signature is over the bytes, and a body that has
     *     been through a JSON parser and back is a different sequence of them
     * @param headers the request's headers, lower-cased by the caller so that an
     *     adapter need not know which case the transport chose
     * @throws WebhookVerificationException when the signature does not verify, the
     *     timestamp is outside the tolerance, or the body cannot be read
     */
    PaymentEvent parseWebhook(byte[] rawBody, Map<String, String> headers);

    /**
     * #587: the provider transaction an <em>unsigned</em> callback names, read from the body alone —
     * for an adapter whose {@link #parseWebhook} verifies a delivery by asking the provider about it.
     *
     * <p>Such a body is not evidence of anything, and verifying it costs a call to another service.
     * {@code ProviderWebhooks} reads the name first and asks only about a payment the platform is
     * actually waiting on. Empty — the default — for an adapter that checks a signature, which
     * costs nothing to check and so needs no gate in front of it.
     *
     * @throws WebhookVerificationException when the body cannot be read or names nothing
     */
    default Optional<String> unsignedCallbackReference(byte[] rawBody) {
        return Optional.empty();
    }

    /**
     * IDN-EXT-01's payment (#38): begin a charge the backer makes on the provider's own page.
     *
     * <p>A default that refuses, so a test adapter that never opens a page need not pretend
     * to. #39 is the caller.
     *
     * @throws ProviderUnavailableException when the provider could not be reached, or refused to
     *     begin — which, before a card has been seen, is a configuration fault and not a decline
     */
    default HostedPaymentSession beginHostedPayment(HostedPaymentRequest request) {
        throw new UnsupportedOperationException(name() + " does not take payments on a hosted page");
    }

    /**
     * What a payment is now, asked of the provider. Safe to ask repeatedly.
     *
     * @throws ProviderUnavailableException when the provider could not be reached or answered
     *     something that cannot be read
     */
    default PaymentLookup lookUpPayment(String providerTransactionId) {
        throw new UnsupportedOperationException(name() + " does not look up hosted payments");
    }

    /**
     * Begin registering the business card a creator's payout goes to (#41).
     *
     * @throws ProviderUnavailableException when the provider could not be reached or refused
     */
    default PayoutCardSession beginPayoutCardRegistration(PayoutCardRequest request) {
        throw new UnsupportedOperationException(name() + " does not register payout cards");
    }

    /**
     * Whether {@link #beginPayoutCardRegistration} opens a page rather than refusing — #394.
     *
     * <p>Asked before offering the creator the card route at all, so that a settings screen
     * does not show a button whose only answer is a 503. An adapter that overrides the call
     * says so here; the default matches the default above.
     */
    default boolean registersPayoutCards() {
        return false;
    }

    /**
     * What this provider can do, from §9.3's table.
     *
     * <p>Read for the currencies a provider settles in and whether it refunds in part; see
     * {@link ProviderCapabilities}.
     */
    ProviderCapabilities capabilities();
}
