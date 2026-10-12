package az.ideanest.payment.api;

import az.ideanest.payment.application.RefundBankTransfers;
import az.ideanest.payment.domain.Dispute;
import az.ideanest.payment.domain.DisputeEvidence;
import az.ideanest.payment.domain.DisputeState;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundState;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * AD-06 and AD-07, as the service describes them — issues #307 and #308.
 *
 * <p>One file for both because the two screens are read together: a chargeback is often
 * answered by issuing a refund, and a refund carrying {@code DISPUTE_CONCEDED} is the
 * other end of a dispute. Splitting them would put two halves of one conversation in two
 * files that import each other.
 */
public final class PaymentAdminResponses {

    private PaymentAdminResponses() {
    }

    /**
     * One refund.
     *
     * <p>{@link Money} serialises as a string with its currency, per §10.3 and CLAUDE.md.
     * Nothing here is a JSON number.
     *
     * @param refundTransactionId the provider call that carried it out, null until there
     *     has been one and forever on a refund that failed before the provider answered
     * @param bankTransfer #399: the bank transfer that pays it, once support has recorded the
     *     account; null for every refund that goes through a provider
     */
    public record Refund(
            UUID id,
            UUID pledgeId,
            UUID projectId,
            UUID chargeTransactionId,
            UUID refundTransactionId,
            Money amount,
            boolean fullRefund,
            RefundReason reason,
            String detail,
            RefundState state,
            String failureCode,
            String failureMessage,
            UUID requestedBy,
            Instant requestedAt,
            Instant settledAt,
            BankTransfer bankTransfer) {

        public static Refund of(az.ideanest.payment.domain.Refund refund) {
            return of(refund, null);
        }

        public static Refund of(
                az.ideanest.payment.domain.Refund refund, az.ideanest.payment.domain.RefundBankTransfer bank) {
            return new Refund(
                    refund.id(),
                    refund.pledgeId(),
                    refund.projectId(),
                    refund.chargeTransactionId(),
                    refund.refundTransactionId(),
                    refund.amount(),
                    refund.fullRefund(),
                    refund.reason(),
                    refund.detail(),
                    refund.state(),
                    refund.failureCode(),
                    refund.failureMessage(),
                    refund.requestedBy(),
                    refund.requestedAt(),
                    refund.settledAt(),
                    bank == null ? null : BankTransfer.of(bank));
        }
    }

    /**
     * How a refund is paid by bank transfer — #399. The account's masked hint and never its number,
     * nor its holder's name: the list is {@code VIEW_FINANCE}'s, and the account is opened only
     * through the audited reveal.
     *
     * @param bankReference null until finance records the transfer, as are the three after it
     */
    public record BankTransfer(
            String ibanHint,
            UUID ticketId,
            UUID detailsRecordedBy,
            Instant detailsRecordedAt,
            String bankReference,
            LocalDate transferredOn,
            UUID transferRecordedBy,
            Instant transferRecordedAt) {

        static BankTransfer of(az.ideanest.payment.domain.RefundBankTransfer row) {
            return new BankTransfer(
                    row.ibanHint(),
                    row.ticketId(),
                    row.detailsRecordedBy(),
                    row.detailsRecordedAt(),
                    row.bankReference(),
                    row.transferredOn(),
                    row.transferRecordedBy(),
                    row.transferRecordedAt());
        }
    }

    /**
     * A backer's bank account, opened for the transfer that pays their refund — #399.
     *
     * @param iban the number in full, normalised
     * @param detailsRecordedBy who recorded it, and so who may not record the transfer
     */
    public record BankDetails(
            UUID refundId,
            UUID pledgeId,
            Money amount,
            String iban,
            String holderName,
            String ibanHint,
            UUID ticketId,
            UUID detailsRecordedBy) {

        public static BankDetails of(RefundBankTransfers.BankDetails details) {
            return new BankDetails(
                    details.refundId(),
                    details.pledgeId(),
                    details.amount(),
                    details.iban(),
                    details.holderName(),
                    details.ibanHint(),
                    details.ticketId(),
                    details.detailsRecordedBy());
        }

        @Override
        public String toString() {
            return "BankDetails[" + refundId + ", " + ibanHint + "]";
        }
    }

    /**
     * A page of refunds.
     *
     * @param hasMore whether another page exists, inferred from a full page rather than
     *     from a count. A {@code COUNT(*)} over a growing table to render a "next" button
     *     is a scan per page view; a full page means "ask for the next one and find out",
     *     which is the same information the reader actually acts on
     */
    public record RefundPage(List<Refund> refunds, int page, boolean hasMore) {

        public static RefundPage of(
                List<az.ideanest.payment.domain.Refund> refunds,
                Map<UUID, az.ideanest.payment.domain.RefundBankTransfer> bank,
                int page,
                int size) {
            return new RefundPage(
                    refunds.stream().map(refund -> Refund.of(refund, bank.get(refund.id()))).toList(),
                    page,
                    refunds.size() == size);
        }
    }

    /**
     * One chargeback.
     *
     * @param evidenceDueAt when the provider stops accepting evidence. The one field
     *     anybody is paged about, and null when the provider sends no deadline
     * @param fee what the provider charges for handling it, win or lose. Separate from the
     *     amount because it is the platform's cost rather than what the backer disputed
     */
    public record Dispute(
            UUID id,
            UUID chargeTransactionId,
            UUID pledgeId,
            UUID projectId,
            String provider,
            String providerDisputeId,
            Money amount,
            Money fee,
            String reasonCode,
            DisputeState state,
            Instant evidenceDueAt,
            Instant openedAt,
            Instant resolvedAt,
            UUID handledBy,
            List<Evidence> evidence) {

        public static Dispute of(az.ideanest.payment.domain.Dispute dispute, List<DisputeEvidence> evidence) {
            return new Dispute(
                    dispute.id(),
                    dispute.chargeTransactionId(),
                    dispute.pledgeId(),
                    dispute.projectId(),
                    dispute.provider().name(),
                    dispute.providerDisputeId(),
                    dispute.amount(),
                    dispute.fee(),
                    dispute.reasonCode(),
                    dispute.state(),
                    dispute.evidenceDueAt(),
                    dispute.openedAt(),
                    dispute.resolvedAt(),
                    dispute.handledBy(),
                    evidence.stream().map(Evidence::of).toList());
        }

        /** The list shape, which carries no evidence. */
        public static Dispute summary(az.ideanest.payment.domain.Dispute dispute) {
            return of(dispute, List.of());
        }
    }

    /** One piece of evidence. */
    public record Evidence(
            UUID id,
            String kind,
            String description,
            UUID mediaId,
            Instant submittedAt,
            String providerEvidenceId,
            Instant createdAt,
            UUID createdBy) {

        public static Evidence of(DisputeEvidence evidence) {
            return new Evidence(
                    evidence.id(),
                    evidence.kind().name(),
                    evidence.description(),
                    evidence.mediaId(),
                    evidence.submittedAt(),
                    evidence.providerEvidenceId(),
                    evidence.createdAt(),
                    evidence.createdBy());
        }
    }

    /** The dispute queue. Soonest deadline first — see V54's partial index. */
    public record DisputePage(List<Dispute> disputes, int page, boolean hasMore) {

        public static DisputePage of(
                List<az.ideanest.payment.domain.Dispute> disputes, int page, int size) {
            return new DisputePage(
                    disputes.stream().map(Dispute::summary).toList(), page, disputes.size() == size);
        }
    }
}
