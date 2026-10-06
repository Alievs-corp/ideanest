package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;

import az.ideanest.notification.application.NotificationDigest;
import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.NotificationFacts;
import az.ideanest.notification.infrastructure.PushComposer;
import az.ideanest.shared.ReaderLocale;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.ResourceBundleMessageSource;
import tools.jackson.databind.json.JsonMapper;

/**
 * What a push says, where tapping it goes, and what the application is handed — #87, #216
 * and #160.
 *
 * <p>No application context. The composer is a catalogue and a document, and the catalogue
 * is built here the way {@code spring.messages} builds it: UTF-8, and
 * {@code fallback-to-system-locale: false}, so a language with no bundle reads the English
 * base file rather than whatever language the machine running the suite happens to have.
 */
@DisplayName("Push composer")
class PushComposerTests {

    private static final Locale ENGLISH = ReaderLocale.of("en");

    private static final String TITLED_PLEDGE = """
            {"projectTitle":"Solar Lamp","total":{"amount":"25.00","currency":"AZN"},\
            "creatorSlug":"aysel","projectSlug":"solar-lamp"}""";

    private final PushComposer composer =
            new PushComposer(catalogue(), new NotificationFacts(JsonMapper.builder().build()));

    // ------------------------------------------------------------------
    // What it says
    // ------------------------------------------------------------------

    @Test
    @DisplayName("says the type's subject and its one-line form, not the email's paragraphs")
    void pushCopyIsATitleAndOneLine() {
        PushComposer.PushContent content =
                composer.compose(message(NotificationType.PLEDGE_CONFIRMED, TITLED_PLEDGE), null, "", ENGLISH);

        // The `.named` variants, because the document carries a title.
        assertThat(content.title()).isEqualTo("Your pledge to Solar Lamp is confirmed");
        assertThat(content.body()).isEqualTo("Your pledge of 25.00 AZN to Solar Lamp was confirmed");
    }

    @Test
    @DisplayName("is written in the recipient's language: Azerbaijani, Russian and Turkish")
    void pushCopyIsInTheRecipientsLanguage() {
        NotificationMessage pledge = message(NotificationType.PLEDGE_CONFIRMED, TITLED_PLEDGE);

        // Issue #216: it used to be Locale.ROOT, the English base catalogue, for everybody.
        PushComposer.PushContent az = composer.compose(pledge, null, "", ReaderLocale.of("az"));
        assertThat(az.title()).isEqualTo("Solar Lamp kampaniyasına dəstəyiniz təsdiqləndi");
        assertThat(az.body()).isEqualTo("Solar Lamp kampaniyasına 25.00 AZN məbləğində dəstəyiniz təsdiqləndi");

        PushComposer.PushContent ru = composer.compose(pledge, null, "", ReaderLocale.of("ru"));
        assertThat(ru.title()).isEqualTo("Ваш взнос в кампанию Solar Lamp подтверждён");
        assertThat(ru.body()).isEqualTo("Ваш взнос на сумму 25.00 AZN в кампанию Solar Lamp подтверждён");

        PushComposer.PushContent tr = composer.compose(pledge, null, "", ReaderLocale.of("tr"));
        assertThat(tr.title()).isEqualTo("Solar Lamp kampanyasına desteğiniz onaylandı");
        assertThat(tr.body()).isEqualTo("Solar Lamp kampanyasına verdiğiniz 25.00 AZN tutarındaki destek onaylandı");
    }

