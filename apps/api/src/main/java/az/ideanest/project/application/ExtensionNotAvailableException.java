package az.ideanest.project.application;

import java.util.UUID;

/**
 * The creator asked to extend a campaign that may not be extended now — IDN-EXT-01 (#34).
 *
 * <p>A 409 rather than a 400: the request is well formed and the creator is entitled to make it;
 * what is missing is a condition of the campaign. The {@link Reason} says which, because each
 * one sends a creator somewhere different — a campaign below half its goal needs backers, one
 * outside the window needs nothing because it cannot be done, and one already extended has had
 * its one extension.
 */
public class ExtensionNotAvailableException extends RuntimeException {

    /** Which of §5.1's conditions is not met. */
    public enum Reason {
        /** Not live and not in its seven-day window. */
        WRONG_STATE,
        /** §5.1: one extension. This campaign has had it. */
        ALREADY_EXTENDED,
        /** Outside seven days before to seven days after the first deadline. */
        OUTSIDE_WINDOW,
        /** Below half of the goal. */
        BELOW_THRESHOLD
    }

    private final UUID projectId;
    private final Reason reason;

    public ExtensionNotAvailableException(UUID projectId, Reason reason) {
        super("Campaign " + projectId + " cannot be extended: " + reason);
        this.projectId = projectId;
        this.reason = reason;
    }

    public UUID projectId() {
        return projectId;
    }

    public Reason reason() {
        return reason;
    }
}
