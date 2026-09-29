package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.domain.PledgeRaise;
import az.ideanest.pledge.domain.PledgeSupplement;
import az.ideanest.pledge.domain.SupplementAddon;
import java.util.List;
import java.util.UUID;

/**
 * A pledge and everything that belongs to it, read together.
 *
 * <p>Four tables are one thing to a client, and assembling them here rather than in
 * the controller is what keeps the read inside a transaction: {@code open-in-view} is
 * off, so a response built from a lazily loaded association outside the service layer
 * is a response built from a closed session.
 *
 * <p>The entities themselves rather than a copy of their fields. The boundary this
 * respects is the module one — {@code ModuleBoundaryTests} lets a module's
 * {@code api} package see its own {@code domain} — and interposing a second set of
 * records between the entity and the response would be a third place for the six
 * amounts to be listed and a third place to get one of them wrong.
 *
 * @param addons what the campaign's pledge selected. Priced inside
 *     {@code pledges.addons_amount}
 * @param supplements §4.8's PM-09 and PM-10 (#76): what was bought after the campaign
 *     closed, each charged separately from the pledge and none of them charged yet
 * @param supplementAddons the lines of those purchases, across all of them. Flat
 *     rather than nested inside each supplement, because they are read in one query
 *     for the whole pledge — the response is what groups them
 * @param latestRaise #171: the most recent attempt to raise this paid pledge, or null when there
 *     has been none — what a screen the payment provider sent the backer back to reads
 * @param raisable #171: whether this pledge may be raised now — it is paid for, its campaign is
 *     taking pledges, and none of its money is being refunded. The service answers it because only
 *     the service can: whether a campaign is taking pledges depends on windows the client is not shown
 * @param raiseResumeUrl #171: the provider's page {@code latestRaise} is waiting to be paid on, while
 *     it is pending and its hold lasts; null otherwise. Where a backer who left the page goes back to
 */
public record PledgeDetail(
        Pledge pledge,
        List<PledgeAddon> addons,
        List<PledgeSupplement> supplements,
        List<SupplementAddon> supplementAddons,
        PledgeRaise latestRaise,
        boolean raisable,
        String raiseResumeUrl) {

    /** A pledge that has never been raised and cannot be now. */
    public PledgeDetail(
            Pledge pledge,
            List<PledgeAddon> addons,
            List<PledgeSupplement> supplements,
            List<SupplementAddon> supplementAddons) {
        this(pledge, addons, supplements, supplementAddons, null, false, null);
    }

    public PledgeDetail {
        addons = addons == null ? List.of() : List.copyOf(addons);
        supplements = supplements == null ? List.of() : List.copyOf(supplements);
        supplementAddons = supplementAddons == null ? List.of() : List.copyOf(supplementAddons);
    }

    /** The lines of one purchase, in the order the repository read them. */
    public List<SupplementAddon> linesOf(UUID supplementId) {
        return supplementAddons.stream()
                .filter(line -> line.getSupplementId().equals(supplementId))
                .toList();
    }
}
