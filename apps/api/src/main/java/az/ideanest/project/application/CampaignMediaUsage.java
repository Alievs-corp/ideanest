package az.ideanest.project.application;

import az.ideanest.media.application.MediaUsage;
import az.ideanest.project.infrastructure.ProjectRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@code media}'s {@link MediaUsage}, answered with the one query this module already asks before
 * it discards an upload itself — {@link ProjectRepository#isMediaInUse} (#568, #647).
 *
 * <p>The same question and the same statement as {@code ProjectRevisionService.releaseMedia}, so
 * that an upload this module would keep is one {@code media} keeps too: a cover, a campaign
 * video, a story's video block or a version of one, a reward tier's picture or clip, and any of
 * those in an open revision.
 */
@Service
public class CampaignMediaUsage implements MediaUsage {

    private final ProjectRepository projects;

    public CampaignMediaUsage(ProjectRepository projects) {
        this.projects = projects;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isInUse(UUID mediaId) {
        return projects.isMediaInUse(mediaId);
    }
}
