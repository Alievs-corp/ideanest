package az.ideanest.verification.application;

/**
 * A student verification photograph the platform will not store — #655.
 *
 * <p>The identity check's refusal and its codes ({@code EMPTY}, {@code TOO_LARGE},
 * {@code UNSUPPORTED_TYPE}), with the multipart part it was about, because a submission carries
 * two files and the creator has to be told which one to replace.
 */
public class StudentDocumentRefusedException extends DocumentRefusedException {

    private static final long serialVersionUID = 1L;

    private final String field;

    public StudentDocumentRefusedException(String field, Reason reason, String message) {
        super(reason, message);
        this.field = field;
    }

    /** {@code studentCard} or {@code selfie}: the part's name. */
    public String field() {
        return field;
    }
}
