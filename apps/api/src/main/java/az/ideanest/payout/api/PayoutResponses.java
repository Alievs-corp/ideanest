package az.ideanest.payout.api;

import az.ideanest.payout.application.PayoutService;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutApproval;
import az.ideanest.payout.domain.PayoutState;
import az.ideanest.shared.compliance.DestinationKind;
import az.ideanest.shared.compliance.DestinationStanding;
import az.ideanest.shared.compliance.VerificationStanding;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * AD-05's payout queue, as the service describes it — issues #69 and #306.
 */
public final class PayoutResponses {

    private PayoutResponses() {
    }

    /**
     * One payout, with every figure that produced it.
     *
     * <p><strong>The whole breakdown travels, not just the net.</strong> This is the
     * screen where somebody signs off money leaving the platform, and a single figure with
     * a note saying "fees deducted" is not something anybody can check. The five numbers
     * add up in front of the reader.
     *
     * <p>Every amount is a {@link Money}, which serialises as a string with its currency
     * per §10.3 — CLAUDE.md, and the reason the frontend uses {@code decimal.js}.
     *
     * @param payableNow whether the hold has expired, computed against the server's clock.
     *     Sent rather than left to the browser: a client comparing {@code payableAt} to its
     *     own clock would show a payout as approvable a few seconds early or late, and the
     *     service would then refuse a button that looked enabled
     * @param feeScheduleId which terms produced the deductions, so the arithmetic can be
     *     traced back. Null only for a payout priced when no schedule was configured
     * @param destinationKind which route the creator is paid by (#397): a provider's token is sent,
     *     an IBAN is transferred by hand. Null when the creator has filed nothing
     * @param bankTransferStartedAt when a member of staff started paying this by bank transfer, and
     *     {@code bankTransferStartedBy} who. Set on an {@code APPROVED} payout while the transfer is
     *     in progress, and kept once it is recorded
     * @param bankTransferredOn the value date of the transfer that paid it, from the statement
     * @param debtWithheld what was kept back towards the creator's debts (IDN-EXT-01, #43). Sent so the
     *     breakdown adds up on the screen: gross less fees, refunds, tax and this is the net
     * @param sendUnconfirmedAt when a send through the provider went unanswered, so the money may have
     *     moved. Null otherwise. The console offers the two resolutions from the provider's statement
     */
    public record PayoutSummary(
            UUID id,
            UUID projectId,
            UUID creatorId,
            Money gross,
            Money platformFee,
            Money processingFee,
            Money taxWithheld,
            Money debtWithheld,
            Money refunded,
            Money net,
            UUID feeScheduleId,
            PayoutState state,
            Instant payableAt,
            boolean payableNow,
            short approvalsRequired,
            UUID payoutTransactionId,
            String failureCode,
            String failureMessage,
            Instant calculatedAt,
            Instant sentAt,
            Instant sendUnconfirmedAt,
            VerificationStanding creatorStanding,
            boolean heldForVerification,
            DestinationStanding destinationStanding,
            boolean heldForDestination,
            DestinationKind destinationKind,
            Instant bankTransferStartedAt,
            UUID bankTransferStartedBy,
            LocalDate bankTransferredOn) {

        /**
         * @param standing where the creator stands with identity verification (#431). Drawn on
         *     AD-05 rather than left for the operator to infer: a payout that will not approve
         *     and does not say why "makes the same campaign look as though nothing is owed"
         * @param destination where the creator stands with a payout destination (#432). A
         *     second value beside the first rather than one merged "held" flag, because the two
         *     are chased differently: an identity standing waits on a document queue, and a
         *     destination standing waits on a creator filing an account or a reviewer looking
         *     at one. An operator shown a single flag would not know which screen to open
         * @param kind which route the creator is paid by (#397), or null when nothing is filed
         */
        public static PayoutSummary of(
                Payout payout,
                Instant now,
                VerificationStanding standing,
                DestinationStanding destination,
                DestinationKind kind) {
            return new PayoutSummary(
                    payout.id(),
                    payout.projectId(),
                    payout.creatorId(),
                    payout.gross(),
                    payout.platformFee(),
                    payout.processingFee(),
                    payout.taxWithheld(),
                    payout.debtWithheld(),
                    payout.refunded(),
                    payout.net(),
                    payout.feeScheduleId(),
                    payout.state(),
                    payout.payableAt(),
                    payout.isPayableAt(now),
                    payout.approvalsRequired(),
                    payout.payoutTransactionId(),
                    payout.failureCode(),
                    payout.failureMessage(),
                    payout.calculatedAt(),
                    payout.sentAt(),
                    payout.sendUnconfirmedSince(),
                    standing,
                    !standing.releasesPayout() && payout.state().isInFlight(),
                    destination,
                    !destination.releasesPayout() && payout.state().isInFlight(),
                    kind,
                    payout.bankTransferStartedAt(),
                    payout.bankTransferStartedBy(),
                    payout.bankTransferredOn());
        }
    }

