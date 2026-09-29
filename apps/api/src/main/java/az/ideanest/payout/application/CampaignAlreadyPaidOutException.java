package az.ideanest.payout.application;

import java.util.UUID;

/**
 * The campaign has already been paid out - #182.
 *
 * <p>409, with the payout that was sent. A calculation prices the campaign's whole collections, and
 * nothing in it subtracts what an earlier payout sent, so a second payout would be the first one paid
 * again. Late pledges are off (#36) and nothing is refunded through the platform after payout (§6.3), so
 * there is no money a second payout could be for; what moves afterwards moves against the creator's
 * debts. V86's partial unique index refuses it anyway; checking first turns that into a sentence.
 */
public class CampaignAlreadyPaidOutException extends RuntimeException {

    private final transient UUID paidPayoutId;

    public CampaignAlreadyPaidOutException(UUID projectId, UUID paidPayoutId) {
        super("Campaign " + projectId + " was already paid out by payout " + paidPayoutId);
        this.paidPayoutId = paidPayoutId;
    }

    /** The payout that was sent, so the console can link to it. */
    public UUID paidPayoutId() {
        return paidPayoutId;
    }
}
