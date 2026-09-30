package az.ideanest.staff.application;

import java.util.UUID;

/**
 * A partner asked for statistics and has no percentage — #205.
 *
 * <p>403. The account holds {@code PARTNER} and no row in {@code partner_profiles}: a role
 * granted by hand, or a profile removed. The answer is a refusal and never the real figures,
 * because "no percentage" must not be read as "no scaling": the statistics are withheld until a
 * super admin gives this partner a share.
 */
public class PartnerNotConfiguredException extends RuntimeException {

    public PartnerNotConfiguredException(UUID accountId) {
        super("Partner " + accountId + " has no percentage");
    }
}
