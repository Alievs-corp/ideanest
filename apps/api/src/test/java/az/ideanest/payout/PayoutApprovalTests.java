package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payment.domain.Dispute;
import az.ideanest.payment.domain.DisputeState;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundState;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutState;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The state machines behind money leaving the platform — issues #67, #68, #69.
 *
 * <p>CLAUDE.md: "money arithmetic, state transitions, idempotency and stock reservation are
 * not optional to test". These are the transitions. Each one is a rule that is invisible
 * when it is right and expensive when it is wrong — a payout that could be sent twice, a
 * refund that could be retried on a row that already settled, a dispute whose resolution
 * date survived it being reopened.
 *
 * <p>Plain unit tests over the entities. What the database enforces is asserted by the
 * schema suites; this is the half that fails at the call site, where a reader can see which
 * line was wrong.
 */
class PayoutApprovalTests {

    private static final Money HUNDRED = Money.of(new BigDecimal("100.00"), "AZN");

    private static final Money FIVE = Money.of(new BigDecimal("5.00"), "AZN");

    private static Payout payout(short approvalsRequired, Instant payableAt) {
        return Payout.calculated(
                UUID.randomUUID(),
                UUID.randomUUID(),
                HUNDRED,
                FIVE,
                FIVE,
                Money.zero("AZN"),
                Money.of(new BigDecimal("90.00"), "AZN"),
                UUID.randomUUID(),
                payableAt,
                approvalsRequired,
                "payout-key-" + UUID.randomUUID());
    }

    @Test
    @DisplayName("a payout starts calculated and held, not waiting for a signature")
    void startsHeld() {
        Payout fresh = payout((short) 2, Instant.parse("2026-12-01T00:00:00Z"));

        // The two states are separate so that the screen can show what is owed and when it
        // becomes payable. Collapsing them would either hide the figure for the length of the
        // hold or ask for a signature that cannot yet be given.
        assertThat(fresh.state()).isEqualTo(PayoutState.CALCULATED);
        assertThat(fresh.isPayableAt(Instant.parse("2026-11-30T23:59:59Z"))).isFalse();
        assertThat(fresh.isPayableAt(Instant.parse("2026-12-01T00:00:00Z"))).isTrue();
    }

    @Test
    @DisplayName("the hold expiring moves it to waiting, and only from calculated")
    void payableOnlyMovesFromCalculated() {
        Payout held = payout((short) 1, Instant.parse("2026-01-01T00:00:00Z"));
        held.payable();
        assertThat(held.state()).isEqualTo(PayoutState.PENDING_APPROVAL);

        held.approved();
        held.payable();

        // An approved payout must not fall back to waiting because somebody listed the queue
        // again. `payable` is called by the read that lists it, so it has to be a no-op on
        // everything except a held one.
        assertThat(held.state()).isEqualTo(PayoutState.APPROVED);
    }

