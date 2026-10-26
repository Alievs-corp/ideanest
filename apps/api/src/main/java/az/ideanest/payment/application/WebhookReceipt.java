package az.ideanest.payment.application;

/**
 * What became of one webhook delivery, as far as the sender needs to know.
 *
 * <p><strong>All four are a 200.</strong> That is the point of the type rather than a
 * limitation of it: a provider retries anything that is not a 2xx, and every value here
 * describes a delivery the platform has finished with — acted on, deliberately ignored,
 * or already handled. Distinguishing them in the response body would tell a sender that
 * knows the URL which events the platform cares about, and would give a retry loop a
 * reason to keep trying something that is complete.
 *
 * <p>They are distinguished in the log and in {@code provider_webhook_events}, which is
 * where the question is actually asked.
 */
public enum WebhookReceipt {

    /** A handler recognised the event and acted on it, in the same commit as the row. */
    PROCESSED,

    /** Verified and recorded; nothing handles this type. See {@code WebhookEventState#IGNORED}. */
    IGNORED,

    /**
     * The platform has seen this event before and did nothing a second time.
     *
     * <p>The ordinary outcome of a provider retrying something whose response it did not
     * receive, and therefore not a warning.
     */
    DUPLICATE,

    /**
     * #587: an unsigned callback naming a payment no page of the platform's is waiting on — an order
     * already settled, one this platform never opened, or a guess. Not verified, not recorded, and the
     * provider is not asked: answered exactly as a delivery that was acted on, so the response says
     * nothing about which orders exist.
     */
    UNEXPECTED
}
