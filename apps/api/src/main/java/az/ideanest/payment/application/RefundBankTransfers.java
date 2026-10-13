package az.ideanest.payment.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.payment.application.BankRefundRefusedException.Reason;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundBankTransfer;
import az.ideanest.payment.domain.RefundState;
import az.ideanest.payment.infrastructure.DisputeRepository;
import az.ideanest.payment.infrastructure.RefundBankTransferRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.pledge.application.PledgeRefunds;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.compliance.BankAccountNumbers;
import az.ideanest.shared.compliance.CheckedIban;
import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.FieldCipherConfiguration;
import az.ideanest.shared.crypto.Sealed;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Refunds paid by bank transfer, because the provider's refund window had closed — issue #399.
 *
 * <h2>Three people, in order</h2>
 *
 * <ol>
 *   <li><strong>The platform</strong> routes the refund ({@code RefundService#send}): past the window,
 *       or refused by the provider as too old, it is {@code AWAITING_BANK_DETAILS} and the backer is told
 *       to contact support. Staff can route a refusal the adapter did not recognise by hand
 *       ({@link #routeRefused}).
 *   <li><strong>Support</strong> ({@code HANDLE_SUPPORT}) records the account the backer named, from the
 *       ticket they raised ({@link #recordBankDetails}). Every part of the pledge's refund waiting for it
 *       is then {@code AWAITING_TRANSFER}.
 *   <li><strong>Finance</strong> ({@code ISSUE_REFUND}) opens the account ({@link #reveal}), makes the
 *       transfer from IdeyaNest's own bank account, and records it with the bank's reference
 *       ({@link #recordTransfer}). That settles the refund like any other.
 * </ol>
 *
 * <p>The second and the third are two people: whoever wrote down where the money goes does not also
 * say it went. And the third waits while the charge is in an open chargeback, because the network may
 * return the money itself.
 *
 * <p><strong>The IBAN is any country's</strong>, checked through {@link BankAccountNumbers} — the same
 * check a creator's account goes through, without the restriction to Azerbaijan. It is sealed under
 * the {@code bank-details} keyring, bound to its refund, and leaves only through {@link #reveal}, which
 * is audited. Logs and audit rows carry the masked hint.
 */
@Service
public class RefundBankTransfers {

    private static final Logger log = LoggerFactory.getLogger(RefundBankTransfers.class);

    private final RefundRepository refunds;
    private final RefundBankTransferRepository bankTransfers;
    private final DisputeRepository disputes;
    private final RefundRecords records;
    private final PledgeRefunds pledges;
    private final BankAccountNumbers ibans;
    private final FieldCipher bankDetails;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public RefundBankTransfers(
            RefundRepository refunds,
            RefundBankTransferRepository bankTransfers,
            DisputeRepository disputes,
            RefundRecords records,
            PledgeRefunds pledges,
            BankAccountNumbers ibans,
            @Qualifier(FieldCipherConfiguration.BANK_DETAILS) FieldCipher bankDetails,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock) {
        this.refunds = refunds;
        this.bankTransfers = bankTransfers;
        this.disputes = disputes;
        this.records = records;
        this.pledges = pledges;
        this.ibans = ibans;
        this.bankDetails = bankDetails;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Support records the account a backer's refund is paid into, from the ticket the backer raised.
     *
     * <p>Applies to every part of the pledge's refund that waits for a bank transfer: the parts waiting
     * for an account move to {@code AWAITING_TRANSFER}, and a part already waiting for the transfer has
     * its account replaced — the backer corrected it — which the audit row says. Each part's IBAN is
     * sealed on its own, bound to that part.
     *
     * @return the parts, oldest first
     * @throws az.ideanest.shared.compliance.UnacceptableIbanException when the number is not an IBAN
     * @throws BankRefundRefusedException {@code SUPPORT_TICKET_NOT_FROM_BACKER} for a ticket the pledge's
     *     backer did not raise, and {@code NO_REFUND_AWAITING_BANK_DETAILS} when nothing waits
     * @throws az.ideanest.shared.crypto.FieldEncryptionNotConfiguredException when the keyring has no key
     */
    @Transactional
    public List<Refund> recordBankDetails(
            UUID staffId, UUID pledgeId, String typedIban, String holderName, UUID ticketId) {
        staff.requireCapability(staffId, StaffCapability.HANDLE_SUPPORT);
        CheckedIban iban = ibans.check(typedIban);
        if (!bankTransfers.ticketIsFromBackerOf(ticketId, pledgeId)) {
            throw new BankRefundRefusedException(Reason.SUPPORT_TICKET_NOT_FROM_BACKER, ticketId);
        }
        pledges.lock(pledgeId);
        List<Refund> waiting = refunds.awaitingBankTransferOn(pledgeId);
        if (waiting.isEmpty()) {
            throw new BankRefundRefusedException(Reason.NO_REFUND_AWAITING_BANK_DETAILS, pledgeId);
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        String holder = holderName.trim();
        byte[] plain = iban.value().getBytes(StandardCharsets.UTF_8);
        for (Refund part : waiting) {
            Sealed sealed = bankDetails.seal(plain, RefundBankTransfer.context(part.id()));
            RefundBankTransfer existing = bankTransfers.findById(part.id()).orElse(null);
            String previous = existing == null ? null : existing.ibanHint();
            if (existing == null) {
                bankTransfers.save(RefundBankTransfer.recorded(
                        part.id(), sealed, iban.displayHint(), holder, ticketId, staffId, now));
            } else {
                existing.replaceDetails(sealed, iban.displayHint(), holder, ticketId, staffId, now);
                bankTransfers.save(existing);
            }
            if (part.state() == RefundState.AWAITING_BANK_DETAILS) {
                part.awaitTransfer();
                refunds.save(part);
            }
            audit.record(
                    AuditAction.REFUND_BANK_DETAILS_RECORDED,
                    part.id(),
                    AuditActor.moderator(staffId),
                    AuditOutcome.SUCCEEDED,
                    "pledge=%s; account=%s; holder=%s; ticket=%s; replaced=%s"
                            .formatted(pledgeId, iban.displayHint(), holder, ticketId, previous == null ? "none" : previous));
        }
        log.info("Bank account {} recorded for {} refund parts of pledge {} by {}", iban.displayHint(), waiting.size(), pledgeId, staffId);
        return refunds.awaitingBankTransferOn(pledgeId);
    }

    /**
     * The backer's account in full, for the member of finance about to pay into it. Audited whether or
     * not it opens, with the hint and never the number.
     *
     * @throws BankRefundRefusedException {@code REFUND_NOT_AWAITING_TRANSFER} when no account is on file
     *     or the refund is already paid, and {@code REFUND_CHARGE_DISPUTED} during an open chargeback
     */
    @Transactional
    public BankDetails reveal(UUID staffId, UUID refundId) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        Refund refund = refunds.findById(refundId)
                .orElseThrow(() -> new BankRefundRefusedException(Reason.REFUND_NOT_FOUND, refundId));
        RefundBankTransfer row = bankTransfers.findById(refundId)
                .filter(found -> refund.state() == RefundState.AWAITING_TRANSFER)
                .orElseThrow(() -> new BankRefundRefusedException(Reason.REFUND_NOT_AWAITING_TRANSFER, refundId));
        if (refund.chargeTransactionId() != null && disputes.openOnCharge(refund.chargeTransactionId())) {
            throw new BankRefundRefusedException(Reason.REFUND_CHARGE_DISPUTED, refundId);
        }
        audit.record(
                AuditAction.REFUND_BANK_DETAILS_REVEALED,
                refundId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "pledge=%s; account=%s; amount=%s".formatted(refund.pledgeId(), row.ibanHint(), refund.amount()));
        byte[] plain = bankDetails.open(row.sealedIban(), RefundBankTransfer.context(refundId));
        log.info("Bank account {} of refund {} opened by {}", row.ibanHint(), refundId, staffId);
        return new BankDetails(
                refund.id(),
                refund.pledgeId(),
                refund.amount(),
                new String(plain, StandardCharsets.UTF_8),
                row.holderName(),
                row.ibanHint(),
                row.ticketId(),
                row.detailsRecordedBy());
    }

    /**
     * Finance made the transfer. Settles the refund as {@code RefundRecords#settleByBankTransfer} says,
     * and replays: the same reference again answers the settled refund.
     */
    public Refund recordTransfer(
            UUID staffId, UUID refundId, String bankReference, LocalDate transferredOn, BigDecimal bankFee) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        Objects.requireNonNull(bankReference, "bankReference");
        Objects.requireNonNull(transferredOn, "transferredOn");
        return records.settleByBankTransfer(staffId, refundId, bankReference, transferredOn, bankFee);
    }

    /**
     * Staff route a refund the provider refused to a bank transfer: a new refund for what its charge has
     * left, waiting for the backer's account. Replays under {@code bank-refund:<refusedId>}.
     */
    public Refund routeRefused(UUID staffId, UUID refusedId) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        return records.bankRefundFor(staffId, refusedId);
    }

    /** The bank-transfer rows of these refunds, by refund, for the console's list. */
    @Transactional(readOnly = true)
    public Map<UUID, RefundBankTransfer> of(Collection<Refund> listed) {
        List<UUID> ids = listed.stream()
                .filter(refund -> refund.state().awaitsBankTransfer() || refund.state() == RefundState.SUCCEEDED)
                .map(Refund::id)
                .toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return bankTransfers.findAllById(ids).stream()
                .collect(Collectors.toMap(RefundBankTransfer::refundId, Function.identity()));
    }

    /**
     * A backer's bank account, opened for a transfer.
     *
     * @param iban the number in full, normalised. Never logged; {@link #toString} shows the hint
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

        @Override
        public String toString() {
            return "BankDetails[" + refundId + ", " + ibanHint + "]";
        }
    }
}
