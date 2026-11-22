package az.ideanest.verification.application;

/**
 * The decision does not apply to the state the submission is in — #655.
 *
 * <p>Approving or refusing anything but a pending submission, or revoking anything but an approval
 * that still counts. The realistic cause is two members of staff in the same queue.
 */
public class StudentVerificationNotDecidableException extends RuntimeException {

    public StudentVerificationNotDecidableException(String message) {
        super(message);
    }
}
