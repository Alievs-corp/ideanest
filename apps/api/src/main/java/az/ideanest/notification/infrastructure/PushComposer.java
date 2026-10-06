package az.ideanest.notification.infrastructure;

import az.ideanest.notification.application.NotificationDigest;
import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.domain.NotificationType;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
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
 * <h2>The destination is the one the inbox links, or nothing</h2>
 *
 * <p>{@link NotificationFacts#pathFor} has fallbacks that resolve to paths the web has
 * and the mobile application does not — {@code /projects/{uuid}} is one, and
 * {@code apps/mobile}'s {@code lib/links.ts} refuses it by design. On the web a wrong
 * path renders a 404 page; from a push notification it opens the application and lands
 * nowhere, which reads as the application being broken.
 *
 * <p>So push sends only {@link NotificationFacts#appPathFor} — the session list for
 * {@code NEW_DEVICE_SIGN_IN}, otherwise the campaign, exactly the two the web inbox links
 * — and when there is neither it sends the bare scheme, which the application's tap
 * handler opens as the inbox (#160). The copy for those types does not promise more.
 *
 * <h2>{@code data} says which inbox row this is</h2>
 *
 * <p>Besides {@code url}, a push carries its {@code type} and, when the recipient's inbox
 * holds the same event, that row's identifier as {@code notificationId} (#160). Every
 * channel writes its own row, so the push row's identifier is not the inbox's; the sender
 * looks the inbox row up and passes it in. With it a tap marks the row read, and without it
 * — in-app switched off for the category, or a digest — the application has nothing to
 * mark. Neither key says anything the visible text does not.
 */
@Component
public class PushComposer {

    /** The catalogue prefix. See the class comment on why it still says {@code email}. */
    private static final String PREFIX = "email.";

    private static final String NAMED = ".named";

    /**
     * Where a link with no destination behind it goes.
     *
     * <p>The scheme with no path. {@code apps/mobile}'s parser answers null for it, and the
     * push tap handler — not the parser, because a shared link with no destination should
     * still leave the person where they are — opens the inbox, where the message lives.
     */
    private static final String NO_DESTINATION = "ideanest://";

    private final MessageSource messages;
    private final NotificationFacts facts;

    public PushComposer(MessageSource messages, NotificationFacts facts) {
        this.messages = messages;
        this.facts = facts;
    }

    /**
     * A title, a line, and what the application reads when it is tapped.
     *
     * @param url where tapping it goes, as an {@code ideanest://} link
     * @param type the {@code NotificationType}'s name, or null for a digest, which is several
     * @param notificationId the inbox row of the same event, or null when there is none
     */
    public record PushContent(String title, String body, String url, String type, UUID notificationId) {

        /**
         * Expo's {@code data}: {@code url} always, the other two only when known.
         *
         * <p>Absent rather than null, so the application has one case to handle per key.
         */
        public Map<String, String> data() {
            Map<String, String> data = new LinkedHashMap<>();
            data.put("url", url);
            if (type != null) {
                data.put("type", type);
            }
            if (notificationId != null) {
                data.put("notificationId", notificationId.toString());
            }
            return Collections.unmodifiableMap(data);
        }
    }

    /**
     * The push notification for one message.
     *
     * @param inboxId the identifier of the recipient's inbox row for the same event, or null
     *     when the event wrote none — sent as {@code notificationId} so a tap can mark it read
     * @param recipientName the name on the recipient's account. Slot {@code 0} in the
     *     catalogue, which most push copy does not use — a lock screen showing somebody
     *     their own name is a wasted line
     * @param locale the recipient's language, read from the account when the push is sent
     */
    public PushContent compose(NotificationMessage message, UUID inboxId, String recipientName, Locale locale) {
        JsonNode params = facts.paramsOf(message.params());
        EmailFacts values = facts.factsFor(message.type(), params, recipientName);
        String base = PREFIX + message.type().name() + ".";

        return new PushContent(
                copy(base + "subject", values, locale),
                copy(base + "line", values, locale),
                urlFor(message.type(), params),
                message.type().name(),
                inboxId);
    }

    /**
     * The push notification for a digest — §12.2's "one message about several things".
     *
     * <p>No destination. A digest is about several campaigns, so any single link would be
     * a guess, and a lock screen has no room to offer the choice — the same argument
     * {@code EmailComposer} makes for leaving the digest email without a button. Tapping
     * opens the inbox. No type and no inbox row either: a digest is several of each.
     */
    public PushContent compose(NotificationDigest digest, String recipientName, Locale locale) {
        EmailFacts values = EmailFacts.of(recipientName).withDetail(String.valueOf(digest.size()));
        return new PushContent(
                copy("email.digest.subject", values, locale),
                copy("email.digest.headline", values, locale),
                NO_DESTINATION,
                null,
                null);
    }

    private String urlFor(NotificationType type, JsonNode params) {
        String path = facts.appPathFor(type, params);
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
