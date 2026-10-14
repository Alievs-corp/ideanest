package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import az.ideanest.project.infrastructure.ProjectRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What the payment module is allowed to ask about a campaign it is taking money for (#64).
 *
 * <p>Answered with a record rather than the entity, so that {@code ModuleBoundaryTests}'
 * rule holds and the payment module can be read without {@code Project} in scope. A paid
 * pledge and a dispute both need the campaign's creator and currency to post to the ledger.
 *
 * <p>Until #45 it also opened the stored-card collection at close — {@code SUCCESSFUL →
 * COLLECTING} — which IDN-EXT-01 replaced with charging the backer when they pledge.
 */
@Service
public class CampaignCollections {

    private final ProjectRepository projects;

    public CampaignCollections(ProjectRepository projects) {
        this.projects = projects;
    }

    /**
     * A campaign, for the payment or dispute that is posting one of its pledges.
     *
     * <p>Read on every posting rather than cached, and that is a deliberate cost. It is one
     * primary-key read against a row the page cache is certainly holding, and a cached
     * creator identifier is precisely the sort of staleness that is invisible until it
     * credits the wrong account.
     *
     * <p>Empty when the campaign has gone, which nothing does today. The caller treats
     * that as a failed attempt rather than as a reason to charge anyway.
     */
    @Transactional(readOnly = true)
    public Optional<CollectingCampaign> describe(UUID projectId) {
        return projects.findById(projectId).map(CampaignCollections::describe);
    }

    private static CollectingCampaign describe(Project project) {
        return new CollectingCampaign(project.getId(), project.getCreatorId(), project.getCurrency());
    }
}
