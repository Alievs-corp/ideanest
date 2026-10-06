package az.ideanest.notification;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.PushDevices;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.domain.PushDevice;
import az.ideanest.notification.infrastructure.ExpoPushClient;
import az.ideanest.notification.infrastructure.NotificationRepository;
import az.ideanest.notification.infrastructure.PushChannelSender;
import az.ideanest.notification.infrastructure.PushComposer;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Which language a push is sent in — issue #216.
 *
 * <p>The language a person chose last, anywhere, is written to the account, and the next
 * push must follow it. So the sender reads {@code users.locale} when it sends, not a copy
 * taken when the notification was queued: {@link #theLanguageIsReadAtSendTime()} changes the
 * account between two sends of the same queued row.
 */
@DisplayName("Push language")
class PushLanguageTests {

    private static final UUID RECIPIENT = UUID.randomUUID();

    private final PushDevices devices = mock(PushDevices.class);
    private final PushComposer composer = mock(PushComposer.class);
    private final ExpoPushClient expo = mock(ExpoPushClient.class);
    private final UserAccounts users = mock(UserAccounts.class);
    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final PushChannelSender sender = new PushChannelSender(devices, composer, expo, users, notifications);

    @BeforeEach
    void aPhoneThatAcceptsEverything() {
        PushDevice phone = mock(PushDevice.class);
        when(phone.getToken()).thenReturn("ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]");
        when(devices.reachable(RECIPIENT)).thenReturn(List.of(phone));
        when(expo.send(anyList())).thenReturn(List.of(new ExpoPushClient.Ticket(true, false, null)));
        when(notifications.inboxIdOf(any())).thenReturn(Optional.empty());
        when(composer.compose(any(NotificationMessage.class), any(), anyString(), any(Locale.class)))
                .thenReturn(new PushComposer.PushContent("title", "line", "ideanest://", "PLEDGE_CONFIRMED", null));
    }

    @Test
    @DisplayName("is composed in the account's language, read when it is sent")
    void theLanguageIsReadAtSendTime() {
        NotificationMessage queued = message();

        speaks("ru");
        sender.send(queued);
        verify(composer).compose(queued, null, "", Locale.forLanguageTag("ru"));

        // The person chose Turkish on the web after the row was queued; the retry follows.
        speaks("tr");
        sender.send(queued);
        verify(composer).compose(queued, null, "", Locale.forLanguageTag("tr"));
    }

    @Test
    @DisplayName("falls back to the primary language for an account that is gone")
    void aMissingAccountReadsAsThePrimaryLanguage() {
        when(users.findById(RECIPIENT)).thenReturn(Optional.empty());

        sender.send(message());

        verify(composer).compose(any(NotificationMessage.class), any(), eq(""), eq(Locale.forLanguageTag("az")));
    }

    @Test
    @DisplayName("falls back to the primary language for an account with none, or one it does not speak")
    void anUnreadableLanguageReadsAsThePrimaryLanguage() {
        NotificationMessage queued = message();

        speaks(null);
        sender.send(queued);

        // A row written before the column's constraint, or by hand. ReaderLocale's rule.
        speaks("de");
        sender.send(queued);

        verify(composer, times(2)).compose(queued, null, "", Locale.forLanguageTag("az"));
    }

    @Test
    @DisplayName("does not read the account when there is no phone to send to")
    void noPhoneNoRead() {
        when(devices.reachable(RECIPIENT)).thenReturn(List.of());

        sender.send(message());

        verify(users, never()).findById(any());
    }

    private void speaks(String locale) {
        UserAccount account = mock(UserAccount.class);
        when(account.locale()).thenReturn(locale);
        when(users.findById(RECIPIENT)).thenReturn(Optional.of(account));
    }

    private static NotificationMessage message() {
        return new NotificationMessage(
                UUID.randomUUID(),
                RECIPIENT,
                NotificationType.PLEDGE_CONFIRMED,
                NotificationChannel.PUSH,
                "project",
                UUID.randomUUID(),
                "{}",
                Instant.now(),
                1);
    }
}
