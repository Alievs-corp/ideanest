package az.ideanest.payment.domain;

import az.ideanest.shared.money.Money;
import java.util.Objects;
import java.util.UUID;

/**
 * §9.5's last arrow, as an instruction: send the creator what is theirs.
 *
 * <p><strong>Nothing calls this today.</strong> Payouts are #69, and §6.3 puts a
 * fourteen-day hold and a dual approval in front of one. The type is here because
 * §9.4 names the call, and because §9.3's R-10 — split payment support — is a
 * decision about whether this call exists at all for a given provider, which is
 * easier to see when the call has a shape.
 *
 * @param payoutId the {@code payouts} row this executes. Carried so that the
 *     provider's reference and the platform's approval record name each other
 * @param creatorId who is being paid
 * @param amount the net, after §5.2's fees and #78's tax. The split itself is
 *     {@code ledger_entries}' and was decided at collection; this is one number
 * @param destinationReference where to: the provider's token for the creator's account.
 *     <strong>Opaque to this service</strong>, like {@link StoredCard#token()}. This
 *     once went on to say that the platform never stores an IBAN; since #394 it does —
 *     the owner decided creators are paid by bank transfer from IdeyaNest's own account,
 *     so the account is held in {@code payout_destinations}, encrypted (V97). Such a
 *     payout is made by a person and recorded, and never reaches a provider through this
 *     instruction, so an IBAN is never what this field carries
 * @param idempotencyKey §9.3's R-08, and here it is the difference between paying a
 *     creator once and twice
 */
public record PayoutRequest(
        UUID payoutId, UUID creatorId, Money amount, String destinationReference, String idempotencyKey) {

    public PayoutRequest {
        Objects.requireNonNull(payoutId, "A payout instruction executes a payouts row");
        Objects.requireNonNull(creatorId, "A payout is paid to somebody");
        Objects.requireNonNull(amount, "A payout needs an amount");
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("A payout sends a positive amount, and this one is " + amount);
        }
        if (destinationReference == null || destinationReference.isBlank()) {
            throw new IllegalArgumentException("A payout needs somewhere to go");
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("§9.3's R-08 requires an idempotency key on every payment mutation");
        }
    }

    /** The instruction, with the destination unreadable. What a log line is allowed to contain. */
    @Override
    public String toString() {
        return "PayoutRequest[payoutId=" + payoutId + ", creatorId=" + creatorId + ", amount=" + amount
                + ", destination=<redacted>]";
    }
}
