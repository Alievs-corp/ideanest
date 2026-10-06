package az.ideanest.notification.infrastructure;

import az.ideanest.notification.application.ChannelSender;
import az.ideanest.notification.application.NotificationDigest;
import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.PermanentDeliveryFailure;
import az.ideanest.notification.application.PushDevices;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.PushDevice;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §4.10's push column, delivered — issue #87.
 *
 * <p>{@code ChannelSenderConfiguration} used to register an
 * {@code UndeliverableChannelSender} for this channel, and its comment said "#87 is the
 * same three lines in reverse". This is that: a {@code @Component} implementing
 * {@link ChannelSender} and returning {@link NotificationChannel#PUSH}, and deleting the
 * bean was the whole of the wiring.
 *
 * <h2>The three outcomes, and why "nobody has the application" is not a failure</h2>
 *
 * <ol>
 *   <li><strong>No registered device.</strong> Returns. Most accounts on this platform
 *       have never installed the application, and a push preference on one of them is not
 *       an error — it is somebody who switched a channel on before the phone existed.
 *       Throwing would spend eight attempts and then dead-letter a row per notification,
 *       filling {@code notifications_dead_idx} with the absence of a phone.
 *   <li><strong>At least one device accepted it.</strong> Returns. §12.2's contract is
 *       that returning means the channel took the message, and it did.
 *   <li><strong>Every device refused it, or the service could not be reached.</strong>
 *       Throws, and the queue retries — which is the behaviour the retry budget exists
 *       for.
 * </ol>
 *
 * <h2>{@code DeviceNotRegistered} is acted on rather than retried</h2>
 *
 * <p>It is the only signal an uninstall ever produces, and it arrives inside a 200: Expo
 * answers success for a batch in which individual messages failed. A sender that read
 * only the HTTP status would keep sending to phones that removed the application months
 * ago, for ever, and would never learn otherwise. The registration is dropped as soon as
 * the service says so.
 *
 * <p>If dropping it leaves the recipient with nothing, that is not a failure to retry
 * either — see outcome one. The row records that the platform tried.
 *
 * <h2>The account's language, read when the push is sent</h2>
 *
 * <p>Issue #216: the language a person chose last — in the application, in the phone's
 * per-app setting or on the web — is written to the account, and the next push must be in
 * it. So {@code users.locale} is read here, at send time, and not copied onto the queued
 * row: a notification queued before somebody changed language and sent after it is sent in
 * the new one, which is what {@code EmailChannelSender} already does for mail. The read
 * happens only once a registered device is found, so the many accounts with no phone cost
 * no extra query.
 *
 * <h2>What is not logged</h2>
 *
 * <p>No token and no recipient. A push token is an address, and these lines are read by
 * people who are not the person the notification was for (§17.4). The counts are what
 * makes an incident readable.
 */
@Component
public class PushChannelSender implements ChannelSender {

    private static final Logger log = LoggerFactory.getLogger(PushChannelSender.class);

    /**
     * The recipient's name, which push copy never uses.
     *
     * <p>Slot {@code 0} in the catalogue is the greeting, and no {@code .subject} or
     * {@code .line} key refers to it — a lock screen showing somebody their own name is a
     * wasted line. The account is read for its language only (#216), and the name is not
     * taken from it, which keeps one more piece of personal data out of a path that does not
     * need it. {@code EmailCopyTests} is what holds the assumption: it asks for every key of
     * every type, so a key that started using {@code 0} would be visible.
     */
    private static final String NO_GREETING = "";

    private final PushDevices devices;
    private final PushComposer composer;
    private final ExpoPushClient expo;
    private final UserAccounts users;
    private final NotificationRepository notifications;

    public PushChannelSender(
            PushDevices devices,
            PushComposer composer,
            ExpoPushClient expo,
            UserAccounts users,
            NotificationRepository notifications) {
        this.devices = devices;
        this.composer = composer;
        this.expo = expo;
        this.users = users;
        this.notifications = notifications;
    }

    @Override
    public NotificationChannel channel() {
        return NotificationChannel.PUSH;
    }

    /**
     * One message, with the inbox row of the same event in its {@code data}.
     *
     * <p>Looked up inside the composition, which runs only once a registered device is
     * found — so, like the language, it costs the accounts with no phone nothing.
     */
    @Override
    public void send(NotificationMessage message) {
        deliver(
                message.recipientId(),
                locale -> composer.compose(
                        message, notifications.inboxIdOf(message.id()).orElse(null), NO_GREETING, locale),
                message.id(),
                "notification " + message.id());
    }

    @Override
    public void send(NotificationDigest digest) {
        deliver(
                digest.recipientId(),
                locale -> composer.compose(digest, NO_GREETING, locale),
                digest.id(),
                "digest " + digest.id());
    }

    /**
     * The recipient's language as the account holds it now.
     *
     * <p>An account that is gone reads as the primary language rather than failing the
     * send: its devices are about to be swept anyway, and a push in Azerbaijani is a better
     * outcome than a retry loop over a missing row.
     */
    private Locale localeOf(UUID recipientId) {
        return ReaderLocale.of(users.findById(recipientId).map(UserAccount::locale).orElse(null));
    }

    /**
     * One message to every phone this person has registered.
     *
     * @param idempotencyKey the notification's own identifier. Expo deduplicates on it for
     *     a day, which is what makes {@link ChannelSender}'s at-least-once contract
     *     tolerable here: the same message handed over twice arrives once
     */
    private void deliver(
            UUID recipientId,
            Function<Locale, PushComposer.PushContent> compose,
            UUID idempotencyKey,
            String what) {
        List<PushDevice> registered = devices.reachable(recipientId);
        if (registered.isEmpty()) {
            // Outcome one. Debug rather than warn: this is the ordinary state of most
            // accounts, and a line per notification at warn would drown the ones that matter.
            log.debug("No registered device for {}; nothing to push.", what);
            return;
        }

        PushComposer.PushContent content = compose.apply(localeOf(recipientId));
        Map<String, String> data = content.data();
        List<ExpoPushClient.Push> batch = new ArrayList<>(registered.size());
        for (PushDevice device : registered) {
            batch.add(new ExpoPushClient.Push(
                    device.getToken(), content.title(), content.body(), data, idempotencyKey.toString()));
        }

        /*
         * Not wrapped in a try/catch. A RestClientException here means the push service
         * could not be reached or refused the whole batch, and that is exactly the failure
         * ChannelSender's contract says to report by throwing: NotificationDispatch counts
         * the attempt and backs off. Swallowing it would record the row as SENT.
         */
        List<ExpoPushClient.Ticket> tickets = expo.send(batch);

        int accepted = 0;
        int gone = 0;
        String lastError = null;

        for (int index = 0; index < registered.size(); index++) {
            ExpoPushClient.Ticket ticket = index < tickets.size()
                    ? tickets.get(index)
                    : new ExpoPushClient.Ticket(false, false, "NoTicket");

            if (ticket.ok()) {
                accepted++;
                continue;
            }
            if (ticket.unregistered()) {
                devices.unregistered(registered.get(index).getToken());
                gone++;
                continue;
            }
            lastError = ticket.error();
        }

        if (gone > 0) {
            log.info("Dropped {} push registration(s) the service no longer recognises.", gone);
        }
        if (accepted > 0) {
            return;
        }

        /*
         * Every device refused. Two cases, and they end differently.
         *
         * If every refusal was `DeviceNotRegistered`, the registrations are now gone and
         * there is nothing left to retry -- retrying would send to an empty list eight
         * times and then dead-letter. That is outcome one arriving a moment late, so it
         * returns.
         *
         * Anything else is a refusal that may not repeat -- a message too large, a service
         * having a bad minute -- and the queue is what those are for.
         */
        if (gone == registered.size()) {
            log.info("Every device for {} was gone; the registrations have been dropped.", what);
            return;
        }
        throw new PushRefusedException(lastError == null ? "the push service refused every device" : lastError);
    }

    /**
     * A refusal the queue should retry.
     *
     * <p>Not a {@link PermanentDeliveryFailure}: the errors that reach here are the ones
     * that are not {@code DeviceNotRegistered}, and none of them is known to be permanent.
     * A message refused the same way eight times becomes a dead letter through
     * {@code NotificationDispatch}'s ordinary counting, which is the right place for that
     * judgement rather than here.
     */
    static class PushRefusedException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        PushRefusedException(String error) {
            // The error code only. Never the token and never the recipient (§17.4).
            super("The push service refused the message: " + error);
        }
    }
}