    @Test
    @DisplayName("an approved payout goes back to waiting explicitly, and refuses anything else")
    void backToPendingApprovalAssertsTheStateItIsHanded() {
        Payout signed = payout((short) 2, Instant.parse("2026-01-01T00:00:00Z"));
        signed.payable();
        signed.approved();

        signed.backToPendingApproval();
        assertThat(signed.state()).isEqualTo(PayoutState.PENDING_APPROVAL);

        /*
         * Issue #398. The withdrawal path used `payable()` for this, and `payable()` is a
         * no-op from APPROVED by design — the test above asserts that it is — so the guard
         * that called it did nothing and the payout stayed APPROVED with one signature of
         * two. The transition the withdrawal needs is a different transition, and it is
         * total: it moves an approved payout back, and it throws on everything else rather
         * than returning quietly. A method that ignores the state it is handed cannot be
         * relied on by a caller, and the money is gated on this one.
         */
        assertThatThrownBy(signed::backToPendingApproval)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PENDING_APPROVAL");

        Payout held = payout((short) 2, Instant.parse("2026-01-01T00:00:00Z"));
        assertThatThrownBy(held::backToPendingApproval).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("only a payout that has been sent carries a transaction and a sent-at")
    void paidCarriesItsTransaction() {
        Payout sending = payout((short) 1, Instant.parse("2026-01-01T00:00:00Z"));
        assertThat(sending.payoutTransactionId()).isNull();
        assertThat(sending.sentAt()).isNull();

        UUID transaction = UUID.randomUUID();
        Instant at = Instant.parse("2026-02-01T00:00:00Z");
        sending.paid(transaction, at);

        // V55 pairs these by constraint. Setting them together in one method is what stops a
        // caller writing one and forgetting the other.
        assertThat(sending.state()).isEqualTo(PayoutState.PAID);
        assertThat(sending.payoutTransactionId()).isEqualTo(transaction);
        assertThat(sending.sentAt()).isEqualTo(at);
        assertThat(sending.failureCode()).isNull();
    }

    @Test
    @DisplayName("a failed payout says why and is terminal")
    void failedSaysWhy() {
        Payout failing = payout((short) 1, Instant.parse("2026-01-01T00:00:00Z"));
        failing.failed("insufficient_funds", "The account could not be credited", Instant.now());

        assertThat(failing.state()).isEqualTo(PayoutState.FAILED);
        assertThat(failing.failureCode()).isEqualTo("insufficient_funds");
        assertThat(failing.state().isInFlight()).isFalse();
    }

    @Test
    @DisplayName("#184's review: a send the provider never answered leaves the payout approved, not failed")
    void anUnansweredSendStaysApproved() {
        Payout sending = payout((short) 1, Instant.parse("2026-01-01T00:00:00Z"));
        assertThatThrownBy(() -> sending.sendUnconfirmedAt(Instant.now())).isInstanceOf(IllegalStateException.class);
        sending.payable();
        sending.approved();

        sending.sendUnconfirmedAt(Instant.parse("2026-02-01T00:00:00Z"));

        // Failed, it would be priced again under a new key beside an instruction that may have moved money.
        assertThat(sending.state()).isEqualTo(PayoutState.APPROVED);
        assertThat(sending.sendUnconfirmed()).isTrue();
        assertThat(sending.failureCode()).isNull();
        assertThat(sending.sentAt()).isNull();
    }

    @Test
    @DisplayName("#184's review: a payout wholly withheld towards debts is paid with nothing sent, and nothing else is")
    void onlyAWhollyWithheldPayoutSettlesAgainstDebts() {
        Payout withheld = payout((short) 1, Instant.parse("2026-01-01T00:00:00Z"));
        withheld.withholdDebt(Money.of(new BigDecimal("90.00"), "AZN"));
        Instant at = Instant.parse("2026-02-01T00:00:00Z");

        withheld.settledAgainstDebts(at);

        assertThat(withheld.state()).isEqualTo(PayoutState.PAID);
        assertThat(withheld.net().amount()).isEqualByComparingTo("0.00");
        assertThat(withheld.sentAt()).isEqualTo(at);
        assertThat(withheld.payoutTransactionId()).isNull();

        Payout partly = payout((short) 1, Instant.parse("2026-01-01T00:00:00Z"));
        partly.withholdDebt(FIVE);
        assertThatThrownBy(() -> partly.settledAgainstDebts(at)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> payout((short) 1, at).settledAgainstDebts(at)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("only the three in-flight states are in flight")
    void inFlightIsTheThreeThatCanStillMove() {
        // V55's partial unique index permits one in-flight payout per campaign, and this is
        // the set it is built from. A state drifting into or out of it silently changes how
        // many payouts a campaign may have at once.
        assertThat(PayoutState.CALCULATED.isInFlight()).isTrue();
        assertThat(PayoutState.PENDING_APPROVAL.isInFlight()).isTrue();
        assertThat(PayoutState.APPROVED.isInFlight()).isTrue();

        assertThat(PayoutState.PAID.isInFlight()).isFalse();
        assertThat(PayoutState.FAILED.isInFlight()).isFalse();
        assertThat(PayoutState.CANCELLED.isInFlight()).isFalse();
    }

    @Test
    @DisplayName("a refund settles once, and a failure says why")
    void refundSettlesOnce() {
        Refund refund = Refund.requested(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                Money.of(new BigDecimal("25.00"), "AZN"),
                false,
                RefundReason.BACKER_REQUEST,
                "They asked before it shipped",
                UUID.randomUUID(),
                "refund-key");

        assertThat(refund.state()).isEqualTo(RefundState.REQUESTED);
        assertThat(refund.settledAt()).isNull();

        UUID transaction = UUID.randomUUID();
        Instant at = Instant.parse("2026-03-01T00:00:00Z");
        refund.succeeded(transaction, at);

        assertThat(refund.state()).isEqualTo(RefundState.SUCCEEDED);
        assertThat(refund.refundTransactionId()).isEqualTo(transaction);
        assertThat(refund.settledAt()).isEqualTo(at);
        // A settled refund carries no failure. V53 has the same rule as a CHECK, and this is
        // the half that catches it where the mistake is made.
        assertThat(refund.failureCode()).isNull();
    }

    @Test
    @DisplayName("a dispute reopened for a second presentment forgets it was resolved")
    void reopeningClearsTheResolution() {
        Dispute dispute = Dispute.notified(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                ProviderName.PAYRIFF,
                "case-1",
                HUNDRED,
                FIVE,
                "FRAUD",
                Instant.parse("2026-04-01T00:00:00Z"),
                Instant.parse("2026-03-01T00:00:00Z"));

        assertThat(dispute.state()).isEqualTo(DisputeState.OPEN);
        assertThat(dispute.resolvedAt()).isNull();

        dispute.resolved(DisputeState.LOST, UUID.randomUUID(), Instant.parse("2026-04-02T00:00:00Z"));
        assertThat(dispute.resolvedAt()).isNotNull();

        dispute.reopened(Instant.parse("2026-05-01T00:00:00Z"));

        // The cycle DisputeState describes. V54 pairs the resolution date with the terminal
        // states, so an open dispute carrying one from last time would fail to commit.
        assertThat(dispute.state()).isEqualTo(DisputeState.OPEN);
        assertThat(dispute.resolvedAt()).isNull();
    }

    @Test
    @DisplayName("a dispute cannot be resolved as a state that is not an outcome")
    void onlyOutcomesResolve() {
        Dispute dispute = Dispute.notified(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                ProviderName.EPOINT,
                "case-2",
                HUNDRED,
                Money.zero("AZN"),
                "PRODUCT_NOT_RECEIVED",
                null,
                Instant.parse("2026-03-01T00:00:00Z"));

        assertThatThrownBy(() -> dispute.resolved(DisputeState.OPEN, UUID.randomUUID(), Instant.now()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () -> dispute.resolved(DisputeState.UNDER_REVIEW, UUID.randomUUID(), Instant.now()))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(DisputeState.WON.isResolved()).isTrue();
        assertThat(DisputeState.LOST.isResolved()).isTrue();
        assertThat(DisputeState.CONCEDED.isResolved()).isTrue();
        assertThat(DisputeState.OPEN.isResolved()).isFalse();
    }
}
