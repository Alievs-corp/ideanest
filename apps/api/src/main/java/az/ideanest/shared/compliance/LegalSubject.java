package az.ideanest.shared.compliance;

import java.util.Objects;
import java.util.Optional;

/**
 * Who a creator legally is — issue #430, as it crosses a module boundary.
 *
 * <p><strong>A fact about the account, not a record of a check.</strong> That distinction is
 * the whole of #430. {@code identity_verifications.subject_kind} says what a reviewer was
 * looking at when they looked; this says what the platform is dealing with, and a creator
 * who has never been asked to verify anything still has one of these while having no
 * verification row at all.
 *
 * <p>The payout needs it to apply withholding, the agreement needs it to bind the right
 * party, #429's signature needs {@link #legalName()} to match a certificate subject against,
 * and #432 needs the same name to match a bank account holder against. None of those may
 * read {@code creator_legal_subjects}, so this is what they read instead.
 *
 * <h2>Why the entity fields are optional rather than a second type</h2>
 *
 * <p>An {@code INDIVIDUAL} has a name and may have a VÖEN, as an individual entrepreneur does
 * (#239); a {@code LEGAL_ENTITY} has a VÖEN, a registered address and a registration number. Two records — one per subject kind —
 * would model that more precisely and would make every caller switch on the kind before it
 * could ask for a name, which is the one field they all want and the one field both kinds
 * have. So it is one record with optional halves, and {@link #isComplete()} is what a gate
 * asks rather than each gate re-deriving which fields its subject kind requires.
 *
 * <h2>What is not here</h2>
 *
 * <p>No verification state. Whether the platform has <em>checked</em> any of this is
 * {@link CreatorStanding}'s question and is answered from a different table by a different
 * module, because the two facts move independently: a creator corrects a misspelled legal
 * name without that being a new identity check, and an approval ages out without the name
 * changing.
 *
 * <p>No bank details. #432's destination is a token held by the provider, for
 * {@code PayoutRequest}'s stated reason, and a record that carried an IBAN beside a VÖEN
 * would be the second class of sensitive data that reasoning exists to avoid.
 *
 * @param subjectKind an individual or a registered entity, in V58's vocabulary
 * @param legalName the name that must agree with #429's certificate subject and #432's
 *     account holder. Present for both kinds
 * @param taxId the VÖEN — a legal entity's, or an individual entrepreneur's. Shape-validated
 *     and nothing more — see
 *     {@code TaxIdentifier}
 * @param registeredAddress the address on the registration extract, for a legal entity
 * @param registrationNumber the entity's registration number, for a legal entity
 */
public record LegalSubject(
        SubjectKind subjectKind,
        String legalName,
        String taxId,
        String registeredAddress,
        String registrationNumber) {

    public LegalSubject {
        Objects.requireNonNull(subjectKind, "A legal subject is a person or a company");
        Objects.requireNonNull(legalName, "A legal subject has a name");
        if (legalName.isBlank()) {
            throw new IllegalArgumentException("A legal subject has a name");
        }
        taxId = blankToNull(taxId);
        registeredAddress = blankToNull(registeredAddress);
        registrationNumber = blankToNull(registrationNumber);
    }

    /** An individual with no VÖEN recorded, who has a name and no registration. */
    public static LegalSubject individual(String legalName) {
        return new LegalSubject(SubjectKind.INDIVIDUAL, legalName, null, null, null);
    }

    public Optional<String> taxIdentifier() {
        return Optional.ofNullable(taxId);
    }

    public Optional<String> address() {
        return Optional.ofNullable(registeredAddress);
    }

    public Optional<String> registration() {
        return Optional.ofNullable(registrationNumber);
    }

    /**
     * Whether every field this subject kind requires is present.
     *
     * <p>Asked by the gates rather than re-derived by each of them. An individual is complete
     * as soon as they have a name; a legal entity is not complete until the platform can say
     * which company, where, and under what number — because "a company called that" is not a
     * party an indemnity clause can be enforced against.
     *
     * <p>Note what completeness is not: it is not verification. A creator may type any
     * company's details in and this returns true. #431 is the check.
     */
    public boolean isComplete() {
        return switch (subjectKind) {
            case INDIVIDUAL -> true;
            case LEGAL_ENTITY -> taxId != null && registeredAddress != null && registrationNumber != null;
        };
    }

    /**
     * Whether a name from somewhere else — a SİMA certificate subject, a bank account holder —
     * is the name on this subject.
     *
     * <p><strong>The comparison is deliberately forgiving about presentation and about nothing
     * else.</strong> Case and runs of whitespace differ between a state certificate, a bank
     * statement and a form a person typed, and refusing on those would produce a
     * {@code MISMATCHED_NAME} that means "you pressed shift", which is how a real refusal
     * stops being read. What it does not do is fuzzy matching: a missing patronymic or a
     * transliterated surname is a genuine mismatch and belongs in front of a human, which is
     * what {@code RejectionReason.MISMATCHED_NAME} puts it in front of.
     */
    public boolean nameMatches(String other) {
        return other != null && normalise(legalName).equals(normalise(other));
    }

    private static String normalise(String name) {
        return name.trim().replaceAll("\\s+", " ").toUpperCase(java.util.Locale.ROOT);
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
