package az.ideanest.verification.application;

import az.ideanest.verification.domain.StudentDocumentKind;
import az.ideanest.verification.domain.StudentVerification;
import az.ideanest.verification.domain.StudentVerificationState;
import java.util.List;
import java.util.UUID;

/**
 * One student verification as the console reviews it — #655.
 *
 * @param state where it stands now, the clock included
 * @param accountName null when the account is gone or anonymised
 * @param accountEmail likewise. Shown to staff because a reviewer comparing a card with a person
 *     reads the address the card was registered with, and the console's account page shows it
 *     anyway
 * @param documents the photographs still held, card first. Empty once a decision erased them
 * @param sameCardElsewhere every other account that ever submitted the same normalised card
 *     number, with where its newest such submission stands — a warning, not a refusal
 */
public record StudentVerificationReview(
        StudentVerification verification,
        StudentVerificationState state,
        String accountName,
        String accountEmail,
        List<StudentDocumentKind> documents,
        List<OtherAccount> sameCardElsewhere) {

    /** Another account that used the same card number. */
    public record OtherAccount(UUID accountId, String accountName, StudentVerificationState state) {
    }
}
