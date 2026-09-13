package az.ideanest.payment.domain;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.Objects;

/**
 * A provider's webhook, verified and normalised: §9.3's R-07 and §17.2's row.
 *
 * <p>Produced by {@link PaymentProvider#parseWebhook}, which means <strong>an
 * instance of this type is a body whose signature has already been checked</strong>.
 * That is the invariant the whole of #66 rests on, and it is why parsing and
 * verification are one call rather than two: two calls can be made in the wrong
 * order, and the wrong order here is acting on an instruction from anybody who knows
 * the URL.
 *
 * @param provider which adapter verified it. Half of the deduplication key, because
 *     two providers' identifiers share no namespace
 * @param providerEventId the provider's own identifier for the event. The other half,
 *     and the thing a redelivery repeats. <strong>Not a hash of the body</strong>: a
 *     provider that re-sends with a refreshed timestamp changes the bytes and not the
 *     event
 * @param type what happened, normalised. See {@link PaymentEventType}
 * @param providerTransactionId which call it is about, in the provider's namespace.
 *     Null on an event that is not about one — which is most of what arrives, since
 *     {@link PaymentEventType#UNRECOGNISED} covers everything the platform did not ask
 *     for
 * @param amount how much the event is about, when it says. Null when the event
 *     carries no amount. Never used to <em>decide</em> anything — the platform's own
 *     record of what was charged is {@code transactions}, and an amount taken from a
 *     webhook is an amount taken from somebody else's system
 * @param signedAt when the provider says it signed. §17.2's replay check compares it
 *     against {@code ideanest.payment.webhooks.tolerance}, and it is stored so that
 *     "how far behind were deliveries during the incident" is answerable
 * @param rawBody the bytes as they arrived, as text. Stored verbatim in
 *     {@code provider_webhook_events.payload}, because in a dispute what matters is
 *     what was signed
 * @param payoutCard IDN-EXT-01 (#44): the card a payout card registration event is about. Null on
 *     every other event
 */
public record PaymentEvent(
        ProviderName provider,
        String providerEventId,
        PaymentEventType type,
        String providerTransactionId,
        Money amount,
        Instant signedAt,
        String rawBody,
        PayoutCard payoutCard) {

    public PaymentEvent {
        Objects.requireNonNull(provider, "A verified event knows which adapter verified it");
        Objects.requireNonNull(type, "An event that says nothing about what happened cannot be routed");
        if (providerEventId == null || providerEventId.isBlank()) {
            // Without it there is no deduplication, and without deduplication a
            // redelivered chargeback is a second refund.
            throw new IllegalArgumentException("An event with no provider identifier cannot be processed exactly once");
        }
        if (rawBody == null || rawBody.isBlank()) {
            throw new IllegalArgumentException("An empty body is not evidence of anything");
        }
    }

    /** Every event that is not about a payout card. */
    public PaymentEvent(
            ProviderName provider,
            String providerEventId,
            PaymentEventType type,
            String providerTransactionId,
            Money amount,
            Instant signedAt,
            String rawBody) {
        this(provider, providerEventId, type, providerTransactionId, amount, signedAt, rawBody, null);
    }
}
