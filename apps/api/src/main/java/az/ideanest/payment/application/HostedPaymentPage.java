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
import az.ideanest.payment.PaymentProperties;
import az.ideanest.shared.money.Money;
import java.net.URI;
import java.time.Clock;
import java.util.Optional;
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
 *
 * <p>#436: the pending row also records the refund terms the backer read at the checkout they came
 * from ({@link RefundTerms}), and the row that settles the payment copies them, so a setting switched
 * while the backer is on the provider's page does not change what they agreed to.
 *
 * <p>#587: the pending row also records where the page is, so that a second request for the same draft
 * is sent back to it ({@link #waiting}) rather than given a second order — {@code SubscriptionCheckout}'s
 * rule for a plan's page, with the same window: a page younger than {@code hosted-charges.answered-after}
 * for the draft's current total. After that the sweep starts asking about it, and a new page may be
 * opened; if both are paid, {@code HostedChargeEvents} returns the second. It records the language the
 * page was opened in beside the two return addresses, and a page is reused only for a request that
 * matches all three, because they are baked into the provider's order: the application's addresses
 * carry {@code via=app}, and a page opened from the website would take an application backer out of it.
 */
@Service
public class HostedPaymentPage implements PaymentPage {

    private static final Logger log = LoggerFactory.getLogger(HostedPaymentPage.class);

    private final PaymentProviders providers;
    private final PaymentTransactionRepository transactions;
    private final ReturnUrls returnUrls;
    private final ObjectMapper json;
    private final RefundTerms terms;
    private final ProviderCircuitBreaker breaker;
    private final PaymentProperties.HostedCharges hostedCharges;
    private final Clock clock;

    public HostedPaymentPage(
            PaymentProviders providers,
            PaymentTransactionRepository transactions,
            ReturnUrls returnUrls,
            ObjectMapper json,
            RefundTerms terms,
            ProviderCircuitBreaker breaker,
            PaymentProperties properties,
            Clock clock) {
        this.providers = providers;
        this.transactions = transactions;
        this.returnUrls = returnUrls;
        this.json = json;
        this.terms = terms;
        this.breaker = breaker;
        this.hostedCharges = properties.hostedCharges();
        this.clock = clock;
    }

    @Override
    public Optional<PaymentPageSession> waiting(
            PayablePledge pledge, String language, URI successUrl, URI errorUrl) {
        return transactions
                .openPageFor(
                        pledge.pledgeId(),
                        clock.instant().minus(hostedCharges.answeredAfter()),
                        language,
                        successUrl == null ? null : successUrl.toString(),
                        errorUrl == null ? null : errorUrl.toString())
                .filter(page -> Money.of(page.getAmount(), page.getCurrency()).equals(pledge.total()))
                .map(page -> {
                    log.info("Returned pledge {} to its open payment {}.", pledge.pledgeId(), page.getProviderTransactionId());
                    return new PaymentPageSession(page.getProviderTransactionId(), URI.create(page.getPaymentUrl()));
                });
    }

    @Override
    public PaymentPageSession open(
            PayablePledge pledge, String language, URI successUrl, URI errorUrl, String idempotencyKey) {
        returnUrls.check(successUrl, errorUrl);
        PaymentProvider provider = providers
                .primary()
                .orElseThrow(() -> new PaymentPageUnavailableException("No payment provider is configured."));
        if (!breaker.isAvailable(provider.name())) {
            throw new PaymentPageUnavailableException("The circuit breaker for " + provider.name() + " is open.");
        }

        HostedPaymentSession session;
        try {
            session = breaker.call(provider.name(), () -> provider.beginHostedPayment(new HostedPaymentRequest(
                    pledge.pledgeId(),
                    pledge.total(),
                    "IdeyaNest pledge " + pledge.pledgeId(),
                    language,
                    successUrl,
                    errorUrl,
                    idempotencyKey)));
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
                        opened(session.redirectUrl(), language, successUrl, errorUrl)),
                1,
                idempotencyKey,
                terms.withholdsProviderFeeOnNewCharges()));
        log.info("Opened payment {} for pledge {}.", session.providerTransactionId(), pledge.pledgeId());
        return new PaymentPageSession(session.providerTransactionId(), session.redirectUrl());
    }

    /**
     * What the pending row stores: that the page was opened, where it is (#587), the language it was
     * opened in, and where the provider will send the backer back — the last three are what
     * {@link #waiting} matches a later request against. Written through the mapper rather than
     * concatenated, because the addresses came from the caller.
     */
    private String opened(URI paymentUrl, String language, URI successUrl, URI errorUrl) {
        ObjectNode node = json.createObjectNode().put("hostedPayment", true);
        if (paymentUrl != null) {
            node.put("paymentUrl", paymentUrl.toString());
        }
        if (language != null) {
            node.put("language", language);
        }
        if (successUrl != null) {
            node.put("successUrl", successUrl.toString());
        }
        if (errorUrl != null) {
            node.put("errorUrl", errorUrl.toString());
        }
        return json.writeValueAsString(node);
    }
}
