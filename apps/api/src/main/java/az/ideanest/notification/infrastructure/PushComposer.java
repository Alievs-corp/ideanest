package az.ideanest.notification.infrastructure;

import az.ideanest.notification.application.NotificationDigest;
import az.ideanest.notification.application.NotificationMessage;
import java.util.Locale;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * What a push notification says, and where tapping it goes — issue #87.
 *
 * <h2>It reads the same catalogue the email does, and that is deliberate</h2>
 *
 * <p>The keys are {@code email.<TYPE>.subject} and {@code email.<TYPE>.line}. The prefix
 * is now a misnomer and the alternative was worse: a parallel {@code push.*} tree would
 * be twenty more entries saying the same thing in fewer words, and the two would diverge
 * the first time somebody corrected a sentence in one of them. Renaming the prefix is a
 * separate change because {@code template_overrides} is keyed on the type rather than on
 * the prefix but the editor's copy is not, and moving both belongs in its own diff.
 *
 * <p>The <em>choice</em> of keys is not arbitrary. A push notification is a title and one
 * line: {@code .subject} is already written to be a title, and {@code .line} is the
 * one-sentence form §12.2's digest needed — "your pledge of 25.00 AZN to Solar Lamp was
 * confirmed" — which is exactly the shape a lock screen wants. The email's
 * {@code .headline} and {@code .body} are paragraph copy and would be truncated by the
 * platform mid-sentence.
 *
 * <h2>An administrator's email edits are NOT applied</h2>
 *
 * <p>{@code TemplateOverrides} lets staff rewrite an email's subject and first paragraph
 * (#315). Those edits are not read here. A sentence written to head an email is not
 * necessarily one that fits on a lock screen, and silently reusing it would mean an
 * administrator changing an email and, without being told, changing every push
 * notification of that type as well.
 *
 * <h2>The destination is the campaign, or nothing</h2>
 *
 * <p>{@link NotificationFacts#pathFor} has fallbacks that resolve to paths the web has
 * and the mobile application does not — {@code /projects/{uuid}} is one, and
 * {@code apps/mobile}'s {@code lib/links.ts} refuses it by design. On the web a wrong
 * path renders a 404 page; from a push notification it opens the application and lands
 * nowhere, which reads as the application being broken.
 *
 * <p>So push sends only {@link NotificationFacts#campaignPath}, and when there is none it
 * sends the bare scheme — which opens the application at whatever screen it was on. That
 * is the honest answer for a message with no destination, and it is why the copy for
 * those types does not promise one.
 */
@Component
public class PushComposer {

    /** The catalogue prefix. See the class comment on why it still says {@code email}. */
    private static final String PREFIX = "email.";

    private static final String NAMED = ".named";

    /**
     * Where a link with no campaign behind it goes.
     *
     * <p>The scheme with no path. {@code apps/mobile}'s parser answers null for it, which
     * means "leave the person where they are" rather than "send them to the feed" — see
     * that file for why a fallback destination makes a bad link look like a good one.
     */
    private static final String NO_DESTINATION = "ideanest://";

    private final MessageSource messages;
    private final NotificationFacts facts;

    public PushComposer(MessageSource messages, NotificationFacts facts) {
        this.messages = messages;
        this.facts = facts;
    }

    /** A title, a line, and a destination. */
    public record PushContent(String title, String body, String url) {}

    /**
     * The push notification for one message.
     *
     * @param recipientName the name on the recipient's account. Slot {@code 0} in the
     *     catalogue, which most push copy does not use — a lock screen showing somebody
     *     their own name is a wasted line
     * @param locale the recipient's language, read from the account when the push is sent
     */
    public PushContent compose(NotificationMessage message, String recipientName, Locale locale) {
        JsonNode params = facts.paramsOf(message.params());
        EmailFacts values = facts.factsFor(message.type(), params, recipientName);
        String base = PREFIX + message.type().name() + ".";

        return new PushContent(
                copy(base + "subject", values, locale), copy(base + "line", values, locale), urlFor(params));
    }

    /**
     * The push notification for a digest — §12.2's "one message about several things".
     *
     * <p>No destination. A digest is about several campaigns, so any single link would be
     * a guess, and a lock screen has no room to offer the choice — the same argument
     * {@code EmailComposer} makes for leaving the digest email without a button. Tapping
     * opens the application, where the inbox is.
     */
    public PushContent compose(NotificationDigest digest, String recipientName, Locale locale) {
        EmailFacts values = EmailFacts.of(recipientName).withDetail(String.valueOf(digest.size()));
        return new PushContent(
                copy("email.digest.subject", values, locale),
                copy("email.digest.headline", values, locale),
                NO_DESTINATION);
    }

    private String urlFor(JsonNode params) {
        String path = facts.campaignPath(params);
        return path == null ? NO_DESTINATION : NO_DESTINATION + path.substring(1);
    }

    /**
     * One line of copy, in the recipient's language.
     *
     * <p>The language is the account's ({@code users.locale}), read by
     * {@link PushChannelSender} when the push is sent rather than when the notification was
     * queued — issue #216: a person who changes language in the application, in the phone's
     * per-app setting or on the web gets the next push in it, as the next email already
     * does ({@code EmailChannelSender}). It used to be {@link Locale#ROOT}, which is the
     * English base catalogue, for everybody.
     *
     * <p>A missing key throws, and {@code EmailCopyTests} asks for every key of every
     * type — so a type whose {@code .line} was never written is a build failure rather
     * than a push notification with a placeholder on somebody's lock screen.
     */
    private String copy(String key, EmailFacts values, Locale locale) {
        if (!values.projectTitle().isEmpty()) {
            String named = messages.getMessage(key + NAMED, values.arguments(), null, locale);
            if (named != null) {
                return named;
            }
        }
        return messages.getMessage(key, values.arguments(), locale);
    }
}
