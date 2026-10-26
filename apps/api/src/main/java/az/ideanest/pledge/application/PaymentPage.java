package az.ideanest.pledge.application;

import java.net.URI;
import java.util.Optional;

/**
 * Opens the provider's payment page for a draft — IDN-EXT-01 (#39).
 *
 * <p><strong>Declared here and implemented by the payment module</strong>, so the dependency runs
 * one way. The payment module already depends on this one — it settles pledges through
 * {@code PledgePayments} — and the pledge module naming a payment type would make the two a
 * cycle, which {@code ModuleBoundaryTests} refuses.
 */
public interface PaymentPage {

    /**
     * @param language the page's language, or null for the provider's default
     * @param successUrl where the backer returns after paying, or null
     * @param errorUrl where the backer returns after a failure, or null
     * @param idempotencyKey the request's key, sent as the provider's order identifier
     * @throws PaymentPageUnavailableException when no provider can take the payment now
     */
    PaymentPageSession open(PayablePledge pledge, String language, URI successUrl, URI errorUrl, String idempotencyKey);

    /**
     * #587: the page already opened for this draft, for its total, and still waiting for the provider —
     * which a second payment request is sent back to rather than given a second order. Empty when there
     * is none, or when it is old enough that the sweep is about to ask after it.
     *
     * <p><strong>Only a page opened with the same language and the same two return addresses.</strong>
     * Both addresses are part of the provider's order, so a page opened from the website sends its backer
     * back to the website however they reached it: a reused page would take a backer paying in the
     * application ({@code via=app}) out of it, and one opened in another language would answer in that
     * language. A request that differs gets a page of its own, as it did before pages were reused; the
     * second payment that can follow is returned by the payment module.
     *
     * <p>A default that finds nothing, so an implementation that cannot tell keeps opening pages.
     *
     * @param language the language the page would be opened in, or null
     * @param successUrl where this request's backer returns after paying, or null
     * @param errorUrl where this request's backer returns after a failure, or null
     */
    default Optional<PaymentPageSession> waiting(
            PayablePledge pledge, String language, URI successUrl, URI errorUrl) {
        return Optional.empty();
    }
}
