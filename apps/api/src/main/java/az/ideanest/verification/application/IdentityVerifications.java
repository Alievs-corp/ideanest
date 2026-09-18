package az.ideanest.verification.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.verification.VerificationProperties;
import az.ideanest.verification.domain.DocumentKind;
import az.ideanest.verification.domain.IdentityDocument;
import az.ideanest.verification.domain.IdentityVerification;
import az.ideanest.shared.compliance.RejectionReason;
import az.ideanest.shared.compliance.SubjectKind;
import az.ideanest.verification.domain.VerificationState;
import az.ideanest.verification.infrastructure.IdentityDocumentRepository;
import az.ideanest.verification.infrastructure.IdentityVerificationRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Identity verification for creators — issue #105. The one door into
 * {@code identity_verifications} and {@code identity_documents}.
 *
 * <h2>Restricted access is what this class mostly is</h2>
 *
 * <p>#105's title is "document capture with restricted access and a retention limit", and
 * the middle third is enforced here rather than in a controller. Three rules, and none of
 * them is optional:
 *
 * <ol>
 *   <li><strong>A creator reaches their own verification and nobody else's.</strong> Every
 *       creator-facing method takes the caller's account identifier and the query is keyed
 *       on it — there is no method that takes a verification identifier from a creator.
 *   <li><strong>Only platform staff open a document, and every opening is audited.</strong>
 *       {@link #openDocument} is the single route to plaintext and it writes an audit row
 *       before it returns one. A read of somebody's passport that nobody can reconstruct is
 *       the failure §17.4 is about.
 *   <li><strong>Nothing lists documents across people.</strong> The repository has no such
 *       query, so a screen that wanted one could not be written by accident.
 * </ol>
 *
 * <h2>The retention limit is enforced in two places, and that is not redundancy</h2>
 *
 * <p>A decision erases the documents behind it at once — that is the ordinary path, and it
 * is synchronous because a reviewer who has finished looking has no further need of the
 * photograph. {@code DocumentRetentionJob} is the backstop for the submission nobody ever
 * decides, which the ordinary path by definition never reaches.
 *
 * <h2>What is deliberately NOT here</h2>
 *
 * <p><strong>No threshold, and nothing gated.</strong> A campaign launches, a pledge is
 * taken and a payout is calculated exactly as before, whatever a verification says. §22.1
 * lists "identity verification thresholds for creators" among the questions requiring a
 * specific legal answer, and #71 carries {@code status: needs-decision}. A threshold
 * invented here would be a compliance position this repository made up and the one a
 * regulator would read back to us. {@code VerificationProperties.required} is where it goes
 * on the day somebody may decide it.
 */
@Service
public class IdentityVerifications {

    private static final Logger log = LoggerFactory.getLogger(IdentityVerifications.class);

    private final IdentityVerificationRepository verifications;
    private final IdentityDocumentRepository documents;
    private final DocumentCipher cipher;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final VerificationProperties properties;
    private final Clock clock;

    public IdentityVerifications(
            IdentityVerificationRepository verifications,
            IdentityDocumentRepository documents,
            DocumentCipher cipher,
            PlatformStaff staff,
            AuditLog audit,
            VerificationProperties properties,
            Clock clock) {
        this.verifications = verifications;
        this.documents = documents;
        this.cipher = cipher;
        this.staff = staff;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    // ------------------------------------------------------------------
    // The creator's side
    // ------------------------------------------------------------------

    /**
     * This account's verification, creating one in {@code REQUESTED} if there is none.
     *
     * <p>Created on read, which is unusual and is right here: the alternative is a separate
     * "start verification" call that every client would have to make before the first
     * upload, and a screen that says "not started" is the same screen as one that says
     * "requested". The row is three columns and carries no personal data.
     */
    @Transactional
    public IdentityVerification forCreator(UUID userId, SubjectKind kind) {
        return verifications
                .findByUserId(userId)
                .orElseGet(() -> verifications.save(IdentityVerification.requested(userId, kind, clock.instant())));
    }

    /** The documents held against this account's verification. Metadata only. */
    @Transactional(readOnly = true)
    public List<IdentityDocument> documentsOf(UUID verificationId) {
        return documents.findByVerificationIdOrderByUploadedAtAsc(verificationId);
    }

    /**
     * Stores one document against this account's verification.
     *
     * <p>The order of the checks is the order they should be in: refuse before decrypting
     * anything, before allocating anything, and before the account is told the file was
     * accepted. The media type comes from the bytes and never from what the client called
     * the part — §17.3, and {@link DocumentBytes} argues it.
     *
     * @throws DocumentStorageUnavailableException when no encryption key is configured. A
     *     503, not a 500: a creator told the service is not taking documents stops, and one
     *     told there was a server error tries for ever
     */
    @Transactional
    public IdentityDocument submit(UUID userId, SubjectKind subjectKind, DocumentKind kind, byte[] content) {
        if (!cipher.isConfigured()) {
            throw new DocumentStorageUnavailableException();
        }
        if (content == null || content.length == 0) {
            throw new DocumentRefusedException(DocumentRefusedException.Reason.EMPTY, "That file is empty.");
        }
        if (content.length > properties.documents().maxBytes()) {
            throw new DocumentRefusedException(
                    DocumentRefusedException.Reason.TOO_LARGE,
                    "A document may be at most " + properties.documents().maxBytes() + " bytes.");
        }
        if (!kind.isFor(subjectKind)) {
            throw new DocumentRefusedException(
                    DocumentRefusedException.Reason.WRONG_KIND_FOR_SUBJECT,
                    "That kind of document is not one a " + subjectKind.name().toLowerCase(java.util.Locale.ROOT)
                            + " submits.");
        }

        String mediaType = DocumentBytes.mediaTypeOf(content)
                .orElseThrow(() -> new DocumentRefusedException(
                        DocumentRefusedException.Reason.UNSUPPORTED_TYPE,
                        "A document is a JPEG, a PNG or a PDF."));

        IdentityVerification verification = forCreator(userId, subjectKind);
        if (documents.countByVerificationId(verification.getId()) >= properties.documents().maxPerVerification()) {
            throw new DocumentRefusedException(
                    DocumentRefusedException.Reason.TOO_MANY,
                    "This submission already holds as many documents as it may.");
        }

        Instant now = clock.instant();
        IdentityDocument stored = documents.save(IdentityDocument.of(
                verification.getId(), kind, mediaType, content.length, cipher.seal(content), now));

        verification.submitted(subjectKind, now);

        /*
         * Audited on the creator's own account rather than on a reviewer: §17.4 makes "a
         * document about this person was stored" an event about them. The detail names the
         * kind and the size and nothing else -- not the media type of somebody's passport
         * photograph, and certainly not a filename.
         */
        audit.recordIndependently(
                AuditAction.IDENTITY_DOCUMENT_SUBMITTED,
                userId,
                AuditActor.user(userId),
                AuditOutcome.SUCCEEDED,
                "kind=%s; bytes=%d".formatted(kind.name(), content.length));

        return stored;
    }

    // ------------------------------------------------------------------
    // The staff side
    // ------------------------------------------------------------------

    /** The review queue: submitted, oldest first. */
    @Transactional(readOnly = true)
    public List<IdentityVerification> queue(UUID staffId, int limit) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
        return verifications.findByStateOrderByCreatedAtAsc(VerificationState.SUBMITTED, PageRequest.ofSize(limit));
    }

    /**
     * One document's bytes, for a member of staff who is about to look at it.
     *
     * <p><strong>The single route to plaintext on this platform, and every call is
     * recorded.</strong> The audit row names the creator as the entity rather than the
     * reviewer, because "who has looked at my passport" is the question this table exists
     * to answer, and it is written whether or not the decryption then succeeds — a failed
     * read is still an attempt somebody made.
     *
     * @throws VerificationNotFoundException when the document does not belong to that
     *     verification. Scoped in the query rather than checked afterwards, so a mismatched
     *     pair cannot be opened by a mistake in a controller
     */
    @Transactional(readOnly = true)
    public OpenedDocument openDocument(UUID staffId, UUID verificationId, UUID documentId) {
        /*
         * OPEN_IDENTITY_DOCUMENT, and not merely staff. StaffCapability calls this "the most
         * sensitive read on the platform" and StaffRole gives it to COMPLIANCE and to nobody
         * else — while this method asked only whether the caller worked here, so every
         * moderator and every curator could open somebody's passport scan. The narrow
         * capability existed; this is the call site that was not using it.
         */
        staff.requireCapability(staffId, StaffCapability.OPEN_IDENTITY_DOCUMENT);

        IdentityDocument document = documents.findByIdAndVerificationId(documentId, verificationId)
                .orElseThrow(VerificationNotFoundException::new);
        IdentityVerification verification =
                verifications.findById(verificationId).orElseThrow(VerificationNotFoundException::new);

        audit.recordIndependently(
                AuditAction.IDENTITY_DOCUMENT_READ,
                verification.getUserId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "kind=%s".formatted(document.getKind().name()));

        return new OpenedDocument(document.getContentType(), cipher.open(document.sealed()));
    }

    /**
     * A member of staff was satisfied.
     *
     * <p>The documents are destroyed in the same transaction. A reviewer who has finished
     * looking has no further need of the photograph, and holding it "just in case" is how a
     * seven-day retention limit becomes a year — §17.4.
     */
    @Transactional
    public IdentityVerification approve(UUID staffId, UUID verificationId) {
        return decide(staffId, verificationId, verification -> {
            verification.approved(staffId, properties.approvalLife(), clock.instant());
            return AuditAction.IDENTITY_VERIFICATION_APPROVED;
        });
    }

    /** A member of staff was not satisfied. Resubmittable — see {@link RejectionReason}. */
    @Transactional
    public IdentityVerification reject(UUID staffId, UUID verificationId, RejectionReason reason) {
        return decide(staffId, verificationId, verification -> {
            verification.rejected(staffId, reason, clock.instant());
            return AuditAction.IDENTITY_VERIFICATION_REJECTED;
        });
    }

    private IdentityVerification decide(
            UUID staffId, UUID verificationId, java.util.function.Function<IdentityVerification, AuditAction> decision) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);

        IdentityVerification verification =
                verifications.findById(verificationId).orElseThrow(VerificationNotFoundException::new);

        if (verification.getState() != VerificationState.SUBMITTED) {
            // Two members of staff in the same queue. A conflict rather than a mistake.
            throw new VerificationNotDecidableException("That verification has already been decided");
        }

        AuditAction action = decision.apply(verification);
        int erased = erase(verification);

        audit.recordIndependently(
                action,
                verification.getUserId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "documentsErased=%d".formatted(erased));

        return verification;
    }

    /**
     * Destroys the documents behind one verification and records that it happened.
     *
     * @return how many were destroyed
     */
    @Transactional
    public int erase(IdentityVerification verification) {
        int erased = documents.deleteForVerifications(List.of(verification.getId()));
        if (erased > 0) {
            verification.documentsErased(clock.instant());
            log.info("Erased {} identity document(s) for verification {}.", erased, verification.getId());
        }
        return erased;
    }

    /** What {@link #openDocument} answers. The bytes exist for the length of one response. */
    public record OpenedDocument(String contentType, byte[] content) {}
}
