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
     * @return whether the pledge moved
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean recordRefunded(UUID pledgeId) {
        Optional<Pledge> found = pledges.findByIdForUpdate(pledgeId);
        if (found.isEmpty() || found.get().getState() != PledgeState.COLLECTED) {
            return false;
        }
        Pledge pledge = found.get();
        pledge.refunded();
        // What the campaign counted for this pledge: its total, which a raise (#171) added to. Not the
        // amount of the refund that completed it — a raised pledge is refunded one charge at a time,
        // and the last refund is only the last charge.
        totals.subtractRefunded(pledge.getProjectId(), Money.of(pledge.getTotalAmount(), pledge.getCurrency()));
        return true;
    }
}
