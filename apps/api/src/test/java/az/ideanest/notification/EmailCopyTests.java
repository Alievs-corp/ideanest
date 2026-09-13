package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.notification.domain.NotificationType;
import az.ideanest.notification.infrastructure.EmailComposer;
import az.ideanest.notification.infrastructure.EmailContent;
import az.ideanest.notification.infrastructure.EmailRenderer;
import az.ideanest.notification.infrastructure.RenderedEmail;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.support.AbstractIntegrationTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * That every notification type has copy, and that the copy is finished.
 *
 * <p>The failure this suite exists to prevent is the quiet one. {@code EmailComposer}
 * asks {@code MessageSource} for a key per type; a missing key throws, a key with a
 * placeholder nothing fills renders the placeholder, and a key referring to a fact its
 * type does not carry renders a hole in the middle of a sentence. None of those is
 * visible until somebody receives the message, and one of the messages is "your payment
 * failed".
 *
 * <p>So every type is rendered, all the way through both layouts, and the result is
 * checked for the shapes an unfinished template leaves behind.
 *
 * <p>Parameterised over the enum rather than listing the types, deliberately: a type
 * added to {@link NotificationType} joins this suite without anybody remembering to add
 * it, which is the same property {@code EmailComposer}'s exhaustive switch has at compile
 * time.
 */
class EmailCopyTests extends AbstractIntegrationTest {

    /**
     * A rendering document carrying every fact any type reads.
     *
     * <p>Every fact, and the assertion below is what keeps that true: a type whose copy names an
     * argument this document does not carry renders a gap where a date or an amount belongs, and
     * {@code EmailFactsHole} catches it as a double space. {@code dueAt} joined with #437's
     * {@code UPDATE_DUE_SOON}, and it is a date rather than an instant because
     * {@code NotificationEventListener} formats it before it reaches a person — an ISO timestamp
     * with a Z on the end in the middle of an Azerbaijani sentence is the platform showing its
     * plumbing. {@code extendedUntil} joined with IDN-EXT-01's {@code CAMPAIGN_EXTENDED}, a date
     * for the same reason.
     */
    private static final String PARAMS =
            """
            {
              "projectId": "01890000-0000-7000-8000-000000000001",
              "total": {"amount": "120.00", "currency": "AZN"},
              "amount": {"amount": "120.00", "currency": "AZN"},
              "goal": {"amount": "5000.00", "currency": "AZN"},
              "pledged": {"amount": "6250.00", "currency": "AZN"},
              "backersCount": 184,
              "attempt": 2,
              "dueAt": "2026-10-05",
              "extendedUntil": "2026-11-12",
              "disputeUntil": "2026-12-01",
              "payableAt": "2026-12-01"
            }""";

    private static final String TITLE = "Xari Bulbul Ceramics";

    /**
     * The same document as {@link #PARAMS}, plus the three fields #249 added.
     *
     * <p>Written out rather than derived from the one above, so that both are readable as
     * what a stored document actually looks like — which is what these tests are about.
     */
    private static final String NAMED_PARAMS =
            """
            {
              "projectId": "01890000-0000-7000-8000-000000000001",
              "projectTitle": "Xari Bulbul Ceramics",
              "creatorSlug": "aysel-studio",
              "projectSlug": "xari-bulbul-ceramics",
              "total": {"amount": "120.00", "currency": "AZN"},
              "amount": {"amount": "120.00", "currency": "AZN"},
              "goal": {"amount": "5000.00", "currency": "AZN"},
              "pledged": {"amount": "6250.00", "currency": "AZN"},
              "backersCount": 184,
              "attempt": 2,
              "dueAt": "2026-10-05",
              "extendedUntil": "2026-11-12",
              "disputeUntil": "2026-12-01",
              "payableAt": "2026-12-01"
            }""";

    /** The suffix on a key that names the campaign, as {@code EmailComposer} spells it. */
    private static final String NAMED = ".named";

    private static final String RECIPIENT = "Aysel";

