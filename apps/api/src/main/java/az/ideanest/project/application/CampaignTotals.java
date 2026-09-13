package az.ideanest.project.application;

import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.shared.money.Money;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a campaign has raised: {@code projects.pledged_amount} and {@code backers_count} — IDN-EXT-01 (#39).
 *
 * <p><strong>The first writer those two columns have had.</strong> §5.1 has always decided a campaign
 * on {@code pledged_amount}, and §4.3 sorts and bands on it, but nothing in production moved it:
 * the entity maps both columns read-only and no statement or trigger wrote them. Under IDN-EXT-01 a
 * pledge is paid for when it is confirmed, so a paid pledge is exactly what should count, and the
 * pledge module calls this in the transaction that collects it.
 *
 * <p>One statement that adds, rather than a read and a write: two backers paying at the same moment
 * must not each read the old total and overwrite the other.
 */
@Service
public class CampaignTotals {

    private final ProjectRepository projects;

    public CampaignTotals(ProjectRepository projects) {
        this.projects = projects;
    }

    /**
     * Counts one paid pledge: its total towards the amount raised, and one backer.
     *
     * <p>One backer per pledge is exact, because a backer has at most one active pledge per campaign
     * (§7.2) and a raise is a supplement to the same pledge, not a second one.
     *
     * @throws IllegalStateException when the campaign does not exist or is in another currency
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void addCollected(UUID projectId, Money amount) {
        int updated = projects.addToTotals(projectId, amount.amount(), amount.currency());
        if (updated != 1) {
            throw new IllegalStateException(
                    "Campaign " + projectId + " in " + amount.currency() + " could not be credited with a paid pledge");
        }
    }
}
