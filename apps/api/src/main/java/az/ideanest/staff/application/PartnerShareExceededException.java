package az.ideanest.staff.application;

import java.math.BigDecimal;

/**
 * The partners' percentages would add up to more than the whole — #204.
 *
 * <p>409, and it carries what is left so the screen can say "at most 30.00" instead of
 * sending a super admin to work out the arithmetic across the other partners. The rule exists
 * because a split that hands out more than one hundred per cent shows the partners, between
 * them, more money than the platform has.
 */
public class PartnerShareExceededException extends RuntimeException {

    private final BigDecimal available;

    public PartnerShareExceededException(BigDecimal available) {
        super("At most " + available.toPlainString() + " is left to allocate");
        this.available = available;
    }

    /** What this account could be given: 100 minus every other partner's share. */
    public BigDecimal available() {
        return available;
    }
}
