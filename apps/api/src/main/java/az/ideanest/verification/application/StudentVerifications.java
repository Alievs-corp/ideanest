package az.ideanest.verification.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.access.StudentStandings;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import az.ideanest.verification.VerificationProperties;
import az.ideanest.verification.domain.StudentCardNumber;
import az.ideanest.verification.domain.StudentDocument;
import az.ideanest.verification.domain.StudentDocumentKind;
import az.ideanest.verification.domain.StudentVerification;
import az.ideanest.verification.domain.StudentVerificationState;
import az.ideanest.verification.infrastructure.StudentDocumentRepository;
import az.ideanest.verification.infrastructure.StudentVerificationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Student verification — #655. The one door into {@code student_verifications} and its
 * photographs, and the answer to {@link StudentStandings} for the subscription module.
 *
 * <h2>One card number, one account</h2>
 *
 * <p>A card number pending or approved-and-counting on another account is refused, here by a read
 * and underneath by V127's partial unique index, which is what holds when two accounts submit the
 * same card at the same moment: both reads find nothing, one insert wins, and the other's failure
 * is read back as {@link StudentCardInUseException}. The index cannot consult a clock, so an
 * approval whose year has run out is retired — moved to {@code EXPIRED} — in the same transaction,
 * just before the insert it would otherwise block.
 *
 * <h2>Restricted access, as for identity documents</h2>
 *
 * <p>A creator reaches their own check and nobody else's: every creator-facing method takes the
 * caller's account. Only staff with {@link StaffCapability#OPEN_IDENTITY_DOCUMENT} open a
 * photograph, and every opening writes an audit row before the bytes are returned. Every decision
 * is audited, and approving or refusing erases the photographs in the same transaction; the card
 * number and the institution stay, because they are what the one-card rule compares.
 */
@Service
public class StudentVerifications implements StudentStandings {

    private static final Logger log = LoggerFactory.getLogger(StudentVerifications.class);

    private final StudentVerificationRepository verifications;
    private final StudentDocumentRepository documents;
    private final DocumentCipher cipher;
    private final PlatformStaff staff;
    private final UserAccounts accounts;
    private final AuditLog audit;
    private final VerificationProperties properties;
    private final Clock clock;

    public StudentVerifications(
            StudentVerificationRepository verifications,
            StudentDocumentRepository documents,
            DocumentCipher cipher,
            PlatformStaff staff,
            UserAccounts accounts,
            AuditLog audit,
            VerificationProperties properties,
            Clock clock) {
        this.verifications = verifications;
        this.documents = documents;
        this.cipher = cipher;
        this.staff = staff;
        this.accounts = accounts;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    // ------------------------------------------------------------------
    // The subscription module's question
    // ------------------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public boolean isVerifiedStudent(UUID accountId, Instant at) {
        return verifications.findFirstByAccountIdOrderBySubmittedAtDesc(accountId)
                .map(verification -> verification.qualifiesAt(at))
                .orElse(false);
    }

    // ------------------------------------------------------------------
    // The creator's side
    // ------------------------------------------------------------------

    /** This account's newest submission, or empty when it has never submitted. */
    @Transactional(readOnly = true)
    public Optional<StudentVerification> current(UUID accountId) {
        return verifications.findFirstByAccountIdOrderBySubmittedAtDesc(accountId);
    }

