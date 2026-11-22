package az.ideanest.verification.application;

/**
 * A field of a student verification submission or decision that is not one — #655.
 *
 * <p>{@link #field} names it ({@code institution}, {@code cardNumber}, {@code reason}), so a form
 * can put the sentence beside the right input.
 */
public class InvalidStudentVerificationException extends RuntimeException {

    private final String field;

    public InvalidStudentVerificationException(String field, String message) {
        super(message);
        this.field = field;
    }

    public String field() {
        return field;
    }
}
