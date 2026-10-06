package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.PushDevices;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.domain.PushDevice;
import az.ideanest.notification.infrastructure.ExpoPushClient;
import az.ideanest.notification.infrastructure.NotificationFacts;
import az.ideanest.notification.infrastructure.NotificationRepository;
import az.ideanest.notification.infrastructure.PushChannelSender;
import az.ideanest.notification.infrastructure.PushComposer;
import az.ideanest.user.application.UserAccounts;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.ResourceBundleMessageSource;
import tools.jackson.databind.json.JsonMapper;

/**
 * Which inbox row a push names — issue #160.
 *
 * <p>The push row and the inbox row are two rows of one event, so the sender looks the inbox
 * row up and the application gets the identifier that {@code POST /v1/me/notifications/{id}/read}
 * accepts. The real composer, so what is asserted is what reaches Expo.
 */
@DisplayName("Push sender")
class PushChannelSenderTests {

    private static final UUID RECIPIENT = UUID.randomUUID();

    private final PushDevices devices = mock(PushDevices.class);
    private final ExpoPushClient expo = mock(ExpoPushClient.class);
    private final UserAccounts users = mock(UserAccounts.class);
    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final PushChannelSender sender =
            new PushChannelSender(devices, composer(), expo, users, notifications);

    @BeforeEach
    void aPhoneThatAcceptsEverything() {
        PushDevice phone = mock(PushDevice.class);
        when(phone.getToken()).thenReturn("ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]");
        when(devices.reachable(RECIPIENT)).thenReturn(List.of(phone));
        when(users.findById(RECIPIENT)).thenReturn(Optional.empty());
        when(expo.send(anyList())).thenReturn(List.of(new ExpoPushClient.Ticket(true, false, null)));
    }

    @Test
    @DisplayName("sends the inbox row's identifier, not its own")
    void theInboxRowIsSent() {
        NotificationMessage push = message(NotificationType.NEW_DEVICE_SIGN_IN);
        UUID inbox = UUID.randomUUID();
        when(notifications.inboxIdOf(push.id())).thenReturn(Optional.of(inbox));

        sender.send(push);

        assertThat(sent().data())
                .containsEntry("url", "ideanest://settings/sessions")
                .containsEntry("type", "NEW_DEVICE_SIGN_IN")
                .containsEntry("notificationId", inbox.toString());
    }

    @Test
    @DisplayName("sends no identifier when the event wrote no inbox row")
    void noInboxRowNoIdentifier() {
        NotificationMessage push = message(NotificationType.PLEDGE_CONFIRMED);
        when(notifications.inboxIdOf(push.id())).thenReturn(Optional.empty());

        sender.send(push);

        // Its own identifier would be worse than none: the read endpoint refuses a push row.
        assertThat(sent().data()).doesNotContainKey("notificationId").containsEntry("type", "PLEDGE_CONFIRMED");
    }

    @Test
    @DisplayName("does not look for the inbox row when there is no phone to send to")
    void noPhoneNoLookup() {
        when(devices.reachable(RECIPIENT)).thenReturn(List.of());

        sender.send(message(NotificationType.PLEDGE_CONFIRMED));

        verify(notifications, never()).inboxIdOf(any());
    }

    @SuppressWarnings("unchecked")
    private ExpoPushClient.Push sent() {
        ArgumentCaptor<List<ExpoPushClient.Push>> batch = ArgumentCaptor.forClass(List.class);
        verify(expo).send(batch.capture());
        assertThat(batch.getValue()).hasSize(1);
        return batch.getValue().get(0);
    }

    private static PushComposer composer() {
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        messages.setDefaultEncoding(StandardCharsets.UTF_8.name());
        messages.setFallbackToSystemLocale(false);
        return new PushComposer(messages, new NotificationFacts(JsonMapper.builder().build()));
    }

    private static NotificationMessage message(NotificationType type) {
        return new NotificationMessage(
                UUID.randomUUID(),
                RECIPIENT,
                type,
                NotificationChannel.PUSH,
                null,
                null,
                "{}",
                Instant.now(),
                1);
    }
}
