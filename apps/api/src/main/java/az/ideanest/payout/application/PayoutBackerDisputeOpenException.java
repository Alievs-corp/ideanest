package az.ideanest.payout.application;

import java.util.UUID;

/**
 * A bank transfer was started while a backer's dispute on the campaign is undecided — #397.
 *
 * <p>409. Starting the transfer closes the dispute window ({@code BackerDisputes} refuses to refund
 * once the money may have left), so a dispute still open would be decided by default. It is decided
 * first, and an upheld one recalculates the payout without the backer.
 */
public class PayoutBackerDisputeOpenException extends RuntimeException {

    private final UUID projectId;

    public PayoutBackerDisputeOpenException(UUID payoutId, UUID projectId) {
        super("Payout " + payoutId + "'s campaign " + projectId + " has a backer dispute to decide first");
        this.projectId = projectId;
    }

    public UUID projectId() {
        return projectId;
    }
}
