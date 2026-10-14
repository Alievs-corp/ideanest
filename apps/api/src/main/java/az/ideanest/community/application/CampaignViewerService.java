package az.ideanest.community.application;

import az.ideanest.community.infrastructure.FollowRepository;
import az.ideanest.community.infrastructure.SaveRepository;
import az.ideanest.pledge.application.BackedPledges;
import az.ideanest.project.application.PrelaunchService;
import az.ideanest.project.application.PublicProjects;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What one signed-in reader has already said about one campaign — #137.
 *
 * <p><strong>Four answers from three modules, asked once.</strong> Saving and following are
 * this module's rows; a launch reminder is the project module's, because it can come from
 * somebody with no account; a backing is the pledge module's. The campaign page needs all four
 * to draw its controls in the state the reader left them, and before this it had none: §10.2
 * published a paginated saved list and no per-campaign read, so a reader who saved a campaign
 * last week was offered "Save" again. Each answer is asked of the module that owns the rows,
 * through its application layer, so nothing here reads another module's table.
 *
 * <p><strong>The campaign must be one the public may see</strong>, through
 * {@link PublicProjects#requireVisible}, and anything else is the same 404 a campaign that does
 * not exist gets. The four answers are only ever about the caller's own rows, so this is not
 * protecting them; it is keeping the endpoint from being one more way to ask whether an
 * identifier is a draft somebody is preparing.
 */
@Service
public class CampaignViewerService {

    private final PublicProjects publicProjects;
    private final ProjectSummaries campaigns;
    private final SaveRepository saves;
    private final FollowRepository follows;
    private final PrelaunchService prelaunch;
    private final BackedPledges backings;

    public CampaignViewerService(
            PublicProjects publicProjects,
            ProjectSummaries campaigns,
            SaveRepository saves,
            FollowRepository follows,
            PrelaunchService prelaunch,
            BackedPledges backings) {

        this.publicProjects = publicProjects;
        this.campaigns = campaigns;
        this.saves = saves;
        this.follows = follows;
        this.prelaunch = prelaunch;
        this.backings = backings;
    }

    /**
     * The reader's state on this campaign.
     *
     * @param accountId the authenticated caller, never a value from a request
     * @throws az.ideanest.project.application.ProjectNotFoundException when there is no such
     *     campaign, and when it is not one the public may see
     */
    @Transactional(readOnly = true)
    public ViewerState stateOf(UUID projectId, UUID accountId) {
        publicProjects.requireVisible(projectId);

        // The creator is joined from the summary because `follows` is keyed on an account and
        // this module may not read `projects`. A summary with no creator is the invariant
        // violation `ProjectSummary` describes, and "not following" is the safe reading of it.
        UUID creatorId = campaigns.summaryOf(projectId).map(ProjectSummary::creatorId).orElse(null);

        return new ViewerState(
                saves.existsByProjectIdAndUserId(projectId, accountId),
                prelaunch.hasReminder(projectId, accountId),
                creatorId != null && follows.existsByCreatorIdAndFollowerId(creatorId, accountId),
                backings.isBacking(projectId, accountId));
    }

    /**
     * @param saved this account has the campaign on its saved list
     * @param reminded this account, as an account, asked to be told when the campaign opens
     * @param followingCreator this account follows the campaign's creator
     * @param backed this account holds a backing on the campaign, in the sense of
     *     {@link BackedPledges#isBacking}
     */
    public record ViewerState(boolean saved, boolean reminded, boolean followingCreator, boolean backed) {
    }
}
