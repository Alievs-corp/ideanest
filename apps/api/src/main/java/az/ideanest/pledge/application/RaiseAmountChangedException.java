package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import java.util.UUID;

/**
 * #171: the difference the backer was shown is not the difference they would be charged.
 *
 * <p>The client prices a raise from a reward list it read some time ago, and a rate or a price may
 * have moved since. The request carries the figure the backer agreed to, and a raise that would
 * charge anything else is refused rather than sent to the provider, with both figures, so the client
 * can show the new one and ask again.
 */
public class RaiseAmountChangedException extends RuntimeException {

    private final Money expected;
    private final Money actual;

    public RaiseAmountChangedException(UUID pledgeId, Money expected, Money actual) {
        super("Raising pledge " + pledgeId + " costs " + actual + ", not the " + expected + " the request expected");
        this.expected = expected;
        this.actual = actual;
    }

    public Money expected() {
        return expected;
    }

    public Money actual() {
        return actual;
    }
}
