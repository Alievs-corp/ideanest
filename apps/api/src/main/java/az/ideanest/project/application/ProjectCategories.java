package az.ideanest.project.application;

import az.ideanest.fee.application.CampaignCategories;
import az.ideanest.project.domain.Project;
import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.project.infrastructure.ProjectRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The project module answering what a campaign is filed under — issue #311.
 *
 * <p>The implementing half of {@link CampaignCategories}, and the same arrangement as
 * {@code ProjectSummaryLookup} implementing {@code shared.project.ProjectSummaries}: the
 * module that owns {@code projects} answers questions about it, and the module that asks
 * names a question rather than a table.
 *
 * <p><strong>It reads every state, not only the public ones.</strong> A payout is
 * calculated for a campaign that has closed, and several of §6.1's closed states are not
 * public — going through {@code PublicProjects} would answer "no category" for exactly the
 * campaigns this is asked about, and every one of them would quietly price against the
 * platform default.
 */
@Service
public class ProjectCategories implements CampaignCategories {

    private final ProjectRepository projects;
    private final CategoryRepository categories;

    public ProjectCategories(ProjectRepository projects, CategoryRepository categories) {
        this.projects = projects;
        this.categories = categories;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UUID> categoryOf(UUID projectId) {
        return projects.findById(projectId).map(Project::getCategoryId);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean categoryExists(UUID categoryId) {
        return categories.existsById(categoryId);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean campaignExists(UUID projectId) {
        return projects.existsById(projectId);
    }
}
