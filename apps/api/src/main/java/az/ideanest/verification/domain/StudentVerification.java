package az.ideanest.verification.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.Period;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.UUID;

/**
 * One student verification submission — #655, V127's row.
 *
 * <h2>A submission, not an account's standing</h2>
 *
 * <p>An account has as many rows as it has submitted; its standing is its newest. A refused or
 * expired check is followed by a new row rather than an edit of the old one, because the old
 * one is what "this card was used on another account before" is answered from.
 *
 * <h2>The clock is part of the state</h2>
 *
 * <p>An approval counts for {@link #APPROVAL_LIFE} from the decision. {@link #stateAt} is the
 * only question worth asking, and it reads {@link StudentVerificationState#EXPIRED} for an
 * approval whose {@link #validUntil} has passed whatever the column says. {@link #retire} moves
 * the column to match, which V127's indexes need and nothing else does.
 *
 * <p>The card number and the institution outlive the decision; the photographs do not
 * ({@link #documentsErased}).
 */
@Entity
@Table(name = "student_verifications")
public class StudentVerification {

    /** How long an approval counts for — the owner's decision on #655. Calendar, in UTC. */
    public static final Period APPROVAL_LIFE = Period.ofYears(1);

    public static final int INSTITUTION_MAX = 200;

    public static final int REASON_MAX = 2000;

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "institution", nullable = false, updatable = false)
    private String institution;

    @Column(name = "card_number", nullable = false, updatable = false)
    private String cardNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private StudentVerificationState state;

    @Column(name = "submitted_at", nullable = false, updatable = false)
    private Instant submittedAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "valid_until")
    private Instant validUntil;

    @Column(name = "rejection_reason")
    private String rejectionReason;

    @Column(name = "documents_erased_at")
    private Instant documentsErasedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected StudentVerification() {
        // JPA.
    }

    /**
     * A new submission, waiting for a member of staff.
     *
     * @param cardNumber already normalised — {@link StudentCardNumber#normalise}
     * @throws IllegalArgumentException when the institution or the card number is not one; the
     *     service refuses first, naming the field, and this is the assertion that it did
     */
    public static StudentVerification submitted(UUID accountId, String institution, String cardNumber, Instant now) {
        StudentVerification verification = new StudentVerification();
        verification.id = Identifiers.newIdentifier();
        verification.accountId = Objects.requireNonNull(accountId, "A submission belongs to an account");
        verification.institution = requireInstitution(institution);
        String normalised = StudentCardNumber.normalise(cardNumber)
                .filter(cardNumber::equals)
                .orElseThrow(() -> new IllegalArgumentException("A card number is stored normalised"));
        verification.cardNumber = normalised;
        verification.state = StudentVerificationState.PENDING;
        verification.submittedAt = micros(now);
        verification.updatedAt = verification.submittedAt;
        return verification;
    }

    /** Where it stands at that instant: an approval past its {@link #validUntil} is expired. */
    public StudentVerificationState stateAt(Instant now) {
        if (state == StudentVerificationState.APPROVED && !validUntil.isAfter(Objects.requireNonNull(now))) {
            return StudentVerificationState.EXPIRED;
        }
        return state;
    }

    /** Whether it lets its account buy a student plan at that instant. */
    public boolean qualifiesAt(Instant now) {
        return stateAt(now) == StudentVerificationState.APPROVED;
    }

    /**
     * A member of staff was satisfied. Counts for {@link #APPROVAL_LIFE} from now.
     *
     * @throws IllegalStateException unless it is waiting for a decision
     */
    public void approve(UUID staffId, Instant now) {
        requirePending();
        Instant at = micros(now);
        this.state = StudentVerificationState.APPROVED;
        this.decidedAt = at;
        this.decidedBy = Objects.requireNonNull(staffId, "Somebody approved this");
        this.validUntil = at.atOffset(ZoneOffset.UTC).plus(APPROVAL_LIFE).toInstant();
        this.updatedAt = at;
    }

    /**
     * A member of staff was not satisfied. The creator may submit again.
     *
     * @throws IllegalStateException unless it is waiting for a decision
     */
    public void reject(UUID staffId, String reason, Instant now) {
        requirePending();
        refuse(staffId, reason, now);
    }

    /**
     * An approval withdrawn — abuse found after the decision. The row becomes a refusal with the
     * reason, and the card number is free again.
     *
     * @throws IllegalStateException unless it is approved and has not run out
     */
    public void revoke(UUID staffId, String reason, Instant now) {
        if (stateAt(now) != StudentVerificationState.APPROVED) {
            throw new IllegalStateException("Only an approval that still counts can be revoked");
        }
        refuse(staffId, reason, now);
    }

    /**
     * Moves an approval whose year has run out to {@link StudentVerificationState#EXPIRED}.
     *
     * <p>V127's indexes hold a card and an account while a row is {@code APPROVED}, and cannot
     * consult a clock; this is what stops an expired approval holding them for ever. Called on the
     * row standing in a new submission's way, and by the sweep.
     *
     * @return whether it moved
     */
    public boolean retire(Instant now) {
        if (state == StudentVerificationState.APPROVED && stateAt(now) == StudentVerificationState.EXPIRED) {
            this.state = StudentVerificationState.EXPIRED;
            this.updatedAt = micros(now);
            return true;
        }
        return false;
    }

    /** The photographs were destroyed. Idempotent: the first time is the one recorded. */
    public void documentsErased(Instant now) {
        if (documentsErasedAt == null) {
            this.documentsErasedAt = micros(now);
            this.updatedAt = this.documentsErasedAt;
        }
    }

    private void refuse(UUID staffId, String reason, Instant now) {
        Instant at = micros(now);
        this.state = StudentVerificationState.REJECTED;
        this.rejectionReason = requireReason(reason);
        this.decidedAt = at;
        this.decidedBy = Objects.requireNonNull(staffId, "Somebody refused this");
        this.validUntil = null;
        this.updatedAt = at;
    }

    private void requirePending() {
        if (state != StudentVerificationState.PENDING) {
            throw new IllegalStateException("Only a submission waiting for a decision can be decided");
        }
    }

    /** The institution as stored, or an exception — {@code StudentVerifications} checks first. */
    public static String requireInstitution(String institution) {
        String trimmed = institution == null ? "" : institution.strip();
        if (trimmed.isEmpty() || trimmed.length() > INSTITUTION_MAX) {
            throw new IllegalArgumentException("An institution is 1 to " + INSTITUTION_MAX + " characters");
        }
        return trimmed;
    }

    /** The reason as stored, or an exception — {@code StudentVerifications} checks first. */
    public static String requireReason(String reason) {
        String trimmed = reason == null ? "" : reason.strip();
        if (trimmed.isEmpty() || trimmed.length() > REASON_MAX) {
            throw new IllegalArgumentException("A reason is 1 to " + REASON_MAX + " characters");
        }
        return trimmed;
    }

    private static Instant micros(Instant now) {
        return Objects.requireNonNull(now, "This happens at some instant").truncatedTo(ChronoUnit.MICROS);
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public String getInstitution() {
        return institution;
    }

    public String getCardNumber() {
        return cardNumber;
    }

    /** The stored state. Readers want {@link #stateAt}. */
    public StudentVerificationState getState() {
        return state;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public UUID getDecidedBy() {
        return decidedBy;
    }

    public Instant getValidUntil() {
        return validUntil;
    }

    public String getRejectionReason() {
        return rejectionReason;
    }

    public Instant getDocumentsErasedAt() {
        return documentsErasedAt;
    }

    @Override
    public String toString() {
        // No card number and no institution: a log line is not where a student's card goes.
        return "StudentVerification[id=" + id + ", state=" + state + "]";
    }
}
