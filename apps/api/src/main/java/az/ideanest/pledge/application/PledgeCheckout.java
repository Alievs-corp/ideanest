package az.ideanest.pledge.application;

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
 */
@Service
public class PledgeCheckout {

    private final PledgePayments payments;
    private final PaymentPage page;

    public PledgeCheckout(PledgePayments payments, PaymentPage page) {
        this.payments = payments;
        this.page = page;
    }

    public PaymentPageSession pay(
            UUID pledgeId,
            UUID backerId,
            Integer acknowledgedVersion,
            String language,
            URI successUrl,
            URI errorUrl,
            String idempotencyKey) {
        PayablePledge payable = payments.prepare(pledgeId, backerId, acknowledgedVersion);
        return page.open(payable, language, successUrl, errorUrl, idempotencyKey);
    }
}
