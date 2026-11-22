package az.ideanest.verification.api;

import az.ideanest.verification.application.StudentVerificationReview;
import az.ideanest.verification.domain.StudentDocumentKind;
import az.ideanest.verification.domain.StudentVerification;
import az.ideanest.verification.domain.StudentVerificationState;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Student verification on the wire — #655. {@code @ideanest/plans/student} is the client's half.
 *
 * <p>Two shapes, deliberately: the creator reads their own standing, and staff read a row that
 * carries the account's address and every other account that used the same card — fields a
 * creator must never be sent, so they are not nullable fields on one record.
 *
 * <p>Names are long because springdoc names a schema by the record's simple name and keeps the
 * first it meets; {@code SubscriptionResponses} records what a short name cost.
 */
public final class StudentVerificationResponses {

    private StudentVerificationResponses() {}

    /**
     * The creator's standing — {@code GET} and {@code POST /v1/me/student-verification}.
     *
     * @param state {@code NONE} when the account never submitted; {@code EXPIRED} when an approval's
     *     {@code validUntil} has passed
     * @param validUntil when an approval stops counting; set on an approval only
     * @param rejectionReason staff's words, on a refusal or a revocation
     */
    public record StudentVerificationStatus(
            StudentVerificationState state,
            String institution,
            String cardNumber,
            Instant submittedAt,
            Instant decidedAt,
            Instant validUntil,
            String rejectionReason) {

        static final StudentVerificationStatus NONE =
                new StudentVerificationStatus(StudentVerificationState.NONE, null, null, null, null, null, null);

        static StudentVerificationStatus of(Optional<StudentVerification> newest, Instant now) {
            return newest.map(verification -> new StudentVerificationStatus(
                            verification.stateAt(now),
                            verification.getInstitution(),
                            verification.getCardNumber(),
                            verification.getSubmittedAt(),
                            verification.getDecidedAt(),
                            verification.getValidUntil(),
                            verification.getRejectionReason()))
                    .orElse(NONE);
        }
    }

    /**
     * One submission, as the console reviews it.
     *
     * @param documents the photographs still held. Empty once a decision erased them
     * @param sameCardElsewhere every other account that ever submitted the same normalised card
     *     number, with where its newest such submission stands. A warning for the reviewer
     */
    public record StudentVerificationRow(
            UUID id,
            UUID accountId,
            String accountName,
            String accountEmail,
            String institution,
            String cardNumber,
            StudentVerificationState state,
            Instant submittedAt,
            Instant decidedAt,
            UUID decidedBy,
            Instant validUntil,
            String rejectionReason,
            List<StudentDocumentKind> documents,
            List<StudentCardHolder> sameCardElsewhere) {

        static StudentVerificationRow of(StudentVerificationReview review) {
            StudentVerification row = review.verification();
            return new StudentVerificationRow(
                    row.getId(),
                    row.getAccountId(),
                    review.accountName(),
                    review.accountEmail(),
                    row.getInstitution(),
                    row.getCardNumber(),
                    review.state(),
                    row.getSubmittedAt(),
                    row.getDecidedAt(),
                    row.getDecidedBy(),
                    row.getValidUntil(),
                    row.getRejectionReason(),
                    review.documents(),
                    review.sameCardElsewhere().stream()
                            .map(other -> new StudentCardHolder(other.accountId(), other.accountName(), other.state()))
                            .toList());
        }
    }

    /** Another account that used the same card number, and where its newest such submission stands. */
    public record StudentCardHolder(UUID accountId, String accountName, StudentVerificationState state) {
    }

    /** The console's list. No cursor, for the identity queue's reason. */
    public record StudentVerificationList(List<StudentVerificationRow> verifications) {
    }

    /** @param reason shown to the creator: what was wrong, or why an approval was withdrawn */
    public record StudentVerificationDecision(@NotBlank @Size(max = 2000) String reason) {
    }
}
