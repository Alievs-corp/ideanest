package az.ideanest.payment.application;

import az.ideanest.payment.domain.PaymentEvent;
import az.ideanest.payment.domain.PaymentEventType;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PayoutCard;
import az.ideanest.payment.domain.PayoutCardRegistration;
import az.ideanest.payment.domain.PayoutCardRequest;
import az.ideanest.payment.domain.PayoutCardSession;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.infrastructure.PayoutCardRegistrationRepository;
import az.ideanest.shared.outbox.Outbox;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * A creator registering the business card their payout goes to — IDN-EXT-01 (#44).
 *
 * <p>The card is entered on the provider's page and never in an IdeaNest form (the spec's Epoint
 * notes: {@code /card-registration} with {@code refund=1}). {@link #begin} asks the primary provider
 * for that page and records the card identifier it answers as {@code PENDING}. The provider's
 * callback settles it: registered, and {@code payout-card.registered} goes through the outbox to the
 * compliance module, which files it as the creator's payout destination for a person to verify;
 * refused, and nothing else moves.
 *
 * <p>The provider call is outside any transaction, as {@code PledgeCheckout}'s is: a row lock held
 * for as long as somebody else's server takes to answer would be a lock held for nothing.
 */
@Component
public class PayoutCardRegistrations implements PaymentEventHandler {

    private static final Logger log = LoggerFactory.getLogger(PayoutCardRegistrations.class);

    private final PaymentProviders providers;
    private final PayoutCardRegistrationRepository registrations;
    private final Outbox outbox;
    private final Clock clock;

    public PayoutCardRegistrations(
            PaymentProviders providers, PayoutCardRegistrationRepository registrations, Outbox outbox, Clock clock) {
        this.providers = providers;
        this.registrations = registrations;
        this.outbox = outbox;
        this.clock = clock;
    }

    /**
     * Opens the provider's card entry page for this creator.
     *
     * @throws PayoutCardsUnavailableException when no provider can register a payout card now
     */
    public PayoutCardPage begin(UUID creatorId, String language, URI successUrl, URI errorUrl) {
        PaymentProvider provider = providers
                .primary()
                .orElseThrow(() -> new PayoutCardsUnavailableException("No payment provider is configured"));

        PayoutCardSession session;
        try {
            session = provider.beginPayoutCardRegistration(
                    new PayoutCardRequest(creatorId, "IdeaNest payout card", language, successUrl, errorUrl));
        } catch (UnsupportedOperationException refused) {
            throw new PayoutCardsUnavailableException(provider.name() + " does not register payout cards", refused);
        } catch (ProviderUnavailableException unavailable) {
            throw new PayoutCardsUnavailableException(provider.name() + " could not open a card page", unavailable);
        }

        registrations.save(PayoutCardRegistration.started(creatorId, provider.name(), session.cardId(), now()));
        log.info("Payout card registration {} begun at {} for creator {}.", session.cardId(), provider.name(), creatorId);
        return new PayoutCardPage(provider.name().name(), session.redirectUrl());
    }

    @Override
    public Set<PaymentEventType> handles() {
        return Set.of(PaymentEventType.PAYOUT_CARD_REGISTERED, PaymentEventType.PAYOUT_CARD_FAILED);
    }

    /** Runs in the webhook's transaction (`ProviderWebhooks`), so the row and the event commit together. */
    @Override
    public Optional<String> handle(PaymentEvent event) {
        PayoutCard card = event.payoutCard();
        if (card == null) {
            return Optional.of("no card named");
        }
        Optional<PayoutCardRegistration> found = registrations.findByProviderAndCardId(event.provider(), card.cardId());
        if (found.isEmpty()) {
            return Optional.of("no registration began for card " + card.cardId());
        }
        PayoutCardRegistration registration = found.get();
        if (!registration.isPending()) {
            return Optional.of("card " + card.cardId() + " is already " + registration.state());
        }

        if (event.type() == PaymentEventType.PAYOUT_CARD_FAILED) {
            registration.failed(now());
            registrations.save(registration);
            return Optional.of("card " + card.cardId() + " was not registered");
        }

        registration.registered(now());
        registrations.save(registration);
        outbox.record(
                PayoutCardRegisteredEvent.AGGREGATE_TYPE,
                registration.creatorId(),
                PayoutCardRegisteredEvent.EVENT_TYPE,
                new PayoutCardRegisteredEvent(
                        registration.creatorId(),
                        registration.provider().name(),
                        card.cardId(),
                        hintOf(card.cardMask()),
                        card.holderName()));
        return Optional.of("card " + card.cardId() + " registered");
    }

    /**
     * The last four digits, as V72's twelve-character hint. A mask with fewer than four digits at its
     * end is not shown at all rather than shown as something the creator would not recognise.
     */
    static String hintOf(String mask) {
        if (mask == null) {
            return null;
        }
        String digits = mask.replaceAll("[^0-9]", "");
        String tail = mask.trim();
        if (digits.length() < 4 || !Character.isDigit(tail.charAt(tail.length() - 1))) {
            return null;
        }
        return "**" + tail.substring(tail.length() - 4);
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
