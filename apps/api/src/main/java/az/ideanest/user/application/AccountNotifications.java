package az.ideanest.user.application;

import java.util.UUID;

/**
 * What this module needs from whoever keeps the account's notifications, when it is anonymised
 * (#647).
 *
 * <p><strong>Why anonymisation has to ask.</strong> {@code notifications.recipient_id} and
 * {@code notification_preferences.user_id} cascade on delete, and that cascade never fires:
 * {@code users} rows are never hard-deleted. An anonymised account's inbox would otherwise stay
 * for ever, and an inbox is not anonymous. Its rows quote the campaigns this person backed, the
 * comments they were answered on and the devices they signed in from, which together identify
 * somebody as well as the name that was just overwritten.
 *
 * <p><strong>At anonymisation, not at the request</strong>, unlike the push registrations: the
 * inbox and the switches are the account's own data, and a cancellation inside the grace period
 * has to give them back whole.
 *
 * <p><strong>An interface here, implemented over there</strong>, for
 * {@link AccountPushRegistrations}'s reason: {@code notification} already depends on this module.
 */
public interface AccountNotifications {

    /**
     * Deletes every notification addressed to the account, on every channel and in every state,
     * and every notification preference it set.
     *
     * <p>Runs inside the anonymiser's transaction, so a failed anonymisation leaves them where
     * they were. Idempotent: a second call finds nothing to delete.
     *
     * @return how many rows went, notifications and preferences together
     */
    int forgetAll(UUID userId);
}