    /**
     * §21.1's four, as {@code EmailChannelSender} builds them off the recipient's account.
     *
     * <p>Every rendering check below runs against all four rather than against the default
     * bundle alone — issue #324. A bundle with no row for a key falls back to
     * {@code messages.properties}, so a Turkish email missing one line is an email that is
     * three-quarters Turkish and reads as a bug in the platform rather than in a file; and a
     * translated line referring to a fact its type does not carry leaves the same invisible gap
     * the English one would, in a language nobody on the team is reading.
     */
    private static final List<Locale> LANGUAGES =
            ReaderLocale.SUPPORTED.stream().map(Locale::forLanguageTag).toList();

    /** The primary language, for the assertions that are about one rendering rather than four. */
    private static final Locale PRIMARY = Locale.forLanguageTag(ReaderLocale.PRIMARY);

    /**
     * The languages that have a file of their own.
     *
     * <p>English is not one: it lives in {@code messages.properties} itself, so that a key no
     * translation has still resolves to a finished sentence rather than to a missing-key throw.
     * That is also why {@code spring.messages.fallback-to-system-locale} is off — with it on, a
     * request for English would fall past the absent {@code messages_en} to the JVM's own
     * language, and an English reader on a Turkish host would be sent Turkish.
     */
    private static final List<String> TRANSLATED =
            ReaderLocale.SUPPORTED.stream().filter(tag -> !"en".equals(tag)).toList();

    @Autowired
    private EmailComposer composer;

    @Autowired
    private EmailRenderer renderer;

    // ------------------------------------------------------------------
    // Every type
    // ------------------------------------------------------------------

    @ParameterizedTest
    @EnumSource(NotificationType.class)
    @DisplayName("every notification type renders a complete email")
    void everyTypeRenders(NotificationType type) {
        for (Locale locale : LANGUAGES) {
            EmailContent content = composer.compose(message(type), RECIPIENT, locale);
            RenderedEmail email = renderer.render(content, locale);

            assertThat(email.subject()).as("%s has a subject in %s", type, locale).isNotBlank();
            assertThat(content.headline()).as("%s opens with something in %s", type, locale).isNotBlank();
            assertThat(content.paragraphs()).as("%s has a body in %s", type, locale).isNotEmpty();
            assertThat(content.paragraphs()).allSatisfy(paragraph -> assertThat(paragraph)
                    .as("%s has no empty paragraph in %s", type, locale)
                    .isNotBlank());
        }
    }

    /**
     * The three shapes an unfinished template leaves in a rendered message.
     *
     * <p>A {@code {2}} that nothing replaced, the word {@code null} where a fact should
     * be, and the double space left behind when a sentence refers to a fact its type does
     * not carry. The last one is why {@link EmailFactsHole} is checked at all: an empty
     * slot renders as nothing rather than as an error, so the sentence still forms and
     * the only trace is the spacing.
     */
    @ParameterizedTest
    @EnumSource(NotificationType.class)
    @DisplayName("no rendered email leaves a placeholder, a null, or a gap where a fact should be")
    void nothingIsLeftUnfilled(NotificationType type) {
        for (Locale locale : LANGUAGES) {
            EmailContent content = composer.compose(message(type), RECIPIENT, locale);
            RenderedEmail email = renderer.render(content, locale);

            for (String part : List.of(email.subject(), email.text(), email.html())) {
                assertThat(part)
                        .as("%s renders every argument its %s copy refers to", type, locale)
                        .doesNotContainPattern("\\{\\d}");
                assertThat(part).as("%s has no null fact in %s", type, locale).doesNotContain("null");
            }

            // The gap check is against the sentences rather than the rendered parts: both
            // layouts are indented, so runs of spaces are ordinary there and would make this
            // assertion fire on the whitespace of the template instead of on the copy.
            List<String> sentences = new java.util.ArrayList<>(content.paragraphs());
            sentences.add(content.subject());
            sentences.add(content.headline());
            assertThat(sentences).allSatisfy(sentence -> assertThat(sentence)
                    .as("%s refers to no fact it does not carry in %s -- see EmailFacts", type, locale)
                    .doesNotContain(EmailFactsHole.DOUBLE_SPACE));
        }
    }

