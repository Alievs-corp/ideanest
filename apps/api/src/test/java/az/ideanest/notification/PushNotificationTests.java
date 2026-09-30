package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.PushDevices;
import az.ideanest.notification.domain.DevicePlatform;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.PushComposer;
import az.ideanest.notification.infrastructure.PushDeviceRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Duration;
import java.time.Instant;
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
 *   <li>{@link #aPushLinksToTheCampaignOrToNothing()} — the mobile parser refuses a path it
 *       does not recognise, so a notification built on the web's identifier fallbacks would
 *       open the application and land nowhere.
 * </ul>
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
    // What a push says, and where it goes
    // ------------------------------------------------------------------

    @Test
    @DisplayName("says the type's subject and its one-line form, not the email's paragraphs")
    void pushCopyIsATitleAndOneLine() {
        PushComposer.PushContent content = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, """
                        {"projectTitle":"Solar Lamp","total":{"amount":"25.00","currency":"AZN"},\
                        "creatorSlug":"aysel","projectSlug":"solar-lamp"}"""),
                "", ENGLISH);

        // The `.named` variants, because the document carries a title.
        assertThat(content.title()).isEqualTo("Your pledge to Solar Lamp is confirmed");
        assertThat(content.body()).isEqualTo("Your pledge of 25.00 AZN to Solar Lamp was confirmed");
    }

    @Test
    @DisplayName("is written in the language it is given, which the sender reads from the account")
    void pushCopyIsInTheRecipientsLanguage() {
        NotificationMessage pledge = message(NotificationType.PLEDGE_CONFIRMED, """
                {"projectTitle":"Solar Lamp","total":{"amount":"25.00","currency":"AZN"}}""");

        // Issue #216: it used to be Locale.ROOT, the English base catalogue, for everybody.
        assertThat(composer.compose(pledge, "", ReaderLocale.of("ru")).title())
                .isEqualTo("Ваш взнос в кампанию Solar Lamp подтверждён");
        assertThat(composer.compose(pledge, "", ReaderLocale.of("az")).title())
                .isEqualTo("Solar Lamp kampaniyasına dəstəyiniz təsdiqləndi");
    }

    @Test
    @DisplayName("falls back to the plain copy when the campaign has no title in the document")
    void copySurvivesAnUntitledDocument() {
        PushComposer.PushContent content =
                composer.compose(message(NotificationType.PLEDGE_CONFIRMED, "{}"), "", ENGLISH);

        // Rows written before #249 carry no title, and a sentence built around an empty
        // slot renders with a hole in it.
        assertThat(content.title()).isEqualTo("Your pledge is confirmed");
        assertThat(content.body()).doesNotContain("null").doesNotContain("{1}");
    }

    @Test
    @DisplayName("links to the campaign, or to nothing at all")
    void aPushLinksToTheCampaignOrToNothing() {
        PushComposer.PushContent linked = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, """
                        {"creatorSlug":"aysel","projectSlug":"solar-lamp"}"""),
                "", ENGLISH);

        assertThat(linked.url()).isEqualTo("ideanest://projects/aysel/solar-lamp");

        /*
         * The web's fallbacks address /projects/{uuid}, which the mobile parser refuses by
         * design -- so a push built on one would open the application and land nowhere.
         * The bare scheme means "leave the person where they are".
         */
        PushComposer.PushContent unlinked = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, """
                        {"projectId":"11111111-1111-1111-1111-111111111111"}"""),
                "", ENGLISH);

        assertThat(unlinked.url()).isEqualTo("ideanest://");
    }

    @Test
    @DisplayName("has copy for every type, so no lock screen ever shows a placeholder")
    void everyTypeHasPushCopy() {
        for (NotificationType type : NotificationType.values()) {
            PushComposer.PushContent content = composer.compose(message(type, "{}"), "", ENGLISH);

            assertThat(content.title()).as("title for %s", type).isNotBlank();
            assertThat(content.body()).as("line for %s", type).isNotBlank();
        }
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
