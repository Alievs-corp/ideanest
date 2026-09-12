package az.ideanest.subscription.application;

import java.time.Instant;

/**
 * A payment recorded as having arrived at an instant that has not happened.
 *
 * <p>Its own refusal rather than a clamp to now, because the two are not the same mistake
 * and only one of them is visible. {@code received_at} is what every total on V73's
 * journal is grouped by and it is deliberately backdatable — a transfer that cleared on
 * the 31st belongs in the month it cleared. The cost of that is a typed year: 2027 for
 * 2026 puts a payment into a period nobody will reconcile for twelve months, and it
 * disappears from the month it should have been in without anything looking wrong.
 *
 * <p>Silently moving it to now would hide the typo in the one column that cannot be
 * corrected afterwards — the row is append-only, so the fix is a reversal and a
 * re-entry rather than an edit. Refusing puts the question in front of the person who
 * still has the bank statement open.
 */
public class PaymentNotYetReceivedException extends RuntimeException {

    private final Instant receivedAt;

    public PaymentNotYetReceivedException(Instant receivedAt) {
        super("A payment cannot have been received at " + receivedAt + ", which is in the future");
        this.receivedAt = receivedAt;
    }

    public Instant receivedAt() {
        return receivedAt;
    }
}
