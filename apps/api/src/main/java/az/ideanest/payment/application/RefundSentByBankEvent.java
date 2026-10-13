package az.ideanest.payment.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * {@code refund.sent_by_bank} — issue #418: finance recorded the bank transfer that paid one part of a
 * backer's refund, and the backer is told. Recorded once per part, in the transaction that settles it;
 * a replay under the same reference answers before it is reached.
 *
 * @param amount what this transfer paid: the part's amount, not necessarily the pledge's whole refund
 * @param transferredOn the value date on the bank statement
 * @param ibanHint the masked hint of the account it went to ({@code AZ21…1944}). Never the number
 */
public record RefundSentByBankEvent(
        UUID refundId,
        UUID pledgeId,
        UUID projectId,
        UUID backerId,
        Money amount,
        LocalDate transferredOn,
        String ibanHint,
        Instant recordedAt) {

    public static final String AGGREGATE_TYPE = "pledge";
    public static final String EVENT_TYPE = "refund.sent_by_bank";
}
