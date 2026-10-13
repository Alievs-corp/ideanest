package az.ideanest.notification.infrastructure;

import az.ideanest.notification.NotificationProperties;
import az.ideanest.notification.application.NotificationDigest;
import az.ideanest.notification.application.NotificationMessage;
import az.ideanest.notification.application.TemplateOverrides;
import az.ideanest.notification.domain.NotificationType;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * What an email says, decided per notification type.
 *
 * <p>The half of #86 that is about words rather than about SMTP. It reads
 * {@code notifications.params}, pulls out the facts the type's copy refers to, and asks
 * {@code messages.properties} for the sentences — so changing what an email says is
 * editing a properties file, and changing which facts it may mention is editing the
 * switch below.
 *
 * <h2>The switch is exhaustive, deliberately</h2>
 *
 * <p>There is no {@code default}. Adding a constant to {@link NotificationType} therefore
 * fails to compile until somebody has decided what the email for it says, which is the
 * one property worth having here: the alternative is a template that resolves to an empty
 * string and an email that goes out saying nothing, discovered by whoever receives it.
 *
 * <p><strong>Thirteen of the twenty types have no producer yet</strong> — nothing
 * publishes an event that becomes a {@code SURVEY_AVAILABLE} or a {@code REWARD_SHIPPED},
 * and #64, #74 and #87 are where those arrive. Their copy is written all the same, for
 * the same reason the enum lists them: the row exists in §4.10, the preference model
 * already resolves it, and a type whose email is written the day its event lands is a
 * type whose email is written in a hurry.
 *
 * <h2>Naming the campaign — #249, and why there are two keys</h2>
 *
 * <p>{@code params} now carries {@code projectTitle} on every notification about a
 * campaign, so the copy can say which one. It cannot simply say it, because the rows
 * written before #249 have no title in them and neither will a row whose campaign was
 * deleted between the event and the send — and a sentence built around {@code {1}} renders
 * with a hole in it when {@code {1}} is empty.
 *
 * <p>So a key may have a {@code .named} variant, and {@link #copy} prefers it when there is
 * a title to put in it. Two plain sentences rather than one sentence with a conditional
 * inside it: {@code MessageFormat}'s {@code choice} would express the same thing in a form
 * no translator can read, and a single sentence with a generic fallback substituted for the
 * title reads wrongly in at least one of the two cases whatever wording is chosen — "your
 * pledge to this campaign is confirmed" is not English anybody writes.
 *
 * <p>A type with no {@code .named} variant is a type whose copy reads the same either way.
 * That is the common case for the button and for the paragraphs that are about money rather
 * than about which campaign it was.
 */
@Component
public class EmailComposer {

    /** Where {@code messages.properties} keeps this module's copy. */
    private static final String PREFIX = "email.";

    /**
     * The digest's own keys, which are not a {@link NotificationType} because a digest is
     * several types at once.
     */
    private static final String DIGEST = PREFIX + "digest.";

    /**
     * The suffix on the variant of a key that names the campaign — #249.
     *
     * <p>Optional on every key. Its absence means the sentence reads the same whether the
     * campaign is named or not, which is the majority of them.
     */
    private static final String NAMED = ".named";

    private final MessageSource messages;
    private final NotificationFacts facts;
    private final NotificationProperties properties;

    /**
     * AD-15's edits, layered over the catalogue — #315.
     *
     * <p>Consulted before {@link MessageSource} for the two keys the editor owns, and for
     * no others. Without this the template editor would store copy nothing renders, which
     * is a screen that lies about what it does.
     */
    private final TemplateOverrides overrides;

    public EmailComposer(
            MessageSource messages,
            NotificationFacts facts,
            NotificationProperties properties,
            TemplateOverrides overrides) {
        this.messages = messages;
        this.facts = facts;
        this.properties = properties;
        this.overrides = overrides;
    }

    /**
     * The content of the email for one notification.
     *
     * @param recipientName the name on the recipient's account, for the greeting
     */
    public EmailContent compose(NotificationMessage message, String recipientName, Locale locale) {
        JsonNode params = this.facts.paramsOf(message.params());
        EmailFacts facts = this.facts.factsFor(message.type(), params, recipientName);
        String action = actionUrl(message.type(), params, message.subjectType(), message.subjectId());
        String base = PREFIX + message.type().name() + ".";

        // The subject and the first paragraph are the two an administrator may rewrite
        // (#315); the headline and the button label stay in the catalogue, because a
        // button with no label is a broken email rather than a badly worded one.
        String type = message.type().name();

        return EmailContent.of(
                overridden(
                        overrides.subjectFor(type, TemplateOverrides.RENDER_LOCALE),
                        base + "subject",
                        facts,
                        locale),
                copy(base + "headline", facts, locale),
                overriddenParagraphs(type, base, facts, locale),
                copy(base + "action", facts, locale),
                action);
    }

    /**
     * The content of the email for one digest — §12.2's "one message about several
     * things".
     *
     * <p>Each member becomes a line built from its own type's {@code .line} key, which is
     * the same sentence as that type's headline in a form that reads inside a list. The
     * members are already ordered by when they happened; nothing is regrouped here,
     * because a digest that reordered its contents would not match the inbox beside it.
     */
    public EmailContent compose(NotificationDigest digest, String recipientName, Locale locale) {
        List<EmailContent.Item> items = new ArrayList<>(digest.notifications().size());
        for (NotificationMessage member : digest.notifications()) {
            JsonNode params = this.facts.paramsOf(member.params());
            EmailFacts facts = this.facts.factsFor(member.type(), params, recipientName);
            items.add(new EmailContent.Item(
                    copy(PREFIX + member.type().name() + ".line", facts, locale),
                    actionUrl(member.type(), params, member.subjectType(), member.subjectId())));
        }

        // The count is the digest's one fact, and it goes in the slot the keys document
        // for one — which is `detail`, because a digest is not about an amount.
        EmailFacts facts = EmailFacts.of(recipientName).withDetail(String.valueOf(digest.notifications().size()));

        // No button. Every line above is already a link to the thing it is about, and a
        // digest's single most likely destination is whichever of them the reader cares
        // about — so one button would have to pick, and picking wrongly is worse than
        // not offering one. The obvious candidate, a link to the notification settings
        // that produced the digest, is #89's page and does not exist; pointing at it
        // would be a dead link in every message the platform sends daily.
        return new EmailContent(
                copy(DIGEST + "subject", facts, locale),
                copy(DIGEST + "headline", facts, locale),
                List.of(copy(DIGEST + "body", facts, locale)),
                null,
                null,
                items);
    }

    /**
     * Where the button goes: {@link NotificationFacts#pathFor}, resolved against this
     * deployment's own origin.
     *
     * <p>The path is shared with push (#87) and the origin is not. A preview
     * environment's mail must not send its readers to production, and the mobile
     * application resolves the same path against its own scheme rather than against any
     * origin at all.
     */
    private String actionUrl(NotificationType type, JsonNode params, String subjectType, UUID subjectId) {
        return properties.email().baseUrl() + trimRoot(facts.pathFor(type, params, subjectType, subjectId));
    }

    /**
     * {@code "/"} becomes the empty string, so that the site link is {@code base} rather
     * than {@code base + "/"}.
     *
     * <p>{@code NotificationProperties.Email} already strips a trailing slash from the
     * configured origin precisely so that every template can concatenate; appending a bare
     * slash here would put one back on the one destination that has no path.
     */
    private static String trimRoot(String path) {
        return "/".equals(path) ? "" : path;
    }

    /**
     * The body, as however many paragraphs the type has.
     *
     * <p>{@code .body} is required and {@code .body2} is optional, which covers every
     * message §4.10 asks for without inventing a list format in a properties file. A type
     * needing three would add {@code .body3} here; none does.
     *
     * <p>{@code .account} (#418) is the one paragraph that depends on a fact rather than on a
     * key: it names the masked account money went to, between the two, and only when the
     * document carries one. A provider's payout has none, and a sentence written around an
     * empty {@code {4}} would leave a hole; a separate paragraph needs no fallback wording, which
     * in Azerbaijani, Turkish and Russian would need its own case ending.
     */
    private List<String> paragraphs(String base, EmailFacts facts, Locale locale) {
        // Through the same `.named` preference as everything else, so that a second
        // paragraph is not the one place in the file where naming the campaign silently
        // does nothing. `.body2.named` without `.body2` would drop the paragraph for a row
        // that has no title; `EmailCopyTests` holds that every `.named` key has its plain
        // counterpart, which is the property that makes this safe.
        String second =
                facts.projectTitle().isEmpty() ? null : optional(base + "body2" + NAMED, facts, locale);
        if (second == null) {
            second = optional(base + "body2", facts, locale);
        }
        List<String> paragraphs = new ArrayList<>(3);
        paragraphs.add(copy(base + "body", facts, locale));
        String account = facts.account().isEmpty() ? null : optional(base + "account", facts, locale);
        if (account != null) {
            paragraphs.add(account);
        }
        if (second != null) {
            paragraphs.add(second);
        }
        return List.copyOf(paragraphs);
    }

    /** An edited string when there is one, and the catalogue's otherwise. */
    private String overridden(
            java.util.Optional<String> override, String key, EmailFacts facts, Locale locale) {
        return override
                .map(text -> java.text.MessageFormat.format(text, facts.arguments()))
                .orElseGet(() -> copy(key, facts, locale));
    }

    /**
     * The paragraphs, with the first one overridable.
     *
     * <p>Only the first. A type's second paragraph is conditional on facts the editor
     * cannot see — {@code .body2.named} exists only when the campaign is named — so
     * offering it for editing would mean an administrator writing copy that appears for
     * some recipients and not others, with nothing on the screen to say which.
     */
    private List<String> overriddenParagraphs(
            String type, String base, EmailFacts facts, Locale locale) {
        java.util.Optional<String> body = overrides.bodyFor(type, TemplateOverrides.RENDER_LOCALE);
        if (body.isEmpty()) {
            return paragraphs(base, facts, locale);
        }

        List<String> shipped = paragraphs(base, facts, locale);
        List<String> edited = new ArrayList<>(shipped.size());
        edited.add(java.text.MessageFormat.format(body.get(), facts.arguments()));
        edited.addAll(shipped.subList(1, shipped.size()));
        return edited;
    }

    /**
     * One line of copy.
     *
     * <p><strong>In the recipient's language since #324.</strong> It used to resolve against
     * {@link Locale#ROOT}, with a note saying that {@code users} had a {@code locale} column
     * nothing here read. It reads it now: {@code EmailChannelSender} takes it off the
     * {@code UserAccount} it already loaded for the address and hands it down, so the language
     * comes from the account rather than from a request — which is the right source, because
     * this runs on a background sender where there is no request, and because the person who
     * triggered the event is frequently not the person being written to.
     *
     * <p>A bundle with no row for a key falls back to {@code messages.properties}, which is
     * English. That is a half-translated email and it is the reason {@code EmailCopyTests}
     * asks for every key of every type in all four languages rather than only the default.
     *
     * <p>A missing key throws. It is caught by {@code EmailCopyTests}, which asks for
     * every key of every type, so a missing one is a build failure rather than an email
     * that goes out with a placeholder in it.
     */
    private String copy(String key, EmailFacts facts, Locale locale) {
        if (!facts.projectTitle().isEmpty()) {
            String named = optional(key + NAMED, facts, locale);
            if (named != null) {
                return named;
            }
        }
        return messages.getMessage(key, facts.arguments(), locale);
    }

    /** The same, for a key a type may legitimately not have. */
    private String optional(String key, EmailFacts facts, Locale locale) {
        return messages.getMessage(key, facts.arguments(), null, locale);
    }

}
