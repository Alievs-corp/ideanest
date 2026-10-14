package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * One of a backer's own pledges, as §4.8's list shows it — {@code GET /v1/me/pledges}.
 *
 * <p><strong>Not {@link PledgeDetail}, and the difference is what a list may cost.</strong>
 * That record is one pledge in full: the entity, its add-on lines, and §4.8's supplements,
 * each of them its own read. A page of twenty would be forty extra queries to render twenty
 * rows a backer is scrolling past. This is the projection a row needs, and the add-ons and
 * supplements stay where they already are — {@code GET /v1/pledges/{id}}, which is what a
 * client opens when the backer taps one.
 *
 * <p><strong>Every amount, though, and not just the total.</strong> The five §7.2 stores
 * plus the generated total, exactly as {@code PledgeResponse.Amounts} serves them, because
 * a list showing one number is a list a backer cannot reconcile against their card
 * statement — and because the alternative, showing the total alone, is the shape that makes
 * somebody add up the parts by hand and find they do not match. They are on the row already;
 * carrying them costs nothing.
 *
 * <p><strong>No backer identifier.</strong> There is only ever one, it is the caller, and a
 * response that echoed it back would be the one field a future endpoint could be tempted to
 * filter on from the request.
 *
 * @param state one of §6.2's twelve, by name
 * @param rewardTierId null on §4.5's PL-02, support with no reward
 * @param anonymous §4.5's PL-12, as the backer set it. On their own list because it is the
 *     only place they can check what they chose — the public archive shows this pledge to
 *     nobody when it is true, and a setting whose effect is invisible is a setting nobody
 *     trusts
 * @param createdAt when the pledge was made. The key {@link BackerCursor} pages on, and it
 *     is not serialised: {@code confirmedAt} is the date a backer means, and a draft that
 *     was never confirmed has no date worth showing
 * @param refundAwaitingBankTransfer #419: what of this pledge's refund waits to be paid by bank
 *     transfer, or null — the figure {@code PledgeDetail} carries, so the list can say a refund is
 *     pending without the backer opening every pledge to find out which one
 * @param refunded #436: what of this pledge has gone back to the backer, as sent, or null —
 *     {@code PledgeDetail}'s figure
 * @param refundWithheldFee #436: the payment provider's fee its refund keeps back, or null —
 *     {@code PledgeDetail}'s figure
 */
public record BackerPledge(
        UUID id,
        UUID projectId,
        String state,
        UUID rewardTierId,
        Money base,
        Money addons,
        Money bonus,
        Money shipping,
        Money tax,
        Money total,
        boolean anonymous,
        Instant confirmedAt,
        Instant canceledAt,
        Instant createdAt,
        Money refundAwaitingBankTransfer,
        Money refunded,
        Money refundWithheldFee) {
}
