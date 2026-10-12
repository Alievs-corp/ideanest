package az.ideanest.payout.application;

import java.util.UUID;

/**
 * A member of staff tried to pay, or record paying, their own campaign's payout by hand — #397.
 *
 * <p>403, and V66's rule: a member of staff may also be a creator, and nobody decides anything about
 * their own. {@code SelfVerifiedDestinationException} applies it to confirming one's own account; this
 * applies it to the person who opens that account, transfers into it and says the transfer was made.
 */
public class SelfPaidPayoutException extends RuntimeException {

    public SelfPaidPayoutException(UUID payoutId) {
        super("Payout " + payoutId + " is to the member of staff handling it");
    }
}
