package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.infrastructure.AuthEmailComposer;
import az.ideanest.notification.application.TransactionalMail;
import az.ideanest.notification.infrastructure.EmailContent;
import az.ideanest.notification.infrastructure.EmailRenderer;
import az.ideanest.notification.infrastructure.RenderedEmail;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.support.AbstractIntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Function;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.MessageSource;

/**
 * That the seven auth emails have copy, in all four languages, and that it is finished.
 *
 * <p>{@code EmailCopyTests} makes this argument for the twenty notification types and it
 * is the same one: a missing key throws, a key with a placeholder nothing fills renders
 * the placeholder, and neither is visible until somebody receives the message. One of
 * these messages is "your password was changed", which is the single message on this
 * platform most likely to be read carefully by somebody who is frightened.
 *
 * <p>Rendered all the way through both layouts rather than checked as strings, because
 * two of the failures are properties of the rendering: an empty paragraph list throws in
 * {@code EmailContent}, and a body that resolved to nothing produces a blank part that
 * {@code RenderedEmail} refuses.
 */
class AuthEmailCopyTests extends AbstractIntegrationTest {

    /** §21.1's four. A key absent from a translation falls back and sends half a language. */
    private static final List<Locale> LANGUAGES =
            ReaderLocale.SUPPORTED.stream().map(Locale::forLanguageTag).toList();

    private static final String TOKEN = "a-token";

    /** The address EMAIL_CHANGE_NOTICE puts in its {@code {0}}. */
    private static final String NEW_ADDRESS = "new-address@example.com";

    @Autowired
    private AuthEmailComposer composer;

    @Autowired
    private EmailRenderer renderer;

    @Autowired
    private MessageSource catalogue;

    /** Every message this module sends, named, so a failure says which one. */
    private List<Message> messages() {
        return List.of(
                new Message("VERIFY_EMAIL", locale -> composer.verifyEmail(TOKEN, locale)),
                new Message("REGISTRATION_ON_EXISTING_ACCOUNT", composer::registrationOnExistingAccount),
                new Message("PASSWORD_RESET", locale -> composer.passwordReset(TOKEN, locale)),
                new Message("PASSWORD_CHANGED", composer::passwordChanged),
                new Message("EMAIL_CHANGE_CONFIRMATION", locale -> composer.emailChangeConfirmation(TOKEN, locale)),
                new Message("EMAIL_CHANGE_NOTICE", locale -> composer.emailChangeNotice(NEW_ADDRESS, locale)),
                new Message("EMAIL_CHANGE_ON_EXISTING_ACCOUNT", composer::emailChangeOnExistingAccount));
    }

    @Test
    @DisplayName("every auth message renders a complete email in every language")
    void everyMessageRenders() {
        for (Message message : messages()) {
            for (Locale locale : LANGUAGES) {
                TransactionalMail mail = message.compose(locale);
                RenderedEmail rendered = render(mail, locale);

                assertThat(rendered.subject()).as("%s has a subject in %s", message.name(), locale).isNotBlank();
                assertThat(mail.headline()).as("%s opens with something in %s", message.name(), locale).isNotBlank();
                assertThat(mail.paragraphs()).as("%s has a body in %s", message.name(), locale).isNotEmpty();
                assertThat(mail.paragraphs()).allSatisfy(paragraph -> assertThat(paragraph)
                        .as("%s has no empty paragraph in %s", message.name(), locale)
                        .isNotBlank());
            }
        }
    }

    @Test
    @DisplayName("no auth message leaves a placeholder or a null behind")
    void nothingIsLeftUnfilled() {
        for (Message message : messages()) {
            for (Locale locale : LANGUAGES) {
                RenderedEmail rendered = render(message.compose(locale), locale);

                for (String part : List.of(rendered.subject(), rendered.text(), rendered.html())) {
                    assertThat(part)
                            .as("%s renders every argument its %s copy refers to", message.name(), locale)
                            .doesNotContainPattern("\\{\\d}");
                    assertThat(part)
                            .as("%s has no null in %s", message.name(), locale)
                            .doesNotContain("null");
                }
            }
        }
    }

    @Test
    @DisplayName("every language says something of its own, rather than falling back to English")
    void nothingFallsBackSilently() {
        // The fallback chain is messages_<language> -> messages, and messages is English.
        // A key nobody translated therefore renders a finished English sentence inside an
        // otherwise Azerbaijani email, which reads as a broken platform rather than as a
        // missing line -- and passes every assertion above.
        for (Message message : messages()) {
            String english = render(message.compose(Locale.ENGLISH), Locale.ENGLISH).subject();

            List<String> untranslated = new ArrayList<>();
            for (Locale locale : LANGUAGES) {
                if (Locale.ENGLISH.getLanguage().equals(locale.getLanguage())) {
                    continue;
                }
                if (english.equals(render(message.compose(locale), locale).subject())) {
                    untranslated.add(locale.toLanguageTag());
                }
            }

            assertThat(untranslated)
                    .as("%s has a subject of its own in every language", message.name())
                    .isEmpty();
        }
    }

    @Test
    @DisplayName("no auth message offers to switch itself off")
    void noneOffersAPreference() {
        // The claim MimeTransactionalMailer makes about the footer, asserted against the
        // renderer it makes it to. A preference behind "your password was changed" is one
        // an attacker turns off.
        for (Message message : messages()) {
            for (Locale locale : LANGUAGES) {
                String preferences = catalogue.getMessage("email.layout.preferences", null, locale);
                String footer = catalogue.getMessage("email.layout.footer", null, locale);
                RenderedEmail rendered = render(message.compose(locale), locale);

                for (String part : List.of(rendered.text(), rendered.html())) {
                    assertThat(part)
                            .as("%s renders without the preferences line in %s", message.name(), locale)
                            .doesNotContain(preferences);
                    // And with the first footer sentence, so this is an omission rather
                    // than a footer that failed to render at all.
                    assertThat(part)
                            .as("%s still says why it was sent, in %s", message.name(), locale)
                            .contains(footer);
                }
            }
        }
    }

    /**
     * The mapping {@code MimeTransactionalMailer} does, minus the origin.
     *
     * <p>The origin is a property of the deployment and adds nothing to a question about
     * words, so the path is used as the destination. What is copied from the adapter is
     * the argument that matters here: {@code preferencesApply} is false.
     */
    private RenderedEmail render(TransactionalMail mail, Locale locale) {
        return renderer.render(
                EmailContent.of(
                        mail.subject(),
                        mail.headline(),
                        mail.paragraphs(),
                        mail.actionLabel(),
                        mail.actionPath()),
                locale,
                false);
    }

    /** One message, with a name for the failure output. */
    private record Message(String name, Function<Locale, TransactionalMail> compose) {

        TransactionalMail compose(Locale locale) {
            return compose.apply(locale);
        }
    }
}
