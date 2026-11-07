package az.ideanest.notification.application;

import az.ideanest.notification.infrastructure.NotificationPreferenceRepository;
import az.ideanest.notification.infrastructure.NotificationRepository;
import az.ideanest.user.application.AccountNotifications;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * An anonymised account's inbox and switches, deleted — {@code user}'s
 * {@link AccountNotifications} (#647).
 *
 * <p><strong>Its own class rather than a method on {@link NotificationInbox} or
 * {@link NotificationPreferences}</strong>, because it is neither of them. Each of those answers
 * one account's own requests about its own rows, and each begins by establishing who is asking.
 * This is the other module's erasure reaching into both tables at once, and keeping it in one
 * place keeps "what anonymisation deletes from this module" readable in one file — the push
 * registrations, the third table, are {@link PushDevices#forgetAll}, because the deletion request
 * deletes those thirty days earlier.
 *
 * <p>Every channel and every state, held and dead-lettered rows included. A row still waiting
 * for a digest is a message to an address that {@code User.anonymise} has just overwritten, and
 * one that never went is still a record of what this person was going to be told.
 */
@Service
public class ClosedAccountNotifications implements AccountNotifications {

    private static final Logger log = LoggerFactory.getLogger(ClosedAccountNotifications.class);

    private final NotificationRepository notifications;
    private final NotificationPreferenceRepository preferences;

    public ClosedAccountNotifications(
            NotificationRepository notifications, NotificationPreferenceRepository preferences) {
        this.notifications = notifications;
        this.preferences = preferences;
    }

    /**
     * Joins the anonymiser's transaction: the rows go if and only if the account's identity goes
     * with them. No account in the log line, for {@link PushDevices#forgetAll}'s reason.
     */
    @Override
    @Transactional
    public int forgetAll(UUID userId) {
        int removed = notifications.deleteByRecipientId(userId) + preferences.deleteByUserId(userId);
        if (removed > 0) {
            log.info("Forgot {} notifications and preferences of an anonymised account.", removed);
        }
        return removed;
    }
}
