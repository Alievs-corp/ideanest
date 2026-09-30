package az.ideanest.staff.application;

import java.util.UUID;

/**
 * A super admin was to be made a partner — #204.
 *
 * <p>409. Holding both would mean the same account sees the real figures and a share of them,
 * and which one a given screen showed would depend on the order the roles were read in. The
 * account is asked to give up the super-admin role first, which is a decision and not a side
 * effect of filling in a percentage.
 */
public class PartnerIsSuperAdminException extends RuntimeException {

    public PartnerIsSuperAdminException(UUID accountId) {
        super("Account " + accountId + " holds a super-admin role");
    }
}
