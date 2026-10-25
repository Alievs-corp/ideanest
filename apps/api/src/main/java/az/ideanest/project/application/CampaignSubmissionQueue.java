package az.ideanest.project.application;

import az.ideanest.project.ProjectProperties;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.SubmissionQueueRow;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What is waiting on a moderator, and the gap it closes.
 *
 * <p>{@code ProjectModerationController} has served {@code approve}, {@code reject} and
 * {@code request-changes} since #101, and nothing has ever listed what they apply to.
 * The consequence was not theoretical: a moderator could only reach a campaign through
 * a <em>report</em> about it, so a campaign nobody complained about could be submitted
 * and wait indefinitely, invisible to the console, while its creator saw "submitted for
 * review". Three privileged actions whose subject cannot be found are three actions
 * nobody takes.
 *
 * <p><strong>This is not the report queue and does not belong in the moderation
 * module.</strong> A report is a complaint somebody filed; this is a state in a
 * campaign's own state machine, read off {@code projects} and
 * {@code project_state_transitions}, which are this module's tables. The moderation
 * module owning it would mean reaching into them — the same argument
 * {@code ProjectModerationController} already makes about why the three outcomes live
 * here.
 *
 * <h2>The states it serves</h2>
 *
 * <p>{@code SUBMITTED} is the queue and is the default. The other three
 * — {@code CHANGES_REQUESTED}, {@code APPROVED}, {@code REJECTED} — are how a moderator
 * looks back at what was decided, which is the same shape the report queue gives its
 * three states and is worth having for the same reason: a decision nobody can find
 * afterwards is a decision that cannot be reviewed. Anything else is refused rather
 * than answered empty, because "no campaigns are LIVE for review" is a sentence that
 * reads as a fact about the platform instead of as a misuse of the endpoint.
 *
 * <h2>Who may read it</h2>
 *
 * <p>{@code MODERATE_CONTENT}, through {@link PlatformStaff#requireCapability}. A queue
 * that listed campaigns to anybody signed in would publish, for every unlaunched
 * campaign on the platform, its title, its goal and the fact that its creator is
 * waiting on us — so a check of some kind is not optional.
 *
 * <p><strong>The same check the three outcomes it feeds make.</strong> It was narrower
 * until #574: {@code ProjectAccess.requireModeratable} asked only whether the caller was
 * staff at all, so a finance-only account could approve a campaign over the API while
 * this screen refused to show it one. A queue and its decisions now ask one question.
 */
@Service
public class CampaignSubmissionQueue {

    /** What a moderator may look at. Everything else is a 400 rather than an empty page. */
    private static final Set<ProjectState> REVIEWABLE =
            Set.of(
                    ProjectState.SUBMITTED,
                    ProjectState.CHANGES_REQUESTED,
                    ProjectState.APPROVED,
                    ProjectState.REJECTED);

    private final ProjectRepository projects;
    private final UserAccounts accounts;
    private final PlatformStaff staff;
    private final ProjectProperties properties;

    public CampaignSubmissionQueue(
            ProjectRepository projects,
            UserAccounts accounts,
            PlatformStaff staff,
            ProjectProperties properties) {

        this.projects = projects;
        this.accounts = accounts;
        this.staff = staff;
        this.properties = properties;
    }

    /**
     * One page, oldest first.
     *
     * @param moderatorId whoever is signed in
     * @param state which of {@link #REVIEWABLE} to read
     * @param after the {@code nextCursor} of the previous page, or null for the first
     * @param limit already clamped by the controller, which is where a request's shape
     *     is decided
     * @throws UnreviewableStateException for a state that is not one a moderator decides.
     *     A caller without {@code MODERATE_CONTENT} is refused by {@link PlatformStaff}
     *     before any of this runs
     */
    @Transactional(readOnly = true)
    public SubmissionQueuePage page(UUID moderatorId, ProjectState state, UUID after, int limit) {
        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);
        if (!REVIEWABLE.contains(state)) {
            throw new UnreviewableStateException(state);
        }

        List<SubmissionQueueRow> rows = after == null
                ? projects.findSubmissionQueue(state.name(), limit)
                : projects.findSubmissionQueueAfter(state.name(), after, limit);

        if (rows.isEmpty()) {
            return new SubmissionQueuePage(state, List.of(), null);
        }

        Map<UUID, UserAccount> creators = accounts.findAllById(creatorIdsOf(rows));

        // A full page is the only honest signal that there may be more -- the argument
        // ReportModerationService makes, and the cursor here has the same property.
        UUID nextCursor = rows.size() < limit ? null : rows.get(rows.size() - 1).getCursor();
        return new SubmissionQueuePage(state, rows.stream().map(row -> toSubmission(row, creators)).toList(), nextCursor);
    }

    /** Distinct, because one creator with three campaigns in the queue is one lookup. */
    private static Set<UUID> creatorIdsOf(List<SubmissionQueueRow> rows) {
        Set<UUID> ids = new LinkedHashSet<>();
        for (SubmissionQueueRow row : rows) {
            ids.add(row.getCreatorId());
        }
        return ids;
    }

    private static SubmittedCampaign toSubmission(SubmissionQueueRow row, Map<UUID, UserAccount> creators) {
        UserAccount creator = creators.get(row.getCreatorId());
        return new SubmittedCampaign(
                row.getCursor(),
                row.getProjectId(),
                row.getTitle(),
                row.getSlug(),
                ProjectState.valueOf(row.getState()),
                row.getEnteredAt(),
                row.getNote(),
                row.getCreatorId(),
                // Null rather than a placeholder: §17.4 anonymises an account and leaves
                // its campaigns behind, and inventing a name here would tell a moderator
                // there is somebody to write to.
                creator == null ? null : creator.name(),
                creator == null ? null : creator.slug(),
                row.getGoalAmount() == null ? null : Money.of(row.getGoalAmount(), row.getCurrency()));
    }

    /** The page size a request gets, clamped rather than refused. */
    public int pageSize(Integer requested) {
        ProjectProperties.Submissions limits = properties.submissions();
        if (requested == null) {
            return limits.defaultPageSize();
        }
        // Clamped at both ends. A client asking for a thousand is asking for as much as
        // it can have, and a 400 there would only teach it to ask for the maximum.
        return Math.clamp(requested, 1, limits.maxPageSize());
    }
}
