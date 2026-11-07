package az.ideanest.project.application;

import az.ideanest.project.infrastructure.ProjectRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@code projects.view_count}, for the module that counts views — #633.
 *
 * <p>The analytics module decides when somebody has viewed a campaign; the column is this
 * module's, so the write is too. Three questions and no entity: the capture endpoint asks
 * them for every campaign event it receives, and loading a {@code Project} to read one
 * column of it would be the most expensive thing that endpoint does.
 *
 * <p><strong>Public means {@link PublicProjects#VISIBLE}</strong>, the rule every public
 * surface applies. A view of a draft, a pre-launch page or a suspended campaign is not
 * counted, and the endpoint does not say so — it must not be a way to find out which
 * identifiers exist.
 */
@Service
public class CampaignViews {

    private final ProjectRepository projects;

    public CampaignViews(ProjectRepository projects) {
        this.projects = projects;
    }

    /** Whether the campaign exists and the public may read it. False for both "no" answers alike. */
    @Transactional(readOnly = true)
    public boolean isPublic(UUID projectId) {
        return projects.findStateById(projectId).map(PublicProjects.VISIBLE::contains).orElse(false);
    }

    /**
     * One more daily viewer. Joins the caller's transaction, which is the point: the count
     * moves exactly when the first view of the day is recorded, or not at all.
     */
    @Transactional
    public void countView(UUID projectId) {
        projects.addView(projectId);
    }

    /** Daily viewers summed, all time; zero for a campaign that does not exist. */
    @Transactional(readOnly = true)
    public long viewsOf(UUID projectId) {
        return projects.findViewCountById(projectId).orElse(0L);
    }
}
