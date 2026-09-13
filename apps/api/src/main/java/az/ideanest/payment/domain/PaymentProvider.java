package az.ideanest.payment.domain;

import java.util.Map;

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
 * string from one provider reaches the collection run, the second integration becomes
 * a rewrite of everything that touched it.
 *
 * <p>{@code PaymentProviderBoundaryTests} checks the rule rather than restating it,
 * the same way {@code ModuleBoundaryTests} checks §16.1's.
 *
 * <h2>Nothing implements this yet, and that is the honest state</h2>
 *
 * <p>#60 — choose the payment provider and confirm §9.3's fourteen capabilities in
 * writing — is unanswered, and §9.2 says plainly why no stub ships in the meantime:
 * an adapter that returned an approval "would be worse than nothing: it would make
 * this path look finished and would have told clients that cards were verified when
 * no card was ever seen". The same argument applies with more force to
 * {@link #chargeStoredCard}, which moves real money.
 *
 * <p>So {@code PaymentProviders} finds no adapters in a deployed environment, and
 * {@code CollectionRun} refuses to start when it finds none. That refusal is the
 * single gate that keeps every piece of machinery built on top of this interface —
 * the batching, the circuit breaker, §9.6's schedule, the ledger posting — inert
 * until there is a real provider behind it, rather than half-working against a
 * pretend one.
 *
 * <h2>What an implementation must guarantee</h2>
 *
 * <ul>
 *   <li><strong>It is a translator, not a decision maker.</strong> An adapter maps
 *       one call to one provider request and one provider response to one result. It
 *       does not retry — §9.6 owns the schedule and a hidden retry inside an adapter
 *       is a second charge nobody counted. It does not consult the database, does not
 *       write a transaction row, and does not post to the ledger.
 *   <li><strong>A refusal is a value; not being able to ask is a throw.</strong> See
 *       {@link ChargeResult} and {@link ProviderUnavailableException} for why the two
 *       cannot be the same thing.
 *   <li><strong>Card data never leaves it.</strong> §17.2 targets SAQ A. Anything a
 *       provider returns is redacted inside the adapter before it becomes a
 *       {@code rawResponse}, because that string is stored and logged.
 *   <li><strong>It is stateless and thread-safe.</strong> The collection run charges a
 *       batch concurrently; a single bean serves all of it.
 * </ul>
 */
public interface PaymentProvider {

    /** Which provider this adapter speaks to. The value stored on every row it produces. */
    ProviderName name();

    /**
     * §9.2's phase one: verify a card and create a stored token, with the backer
     * present and 3-D Secure in the loop.
     *
     * <p>Returns a session rather than a token because the answer is not knowable
     * synchronously — there is a human being and an issuer in the middle. #55 owns the
     * caller.
     *
     * @throws ProviderUnavailableException when the provider could not be reached
     */
    TokenizationSession beginTokenization(TokenizationRequest request);

    /**
     * The other half of phase one: what the session came to, once the backer has been
     * through it.
     *
     * <p>Asked by the return leg of the redirect and again by any reconciliation, so it
     * must be safe to ask repeatedly — a session that has resolved keeps resolving to
     * the same answer.
     *
     * @param sessionId {@link TokenizationSession#sessionId()}
     * @throws ProviderUnavailableException when the provider could not be reached
     */
    TokenizationResult resolveTokenization(String sessionId);

    /**
     * §9.2's phase two: collect at the campaign's close, without the customer present.
     *
     * <p><strong>The call the platform's whole design rests on.</strong> §9.3's R-02
     * and R-03 are what make it legal and acceptable to the schemes — the charge is
     * merchant-initiated and chained to the original customer-initiated authorisation
     * carried on {@link StoredCard#schemeTransactionId()} — and
     * {@code PaymentProviders} refuses to register an adapter whose
     * {@link #capabilities()} do not claim both.
     *
     * <p>Must be idempotent on {@link StoredCardChargeRequest#idempotencyKey()}: R-08
     * is on §9.3's list precisely so that a request whose answer was lost can be
     * repeated without charging a backer twice.
     *
     * @throws ProviderUnavailableException when the provider could not be reached, or
     *     answered something that cannot be read. <strong>Never for a decline</strong>
     */
    ChargeResult chargeStoredCard(StoredCardChargeRequest request);

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
     * IDN-EXT-01's payment (#38): begin a charge the backer makes on the provider's own page.
     *
     * <p>A default that refuses, so an adapter for the retired stored-card model need not
     * pretend to support it. #39 is the caller.
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
     * What this provider can do, from §9.3's table.
     *
     * <p>Read at start-up by {@code PaymentProviders}, which refuses an adapter that
     * cannot do R-01, R-02 and R-03 — see {@link ProviderCapabilities} for why that
     * check is at start-up and not at the first charge.
     */
    ProviderCapabilities capabilities();
}
