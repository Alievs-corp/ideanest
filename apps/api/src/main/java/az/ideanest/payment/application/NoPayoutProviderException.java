package az.ideanest.payment.application;

/**
 * No adapter is configured to send money out — issue #69.
 *
 * <p>Distinct from {@code UnconfiguredProviderException}, which names a provider the
 * platform once used and no longer has. This one is the deployment having no primary
 * provider at all, which is a different sentence to put in front of somebody: one is
 * "that charge cannot be reversed here" and the other is "nothing can be paid out from
 * this deployment".
 *
 * <p>503, because it becomes untrue the moment an adapter is configured.
 */
public class NoPayoutProviderException extends RuntimeException {

    public NoPayoutProviderException() {
        super("No payment provider is configured to send a payout");
    }

    /** A provider is configured and cannot send payouts — Payriff until #352 is settled. */
    public NoPayoutProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
