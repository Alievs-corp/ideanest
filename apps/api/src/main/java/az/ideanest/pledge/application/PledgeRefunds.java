package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.project.application.CampaignTotals;
import az.ideanest.shared.money.Money;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The pledge's side of a full refund — IDN-EXT-01 (#40), §6.2's {@code COLLECTED → REFUNDED}.
 *
 * <p>Called by the payment module in the transaction that settles the refund, so the money, the
 * pledge and the campaign's totals move together. A pledge that is not {@code COLLECTED} — a
 * stored-card pledge of the retired model, or one already refunded — is left as it is.
 */
@Service
public class PledgeRefunds {

    private final PledgeRepository pledges;
    private final CampaignTotals totals;

    public PledgeRefunds(PledgeRepository pledges, CampaignTotals totals) {
        this.pledges = pledges;
        this.totals = totals;
    }

    /**
     * @param refunded what went back, which is what leaves the campaign's total
     * @return whether the pledge moved
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean recordRefunded(UUID pledgeId, Money refunded) {
        Optional<Pledge> found = pledges.findByIdForUpdate(pledgeId);
        if (found.isEmpty() || found.get().getState() != PledgeState.COLLECTED) {
            return false;
        }
        Pledge pledge = found.get();
        pledge.refunded();
        totals.subtractRefunded(pledge.getProjectId(), refunded);
        return true;
    }
}
