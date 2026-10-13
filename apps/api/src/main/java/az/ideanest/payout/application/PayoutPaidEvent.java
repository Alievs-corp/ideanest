package az.ideanest.payout.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * {@code payout.paid} — issue #418: a payout is {@code PAID}, by whichever route, and its creator is
 * told. Recorded once, in the transaction that marks it paid: a replayed or refused call never reaches
 * the line that records it.
 *
 * @param amount what left, the payout's net
 * @param paidOn the bank's value date for a bank transfer, otherwise the day (in Baku) it was sent or
 *     settled from the provider's statement
 * @param accountHint the masked hint of the account a bank transfer went to, or null. Never the number
 * @param bankTransfer whether a member of staff paid it from IdeyaNest's bank rather than a provider
 */
public record PayoutPaidEvent(
        UUID projectId,
        UUID creatorId,
        UUID payoutId,
        Money amount,
        LocalDate paidOn,
        String accountHint,
        boolean bankTransfer,
        Instant paidAt) {

    public static final String AGGREGATE_TYPE = "payout";
    public static final String EVENT_TYPE = "payout.paid";
}
