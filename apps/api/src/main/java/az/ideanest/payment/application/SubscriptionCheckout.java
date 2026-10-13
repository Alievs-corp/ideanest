package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.HostedPaymentRequest;
import az.ideanest.payment.domain.HostedPaymentSession;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.SubscriptionCharge;
import az.ideanest.payment.infrastructure.SubscriptionChargeRepository;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.payment.ReturnUrls;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Opens the provider's page for a creator plan — issue #449.
 *
 * <p>{@link HostedPaymentPage}'s twin for subscriptions. The provider is asked outside any
 * transaction and the page is recorded once it exists.
 *
 * <p><strong>A second click goes back to the same page.</strong> While a page opened in the last
 * {@code hosted-charges.answered-after} is still waiting, it is returned instead of opening another
 * order — two open orders for one period are two payments a creator could make. After that window
 * the sweep starts asking about the old page, and a new one may be opened; if both are paid, each
 * pays for a period of its own.
 */
@Service
public class SubscriptionCheckout {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionCheckout.class);

    private final PaymentProviders providers;
    private final SubscriptionChargeRepository charges;
    private final ReturnUrls returnUrls;
    private final PaymentProperties.HostedCharges properties;
    private final Clock clock;

    public SubscriptionCheckout(
            PaymentProviders providers,
            SubscriptionChargeRepository charges,
            ReturnUrls returnUrls,
            PaymentProperties properties,
            Clock clock) {
        this.providers = providers;
        this.charges = charges;
        this.returnUrls = returnUrls;
        this.properties = properties.hostedCharges();
        this.clock = clock;
    }

    /**
     * @param language the page's language, or null for the provider's default
     * @param successUrl where the creator returns after paying, or null
     * @param errorUrl where the creator returns after a failure, or null
     * @throws SubscriptionCheckoutUnavailableException when no provider can take the payment now
     */
    public SubscriptionPaymentPage open(
            SubscriptionPaymentRequest request, String language, URI successUrl, URI errorUrl) {
        returnUrls.check(successUrl, errorUrl);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Optional<SubscriptionCharge> open = charges.findFirstBySubscriptionIdAndStatusOrderByOpenedAtDesc(
                request.subscriptionId(), SubscriptionCharge.Status.PENDING);
        if (open.isPresent() && open.get().isReusableAt(now, properties.answeredAfter())) {
            SubscriptionCharge reused = open.get();
            log.info("Returned subscription {} to its open payment {}.",
                    request.subscriptionId(), reused.getProviderTransactionId());
            return new SubscriptionPaymentPage(reused.getProviderTransactionId(), reused.getPaymentUrl());
        }

        PaymentProvider provider = providers
                .primary()
                .orElseThrow(() -> new SubscriptionCheckoutUnavailableException("No payment provider is configured."));

        UUID chargeId = Identifiers.newIdentifier();
        HostedPaymentSession session;
        try {
            session = provider.beginHostedPayment(new HostedPaymentRequest(
                    chargeId,
                    request.amount(),
                    description(request),
                    language,
                    successUrl,
                    errorUrl,
                    chargeId.toString()));
        } catch (UnsupportedOperationException e) {
            throw new SubscriptionCheckoutUnavailableException(
                    provider.name() + " does not take payments on a hosted page.", e);
        } catch (ProviderUnavailableException e) {
            log.warn("Could not open a payment page for subscription {}: {}", request.subscriptionId(), e.getMessage());
            throw new SubscriptionCheckoutUnavailableException("The payment provider could not be reached.", e);
        }

        charges.save(SubscriptionCharge.opened(
                chargeId,
                request.subscriptionId(),
                request.accountId(),
                request.renewal() ? SubscriptionCharge.Purpose.RENEWAL : SubscriptionCharge.Purpose.FIRST_PERIOD,
                request.amount(),
                provider.name(),
                session,
                now));
        log.info("Opened payment {} for subscription {} ({}).",
                session.providerTransactionId(), request.subscriptionId(), request.renewal() ? "renewal" : "first period");
        return new SubscriptionPaymentPage(session.providerTransactionId(), session.redirectUrl());
    }

    private static String description(SubscriptionPaymentRequest request) {
        String plan = request.planName() == null || request.planName().isBlank() ? "plan" : request.planName().trim();
        return "IdeyaNest " + plan + (request.renewal() ? " renewal" : "");
    }
}
