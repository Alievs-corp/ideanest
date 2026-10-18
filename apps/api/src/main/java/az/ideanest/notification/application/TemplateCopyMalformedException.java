package az.ideanest.notification.application;

/**
 * Edited email copy that would not render — #315.
 *
 * <p>422, like {@link MissingTemplatePlaceholderException}: the request is well formed and
 * the text is refused for what it says. Checked on write because the alternative is finding
 * out at send time, on a background thread, with the platform's real mail: an unbalanced
 * brace made {@code MessageFormat} throw inside {@code EmailComposer}, and a placeholder for a
 * fact the message does not carry rendered as an empty gap in every copy sent.
 */
public class TemplateCopyMalformedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** What is wrong, for the console to word. */
    public enum Reason {
        /** A brace that does not close, a placeholder that is not a bare number, a format in one. */
        SYNTAX,
        /** A placeholder for a fact this message does not carry. */
        UNKNOWN_PLACEHOLDER
    }

    private final String field;
    private final Reason reason;
    private final String placeholder;

    /**
     * @param field {@code subject} or {@code body}
     * @param placeholder the index, for {@link Reason#UNKNOWN_PLACEHOLDER}; null otherwise
     */
    public TemplateCopyMalformedException(String field, Reason reason, String placeholder) {
        super("The " + field + " does not render: " + reason);
        this.field = field;
        this.reason = reason;
        this.placeholder = placeholder;
    }

    public String field() {
        return field;
    }

    public Reason reason() {
        return reason;
    }

    public String placeholder() {
        return placeholder;
    }
}
