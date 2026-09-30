package az.ideanest.staff.application;

import az.ideanest.staff.domain.StaffRole;
import java.util.Set;
import java.util.UUID;

/**
 * An account that already holds another staff role was to be made a partner — #204, #205.
 *
 * <p>409. Roles add up, so a partner who also held {@code FINANCE} would read the payments
 * journal and the ledger through that role and the percentage would protect nothing. The
 * account is asked to give the other roles up first, which is a decision and not a side effect
 * of filling in a share.
 */
public class PartnerHoldsOtherRolesException extends RuntimeException {

    private final Set<StaffRole> roles;

    public PartnerHoldsOtherRolesException(UUID accountId, Set<StaffRole> roles) {
        super("Account " + accountId + " already holds " + roles);
        this.roles = Set.copyOf(roles);
    }

    /** The roles that stand in the way, which the screen names. */
    public Set<StaffRole> roles() {
        return roles;
    }
}
