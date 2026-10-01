package az.ideanest.compliance.domain;

import az.ideanest.shared.compliance.LegalSubject;
import az.ideanest.shared.compliance.SubjectKind;
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
 * Who a creator legally is, on their account — issue #430.
 *
 * <p>One row per account, keyed by the account. A creator is one legal subject at a time: an
 * individual who registers a company edits this row rather than acquiring a second, and the
 * campaigns they submitted as an individual keep the subject they were submitted with because
 * {@link CampaignLegalSubject} froze it.
 *
 * <p><strong>The row is not evidence and does not pretend to be.</strong> Everything here was
 * typed by the creator. Whether any of it is true is #431's document review, and the two are
 * kept apart on purpose: a field a creator may correct at four in the afternoon must not be
 * the same field a reviewer approved at ten in the morning.
 */
@Entity
@Table(name = "creator_legal_subjects")
public class CreatorLegalSubject {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "subject_kind", nullable = false)
    private SubjectKind subjectKind;

    @Column(name = "legal_name", nullable = false)
    private String legalName;

    @Column(name = "tax_id")
    private String taxId;

    @Column(name = "registered_address")
    private String registeredAddress;

    @Column(name = "registration_number")
    private String registrationNumber;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected CreatorLegalSubject() {
    }

    private CreatorLegalSubject(UUID userId, LegalSubject subject, Instant now) {
        this.userId = Objects.requireNonNull(userId, "A legal subject is somebody's");
        this.createdAt = at(now);
        // Not the public `apply`: calling an overridable method from a constructor is
        // what `-Xlint:this-escape` refuses, and the build treats that as an error.
        replace(subject, now);
    }

    public static CreatorLegalSubject of(UUID userId, LegalSubject subject, Instant now) {
        return new CreatorLegalSubject(userId, subject, now);
    }

    /**
     * Replace what is recorded.
     *
     * <p>A whole-row replacement rather than a patch, because the fields are not independent:
     * moving from {@code INDIVIDUAL} to {@code LEGAL_ENTITY} arrives with two new fields, and
     * moving back must clear them rather than leave a company's address attached to a person.
     * The record that arrives is the row that results.
     *
     * <p>The VÖEN is kept for both kinds (#239). An individual entrepreneur has one, and §6.3
     * approves no payout without it; clearing it here is what made the settings form say
     * "Saved" while the number was thrown away.
     */
    public void apply(LegalSubject subject, Instant now) {
        replace(subject, now);
    }

    private void replace(LegalSubject subject, Instant now) {
        Objects.requireNonNull(subject, "A legal subject is a person or a company");
        this.subjectKind = subject.subjectKind();
        this.legalName = subject.legalName().trim();
        this.taxId = subject.taxIdentifier().orElse(null);
        this.registeredAddress = subject.address().orElse(null);
        this.registrationNumber = subject.registration().orElse(null);
        if (subjectKind == SubjectKind.INDIVIDUAL) {
            this.registeredAddress = null;
            this.registrationNumber = null;
        }
        this.updatedAt = at(now);
    }

    public LegalSubject asLegalSubject() {
        return new LegalSubject(subjectKind, legalName, taxId, registeredAddress, registrationNumber);
    }

    private static Instant at(Instant now) {
        return now.truncatedTo(ChronoUnit.MICROS);
    }

    public UUID getUserId() {
        return userId;
    }

    public SubjectKind getSubjectKind() {
        return subjectKind;
    }

    public String getLegalName() {
        return legalName;
    }

    public String getTaxId() {
        return taxId;
    }

    public String getRegisteredAddress() {
        return registeredAddress;
    }

    public String getRegistrationNumber() {
        return registrationNumber;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
