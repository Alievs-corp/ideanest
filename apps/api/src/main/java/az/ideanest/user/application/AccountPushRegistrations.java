package az.ideanest.user.application;

import java.util.UUID;

/**
 * What this module needs from whoever keeps the account's push registrations (#643).
 *
 * <p><strong>Why anonymisation has to ask.</strong> {@code push_devices.user_id} cascades on
 * delete, and that cascade never fires: {@code users} rows are never hard-deleted, which is the
 * whole point of anonymising rather than deleting. Without this call an anonymised account's
 * tokens would sit in the table until the retention sweep found them unrefreshed for 180 days —
 * an address for a phone, kept under an identifier whose person has asked to be forgotten, and
 * the one occasion the privacy policy's list of when a token is deleted did not cover.
 *
 * <p><strong>An interface here, implemented over there</strong>, for {@link AccountSecurity}'s
 * reason. The registrations belong to {@code notification}, and {@code notification} already
 * depends on {@code user} — it looks recipients up through {@link UserAccounts} — so a call in the
 * other direction would be the cycle {@code ModuleBoundaryTests} refuses.
 */
public interface AccountPushRegistrations {

    /**
     * Deletes every push registration the account has.
     *
     * <p>Runs inside the anonymiser's transaction, so a failed anonymisation leaves the
     * registrations where they were and the next run tries both again. Idempotent: a second call
     * finds nothing to delete.
     *
     * @return how many registrations went
     */
    int forgetAll(UUID userId);
}
