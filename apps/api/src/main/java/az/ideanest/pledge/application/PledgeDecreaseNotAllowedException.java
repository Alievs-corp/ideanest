package az.ideanest.pledge.application;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * An edit would lower a confirmed pledge — IDN-EXT-01 (#35), §5.1.
 *
 * <p>A backer may only raise a pledge. Lowering a confirmed one is a partial cancellation under a
 * different verb, and the rule that a backer cannot cancel would mean nothing if the same money
 * could be taken back one edit at a time. A draft is not held to it: nothing has been charged, and
 * a backer still choosing what to pledge is choosing, not withdrawing.
 */
public class PledgeDecreaseNotAllowedException extends RuntimeException {

    private final UUID pledgeId;
    private final BigDecimal current;
    private final BigDecimal requested;

    public PledgeDecreaseNotAllowedException(UUID pledgeId, BigDecimal current, BigDecimal requested) {
        super("Pledge " + pledgeId + " is confirmed at " + current.toPlainString()
                + " and cannot be lowered to " + requested.toPlainString());
        this.pledgeId = pledgeId;
        this.current = current;
        this.requested = requested;
    }

    public UUID pledgeId() {
        return pledgeId;
    }

    public BigDecimal current() {
        return current;
    }

    public BigDecimal requested() {
        return requested;
    }
}