    /**
     * That both parts say the same thing.
     *
     * <p>The headline and the call to action are the two things a reader acts on, and a
     * plain-text part that lost either is a message that is complete for some readers and
     * broken for the rest — which is precisely the failure {@code RenderedEmail} argues
     * against sending only HTML to avoid.
     */
    @ParameterizedTest
    @EnumSource(NotificationType.class)
    @DisplayName("the plain-text part carries the same headline and destination as the HTML")
    void bothPartsAgree(NotificationType type) {
        EmailContent content = composer.compose(message(type), RECIPIENT, PRIMARY);
        RenderedEmail email = renderer.render(content, PRIMARY);

        assertThat(email.text()).as("%s: headline in the text part", type).contains(content.headline());
        assertThat(email.html()).as("%s: headline in the HTML part", type).contains(content.headline());
        assertThat(email.text())
                .as("%s: the text part carries the destination as a readable URL", type)
                .contains(content.actionUrl());
        assertThat(email.html())
                .as("%s: the HTML part links to the same place", type)
                .contains(content.actionUrl());
    }

    // ------------------------------------------------------------------
    // What the links point at
    // ------------------------------------------------------------------

    /**
     * That a message about a campaign goes to that campaign.
     *
     * <p>{@code params.projectId} is what the pledge-shaped types carry, and reading it
     * is what stops the button falling back to the home page on the messages people
     * actually receive today.
     */
    @Test
    @DisplayName("a pledge confirmation links to the campaign it is about")
    void thePledgeConfirmationLinksToItsCampaign() {
        EmailContent content = composer.compose(message(NotificationType.PLEDGE_CONFIRMED), RECIPIENT, PRIMARY);

        assertThat(content.actionUrl()).endsWith("/projects/01890000-0000-7000-8000-000000000001");
    }

    /**
     * That the one message about the account rather than a campaign goes to the account.
     *
     * <p>A sign-in alert whose only button led to a campaign page would be the least
     * useful possible response to "somebody signed in as you".
     */
    @Test
    @DisplayName("a new-device alert links to the session list rather than to a campaign")
    void theSecurityAlertLinksToTheSessions() {
        EmailContent content = composer.compose(message(NotificationType.NEW_DEVICE_SIGN_IN), RECIPIENT, PRIMARY);

        assertThat(content.actionUrl()).endsWith("/settings/sessions");
    }

    /**
     * That an amount reaches the copy as the string §10.3 stored, unrounded.
     *
     * <p>Money is the reason this file is not only about spelling. {@code params} holds
     * {@code {"amount": "120.00"}} and a renderer that read it as a number would send
     * somebody {@code 120.0} — or, on the wrong value, something further from what they
     * pledged.
     */
    @Test
    @DisplayName("an amount is rendered exactly as it was stored, to the currency's scale")
    void anAmountIsNotRounded() {
        RenderedEmail email = renderer.render(
                composer.compose(message(NotificationType.PLEDGE_CONFIRMED), RECIPIENT, PRIMARY), PRIMARY);

        assertThat(email.text()).contains("120.00 AZN").doesNotContain("120.0 ").doesNotContain("120 AZN");
    }

    // ------------------------------------------------------------------
    // Naming the campaign -- #249
    // ------------------------------------------------------------------

    /**
     * That a document carrying a title produces copy that uses it.
     *
     * <p>The point of #249, checked on the message where it is worth most: a digest line and
     * a subject that say which campaign, rather than "a campaign you backed".
     */
    @Test
    @DisplayName("copy names the campaign when the document carries its title")
    void namedCopyIsUsedWhenThereIsATitle() {
        EmailContent content = composer.compose(named(NotificationType.GOAL_REACHED), RECIPIENT, PRIMARY);

        assertThat(content.subject()).contains(TITLE);
        assertThat(content.headline()).contains(TITLE);
        assertThat(content.paragraphs()).anySatisfy(paragraph -> assertThat(paragraph)
                .contains(TITLE));
    }

    /**
     * That a document without one still produces a finished sentence.
     *
     * <p>The rows written before #249 have no title, and neither has a notification whose
     * campaign was deleted between the event and the send. Those must fall back to copy that
     * reads correctly rather than to a sentence with a gap in it — which is what a single
     * key built around {@code {1}} would give them, and the reason there are two keys.
     */
    @Test
    @DisplayName("copy without a title falls back to the sentence that needs none")
    void plainCopyIsUsedWhenThereIsNoTitle() {
        EmailContent content =
                composer.compose(message(NotificationType.GOAL_REACHED), RECIPIENT, Locale.ENGLISH);

        assertThat(content.subject()).isEqualTo("The goal has been reached");
        assertThat(content.paragraphs()).allSatisfy(paragraph -> assertThat(paragraph)
                .doesNotContain(EmailFactsHole.DOUBLE_SPACE));
    }

