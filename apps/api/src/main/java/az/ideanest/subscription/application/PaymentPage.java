package az.ideanest.subscription.application;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.PaymentMethod;
import az.ideanest.subscription.domain.SubscriptionPayment;
import az.ideanest.subscription.infrastructure.SubscriptionRevenueRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One page of the payment list — #23, and the one read three surfaces share.
 *
 * <p>The revenue report's table, the CSV export and the console's per-account history are
 * the same query with different bounds, which is why there is one of these rather than
 * three shapes that drift. A per-account history is this list filtered to one account over
 * a wide period; the export is this list taken to its cap.
 *
 * @param payments newest first, by when the money arrived
 * @param nextCursor what to hand back for the page after this one, or null at the end.
 *     Null rather than an empty string, and absent rather than a boolean: a client that
 *     asks "is there more" of a flag will keep asking after the flag lies to it once
 */
public record PaymentPage(List<Payment> payments, String nextCursor) {

    /**
     * One payment as a reader sees it.
     *
     * @param accountEmail the payer, when the platform still knows who they were. Null for
     *     a closed or anonymised account — V73 keeps no foreign key to {@code users}, on
     *     purpose, so that a receipt outlives the account that paid it. A row with a null
     *     address is a payment the platform genuinely took, not a gap, and leaving it out
     *     would under-report revenue by everybody who has since left
     * @param amount signed: negative on a reversing row
     * @param reverses the payment this one undoes, or null. What makes a negative row
     *     identifiable as a correction rather than as a payment somebody made backwards
     */
    public record Payment(
            UUID id,
            UUID subscriptionId,
            UUID accountId,
            String accountEmail,
            String accountName,
            UUID planId,
            String planCode,
            String planName,
            Money amount,
            BillingPeriod billingPeriod,
            PaymentMethod method,
            String reference,
            String note,
            Instant receivedAt,
            Instant recordedAt,
            UUID recordedBy,
            UUID reverses) {

        static Payment of(SubscriptionRevenueRepository.PaymentRow row) {
            return new Payment(
                    row.getId(),
                    row.getSubscriptionId(),
                    row.getAccountId(),
                    row.getAccountEmail(),
                    row.getAccountName(),
                    row.getPlanId(),
                    row.getPlanCode(),
                    row.getPlanName(),
                    Money.of(row.getAmount(), row.getCurrency()),
                    BillingPeriod.valueOf(row.getBillingPeriod()),
                    PaymentMethod.valueOf(row.getMethod()),
                    row.getReference(),
                    row.getNote(),
                    row.getReceivedAt(),
                    row.getRecordedAt(),
                    row.getRecordedBy(),
                    row.getReverses());
        }

        /**
         * One payment as the journal holds it, without the payer's name and address.
         *
         * <p>For the console's account page, which is already about one account and has its
         * name at the top: repeating it on every row would be the same fact twelve times, and
         * a second read of {@code users} to supply it would be a join that only ever
         * confirms what the page's own heading says.
         */
        static Payment recorded(SubscriptionPayment payment) {
            return new Payment(
                    payment.getId(),
                    payment.getSubscriptionId(),
                    payment.getAccountId(),
                    null,
                    null,
                    payment.getPlanId(),
                    payment.getPlanCode(),
                    payment.getPlanName(),
                    payment.getAmount(),
                    payment.getBillingPeriod(),
                    payment.getMethod(),
                    payment.getReference(),
                    payment.getNote(),
                    payment.getReceivedAt(),
                    payment.getRecordedAt(),
                    payment.getRecordedBy(),
                    payment.getReverses());
        }

        /** Whether this row undoes another. */
        public boolean isReversal() {
            return reverses != null;
        }
    }
}