    /**
     * A new submission: the institution, the card number, and the two photographs.
     *
     * <p>Checked in this order, cheapest and least revealing first: storage configured, the two
     * fields, the account's own standing, the card's, then the files. The media type of each file
     * comes from its bytes ({@link DocumentBytes}), never from the part.
     *
     * @throws DocumentStorageUnavailableException when no encryption key is configured
     * @throws InvalidStudentVerificationException for an institution or a card number that is
     *     not one
     * @throws StudentVerificationAlreadySubmittedException when the account's newest check is
     *     pending, or approved and still counting
     * @throws StudentCardInUseException when the card is pending, or approved and still
     *     counting, on another account
     * @throws StudentDocumentRefusedException for a file that is empty, too large or of a type
     *     that part does not take
     */
    @Transactional
    public StudentVerification submit(
            UUID accountId, String institution, String cardNumber, byte[] studentCard, byte[] selfie) {

        if (!cipher.isConfigured()) {
            throw new DocumentStorageUnavailableException();
        }
        String place = institutionOf(institution);
        String card = StudentCardNumber.normalise(cardNumber)
                .orElseThrow(() -> new InvalidStudentVerificationException(
                        "cardNumber",
                        "A student card number is " + StudentCardNumber.TYPED_MIN + " to "
                                + StudentCardNumber.TYPED_MAX + " characters, with at least "
                                + StudentCardNumber.NORMALISED_MIN + " letters or digits."));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Optional<StudentVerification> newest = verifications.findFirstByAccountIdOrderBySubmittedAtDesc(accountId);
        if (newest.isPresent() && newest.get().stateAt(now).blocksResubmission()) {
            throw new StudentVerificationAlreadySubmittedException();
        }
        boolean heldElsewhere = verifications.findByCardNumberOrderBySubmittedAtDesc(card).stream()
                .anyMatch(other -> !other.getAccountId().equals(accountId)
                        && other.stateAt(now).blocksResubmission());
        if (heldElsewhere) {
            throw new StudentCardInUseException();
        }

        String cardType = mediaTypeOf("studentCard", StudentDocumentKind.STUDENT_CARD, studentCard);
        String selfieType = mediaTypeOf("selfie", StudentDocumentKind.SELFIE, selfie);

        // Approvals whose year has run out, on this account or this card, would still hold V127's
        // indexes. Retired here, by the submission they are in the way of.
        // Flushed one by one rather than left to the insert's flush, because Hibernate runs a
        // flush's inserts before its updates, and the insert would meet the row still APPROVED.
        for (StudentVerification open : verifications.openForAccountOrCard(accountId, card)) {
            if (open.retire(now)) {
                verifications.saveAndFlush(open);
            }
        }

        StudentVerification saved;
        try {
            saved = verifications.saveAndFlush(StudentVerification.submitted(accountId, place, card, now));
        } catch (DataIntegrityViolationException raced) {
            // Somebody got there between the reads above and this insert. Which index caught it
            // says who: the card's means another account, the account's means a double submit.
            if (String.valueOf(raced.getMostSpecificCause().getMessage()).contains("one_open_per_card")) {
                throw new StudentCardInUseException();
            }
            throw new StudentVerificationAlreadySubmittedException();
        }

        documents.save(StudentDocument.of(
                saved.getId(), StudentDocumentKind.STUDENT_CARD, cardType, studentCard.length, cipher.seal(studentCard), now));
        documents.save(StudentDocument.of(
                saved.getId(), StudentDocumentKind.SELFIE, selfieType, selfie.length, cipher.seal(selfie), now));

        // On the creator's own account, as an identity document's is. The sizes and nothing else:
        // not the institution, not the card number, not a byte.
        audit.record(
                AuditAction.STUDENT_VERIFICATION_SUBMITTED,
                accountId,
                AuditActor.user(accountId),
                AuditOutcome.SUCCEEDED,
                "verification=%s; cardBytes=%d; selfieBytes=%d".formatted(saved.getId(), studentCard.length, selfie.length));

        log.info("Student verification {} submitted.", saved.getId());
        return saved;
    }

    // ------------------------------------------------------------------
    // The staff side
    // ------------------------------------------------------------------

