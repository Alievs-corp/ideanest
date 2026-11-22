package az.ideanest.verification.infrastructure;

import az.ideanest.verification.domain.StudentDocument;
import az.ideanest.verification.domain.StudentDocumentKind;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** V127's {@code student_verification_documents} — #655. Ciphertext only; see {@code StudentDocument}. */
public interface StudentDocumentRepository extends JpaRepository<StudentDocument, UUID> {

    /** Which photographs are still held, without reading a byte of any of them. */
    interface HeldKind {
        UUID getVerificationId();

        StudentDocumentKind getKind();
    }

    @Query("""
            select d.verificationId as verificationId, d.kind as kind
              from StudentDocument d
             where d.verificationId in :verificationIds
            """)
    List<HeldKind> heldKinds(Collection<UUID> verificationIds);

    Optional<StudentDocument> findByVerificationIdAndKind(UUID verificationId, StudentDocumentKind kind);

    @Modifying
    @Query("delete from StudentDocument d where d.verificationId in :verificationIds")
    int deleteForVerifications(Collection<UUID> verificationIds);

    /** The submissions holding a photograph uploaded before that instant — the sweep's candidates. */
    @Query("select distinct d.verificationId from StudentDocument d where d.uploadedAt < :moment")
    List<UUID> verificationsWithDocumentsBefore(Instant moment);
}
