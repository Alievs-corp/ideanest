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
import java.net.URI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The payment module's side of {@link PaymentPage} — IDN-EXT-01 (#39).
 *
 * <p>Asks the primary provider for a payment page and records a {@code PENDING} charge under the
 * provider's transaction identifier. {@code transactions} is append-only, so the charge is settled
 * later by a second row — {@code SUCCEEDED} or {@code FAILED} — which V41's partial indexes allow
 * to share this row's identifier and key while refusing two settled rows for one payment.
 */
@Service
public class HostedPaymentPage implements PaymentPage {

    private static final Logger log = LoggerFactory.getLogger(HostedPaymentPage.class);

    private final PaymentProviders providers;
    private final PaymentTransactionRepository transactions;

    public HostedPaymentPage(PaymentProviders providers, PaymentTransactionRepository transactions) {
        this.providers = providers;
        this.transactions = transactions;
    }

    @Override
    public PaymentPageSession open(
            PayablePledge pledge, String language, URI successUrl, URI errorUrl, String idempotencyKey) {
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
                new ChargeResult(ProviderOutcome.PENDING, session.providerTransactionId(), null, null, "{\"hostedPayment\":true}"),
                1,
                idempotencyKey));
        log.info("Opened payment {} for pledge {}.", session.providerTransactionId(), pledge.pledgeId());
        return new PaymentPageSession(session.providerTransactionId(), session.redirectUrl());
    }
}
