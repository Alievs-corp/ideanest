package az.ideanest.project.application;

import java.util.List;

/**
 * The edge to {@code LIVE} is allowed, and the campaign has nothing to be live
 * with.
 *
 * <p>Answered as 409 with {@code code: PROJECT_NOT_LAUNCHABLE} and the missing
 * fields in {@code meta}. A conflict rather than a bad request, for the same
 * reason as a refused transition: the request is well formed and the state of the
 * campaign is what refuses it.
 *
 * <p><strong>Reachable through approval since #552.</strong> §5.1 resolves a campaign by
 * comparing its total against its goal at its deadline, so a live campaign without a goal or
 * a duration cannot be resolved at all — {@code projects_public_states_are_fully_specified}
 * refuses the row outright. {@code ProjectChecklistService} refuses to submit such a campaign,
 * but both fields stay editable while it is in review, and approving now launches it. So the
 * approval asks this first and refuses with it, which tells the moderator why and leaves the
 * campaign in {@code SUBMITTED} rather than approved and unable to open. The creator's launch
 * and the scheduled launch of §8.4 keep the same guard for rows edited by other means.
 */
public class ProjectNotLaunchableException extends RuntimeException {

    private final List<String> missing;

    public ProjectNotLaunchableException(List<String> missing) {
        super("A project cannot go live without " + String.join(" and ", missing));
        this.missing = List.copyOf(missing);
    }

    /** JSON field names, so a client can point at the inputs that are empty. */
    public List<String> missing() {
        return missing;
    }
}
