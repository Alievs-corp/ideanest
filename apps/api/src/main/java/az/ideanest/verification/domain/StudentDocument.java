package az.ideanest.verification.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

/**
 * One photograph behind a student verification, sealed — #655, V127.
 *
 * <p>{@link IdentityDocument}'s envelope and its rules, unchanged: the bytes are never in the clear
 * on this entity, and opening one is {@code DocumentCipher}'s, from one audited route.
 */
@Entity
@Table(name = "student_verification_documents")
public class StudentDocument {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "verification_id", nullable = false, updatable = false)
    private UUID verificationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, updatable = false)
    private StudentDocumentKind kind;

    @Column(name = "content_type", nullable = false, updatable = false)
    private String contentType;

    @Column(name = "byte_length", nullable = false, updatable = false)
    private int byteLength;

    @Column(name = "ciphertext", nullable = false, updatable = false)
    private byte[] ciphertext;

    @Column(name = "nonce", nullable = false, updatable = false)
    private byte[] nonce;

    @Column(name = "key_id", nullable = false, updatable = false)
    private String keyId;

    @Column(name = "uploaded_at", nullable = false, updatable = false)
    private Instant uploadedAt;

    protected StudentDocument() {
        // JPA.
    }

    /**
     * @param contentType decided from the bytes, never from the upload
     * @throws IllegalArgumentException when this kind may not be that type — a selfie is a photograph
     */
    public static StudentDocument of(
            UUID verificationId,
            StudentDocumentKind kind,
            String contentType,
            int byteLength,
            SealedDocument sealed,
            Instant now) {
        StudentDocument document = new StudentDocument();
        document.id = Identifiers.newIdentifier();
        document.verificationId = Objects.requireNonNull(verificationId, "A document belongs to a submission");
        document.kind = Objects.requireNonNull(kind, "A document is of some kind");
        if (!kind.accepts(contentType)) {
            throw new IllegalArgumentException("A " + kind + " may not be " + contentType);
        }
        document.contentType = contentType;
        document.byteLength = byteLength;
        document.ciphertext = sealed.ciphertext();
        document.nonce = sealed.nonce();
        document.keyId = sealed.keyId();
        document.uploadedAt = now.truncatedTo(ChronoUnit.MICROS);
        return document;
    }

    /** The envelope, for {@code DocumentCipher} and for nothing else. */
    public SealedDocument sealed() {
        return new SealedDocument(ciphertext, nonce, keyId);
    }

    public UUID getId() {
        return id;
    }

    public UUID getVerificationId() {
        return verificationId;
    }

    public StudentDocumentKind getKind() {
        return kind;
    }

    public String getContentType() {
        return contentType;
    }

    public int getByteLength() {
        return byteLength;
    }

    public Instant getUploadedAt() {
        return uploadedAt;
    }

    @Override
    public String toString() {
        return "StudentDocument[id=" + id + ", kind=" + kind + ", bytes=" + byteLength + "]";
    }
}
