package az.ideanest.pledge.application;

import az.ideanest.shared.payment.ReturnUrls;
import java.net.URI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * {@code POST /v1/pledges/{id}/raise} — #171.
 *
 * <p>{@link PledgeCheckout} for a raise, in the same two steps: the raise and its hold are prepared
 * first, and only then is the provider asked for a page. The return addresses are checked before
 * either step, so a refused address holds nothing (#139).
 *
 * <p><strong>Under the endpoint, the two steps are one transaction.</strong> {@code POST
 * /v1/pledges/{id}/raise} runs this inside the idempotency store's own transaction
 * ({@code IdempotencyRecords#runAndRecord}), so {@link PledgeRaiseService#prepare} joins it: the
 * pledge's row lock is held while the provider answers, and a page that cannot be opened rolls the
 * raise and its hold back with the rest — nothing is held and nothing is recorded. That is the draft's
 * {@code /payment} arrangement too. {@link PledgeRaiseService#abandon} is for a caller outside such a
 * transaction, where the raise would otherwise stand in the way of the backer's next attempt for the
 * whole payment window.
 */
@Service
public class PledgeRaiseCheckout {

    private static final Logger log = LoggerFactory.getLogger(PledgeRaiseCheckout.class);

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
        PaymentPageSession session;
        try {
            session = page.open(payable.payment(), language, successUrl, errorUrl, payable.chargeKey());
        } catch (RuntimeException failure) {
            raises.abandon(payable.raiseId());
            throw failure;
        }
        // Outside the try: the page is open and a payment may follow, so keeping its address must not
        // abandon the raise. PledgeRaise.recordPage refuses nothing — it keeps an address only of the
        // shape V83 accepts — so this cannot turn the request's transaction into a rollback.
        try {
            raises.recordPage(payable.raiseId(), session.redirectUrl());
        } catch (RuntimeException failure) {
            log.warn("Could not keep the page address of raise {}; it cannot be resumed.", payable.raiseId(), failure);
        }
        return new OpenedRaise(payable, session);
    }
}
