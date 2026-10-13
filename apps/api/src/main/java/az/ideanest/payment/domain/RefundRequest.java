package az.ideanest.payment.domain;

import az.ideanest.shared.money.Money;
import java.util.Objects;
import java.util.UUID;

/**
 * §9.7, as an instruction: give this back.
 *
 * <p><strong>Nothing calls this today.</strong> Refunds are #67, and §9.7 is the
 * policy behind them. The type is here for #61's reason and one of its own: a
 * provider is chosen partly on §9.3's R-06, and an interface that could not express
 * a partial refund would have hidden the requirement until the day somebody needed
 * one.
 *
 * @param reference what is being refunded: the pledge, or an unapplied plan payment (#457). Not sent
 *     to the provider; it names the refund in the platform's own logs
 * @param providerTransactionId the charge being reversed. <strong>The provider's
 *     identifier and not ours</strong>: a refund is submitted against the original
 *     authorisation, and the platform's own transaction identifier means nothing on
 *     the other side
 * @param amount how much. Equal to the charge for a full refund, less for a partial
 *     one — which §9.3's R-06 makes a capability rather than an assumption, so #67
 *     checks {@link ProviderCapabilities#partialRefund()} before building one of
 *     these for less than the whole
 * @param reasonCode why, for {@code transactions} and for the provider's own dispute
 *     record. <strong>A string and not an enum</strong>, deliberately: #67 owns the
 *     vocabulary of §9.7's five scenarios, and inventing it here — in the issue that
 *     is only supposed to settle the interface — would mean #67 either inherits a
 *     list nobody designed or changes a type four other calls depend on
 * @param idempotencyKey §9.3's R-08. It matters more here than on a charge: a
 *     duplicated refund is money leaving the platform twice, and unlike a duplicated
 *     charge nobody complains about it
 */
public record RefundRequest(
        UUID reference, String providerTransactionId, Money amount, String reasonCode, String idempotencyKey) {

    public RefundRequest {
        Objects.requireNonNull(reference, "A refund is a refund of something");
        Objects.requireNonNull(amount, "A refund needs an amount");
        if (providerTransactionId == null || providerTransactionId.isBlank()) {
            throw new IllegalArgumentException("A refund is submitted against the charge it reverses");
        }
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("A refund returns a positive amount, and this one is " + amount);
        }
        if (reasonCode == null || reasonCode.isBlank()) {
            throw new IllegalArgumentException("§9.8 records a reason code on every reversal");
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("§9.3's R-08 requires an idempotency key on every payment mutation");
        }
    }
}
