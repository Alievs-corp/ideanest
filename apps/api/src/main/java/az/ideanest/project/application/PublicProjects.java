package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.project.infrastructure.PublicProjectPages;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Whether a campaign may be read by somebody with no relationship to it, for a
 * caller that may not name a campaign.
 *
 * <p><strong>The counterpart of {@link ProjectAccess}, not a variant of it.</strong>
 * That class answers "who may act on this campaign" and every one of its methods
 * takes an account. The public surfaces have no account to take — a visitor reading
 * a campaign page is the audience they exist for — and what stands in for
 * authorisation is the campaign's state, exactly as {@link PrelaunchService} says of
 * its own three methods. Keeping that second rule in one place is the same argument
 * that gave the first one a home: written inline in each public endpoint, it becomes
 * one rule per endpoint, and the first one that forgets {@code SUSPENDED} publishes a
 * campaign trust and safety stopped.
 *
 * <p><strong>The nine states, and why they are these nine.</strong> They are exactly
 * {@code DiscoveryStatus.PUBLIC_STATES}, which is the set every read in the discovery
 * module already applies. Two of the sixteen decide the shape:
 *
 * <ul>
 *   <li>{@link ProjectState#PRELAUNCH} is in. It has a public page — that is what the
 *       {@code DRAFT → PRELAUNCH} edge is for — so a stranger holding its identifier
 *       is looking at something the creator published.
 *   <li>{@link ProjectState#SUSPENDED} is out, although it is a campaign the public
 *       has already seen and pledged to. It was stopped by trust and safety,
 *       frequently while an investigation is open, and continuing to serve its
 *       reward tiers would be offering for sale what the platform has just withdrawn.
 * </ul>
 *
 * <p>The set is written here rather than imported from discovery because that one
 * lives in {@code discovery.domain}, which is another module's internals —
 * {@code ModuleBoundaryTests} forbids reaching into it, and rightly: discovery reads
 * {@code projects.state} as text out of its own SQL and has no {@link ProjectState}
 * to say it with. Two independent statements of one rule, checked against each other
 * in a test, is the arrangement {@code DiscoveryStatus} already uses for its own
 * partition, and it is better than one statement and one derivation that cannot
 * disagree because nobody ever reads it.
 *
 * <p><strong>404, never 403.</strong> A campaign that is not publicly visible is
 * answered as one that does not exist, which is the answer {@link ProjectAccess}
 * gives a stranger and the answer {@link PrelaunchService#page} gives for a draft. A
 * 403 would confirm the identifier is real, and what it would confirm about is a
 * campaign somebody is still preparing or one a moderator has just stopped.
 */
@Service
public class PublicProjects {

    /**
     * See the class comment. The same nine as {@code DiscoveryStatus.PUBLIC_STATES}.
     *
     * <p><strong>Package-private rather than private since #274.</strong>
     * {@link ProfileCampaigns} serves §4.2's two public campaign lists and has to apply
     * this exact set; a second literal nine states away in the same package would be the
     * copy that eventually falls behind, and the specific way it falls behind is that it
     * keeps {@code SUSPENDED} out of one list and lets it into another. Still not public:
     * every module outside this one asks a method here rather than holding the set, so a
     * caller cannot come to depend on the enum it is written in.
     */
    static final Set<ProjectState> VISIBLE = EnumSet.of(
            ProjectState.PRELAUNCH,
            ProjectState.LIVE,
            ProjectState.CANCELED,
            ProjectState.SUCCESSFUL,
            ProjectState.UNSUCCESSFUL,
            ProjectState.COLLECTING,
            ProjectState.LATE_PLEDGE,
            ProjectState.FULFILLING,
            ProjectState.COMPLETED,
            // IDN-EXT-01 (#32).
            ProjectState.CLOSING_WINDOW,
            ProjectState.EXTENDED,
            ProjectState.WITHDRAWN);

    private final ProjectRepository projects;
    private final PublicProjectPages pages;

    public PublicProjects(ProjectRepository projects, PublicProjectPages pages) {
        this.projects = projects;
        this.pages = pages;
    }

    /**
     * The campaign at a public URL — §10.2's
     * {@code GET /v1/projects/{creatorSlug}/{projectSlug}}, and what #119 server-renders.
     *
     * <p><strong>The same nine states as {@link #requireVisible}, checked by the same
     * set.</strong> That is the whole reason this method is here rather than on the
     * repository: the rule about which campaigns a stranger may see has one statement,
     * and a second read path that filtered by its own list would be the copy that
     * eventually falls behind — publishing a campaign a moderator has just suspended,
     * quietly, on the one surface a search engine indexes.
     *
     * <p>404 for a campaign in any other state, and for a URL that resolves to nothing.
     * The same answer for both, so this endpoint cannot be used to find out what a
     * creator is preparing under a name they have not announced.
     *
     * @param locale one of §21.1's four, from {@code Taxonomy.localeFor}; decides which
     *     translation the category and subcategory names come back in
     */
    @Transactional(readOnly = true)
    public PublicProjectPage page(String creatorSlug, String projectSlug, String locale) {
        PublicProjectPage page = pages.find(creatorSlug, projectSlug, locale)
                .orElseThrow(() -> new ProjectNotFoundException(creatorSlug, projectSlug));

        if (!VISIBLE.contains(ProjectState.valueOf(page.state()))) {
            throw new ProjectNotFoundException(creatorSlug, projectSlug);
        }
        return page;
    }

    /**
     * The campaign's public facts, if it has any.
     *
     * <p>Loading and checking are one call, as everywhere else in this module: a
     * method that only answered {@code boolean} would leave the load in the callers,
     * and a future caller would load a campaign and forget to ask.
     *
     * @return what a public endpoint of another module is allowed to know about a
     *     campaign, which is deliberately two values rather than the entity. A
     *     {@link Project} in another module's hands is that module reaching into this
     *     one's domain, and it is what {@link EditLocks} already refuses to do for the
     *     same reader
     * @throws ProjectNotFoundException for an identifier that does not exist and for
     *     one whose state is not public. The same exception for both, on purpose
     */
    @Transactional(readOnly = true)
    public PublicCampaign requireVisible(UUID projectId) {
        Project project = projects.findById(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));
        if (!VISIBLE.contains(project.getState())) {
            throw new ProjectNotFoundException(projectId);
        }
        return new PublicCampaign(project.getState().name(), project.getCurrency());
    }

    /**
     * A publicly visible campaign, as the modules that hang off it need it.
     *
     * @param state by name, because the module asking has no enum to hold it in —
     *     the same reasoning {@link EditLocks} gives
     * @param currency what every price on the campaign is denominated in. It is on
     *     the campaign rather than on the tier as far as a client is concerned, and a
     *     reward list has to be able to state it even when the campaign has no tiers
     *     at all
     */
    public record PublicCampaign(String state, String currency) {
    }
}
