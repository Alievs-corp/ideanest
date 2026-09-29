package az.ideanest.pledge.application;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * #171: the new selection costs exactly what the pledge already does.
 *
 * <p>A raise is a payment, and a payment of nothing is not one. A selection that costs less is
 * {@link PledgeDecreaseNotAllowedException}; this is the equal case, which changes nothing a backer
 * pays for and so is not charged either.
 */
public class RaiseNotAnIncreaseException extends RuntimeException {

    private final BigDecimal current;

    public RaiseNotAnIncreaseException(UUID pledgeId, BigDecimal current) {
        super("Pledge " + pledgeId + " already comes to " + current.toPlainString());
        this.current = current;
    }

    public BigDecimal current() {
        return current;
    }
}
