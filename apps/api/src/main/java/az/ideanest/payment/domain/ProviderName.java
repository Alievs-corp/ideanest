package az.ideanest.payment.domain;

import java.util.Locale;

/**
 * Which payment provider, from §9.3's candidate table.
 *
 * <p><strong>An enum and not free text</strong>, because this value is half of two
 * uniqueness rules — {@code transactions_settled_provider_key} and
 * {@code provider_webhook_events_identity_key} — and a provider that is spelled two
 * ways is a provider whose events deduplicate against nothing. The names are also
 * the values stored in {@code transactions.provider} and
 * {@code provider_webhook_events.provider}, so renaming one is a data migration.
 *
 * <p><strong>Being on this list is not being integrated.</strong> §9.3 requires
 * fourteen capabilities confirmed in writing before a provider can be signed, and
 * #60 — which is the issue that does the confirming — is unanswered, so no adapter
 * for any of these ships. What the enum gives the platform before then is a closed
 * vocabulary: {@code PaymentProviders} resolves a configured name against it at
 * start-up, so a typo in a deployment's configuration is a start-up failure rather
 * than a webhook endpoint that quietly matches nothing.
 *
 * <p>§9.3's fourth row, "bank acquiring", is deliberately absent. Its terms are
 * negotiated individually, so it names a class of arrangement rather than an
 * integration, and a value nothing can ever be an adapter for would be a value that
 * only ever appears in a configuration mistake.
 */
public enum ProviderName {

    /** Pre-authorisation and completion, refunds, AZN/USD/EUR. §9.3's first candidate. */
    PAYRIFF,

    /** API integration with split payments across parties, which suits §9.5's distribution. */
    EPOINT,

    /** The national processing centre. Direct integration is typically bank-intermediated. */
    AZERICARD,

    /**
     * Local development only, and temporary — issue #243.
     *
     * <p>Registers a payout card on a page the service draws itself, so the card's path can be
     * walked before Epoint's keys exist. It moves no money: every charge, refund and payout
     * refuses. {@code SandboxPaymentProvider} refuses to start outside the {@code local} and
     * {@code test} profiles, and a deployment naming it has no adapter to resolve, which is a
     * start-up failure. Removed once Epoint is configured.
     */
    SANDBOX;

    /**
     * The name as it is written in a URL and in configuration: lower case.
     *
     * <p>§10.2's endpoint is {@code POST /v1/webhooks/psp/{provider}}, and a path
     * segment that has to be shouted is one every provider's configuration screen
     * will get wrong once. Parsing is {@link #of(String)} and is case-insensitive in
     * both directions, so neither side has to know which convention the other chose.
     */
    public String slug() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * The provider with this name, however it was capitalised.
     *
     * @throws UnknownProviderException when nothing matches. Deliberately not an
     *     {@code Optional} at this level: every caller — the webhook path, the
     *     configured primary, a stored {@code transactions.provider} — is holding a
     *     string that is supposed to name a provider, and the three of them want the
     *     same refusal rather than three different ways of saying "no such thing"
     */
    public static ProviderName of(String name) {
        if (name != null) {
            String trimmed = name.trim();
            for (ProviderName candidate : values()) {
                if (candidate.name().equalsIgnoreCase(trimmed)) {
                    return candidate;
                }
            }
        }
        throw new UnknownProviderException(name);
    }
}