    /**
     * That every {@code .named} key has the plain key it falls back to.
     *
     * <p>The one way this arrangement fails silently. {@code EmailComposer} prefers the named
     * variant and falls back to the plain one; a {@code .body2.named} whose counterpart was
     * never written would simply drop that paragraph for every reader whose notification has
     * no title, and nothing else in this suite would notice — the sentences that remain are
     * all well formed.
     */
    @Test
    @DisplayName("every campaign-naming key has the plain key it falls back to")
    void everyNamedKeyHasAPlainCounterpart() {
        ResourceBundle bundle = ResourceBundle.getBundle("messages", Locale.ROOT);

        List<String> orphans = bundle.keySet().stream()
                .filter(key -> key.endsWith(NAMED))
                .filter(key -> !bundle.containsKey(key.substring(0, key.length() - NAMED.length())))
                .sorted()
                .toList();

        assertThat(orphans)
                .withFailMessage(
                        "These keys name the campaign and have no fallback for a notification that carries"
                                + " no title:%n  %s",
                        String.join("\n  ", orphans))
                .isEmpty();
    }

    /**
     * The same three checks, against the document every new notification now carries.
     *
     * <p>{@link #nothingIsLeftUnfilled} renders the copy a titleless row falls back to, so on
     * its own it leaves the {@code .named} half of the bundle unexercised — and a named key
     * referring to a fact its type does not carry fails in exactly the invisible way that
     * suite exists to catch.
     */
    @ParameterizedTest
    @EnumSource(NotificationType.class)
    @DisplayName("the campaign-naming copy leaves no placeholder, null or gap either")
    void namedCopyIsAlsoComplete(NotificationType type) {
        for (Locale locale : LANGUAGES) {
            EmailContent content = composer.compose(named(type), RECIPIENT, locale);
            RenderedEmail email = renderer.render(content, locale);

            for (String part : List.of(email.subject(), email.text(), email.html())) {
                assertThat(part)
                        .as("%s renders every argument its named %s copy refers to", type, locale)
                        .doesNotContainPattern("\\{\\d}");
                assertThat(part).as("%s has no null fact in %s", type, locale).doesNotContain("null");
            }

            List<String> sentences = new java.util.ArrayList<>(content.paragraphs());
            sentences.add(content.subject());
            sentences.add(content.headline());
            assertThat(sentences).allSatisfy(sentence -> assertThat(sentence)
                    .as("%s refers to no fact it does not carry in %s -- see EmailFacts", type, locale)
                    .doesNotContain(EmailFactsHole.DOUBLE_SPACE));
        }
    }

    /**
     * That the button goes to a page that exists.
     *
     * <p>§10.2's campaign page takes two slugs, so the {@code /projects/{uuid}} this used to
     * build matched no route and answered 404 — on every email the platform sent about a
     * campaign. #249 puts both slugs in the document; this is the assertion that they are
     * used.
     */
    @Test
    @DisplayName("a campaign message links to the two-segment public path")
    void theButtonUsesThePublicPath() {
        EmailContent content = composer.compose(named(NotificationType.PLEDGE_CONFIRMED), RECIPIENT, PRIMARY);

        assertThat(content.actionUrl()).endsWith("/projects/aysel-studio/xari-bulbul-ceramics");
    }

    // ------------------------------------------------------------------
    // The one type with copy and no email
    // ------------------------------------------------------------------

    /**
     * {@code DEADLINE_24H} has copy because the switch is exhaustive, and no email column.
     *
     * <p>Asserted from the enum rather than from a list here, so that this stays true if
     * §4.10 changes its mind: what the test is about is that copy existing does not imply
     * an email being sendable.
     */
    @Test
    @DisplayName("a type with no email column still renders, and is still not emailed")
    void copyExistsForATypeThatIsNeverEmailed() {
        assertThat(NotificationType.DEADLINE_24H.channels())
                .as("§4.10 gives the twenty-four hour reminder push and in-app only")
                .doesNotContain(NotificationChannel.EMAIL);

        assertThat(renderer.render(
                                composer.compose(message(NotificationType.DEADLINE_24H), RECIPIENT, PRIMARY),
                                PRIMARY)
                        .subject())
                .isNotBlank();
    }

