package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.PushDevices;
import az.ideanest.notification.domain.DevicePlatform;
import az.ideanest.notification.domain.Notification;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.NotificationRepository;
import az.ideanest.notification.infrastructure.PushComposer;
import az.ideanest.notification.infrastructure.PushDeviceRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * Push registration and push copy — issue #87.
 *
 * <p>The ones that carry the design:
 *
 * <ul>
 *   <li>{@link #aTokenBelongsToWhoeverSignedInLast()} — two people can share a phone, and a
 *       registration that stayed with the first of them would deliver the second person's
 *       pledge confirmations to somebody else's lock screen. This is a disclosure test
 *       wearing an upsert's clothes.
 *   <li>{@link #aMalformedTokenIsRefusedRatherThanStored()} — Expo rejects an entire batch
 *       containing one bad token, so a single stored one would stop everybody in that batch
 *       being told anything.
 *   <li>{@link #aPushKnowsItsInboxRow()} — every channel writes its own row, so the push
 *       row's identifier is not the one a tap can mark read (#160).
 * </ul>
 *
 * <p>What a push says and where it links is {@code PushComposerTests}, which needs no
 * database.
 */
@DisplayName("Push notifications")
class PushNotificationTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    /** A token of the shape Expo issues. Not a real one; nothing here reaches Expo. */
    private static final String TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

    private static final String OTHER_TOKEN = "ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

    /** The base catalogue's language, which is what these copy assertions are written in. */
    private static final Locale ENGLISH = ReaderLocale.of("en");

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private PushDevices devices;

    @Autowired
    private PushDeviceRepository repository;

    @Autowired
    private PushComposer composer;

    @Autowired
    private NotificationRepository notifications;

    @BeforeEach
    void clearRegistrations() {
        repository.deleteAll();
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------

    @Test
    @DisplayName("registers a phone and answers 201 the first time, 200 after that")
    void registeringTwiceIsOneRow() {
        Account person = account("push-first-");

        ResponseEntity<Map<String, Object>> first = register(person, TOKEN, "ios");
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ResponseEntity<Map<String, Object>> again = register(person, TOKEN, "ios");
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);

        // One installation, one row -- the property the unique index exists for.
        assertThat(repository.findByUserId(person.id())).hasSize(1);

        // The creation time did not move, which is how a client can tell that
        // re-registering did not replace the installation.
        assertThat(again.getBody().get("registeredAt")).isEqualTo(first.getBody().get("registeredAt"));
    }

    @Test
    @DisplayName("never echoes the token, which is an address")
    void theResponseCarriesNoToken() {
        Account person = account("push-echo-");

        ResponseEntity<Map<String, Object>> response = register(person, TOKEN, "android");

        // The client already has it; putting it in a body puts it in every log on the way.
        assertThat(response.getBody()).doesNotContainKey("token");
        assertThat(response.getBody().toString()).doesNotContain(TOKEN);
    }

    @Test
    @DisplayName("a token belongs to whoever signed in last, not to both")
    void aTokenBelongsToWhoeverSignedInLast() {
        Account first = account("push-shared-a-");
        Account second = account("push-shared-b-");

        register(first, TOKEN, "ios");
        register(second, TOKEN, "ios");

        // Not two rows. The first person's notifications must not reach a phone the
        // second person is now holding.
        assertThat(repository.findByUserId(first.id())).isEmpty();
        assertThat(repository.findByUserId(second.id())).hasSize(1);
    }

    @Test
    @DisplayName("one person with two phones is two rows")
    void twoPhonesAreTwoRows() {
        Account person = account("push-two-");

        register(person, TOKEN, "ios");
        register(person, OTHER_TOKEN, "android");

        assertThat(repository.findByUserId(person.id())).hasSize(2);
    }

    @Test
    @DisplayName("refuses a token Expo could not have issued, rather than storing it")
    void aMalformedTokenIsRefusedRatherThanStored() {
        Account person = account("push-bad-");

        ResponseEntity<Map<String, Object>> response = register(person, "not-a-push-token", "ios");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().get("code")).isEqualTo("UNUSABLE_DEVICE_TOKEN");
        // The problem detail names the field and not the value: a problem detail is a
        // document a client may log.
        assertThat(response.getBody().get("field")).isEqualTo("token");
        assertThat(repository.findByUserId(person.id())).isEmpty();
    }

    @Test
    @DisplayName("refuses a platform this build does not record")
    void anUnknownPlatformIsRefused() {
        Account person = account("push-platform-");

        ResponseEntity<Map<String, Object>> response = register(person, TOKEN, "web");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().get("code")).isEqualTo("UNKNOWN_DEVICE_PLATFORM");
    }

    @Test
    @DisplayName("forgets a registration on sign-out, and says so again on a retry")
    void forgettingIsIdempotent() {
        Account person = account("push-forget-");
        register(person, TOKEN, "ios");

        assertThat(forget(person, TOKEN).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(repository.findByUserId(person.id())).isEmpty();

        // A client retrying a sign-out must not be told that it failed, and telling the
        // two apart would confirm to whoever holds a token that the token was registered.
        assertThat(forget(person, TOKEN).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("needs a session")
    void registrationNeedsASession() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        ResponseEntity<String> response = rest.exchange(
                "/v1/me/devices",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("token", TOKEN, "platform", "ios"), headers),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // Retention — §17.4
    // ------------------------------------------------------------------

    @Test
    @DisplayName("forgets a registration nobody has refreshed")
    void staleRegistrationsAreForgotten() {
        Account person = account("push-stale-");
        register(person, TOKEN, "ios");

        // Nothing has aged, so nothing goes.
        assertThat(devices.forgetUnusedSince(Duration.ofDays(180))).isZero();
        assertThat(repository.findByUserId(person.id())).hasSize(1);

        // A window of zero means "anything last seen before now", which every row is.
        assertThat(devices.forgetUnusedSince(Duration.ZERO)).isEqualTo(1);
        assertThat(repository.findByUserId(person.id())).isEmpty();
    }

    // ------------------------------------------------------------------
    // What a push says, and which inbox row it is
    // ------------------------------------------------------------------

    /**
     * The application's own catalogue, as Spring configured it.
     *
     * <p>{@code PushComposerTests} covers the copy and the links against a catalogue it builds
     * itself; this is the one assertion that the bean the sender is given resolves the same
     * bundles — a {@code spring.messages} change that broke them would pass there.
     */
    @Test
    @DisplayName("is written in the language it is given, which the sender reads from the account")
    void pushCopyIsInTheRecipientsLanguage() {
        NotificationMessage pledge = message(NotificationType.PLEDGE_CONFIRMED, """
                {"projectTitle":"Solar Lamp","total":{"amount":"25.00","currency":"AZN"}}""");

        // Issue #216: it used to be Locale.ROOT, the English base catalogue, for everybody.
        assertThat(composer.compose(pledge, null, "", ReaderLocale.of("ru")).title())
                .isEqualTo("Ваш взнос в кампанию Solar Lamp подтверждён");
        assertThat(composer.compose(pledge, null, "", ReaderLocale.of("az")).title())
                .isEqualTo("Solar Lamp kampaniyasına dəstəyiniz təsdiqləndi");
        assertThat(composer.compose(pledge, null, "", ReaderLocale.of("tr")).title())
                .isEqualTo("Solar Lamp kampanyasına desteğiniz onaylandı");
        assertThat(composer.compose(pledge, null, "", ENGLISH).title())
                .isEqualTo("Your pledge to Solar Lamp is confirmed");
    }

    @Test
    @DisplayName("finds the inbox row the same event wrote, which a tap marks read")
    void aPushKnowsItsInboxRow() {
        Account person = account("push-inbox-");
        UUID event = UUID.randomUUID();
        Notification inbox = notifications.save(row(person, NotificationChannel.IN_APP, event));
        Notification push = notifications.save(row(person, NotificationChannel.PUSH, event));

        // Every channel writes its own row, so the push row's identifier is not the one the
        // inbox shows and POST /v1/me/notifications/{id}/read accepts.
        assertThat(notifications.inboxIdOf(push.getId())).contains(inbox.getId());

        // Another event, and one that wrote no inbox row: in-app switched off for the
        // category. There is nothing to mark read, and nothing borrowed from the first.
        Notification alone = notifications.save(row(person, NotificationChannel.PUSH, UUID.randomUUID()));
        assertThat(notifications.inboxIdOf(alone.getId())).isEmpty();
    }

    @Test
    @DisplayName("does not take somebody else's inbox row from the same event")
    void theInboxRowIsTheRecipients() {
        Account backer = account("push-inbox-a-");
        Account creator = account("push-inbox-b-");
        UUID event = UUID.randomUUID();
        notifications.save(row(creator, NotificationChannel.IN_APP, event));
        Notification push = notifications.save(row(backer, NotificationChannel.PUSH, event));

        // One event addresses several people. Their rows share the event and nothing else.
        assertThat(notifications.inboxIdOf(push.getId())).isEmpty();
    }

    // ------------------------------------------------------------------
    // The registry, from Java
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account with no phone is not a delivery failure")
    void anAccountWithNoPhoneHasNothingReachable() {
        Account person = account("push-none-");

        // The ordinary state of most accounts on this platform. PushChannelSender returns
        // rather than throwing, so a push preference on such an account does not fill the
        // dead-letter index.
        assertThat(devices.reachable(person.id())).isEmpty();
    }

    @Test
    @DisplayName("drops a registration the push service reports as gone")
    void anUnregisteredDeviceIsDropped() {
        Account person = account("push-gone-");
        devices.register(person.id(), TOKEN, DevicePlatform.IOS, "A phone", "0.1.0");

        devices.unregistered(TOKEN);

        // The only signal an uninstall ever produces, and the reason the sender reads the
        // per-token receipts rather than only the batch's status.
        assertThat(devices.reachable(person.id())).isEmpty();
    }

    @Test
    @DisplayName("bounds the free text a client can store")
    void freeTextIsTruncatedRatherThanRefused() {
        Account person = account("push-long-");

        devices.register(person.id(), TOKEN, DevicePlatform.ANDROID, "n".repeat(500), "v".repeat(500));

        // Truncated, not refused: a registration turned down because somebody's phone has
        // a long name is a phone that receives nothing.
        assertThat(devices.reachable(person.id())).singleElement().satisfies(device -> {
            assertThat(device.getDeviceName()).hasSize(120);
            assertThat(device.getAppVersion()).hasSize(40);
        });
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {}

    private static NotificationMessage message(NotificationType type, String params) {
        return new NotificationMessage(
                UUID.randomUUID(),
                UUID.randomUUID(),
                type,
                NotificationChannel.PUSH,
                "project",
                UUID.randomUUID(),
                params,
                Instant.now(),
                1);
    }

    private static Notification row(Account person, NotificationChannel channel, UUID event) {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        return Notification.pending(
                person.id(),
                NotificationType.PLEDGE_CONFIRMED,
                channel,
                event,
                "project",
                UUID.randomUUID(),
                "{}",
                now,
                now);
    }

    private ResponseEntity<Map<String, Object>> register(Account person, String token, String platform) {
        return exchange(HttpMethod.POST, person, Map.of("token", token, "platform", platform));
    }

    private ResponseEntity<Map<String, Object>> forget(Account person, String token) {
        return exchange(HttpMethod.DELETE, person, Map.of("token", token, "platform", "ios"));
    }

    private ResponseEntity<Map<String, Object>> exchange(
            HttpMethod method, Account person, Map<String, Object> body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(person.accessToken());

        return rest.exchange(
                "/v1/me/devices",
                method,
                new HttpEntity<>(body, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    /**
     * A registered, signed-in account.
     *
     * <p>The prefix is per test rather than shared, because two suites taking the same
     * address is a failure that surfaces three frames away as a request with a null bearer.
     */
    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }
}