    @Test
    @DisplayName("reads the English base catalogue for a language it has no bundle for")
    void aLanguageWithNoBundleReadsTheBase() {
        // The sender never asks for one -- ReaderLocale turns an unknown or missing account
        // language into the primary one -- but a Locale with no bundle must still say
        // something rather than throw.
        PushComposer.PushContent content = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, TITLED_PLEDGE), null, "", Locale.GERMAN);

        assertThat(content.title()).isEqualTo("Your pledge to Solar Lamp is confirmed");
    }

    @Test
    @DisplayName("falls back to the plain copy when the campaign has no title in the document")
    void copySurvivesAnUntitledDocument() {
        PushComposer.PushContent content =
                composer.compose(message(NotificationType.PLEDGE_CONFIRMED, "{}"), null, "", ENGLISH);

        // Rows written before #249 carry no title, and a sentence built around an empty
        // slot renders with a hole in it.
        assertThat(content.title()).isEqualTo("Your pledge is confirmed");
        assertThat(content.body()).doesNotContain("null").doesNotContain("{1}");
    }

    @Test
    @DisplayName("has copy for every type in every language, so no lock screen shows a placeholder")
    void everyTypeHasPushCopy() {
        for (String language : ReaderLocale.SUPPORTED) {
            for (NotificationType type : NotificationType.values()) {
                PushComposer.PushContent content =
                        composer.compose(message(type, "{}"), null, "", ReaderLocale.of(language));

                assertThat(content.title()).as("title for %s in %s", type, language).isNotBlank();
                assertThat(content.body()).as("line for %s in %s", type, language).isNotBlank();
            }
        }
    }

    // ------------------------------------------------------------------
    // Where it goes
    // ------------------------------------------------------------------

    @Test
    @DisplayName("links to the campaign, or to nothing at all")
    void aPushLinksToTheCampaignOrToNothing() {
        PushComposer.PushContent linked = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, """
                        {"creatorSlug":"aysel","projectSlug":"solar-lamp"}"""),
                null,
                "",
                ENGLISH);

        assertThat(linked.url()).isEqualTo("ideanest://projects/aysel/solar-lamp");

        /*
         * The web's fallbacks address /projects/{uuid}, which the mobile parser refuses by
         * design -- so a push built on one would open the application and land nowhere.
         * The bare scheme is "no destination", which a tap opens as the inbox.
         */
        PushComposer.PushContent unlinked = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, """
                        {"projectId":"11111111-1111-1111-1111-111111111111"}"""),
                null,
                "",
                ENGLISH);

        assertThat(unlinked.url()).isEqualTo("ideanest://");

        // Half a pair is no pair.
        PushComposer.PushContent half = composer.compose(
                message(NotificationType.PLEDGE_CONFIRMED, """
                        {"creatorSlug":"aysel"}"""),
                null,
                "",
                ENGLISH);

        assertThat(half.url()).isEqualTo("ideanest://");
    }

    @Test
    @DisplayName("links a new sign-in to the session list, as the web inbox does")
    void aNewSignInLinksToTheSessions() {
        // The web's hrefOf sends NEW_DEVICE_SIGN_IN to /settings/sessions. It used to be the
        // bare scheme here, so the one push that asks somebody to act landed nowhere.
        PushComposer.PushContent content =
                composer.compose(message(NotificationType.NEW_DEVICE_SIGN_IN, "{}"), null, "", ENGLISH);

        assertThat(content.url()).isEqualTo("ideanest://settings/sessions");
    }

    // ------------------------------------------------------------------
    // What the application is handed
    // ------------------------------------------------------------------

    @Test
    @DisplayName("carries the url, the type and the inbox row in data")
    void dataCarriesTheTypeAndTheInboxRow() {
        UUID inbox = UUID.randomUUID();

        PushComposer.PushContent content =
                composer.compose(message(NotificationType.PLEDGE_CONFIRMED, TITLED_PLEDGE), inbox, "", ENGLISH);

        assertThat(content.type()).isEqualTo("PLEDGE_CONFIRMED");
        assertThat(content.notificationId()).isEqualTo(inbox);
        assertThat(content.data())
                .containsExactly(
                        entry("url", "ideanest://projects/aysel/solar-lamp"),
                        entry("type", "PLEDGE_CONFIRMED"),
                        entry("notificationId", inbox.toString()));
    }

    @Test
    @DisplayName("leaves notificationId out, rather than null, when the event wrote no inbox row")
    void noInboxRowNoNotificationId() {
        PushComposer.PushContent content =
                composer.compose(message(NotificationType.NEW_DEVICE_SIGN_IN, "{}"), null, "", ENGLISH);

        assertThat(content.data())
                .containsOnlyKeys("url", "type")
                .containsEntry("type", "NEW_DEVICE_SIGN_IN")
                .containsEntry("url", "ideanest://settings/sessions");
    }

    @Test
    @DisplayName("sends a digest with no destination, no type and no inbox row")
    void aDigestCarriesOnlyTheScheme() {
        Instant now = Instant.now();
        NotificationDigest digest = new NotificationDigest(
                UUID.randomUUID(),
                UUID.randomUUID(),
                NotificationChannel.PUSH,
                List.of(message(NotificationType.PLEDGE_CONFIRMED, "{}"), message(NotificationType.GOAL_REACHED, "{}")),
                now.minusSeconds(3600),
                now);

        PushComposer.PushContent content = composer.compose(digest, "", ReaderLocale.of("az"));

        assertThat(content.data()).containsOnlyKeys("url").containsEntry("url", "ideanest://");
        assertThat(content.title()).isNotBlank();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static ResourceBundleMessageSource catalogue() {
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        messages.setDefaultEncoding(StandardCharsets.UTF_8.name());
        messages.setFallbackToSystemLocale(false);
        return messages;
    }

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
}
