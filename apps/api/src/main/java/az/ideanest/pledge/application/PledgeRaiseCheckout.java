package az.ideanest.pledge.application;

import az.ideanest.shared.payment.ReturnUrls;
import java.net.URI;
import org.springframework.stereotype.Service;

/**
 * {@code POST /v1/pledges/{id}/raise} — #171.
 *
 * <p>{@link PledgeCheckout} for a raise, and in the same two steps for the same reason: the raise and
 * its hold are committed first, and only then is the provider asked for a page, so its row lock is not
 * held while somebody else's server answers. The return addresses are checked before either step, so
 * a refused address holds nothing (#139).
 *
 * <p>The one thing a confirmation does not need: when the page cannot be opened, the raise is
 * abandoned and its hold given back at once. A draft's places lapse with its reservation anyway; a
 * raise's would otherwise stand in the way of the backer's next attempt for the whole payment window.
 */
@Service
public class PledgeRaiseCheckout {

    private final PledgeRaiseService raises;
    private final PaymentPage page;
    private final ReturnUrls returnUrls;

    public PledgeRaiseCheckout(PledgeRaiseService raises, PaymentPage page, ReturnUrls returnUrls) {
        this.raises = raises;
        this.page = page;
        this.returnUrls = returnUrls;
    }

    /** What the backer is sent to, and what they are paying for. */
    public record OpenedRaise(PayableRaise raise, PaymentPageSession session) {
    }

    /**
     * Holds the raise and opens the provider's page for the difference.
     *
     * @throws az.ideanest.shared.payment.InvalidReturnUrlException when either address is not a page
     *     on the site
     * @throws PaymentPageUnavailableException when no provider can take the payment; the raise is
     *     abandoned and nothing is held
     */
    public OpenedRaise raise(RaisePledge command, String language, URI successUrl, URI errorUrl) {
        returnUrls.check(successUrl, errorUrl);
        PayableRaise payable = raises.prepare(command);
        try {
            PaymentPageSession session =
                    page.open(payable.payment(), language, successUrl, errorUrl, payable.chargeKey());
            return new OpenedRaise(payable, session);
        } catch (RuntimeException failure) {
            raises.abandon(payable.raiseId());
            throw failure;
        }
    }
}
