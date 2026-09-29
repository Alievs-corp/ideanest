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
 *
 * <p><strong>The pledge's row lock is what serialises its money (#171).</strong> Recording a refund,
 * settling one and applying a paid raise each take it first, before they read what the pledge was
 * charged and what went back. So a raise cannot be applied between a refund being decided and being
 * settled, two refunds settling on two charges at once cannot both see the other still in flight, and
 * whichever of them leaves nothing is the one that finds it so.
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
     * Takes the pledge's row lock for the rest of the caller's transaction, before it reads or
     * writes any of the pledge's money. Nothing happens when there is no such pledge.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lock(UUID pledgeId) {
        pledges.findByIdForUpdate(pledgeId);
    }

    /**
     * The pledge's money has all gone back: it is {@code REFUNDED} and leaves its campaign's totals.
     *
     * <p>Called only once the refunds that returned it have settled — never when one is merely
     * requested, since a requested refund may yet fail — and with the lock {@link #lock} took.
     *
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
        // What the campaign counted for this pledge: its total, which an applied raise (#171) added to.
        // Not the amount of the refund that completed it — a raised pledge is refunded one charge at a
        // time, and the last refund is only the last charge. A raise that was paid for and not applied
        // never reached the total, and its refund is not subtracted here either.
        totals.subtractRefunded(pledge.getProjectId(), Money.of(pledge.getTotalAmount(), pledge.getCurrency()));
        return true;
    }
}
