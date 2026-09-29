package az.ideanest.payment.application;

import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.HostedPaymentSession;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.pledge.application.PayablePledge;
import az.ideanest.pledge.application.PaymentPage;
import az.ideanest.pledge.application.PaymentPageSession;
import az.ideanest.pledge.application.PaymentPageUnavailableException;
import az.ideanest.shared.payment.ReturnUrls;
import java.net.URI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The payment module's side of {@link PaymentPage} — IDN-EXT-01 (#39).
 *
 * <p>Asks the primary provider for a payment page and records a {@code PENDING} charge under the
 * provider's transaction identifier. {@code transactions} is append-only, so the charge is settled
 * later by a second row — {@code SUCCEEDED} or {@code FAILED} — which V41's partial indexes allow
 * to share this row's identifier and key while refusing two settled rows for one payment.
 *
 * <p>The return addresses are checked again here, although {@code PledgeCheckout} already has: this
 * is where they leave for the provider, and a second caller of {@link PaymentPage} must not be able to
 * skip the rule (#139). The pending row records them, so the payment's own record says where the
 * backer was sent back to.
 */
@Service
public class HostedPaymentPage implements PaymentPage {

    private static final Logger log = LoggerFactory.getLogger(HostedPaymentPage.class);

    private final PaymentProviders providers;
    private final PaymentTransactionRepository transactions;
    private final ReturnUrls returnUrls;
    private final ObjectMapper json;

    public HostedPaymentPage(
            PaymentProviders providers,
            PaymentTransactionRepository transactions,
            ReturnUrls returnUrls,
            ObjectMapper json) {
        this.providers = providers;
        this.transactions = transactions;
        this.returnUrls = returnUrls;
        this.json = json;
    }

    @Override
    public PaymentPageSession open(
            PayablePledge pledge, String language, URI successUrl, URI errorUrl, String idempotencyKey) {
        returnUrls.check(successUrl, errorUrl);
        PaymentProvider provider = providers
                .primary()
                .orElseThrow(() -> new PaymentPageUnavailableException("No payment provider is configured."));

        HostedPaymentSession session;
        try {
            session = provider.beginHostedPayment(new HostedPaymentRequest(
                    pledge.pledgeId(),
                    pledge.total(),
                    "IdeaNest pledge " + pledge.pledgeId(),
                    language,
                    successUrl,
                    errorUrl,
                    idempotencyKey));
        } catch (UnsupportedOperationException e) {
            throw new PaymentPageUnavailableException(provider.name() + " does not take payments on a hosted page.", e);
        } catch (ProviderUnavailableException e) {
            log.warn("Could not open a payment page for pledge {}: {}", pledge.pledgeId(), e.getMessage());
            throw new PaymentPageUnavailableException("The payment provider could not be reached.", e);
        }

        transactions.save(PaymentTransaction.charge(
                pledge.pledgeId(),
                pledge.projectId(),
                pledge.total(),
                provider.name(),
                new ChargeResult(
                        ProviderOutcome.PENDING,
                        session.providerTransactionId(),
                        null,
                        null,
                        opened(successUrl, errorUrl)),
                1,
                idempotencyKey));
        log.info("Opened payment {} for pledge {}.", session.providerTransactionId(), pledge.pledgeId());
        return new PaymentPageSession(session.providerTransactionId(), session.redirectUrl());
    }

    /**
     * What the pending row stores: that the page was opened, and where the provider will send the
     * backer back. Written through the mapper rather than concatenated, because the addresses came
     * from the caller.
     */
    private String opened(URI successUrl, URI errorUrl) {
        ObjectNode node = json.createObjectNode().put("hostedPayment", true);
        if (successUrl != null) {
            node.put("successUrl", successUrl.toString());
        }
        if (errorUrl != null) {
            node.put("errorUrl", errorUrl.toString());
        }
        return json.writeValueAsString(node);
    }
}
