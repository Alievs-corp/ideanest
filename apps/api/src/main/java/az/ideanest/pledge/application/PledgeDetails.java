package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeRaise;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.domain.PledgeSupplement;
import az.ideanest.pledge.domain.SupplementAddon;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRaiseRepository;
import az.ideanest.pledge.infrastructure.PledgeSupplementRepository;
import az.ideanest.pledge.infrastructure.SupplementAddonRepository;
import az.ideanest.project.application.PledgeAcceptance;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * Assembles the whole of a pledge for a response — the add-on lines, the
 * post-campaign purchases, and their lines.
 *
 * <p><strong>One assembler rather than one per service</strong>, and #76 is what made
 * that necessary: a pledge is now four tables, {@code PledgeService} and
 * {@code PledgeSupplementService} both answer with the same shape, and two copies of
 * "read the pledge and everything hanging off it" is the arrangement in which one of
 * them quietly stops including the newest table. A backer who upgraded and then
 * confirmed would see their purchase on one endpoint and not on the next.
 *
 * <p>Called inside the caller's transaction and never on its own. {@code open-in-view}
 * is off, and the whole point of assembling here is that the reads happen while the
 * session is open.
 */
@Component
public class PledgeDetails {

    private final PledgeAddonRepository addons;
    private final PledgeSupplementRepository supplements;
    private final SupplementAddonRepository supplementLines;
    private final PledgeRaiseRepository raises;
    private final PledgeAcceptance acceptance;

    public PledgeDetails(
            PledgeAddonRepository addons,
            PledgeSupplementRepository supplements,
            SupplementAddonRepository supplementLines,
            PledgeRaiseRepository raises,
            PledgeAcceptance acceptance) {

        this.addons = addons;
        this.supplements = supplements;
        this.supplementLines = supplementLines;
        this.raises = raises;
        this.acceptance = acceptance;
    }

    /**
     * The pledge with its lines and its purchases.
     *
     * <p>The lines of the purchases are read in one query for all of them rather than
     * one per purchase, which is what {@code SupplementAddonRepository.findBySupplements}
     * exists for; a pledge with no purchases makes no second query at all, which is
     * every pledge on the platform until somebody upgrades.
     */
    public PledgeDetail of(Pledge pledge) {
        List<PledgeSupplement> bought = supplements.findByPledge(pledge.getId());
        List<SupplementAddon> lines = bought.isEmpty()
                ? List.of()
                : supplementLines.findBySupplements(
                        bought.stream().map(PledgeSupplement::getId).toList());

        PledgeRaise latestRaise =
                raises.findLatest(pledge.getId(), PageRequest.of(0, 1)).stream().findFirst().orElse(null);
        // #171: a paid pledge is raised while its campaign takes pledges, and the service is the only
        // side that can say whether it does.
        boolean raisable = pledge.getState() == PledgeState.COLLECTED
                && acceptance.isAcceptingPledges(pledge.getProjectId());

        return new PledgeDetail(
                pledge, addons.findByPledge(pledge.getId()), bought, lines, latestRaise, raisable);
    }
}
