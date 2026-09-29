package az.ideanest.pledge.application;

import az.ideanest.shared.payment.ReturnUrls;
import java.net.URI;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * {@code POST /v1/pledges/{id}/payment} — IDN-EXT-01 (#39).
 *
 * <p>Two steps and deliberately two transactions: {@link PledgePayments#prepare} commits the hold
 * on the draft, and only then is the provider asked for a payment page. A provider call inside the
 * transaction would hold the pledge's row lock for as long as somebody else's server takes to
 * answer.
 *
 * <p>The return addresses are checked before either step (#139), so a refused address holds no draft
 * and records no agreement.
 */
@Service
public class PledgeCheckout {

    private final PledgePayments payments;
    private final PaymentPage page;
    private final ReturnUrls returnUrls;

    public PledgeCheckout(PledgePayments payments, PaymentPage page, ReturnUrls returnUrls) {
        this.payments = payments;
        this.page = page;
        this.returnUrls = returnUrls;
    }

    /**
     * Holds the draft and opens the provider's page.
     *
     * @throws az.ideanest.shared.payment.InvalidReturnUrlException when either address is not a page
     *     on the site
     */
    public PaymentPageSession pay(
            UUID pledgeId,
            UUID backerId,
            Integer acknowledgedVersion,
            String language,
            URI successUrl,
            URI errorUrl,
            String idempotencyKey) {
        returnUrls.check(successUrl, errorUrl);
        PayablePledge payable = payments.prepare(pledgeId, backerId, acknowledgedVersion);
        return page.open(payable, language, successUrl, errorUrl, idempotencyKey);
    }
}
