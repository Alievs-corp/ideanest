package az.ideanest.pledge.application;

import java.time.Instant;
import java.util.UUID;

/**
 * #171: a raise of this pledge is already waiting for its payment.
 *
 * <p>One at a time, because each is priced against the pledge as it stands: a second opened beside
 * the first would charge a difference from a total the first is about to change. The first either is
 * paid for, fails, or lapses at {@link #holdExpiresAt()}, and then another may start.
 */
public class PledgeRaiseInProgressException extends RuntimeException {

    private final UUID raiseId;
    private final Instant holdExpiresAt;

    public PledgeRaiseInProgressException(UUID pledgeId, UUID raiseId, Instant holdExpiresAt) {
        super("Pledge " + pledgeId + " already has raise " + raiseId + " waiting for its payment");
        this.raiseId = raiseId;
        this.holdExpiresAt = holdExpiresAt;
    }

    public UUID raiseId() {
        return raiseId;
    }

    public Instant holdExpiresAt() {
        return holdExpiresAt;
    }
}
