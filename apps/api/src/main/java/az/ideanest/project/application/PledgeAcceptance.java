package az.ideanest.project.application;

import az.ideanest.project.ProjectProperties;
import az.ideanest.project.domain.Project;
import az.ideanest.project.infrastructure.ProjectRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Whether a campaign will take a pledge at all.
 *
 * <p><strong>Here rather than in the pledge module, and that is not filing.</strong>
 * The answer is a statement about {@code projects} — a state from §6.1 and a
 * deadline — and {@code ModuleBoundaryTests} keeps this module's entity and its
 * repository to this module. So the question is asked through the application layer,
 * which is the only part of this module the pledge module is entitled to rely on,
 * and the pledge module never learns what a {@link Project} is.
 *
 * <p><strong>And not in {@code ReservationService} either</strong>, whose javadoc
 * says so and says why: reservation is about stock, checking the campaign there
 * would mean this module being depended on in order to say no twice, and the
 * endpoint has to have asked before it reserves anything anyway.
 *
 * <p><strong>Deliberately not {@link ProjectAccess}.</strong> That class answers
 * "may this account act on this campaign", and every one of its methods is about a
 * relationship between a person and a campaign. This is a question about the
 * campaign alone: a backer has no relationship to it, and a rule stated in terms of
 * capabilities would be a rule about the wrong thing.
 *
 * <p><strong>Three periods, one funding window — IDN-EXT-01 (#36).</strong> A campaign
 * takes pledges while it is {@code LIVE} and before its first deadline, while it is in
 * {@code CLOSING_WINDOW} and inside the seven days after that deadline, and while it is
 * {@code EXTENDED} and before its extension ends — and at no other time. All three are
 * the same funding: the campaign is not decided until the last of them ends, so a pledge
 * taken in any of them counts towards the goal it is judged on.
 *
 * <p><strong>No late pledges.</strong> PL-16's second window (#81), a {@code LATE_PLEDGE}
 * campaign taking money after it was decided, is switched off: the state machine no longer
 * has an edge into that state, and a campaign already in it is refused like any other closed
 * one. So nothing this answers stamps {@code pledges.is_late_pledge} any more; the column
 * goes with stage 4 (#45).
 */
@Service
public class PledgeAcceptance {

    private final ProjectRepository projects;
    private final ProjectProperties properties;
    private final Clock clock;

    public PledgeAcceptance(ProjectRepository projects, ProjectProperties properties, Clock clock) {
        this.projects = projects;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * The same question, asked by somebody who has something else to do with the
     * answer — §4.8's PM-09 and PM-10 (#76).
     *
     * <p>The pledge manager's post-campaign purchases are refused <em>while</em> a
     * campaign is still taking pledges, because §4.5's PL-09 edit is the way to change
     * a pledge then and two ways to change one thing is how the two come to disagree.
     * So the one caller of this needs "yes or no" rather than "or else", and catching
     * {@link ProjectNotAcceptingPledgesException} to invert it would be control flow
     * through an exception whose whole purpose is to be reported to a client.
     *
     * <p>A campaign that does not exist answers {@code false} rather than throwing:
     * the caller is holding a pledge that names it, so the identifier is real, and the
     * refusal it would raise belongs to the pledge it loaded rather than to this.
     */
    @Transactional(readOnly = true)
    public boolean isAcceptingPledges(UUID projectId) {
        try {
            requireAcceptingPledges(projectId);
            return true;
        } catch (ProjectNotAcceptingPledgesException | ProjectNotFoundException closed) {
            return false;
        }
    }

    /**
     * Refuses a pledge on a campaign that will not take one.
     *
     * <p>No lock. The campaign's state can change between this check and the pledge
     * being written — a creator can cancel, and the finalizer runs every minute —
     * and a lock held across a checkout would be the wrong answer to that: it would
     * make a backer's draft block a campaign transition, on a row read by every
     * request in the platform. The window is a few milliseconds wide and what is on
     * the other side of it is a DRAFT pledge holding nothing that was charged;
     * cancellation releases those, which is #56's and epic #59's job rather than a
     * reason to serialise the campaign here.
     *
     * @throws ProjectNotFoundException when there is no such campaign, and when there
     *     is one that has never launched — deliberately the same answer
     * @throws ProjectNotAcceptingPledgesException when a campaign that did launch is
     *     no longer taking pledges — §10.4's {@code PROJECT_NOT_LIVE}, carrying the end of
     *     whichever period it was in
     */
    @Transactional(readOnly = true)
    public void requireAcceptingPledges(UUID projectId) {
        Project project = projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));

        if (project.getLaunchedAt() == null) {
            // **A campaign that never launched is answered 404, not 409.**
            // {@link ProjectNotFoundException} explains what a draft is: an
            // unreleased product, a price nobody has been told, sometimes a company
            // that does not exist yet. A refusal that said "this campaign is not
            // live" would confirm to anybody holding an identifier that there is a
            // campaign there, which is precisely what the 404 protects — and it
            // would do it from an endpoint that needs no relationship to the
            // campaign at all.
            //
            // `launched_at` rather than a list of states, because it is the one
            // field that answers "has this ever been public" and cannot fall behind
            // §6.1 gaining a state.
            throw new ProjectNotFoundException(projectId);
        }

        Instant ends = endOfFunding(project);
        // A campaign whose period has ended but which is still in that state is one the
        // finalizer has not reached yet (§8.4, every minute). Refusing it here is the
        // difference between a deadline and a suggestion: a pledge taken in that minute
        // would be a commitment made after the funding the backer was shown.
        //
        // A null end on a taking state cannot happen —
        // projects_public_states_are_fully_specified requires a deadline, and
        // projects_extension_recorded_together an extension's end — and it is treated as
        // open rather than refused, because inventing a refusal for a row the database
        // cannot hold would be a branch nothing can ever test.
        if (ends == null) {
            if (takesPledges(project)) {
                return;
            }
        } else if (ends.isAfter(clock.instant())) {
            return;
        }
        throw new ProjectNotAcceptingPledgesException(
                projectId,
                project.getState().name(),
                // The end of the period the campaign is in, so a backer refused on the fifth
                // day of an extension is not told about a deadline weeks earlier.
                ends == null ? project.getDeadline() : ends);
    }

    private static boolean takesPledges(Project project) {
        return switch (project.getState()) {
            case LIVE, CLOSING_WINDOW, EXTENDED -> true;
            default -> false;
        };
    }

    /**
     * When the campaign stops taking pledges, for the three states that take them; the first
     * deadline for any other, which is refused whatever the clock says.
     */
    private Instant endOfFunding(Project project) {
        Instant deadline = project.getDeadline();
        return switch (project.getState()) {
            case LIVE -> deadline;
            case CLOSING_WINDOW -> deadline == null ? null : deadline.plus(properties.finalisation().closingWindow());
            case EXTENDED -> project.getExtendedUntil();
            // Any other state is closed. Returning an instant already past keeps the refusal
            // in one place; the deadline is what it reports, as before.
            default -> Instant.MIN;
        };
    }
}
