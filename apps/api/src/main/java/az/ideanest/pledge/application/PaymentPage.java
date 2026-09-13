package az.ideanest.pledge.application;

import java.net.URI;

/**
 * Opens the provider's payment page for a draft — IDN-EXT-01 (#39).
 *
 * <p><strong>Declared here and implemented by the payment module</strong>, so the dependency runs
 * one way. The payment module already depends on this one — it collects pledges through
 * {@code PledgeCollection} — and the pledge module naming a payment type would make the two a
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
}
