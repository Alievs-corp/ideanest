package az.ideanest.verification.application;

/** The console named a student verification that is not there — #655. */
public class StudentVerificationNotFoundException extends RuntimeException {

    public StudentVerificationNotFoundException() {
        super("No such student verification");
    }
}
