package az.ideanest.shared.observability;

import java.util.List;

/**
 * Whether the platform's outbound providers are answering — §4.11's AD-16, issue #316.
 *
 * <p><strong>{@link QueueDepthSource}'s shape, and it exists for a boundary rather than for
 * symmetry.</strong> AD-16's screen shows payment provider status, and the first version of
 * {@code SystemHealthService} read {@code payment.application.ProviderCircuitBreaker}
 * directly — which compiled, and which {@code ModuleBoundaryTests} refused, because naming
 * the breaker means naming {@code payment.domain.ProviderName} to iterate over it.
 *
 * <p>That rule was doing real work. A health screen that knew the provider vocabulary would
 * have to change every time §9.3's list of integrations did, for a page that only ever
 * renders whatever it is handed. So the payment module answers with strings it chooses, and
 * the platform module renders them.
 *
 * <p>The same arrangement makes a second answerer free: a mail relay or a media provider
 * that grew a health check would appear on the screen by implementing this, with no edit to
 * the module that draws it.
 */
public interface ProviderStatusSource {

    /**
     * What this module is prepared to say about the third parties it calls.
     *
     * <p>A list rather than one entry per bean, because the answering module knows how many
     * there are and which of them a deployment has configured — and a bean per provider
     * would put that count in the Spring context, where a misconfiguration becomes a
     * start-up failure rather than a red row on a screen.
     */
    List<ProviderStatus> providerStatuses();

    /**
     * One provider.
     *
     * @param kind what sort of thing it is, as an identifier the screen groups by and
     *     words — {@code payments}. Not a sentence, for the reason
     *     {@link QueueDepthSource#queueName()} gives: it is a metric tag and a catalogue key,
     *     and a word sent from here could only ever be in one language
     * @param name the provider, as the platform names it
     * @param configured whether this deployment has credentials for it at all.
     *     <strong>An unconfigured provider is not unhealthy</strong> — §9.3 asks for at
     *     least two integrations and a deployment may run one, so painting the others red
     *     would put permanent failures on a screen whose only job is to show the ones that
     *     are not permanent
     * @param available what the caller's own circuit breaker currently answers. False on an
     *     unconfigured provider, which the screen reads together with {@code configured}
     * @param reason why it is not available, as a code the screen words: {@link #NOT_CONFIGURED}
     *     or {@link #CIRCUIT_OPEN}. Null while it is. It used to be an English sentence, which
     *     the console printed verbatim under an Azerbaijani heading
     */
    record ProviderStatus(String kind, String name, boolean configured, boolean available, String reason) {

        /** No credentials for it on this deployment. Switched off rather than failing. */
        public static final String NOT_CONFIGURED = "NOT_CONFIGURED";

        /** The caller's circuit breaker has taken it out of service after repeated failures. */
        public static final String CIRCUIT_OPEN = "CIRCUIT_OPEN";
    }
}
