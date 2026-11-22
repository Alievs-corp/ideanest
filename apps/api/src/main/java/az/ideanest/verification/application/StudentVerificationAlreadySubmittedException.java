package az.ideanest.verification.application;

/**
 * The account already has a check waiting for staff, or an approval that still counts — #655.
 *
 * <p>A second submission would be a second row for a reviewer to compare with the first. A
 * refused or expired check is the time to submit again.
 */
public class StudentVerificationAlreadySubmittedException extends RuntimeException {

    public StudentVerificationAlreadySubmittedException() {
        super("This account already has a student verification waiting for review or approved");
    }
}