    /**
     * The console's list.
     *
     * @param state which list: {@code PENDING} is the queue, oldest first; the others are the
     *     archive, newest decision first. {@code EXPIRED} includes approvals whose year has run
     *     out and whose row has not been retired yet
     */
    @Transactional(readOnly = true)
    public List<StudentVerificationReview> list(UUID staffId, StudentVerificationState state, int limit) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
        Instant now = clock.instant();
        PageRequest page = PageRequest.ofSize(limit);
        List<StudentVerification> rows = switch (state == null ? StudentVerificationState.PENDING : state) {
            case PENDING, NONE -> verifications.findByStateOrderBySubmittedAtAsc(StudentVerificationState.PENDING, page);
            case APPROVED -> verifications.approvedAt(now, page);
            case REJECTED -> verifications.rejected(page);
            case EXPIRED -> verifications.expiredAt(now, page);
        };
        return reviews(rows, now);
    }

    /**
     * One photograph's bytes, for a member of staff about to look at it.
     *
     * <p>The single route to plaintext, and the audit row is written — in a transaction of its own,
     * so a failed decryption is still recorded as an attempt — before the bytes are returned. The
     * entity is the creator: "who has looked at my face" is their question.
     *
     * @throws StudentVerificationNotFoundException for an unknown submission, and for a photograph
     *     no longer held because a decision erased it
     */
    @Transactional(readOnly = true)
    public IdentityVerifications.OpenedDocument openDocument(UUID staffId, UUID verificationId, StudentDocumentKind kind) {
        staff.requireCapability(staffId, StaffCapability.OPEN_IDENTITY_DOCUMENT);

        StudentVerification verification =
                verifications.findById(verificationId).orElseThrow(StudentVerificationNotFoundException::new);
        StudentDocument document = documents.findByVerificationIdAndKind(verificationId, kind)
                .orElseThrow(StudentVerificationNotFoundException::new);

        audit.recordIndependently(
                AuditAction.STUDENT_DOCUMENT_READ,
                verification.getAccountId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "verification=%s; kind=%s".formatted(verificationId, kind.name()));

        return new IdentityVerifications.OpenedDocument(document.getContentType(), cipher.open(document.sealed()));
    }

    /**
     * A member of staff was satisfied. Counts for a year from now; the photographs are erased.
     *
     * @throws StudentCardInUseException when another account holds an approval of the same card
     *     that still counts — a submission that reached the queue before that one was approved
     */
    @Transactional
    public StudentVerificationReview approve(UUID staffId, UUID verificationId) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
        StudentVerification verification = decidable(verificationId);
        Instant now = clock.instant();
        if (verification.stateAt(now) != StudentVerificationState.PENDING) {
            throw new StudentVerificationNotDecidableException("Only a submission waiting for review can be approved");
        }
        boolean approvedElsewhere = verifications.findByCardNumberOrderBySubmittedAtDesc(verification.getCardNumber())
                .stream()
                .anyMatch(other -> !other.getAccountId().equals(verification.getAccountId()) && other.qualifiesAt(now));
        if (approvedElsewhere) {
            throw new StudentCardInUseException();
        }

        verification.approve(staffId, now);
        return decided(staffId, verification, AuditAction.STUDENT_VERIFICATION_APPROVED, now);
    }

    /** A member of staff was not satisfied. The creator may submit again; the photographs are erased. */
    @Transactional
    public StudentVerificationReview reject(UUID staffId, UUID verificationId, String reason) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
        String why = reasonOf(reason);
        StudentVerification verification = decidable(verificationId);
        Instant now = clock.instant();
        if (verification.stateAt(now) != StudentVerificationState.PENDING) {
            throw new StudentVerificationNotDecidableException("Only a submission waiting for review can be refused");
        }
        verification.reject(staffId, why, now);
        return decided(staffId, verification, AuditAction.STUDENT_VERIFICATION_REJECTED, now);
    }

    /**
     * An approval withdrawn — abuse found after the decision. The account stops qualifying at once
     * and the card number is free again. A subscription already paid for keeps its period; the
     * next one is refused.
     */
    @Transactional
    public StudentVerificationReview revoke(UUID staffId, UUID verificationId, String reason) {
        staff.requireCapability(staffId, StaffCapability.REVIEW_IDENTITY_VERIFICATION);
        String why = reasonOf(reason);
        StudentVerification verification = decidable(verificationId);
        Instant now = clock.instant();
        if (verification.stateAt(now) != StudentVerificationState.APPROVED) {
            throw new StudentVerificationNotDecidableException("Only an approval that still counts can be revoked");
        }
        verification.revoke(staffId, why, now);
        return decided(staffId, verification, AuditAction.STUDENT_VERIFICATION_REVOKED, now);
    }

    /**
     * Destroys the photographs behind one submission and records that it happened.
     *
     * @return how many were destroyed
     */
    private int erase(StudentVerification verification, Instant now) {
        int erased = documents.deleteForVerifications(List.of(verification.getId()));
        if (erased > 0) {
            verification.documentsErased(now);
        }
        return erased;
    }

    private StudentVerificationReview decided(
            UUID staffId, StudentVerification verification, AuditAction action, Instant now) {
        int erased = erase(verification, now);
        verifications.saveAndFlush(verification);

        // The reason is on the row and shown to the creator; it is not copied here, for
        // IDENTITY_VERIFICATION_REJECTED's reason.
        audit.record(
                action,
                verification.getAccountId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "verification=%s; documentsErased=%d".formatted(verification.getId(), erased));

        log.info("Student verification {} decided: {}.", verification.getId(), verification.getState());
        return reviews(List.of(verification), now).getFirst();
    }

    private StudentVerification decidable(UUID verificationId) {
        return verifications.findById(verificationId).orElseThrow(StudentVerificationNotFoundException::new);
    }

    /** The rows with everything the console draws beside them, in three queries whatever the page size. */
    private List<StudentVerificationReview> reviews(List<StudentVerification> rows, Instant now) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Set<UUID> ids = rows.stream().map(StudentVerification::getId).collect(Collectors.toSet());
        Map<UUID, List<StudentDocumentKind>> held = new HashMap<>();
        for (StudentDocumentRepository.HeldKind kind : documents.heldKinds(ids)) {
            held.computeIfAbsent(kind.getVerificationId(), ignored -> new ArrayList<>()).add(kind.getKind());
        }

        Set<String> cards = rows.stream().map(StudentVerification::getCardNumber).collect(Collectors.toSet());
        Map<String, List<StudentVerification>> byCard = verifications.findByCardNumberIn(cards).stream()
                .collect(Collectors.groupingBy(StudentVerification::getCardNumber));

        Set<UUID> people = new HashSet<>();
        rows.forEach(row -> people.add(row.getAccountId()));
        byCard.values().forEach(list -> list.forEach(other -> people.add(other.getAccountId())));
        Map<UUID, UserAccount> named = accounts.findAllById(people);

        List<StudentVerificationReview> reviews = new ArrayList<>(rows.size());
        for (StudentVerification row : rows) {
            UserAccount account = named.get(row.getAccountId());
            reviews.add(new StudentVerificationReview(
                    row,
                    row.stateAt(now),
                    account == null ? null : account.name(),
                    account == null ? null : account.email().value(),
                    held.getOrDefault(row.getId(), List.of()).stream().sorted().toList(),
                    elsewhere(row, byCard.getOrDefault(row.getCardNumber(), List.of()), named, now)));
        }
        return reviews;
    }

    /** Every other account that used this card, each with its newest such submission's standing. */
    private static List<StudentVerificationReview.OtherAccount> elsewhere(
            StudentVerification row, Collection<StudentVerification> sameCard, Map<UUID, UserAccount> named, Instant now) {
        Map<UUID, StudentVerification> newestByAccount = new LinkedHashMap<>();
        sameCard.stream()
                .filter(other -> !other.getAccountId().equals(row.getAccountId()))
                .sorted(Comparator.comparing(StudentVerification::getSubmittedAt).reversed())
                .forEach(other -> newestByAccount.putIfAbsent(other.getAccountId(), other));
        return newestByAccount.values().stream()
                .map(other -> {
                    UserAccount account = named.get(other.getAccountId());
                    return new StudentVerificationReview.OtherAccount(
                            other.getAccountId(), account == null ? null : account.name(), other.stateAt(now));
                })
                .toList();
    }

    private String mediaTypeOf(String field, StudentDocumentKind kind, byte[] content) {
        if (content == null || content.length == 0) {
            throw new StudentDocumentRefusedException(field, DocumentRefusedException.Reason.EMPTY, "That file is empty.");
        }
        int max = properties.documents().maxBytes();
        if (content.length > max) {
            throw new StudentDocumentRefusedException(
                    field, DocumentRefusedException.Reason.TOO_LARGE, "A file may be at most " + max + " bytes.");
        }
        return DocumentBytes.mediaTypeOf(content)
                .filter(kind::accepts)
                .orElseThrow(() -> new StudentDocumentRefusedException(
                        field,
                        DocumentRefusedException.Reason.UNSUPPORTED_TYPE,
                        kind == StudentDocumentKind.SELFIE
                                ? "A selfie is a JPEG or a PNG."
                                : "A student card is a JPEG, a PNG or a PDF."));
    }

    private static String institutionOf(String institution) {
        try {
            return StudentVerification.requireInstitution(institution);
        } catch (IllegalArgumentException invalid) {
            throw new InvalidStudentVerificationException("institution", invalid.getMessage() + ".");
        }
    }

    private static String reasonOf(String reason) {
        try {
            return StudentVerification.requireReason(reason);
        } catch (IllegalArgumentException invalid) {
            throw new InvalidStudentVerificationException("reason", invalid.getMessage() + ".");
        }
    }
}
