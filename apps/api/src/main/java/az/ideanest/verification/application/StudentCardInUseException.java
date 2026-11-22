package az.ideanest.verification.application;

/**
 * The card number is held by another account — #655's "one card number, one account".
 *
 * <p>Pending there, or approved there and still counting. The message names neither the other
 * account nor anything about it: whose card it is is not the caller's to learn.
 */
public class StudentCardInUseException extends RuntimeException {

    public StudentCardInUseException() {
        super("That student card number is already in use on another account");
    }
}