    /**
     * A bank transfer in progress, with everything the person making it types into the bank — #397.
     *
     * <p><strong>The one response that carries a creator's account number in full</strong>, to a
     * member of staff about to pay into it, and only after {@code PayoutDestinations.revealBankAccount}
     * has audited the opening. {@code no-store} like every response here; never logged.
     *
     * @param iban the account to pay into, normalised: upper case, no spaces
     * @param holderName who holds it, as matched against the creator's legal name
     * @param accountHint the masked form, for the screen that lists it afterwards
     * @param amount what to transfer: the payout's net, as a string with its currency
     * @param description what to write as the transfer's payment description, so the statement names
     *     the payout it paid
     */
    public record BankTransferInstruction(
            PayoutSummary payout,
            String iban,
            String holderName,
            String accountHint,
            Money amount,
            String description) {

        public static BankTransferInstruction of(
                PayoutService.BankTransfer transfer,
                Instant now,
                VerificationStanding standing,
                DestinationStanding destination,
                DestinationKind kind) {
            return new BankTransferInstruction(
                    PayoutSummary.of(transfer.payout(), now, standing, destination, kind),
                    transfer.account().iban(),
                    transfer.account().holderName(),
                    transfer.account().displayHint(),
                    transfer.payout().net(),
                    transfer.description());
        }

        /** Never the number: a response logged by accident must not put an IBAN in a log. */
        @Override
        public String toString() {
            return "BankTransferInstruction[" + payout.id() + ", " + accountHint + "]";
        }
    }

    /** One signature. */
    public record Approval(UUID approverId, Instant approvedAt, String note) {

        public static Approval of(PayoutApproval approval) {
            return new Approval(approval.approverId(), approval.approvedAt(), approval.note());
        }
    }

    /**
     * A payout and who has signed it.
     *
     * @param stillNeeded how many more signatures it needs. Sent rather than derived,
     *     because deriving it means the browser holding V55's rule about who may sign — and
     *     the browser cannot see that two rows are two different people
     */
    public record PayoutFile(PayoutSummary payout, List<Approval> approvals, long stillNeeded) {

        public static PayoutFile of(
                PayoutService.PayoutFile file,
                Instant now,
                VerificationStanding standing,
                DestinationStanding destination,
                DestinationKind kind) {
            return new PayoutFile(
                    PayoutSummary.of(file.payout(), now, standing, destination, kind),
                    file.approvals().stream().map(Approval::of).toList(),
                    file.stillNeeded());
        }
    }

    /** A page of payouts. */
    public record PayoutPage(List<PayoutSummary> payouts, int page, boolean hasMore) {

        /**
         * @param standings one entry per distinct creator on the page (#431). A map rather than
         *     a lookup per row, because a page is fifty payouts and a handful of creators
         * @param destinations the same, for #432's destination standing. Two maps rather than
         *     one of pairs, because the two are read from different modules and a page where
         *     one of them was cheap should not pay for the other
         * @param kinds which route each creator is paid by (#397); absent for one who filed nothing
         */
        public static PayoutPage of(
                List<Payout> payouts,
                int page,
                int size,
                Instant now,
                Map<UUID, VerificationStanding> standings,
                Map<UUID, DestinationStanding> destinations,
                Map<UUID, DestinationKind> kinds) {
            return new PayoutPage(
                    payouts.stream()
                            .map(payout -> PayoutSummary.of(
                                    payout,
                                    now,
                                    standings.getOrDefault(payout.creatorId(), VerificationStanding.NOT_REQUIRED),
                                    destinations.getOrDefault(payout.creatorId(), DestinationStanding.NONE),
                                    kinds.get(payout.creatorId())))
                            .toList(),
                    page,
                    payouts.size() == size);
        }
    }
}
