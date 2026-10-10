package az.ideanest.support;

import az.ideanest.payment.application.StoredCards;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.StoredCard;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A saved card for every pledge, unless a test says otherwise.
 *
 * <p>{@code payment_methods} is #55 and does not exist, so the shipped
 * {@code UnavailableStoredCards} answers "there is no card on file" — which is true of
 * the platform and fatal to any test of collection, since every attempt would be
 * refused with {@code payment_method_missing} before a provider was asked.
 *
 * <p>The default is a card. {@link #withoutACard} is how a test asks for the platform's
 * real answer for one pledge, which is worth being able to do: a pledge whose card has
 * gone is a case §9.6's schedule has to handle, and it is the only case a deployed
 * environment can produce today.
 */
public class ScriptedStoredCards implements StoredCards {

    private final Set<UUID> withoutACard = ConcurrentHashMap.newKeySet();

    @Override
    public Optional<StoredCard> forPledge(UUID pledgeId, UUID paymentMethodId) {
        if (withoutACard.contains(pledgeId)) {
            return Optional.empty();
        }
        // Derived from the pledge rather than random, so a second call for one pledge
        // produces the same card -- which is what a retry does, and a card that changed
        // between attempts would hide a bug rather than reveal one.
        return Optional.of(new StoredCard(
                UUID.nameUUIDFromBytes(("card:" + pledgeId).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                ProviderName.AZERICARD,
                "tok_" + pledgeId,
                "scheme_" + pledgeId));
    }

    /** This pledge has no card on file, which is the platform's answer for every pledge today. */
    public void withoutACard(UUID pledgeId) {
        withoutACard.add(pledgeId);
    }

    /** Forgets what any test said. Called between tests, like the provider's own reset. */
    public void reset() {
        withoutACard.clear();
    }
}
