package az.ideanest.notification.application;

import az.ideanest.notification.domain.NotificationType;
import java.util.List;

/**
 * The edited copy drops something the shipped copy carries — issue #315.
 *
 * <p>422, not 400: the request is well formed and the body is a perfectly good sentence. It
 * is refused because of what it leaves out, which is a rule about content rather than about
 * shape.
 *
 * <p><strong>This is half the answer to what #315 was blocked on.</strong> The other half
 * is a role — {@code CONFIGURE_PLATFORM}, which only an administrator holds — and it does
 * not cover this case: the administrator editing a payment-failure notice is exactly the
 * person allowed to, so nothing about who they are stops them shipping one that no longer
 * says which card was declined. The placeholders are what does.
 *
 * <p>The missing indices travel with it so the console can point at them.
 */
public class MissingTemplatePlaceholderException extends RuntimeException {

    private final transient List<String> missing;

    public MissingTemplatePlaceholderException(NotificationType type, String locale, List<String> missing) {
        super("The " + locale + " copy for " + type + " must keep " + missing);
        this.missing = List.copyOf(missing);
    }

    /** The argument indices the override left out, in numeric order. */
    public List<String> missing() {
        return missing;
    }
}
