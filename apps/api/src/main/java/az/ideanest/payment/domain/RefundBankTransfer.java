package az.ideanest.payment.domain;

import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.Sealed;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/**
 * A refund paid by bank transfer, because the provider's refund window had closed — V99's row,
 * issue #399.
 *
 * <p>Two halves written by two people. Support records where the money goes —
 * {@link #recorded}, or {@link #replaceDetails} when the backer corrects it — from a support
 * conversation, and finance records that it went, with the bank's reference ({@link #transferred}).
 * V99 refuses a row whose two halves name the same person; {@code RefundBankTransfers} refuses it
 * first, with a reason a person can read.
 *
 * <p><strong>The IBAN is sealed</strong> under the {@code bank-details} keyring, bound to this
 * refund by {@link #context}, and is opened only through an audited reveal. {@link #ibanHint} is
 * what everything else shows.
 */
@Entity
@Table(name = "refund_bank_transfers")
public class RefundBankTransfer {

    private static final String TABLE = "refund_bank_transfers";

    @Id
    @Column(name = "refund_id", nullable = false, updatable = false)
    private UUID refundId;

    @Column(name = "iban_ciphertext", nullable = false)
    private byte[] ibanCiphertext;

    @Column(name = "iban_nonce", nullable = false)
    private byte[] ibanNonce;

    @Column(name = "iban_key_id", nullable = false)
    private String ibanKeyId;

    @Column(name = "iban_hint", nullable = false)
    private String ibanHint;

    @Column(name = "holder_name", nullable = false)
    private String holderName;

    @Column(name = "ticket_id", nullable = false)
    private UUID ticketId;

    @Column(name = "details_recorded_by", nullable = false)
    private UUID detailsRecordedBy;

    @Column(name = "details_recorded_at", nullable = false)
    private Instant detailsRecordedAt;

    @Column(name = "bank_reference")
    private String bankReference;

    @Column(name = "transferred_on")
    private LocalDate transferredOn;

    @Column(name = "transfer_recorded_by")
    private UUID transferRecordedBy;

    @Column(name = "transfer_recorded_at")
    private Instant transferRecordedAt;

    protected RefundBankTransfer() {
        // Hibernate.
    }

    /**
     * The additional authenticated data the IBAN of this refund is sealed under: the table and the
     * refund's id, so a ciphertext copied onto another refund does not open.
     */
    public static String context(UUID refundId) {
        return FieldCipher.rowContext(TABLE, refundId);
    }

    /** Support recorded the backer's account against this refund. */
    public static RefundBankTransfer recorded(
            UUID refundId, Sealed iban, String ibanHint, String holderName, UUID ticketId, UUID recordedBy, Instant at) {
        RefundBankTransfer row = new RefundBankTransfer();
        row.refundId = Objects.requireNonNull(refundId, "refundId");
        row.details(iban, ibanHint, holderName, ticketId, recordedBy, at);
        return row;
    }

    /**
     * The backer named another account before the transfer was made. Refused once it was made:
     * the account a backer was paid into is history, not a setting.
     */
    public void replaceDetails(
            Sealed iban, String ibanHint, String holderName, UUID ticketId, UUID recordedBy, Instant at) {
        if (isTransferred()) {
            throw new IllegalStateException("The account a refund was paid into is not replaced");
        }
        details(iban, ibanHint, holderName, ticketId, recordedBy, at);
    }

    private void details(
            Sealed iban, String ibanHint, String holderName, UUID ticketId, UUID recordedBy, Instant at) {
        this.ibanCiphertext = Objects.requireNonNull(iban, "iban").ciphertext();
        this.ibanNonce = iban.nonce();
        this.ibanKeyId = iban.keyId();
        this.ibanHint = Objects.requireNonNull(ibanHint, "ibanHint");
        this.holderName = Objects.requireNonNull(holderName, "holderName").trim();
        this.ticketId = Objects.requireNonNull(ticketId, "ticketId");
        this.detailsRecordedBy = Objects.requireNonNull(recordedBy, "recordedBy");
        this.detailsRecordedAt = Objects.requireNonNull(at, "at");
    }

    /** Finance made the transfer, and the bank gave it this reference. */
    public void transferred(String bankReference, LocalDate transferredOn, UUID recordedBy, Instant at) {
        if (isTransferred()) {
            throw new IllegalStateException("A refund is transferred once");
        }
        if (Objects.requireNonNull(recordedBy, "recordedBy").equals(detailsRecordedBy)) {
            throw new IllegalStateException("The person who recorded the account does not record the transfer");
        }
        this.bankReference = Objects.requireNonNull(bankReference, "bankReference").trim();
        this.transferredOn = Objects.requireNonNull(transferredOn, "transferredOn");
        this.transferRecordedBy = recordedBy;
        this.transferRecordedAt = Objects.requireNonNull(at, "at");
    }

    public boolean isTransferred() {
        return bankReference != null;
    }

    public UUID refundId() {
        return refundId;
    }

    /** The sealed IBAN, to be opened with {@link #context}. */
    public Sealed sealedIban() {
        return new Sealed(ibanCiphertext, ibanNonce, ibanKeyId);
    }

    public String ibanHint() {
        return ibanHint;
    }

    public String holderName() {
        return holderName;
    }

    public UUID ticketId() {
        return ticketId;
    }

    public UUID detailsRecordedBy() {
        return detailsRecordedBy;
    }

    public Instant detailsRecordedAt() {
        return detailsRecordedAt;
    }

    public String bankReference() {
        return bankReference;
    }

    public LocalDate transferredOn() {
        return transferredOn;
    }

    public UUID transferRecordedBy() {
        return transferRecordedBy;
    }

    public Instant transferRecordedAt() {
        return transferRecordedAt;
    }
}
