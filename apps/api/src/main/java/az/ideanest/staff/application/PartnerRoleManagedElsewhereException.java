package az.ideanest.staff.application;

import java.util.UUID;

/**
 * Granting or withdrawing {@code PARTNER} through the staff roster rather than through a
 * partner profile.
 *
 * <p>A partner is the role <em>and</em> a row in {@code partner_profiles} carrying the share and
 * the sections, and the two are written together by {@link PartnerAdministrationService}. The
 * roster endpoint writes the role alone: granted there it opened nothing, because there was no
 * share to scale by, and withdrawn there it left a profile whose percentage still counted against
 * the hundred while nobody held it.
 */
public class PartnerRoleManagedElsewhereException extends RuntimeException {

    public PartnerRoleManagedElsewhereException(UUID accountId) {
        super("The partner role of " + accountId + " is managed through its partner profile");
    }
}