    // ------------------------------------------------------------------
    // The bundles themselves -- #324
    // ------------------------------------------------------------------

    /**
     * That every language holds every key English does.
     *
     * <p>A missing row does not throw: {@code ResourceBundle} falls back to the default bundle,
     * so the email goes out with one English sentence in the middle of it. That is the defect
     * this asserts against, and it is invisible to everybody who reads the language the file was
     * written in.
     */
    @Test
    @DisplayName("every language carries every key the English bundle does")
    void everyLanguageIsComplete() throws java.io.IOException {
        java.util.Properties english = bundleFile("messages.properties");

        for (String tag : TRANSLATED) {
            java.util.Properties translated = bundleFile("messages_" + tag + ".properties");

            List<String> missing = english.stringPropertyNames().stream()
                    .filter(key -> key.startsWith("email."))
                    .filter(key -> !translated.containsKey(key))
                    .sorted()
                    .toList();

            assertThat(missing)
                    .withFailMessage(
                            "The %s bundle has no row for these keys, so an email in that language"
                                    + " would carry English sentences:%n  %s",
                            tag, String.join(System.lineSeparator() + "  ", missing))
                    .isEmpty();
        }
    }

    /**
     * That no translation carries a lone apostrophe.
     *
     * <p>Every row is a {@code MessageFormat} pattern, where a single quote opens a literal
     * section: a Turkish sentence written {@code IdeaNest'e {1} geldi} prints the placeholder
     * as four characters rather than substituting the campaign. Turkish attaches case suffixes
     * to proper nouns with an apostrophe, so this is a trap the language walks into by writing
     * ordinary prose, and the failure lands in a subject line.
     *
     * <p>Doubling the quote is the escape and is allowed; what is refused is a lone one.
     */
    @Test
    @DisplayName("no translated line carries a lone apostrophe, which would swallow a placeholder")
    void noTranslationOpensALiteralSection() throws java.io.IOException {
        for (String tag : TRANSLATED) {
            java.util.Properties translated = bundleFile("messages_" + tag + ".properties");

            for (String key : translated.stringPropertyNames()) {
                assertThat(translated.getProperty(key).replace("''", ""))
                        .as("%s %s opens a MessageFormat literal section", tag, key)
                        .doesNotContain("'");
            }
        }
    }

    /**
     * One bundle, read as the file it is rather than through {@link ResourceBundle}.
     *
     * <p>{@code ResourceBundle} falls back to the default bundle for a key a translation is
     * missing, which is exactly the behaviour the first of these two tests exists to detect —
     * asking it whether a key is present would always answer yes.
     */
    private static java.util.Properties bundleFile(String name) throws java.io.IOException {
        java.util.Properties properties = new java.util.Properties();

        try (java.io.InputStream in = EmailCopyTests.class.getResourceAsStream("/" + name)) {
            assertThat(in).as("%s is on the classpath", name).isNotNull();
            properties.load(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8));
        }

        return properties;
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static NotificationMessage message(NotificationType type) {
        return message(type, PARAMS);
    }

    /** The same notification, about a campaign the document can name. */
    private static NotificationMessage named(NotificationType type) {
        return message(type, NAMED_PARAMS);
    }

    private static NotificationMessage message(NotificationType type, String params) {
        return new NotificationMessage(
                UUID.fromString("01890000-0000-7000-8000-000000000002"),
                UUID.fromString("01890000-0000-7000-8000-000000000003"),
                type,
                NotificationChannel.EMAIL,
                "project",
                UUID.fromString("01890000-0000-7000-8000-000000000001"),
                params,
                Instant.now().truncatedTo(ChronoUnit.MICROS),
                1);
    }

    /** Named so the assertion above reads as what it is checking rather than as a literal. */
    private static final class EmailFactsHole {

        /** What an unfilled slot leaves between two words. */
        static final String DOUBLE_SPACE = "  ";

        private EmailFactsHole() {
        }
    }
}
