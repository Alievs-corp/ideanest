package az.ideanest.staff.application;

import java.util.UUID;

/**
 * A staff role granted to an account that is a partner.
 *
 * <p>The other half of {@link PartnerHoldsOtherRolesException}. That one stops an account with a
 * staff role from becoming a partner; nothing stopped a partner from being given a staff role
 * afterwards, and roles add up — a partner granted {@code FINANCE} reads the payment journal
 * through it, and the share protects nothing.
 */
public class AccountIsPartnerException extends RuntimeException {

    public AccountIsPartnerException(UUID accountId) {
        super("Account " + accountId + " is a partner and may hold no other staff role");
    }
}
