package az.ideanest.project.application;

import az.ideanest.project.domain.ProjectState;
import java.util.List;

/**
 * A reminder was asked for on a campaign that is not collecting them.
 *
 * <p><strong>Two states accept reminders.</strong> {@link ProjectState#APPROVED} and
 * {@link ProjectState#SCHEDULED}: cleared by moderation and not yet taking money (#626).
 * APPROVED is in because it is where an approved campaign actually waits — the launcher
 * takes it straight to LIVE at its launch time. {@link ProjectState#PRELAUNCH} accepted
 * reminders until #626, but a creator reached it from a draft without moderation, so its
 * page is now a 404 like a draft's. {@link ProjectState#LIVE} is refused
 * because a reminder to be told about something that has already happened is a
 * message nobody will ever be sent, and accepting it quietly would be worse than
 * refusing it: the visitor would believe they had been added to something.
 *
 * <p><strong>Raised only for a campaign the caller can already see.</strong> That
 * is the line between this and {@link ProjectNotFoundException}, and it is drawn
 * in {@code PrelaunchService}: a campaign that has not opened a pre-launch page is
 * a 404, exactly as it is on the page itself, because telling a stranger "this
 * identifier is a draft" is telling them what somebody is preparing. What is left
 * for this exception is the case where the visitor was looking at a real
 * pre-launch page a moment ago and the campaign has moved on underneath them —
 * usually because it launched while the page sat open.
 *
 * <p>A 409 rather than a 400: the request was well formed and would have been
 * accepted a moment earlier. §10.4 asks that a refusal carry something the client
 * can act on, and here that is the state — a client that sees {@code LIVE} sends
 * the visitor to back the campaign, and one that sees {@code CANCELED} does not.
 */
public class RemindersClosedException extends RuntimeException {

    /** The two states in which a pre-launch page exists and collects reminders (#626). */
    public static final List<ProjectState> ACCEPTED_IN = List.of(ProjectState.APPROVED, ProjectState.SCHEDULED);

    private final transient ProjectState state;

    public RemindersClosedException(ProjectState state) {
        super("A project in " + state + " does not collect launch reminders");
        this.state = state;
    }

    /** Where the campaign actually is, so the client can decide what to offer instead. */
    public ProjectState state() {
        return state;
    }
}
