package az.ideanest.notification.application;

import az.ideanest.notification.domain.NotificationType;
import az.ideanest.shared.ReaderLocale;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.context.MessageSource;
import org.springframework.context.NoSuchMessageException;
import org.springframework.stereotype.Component;

/**
 * The copy a template ships with, in one language, and what an edit of it must keep — #315.
 *
 * <h2>Per language</h2>
 *
 * <p>An override is stored per locale (V52 made the pair its identity, and its CHECK only
 * admits a real two-letter code), so the copy it is compared against is the shipped copy in
 * that same language. Comparing an Azerbaijani rewrite with the English catalogue would ask it
 * to keep placeholders the Azerbaijani sentence may legitimately place differently.
 *
 * <h2>The campaign-named variant counts</h2>
 *
 * <p>Since #249 most campaign messages have a {@code .named} twin that names the campaign
 * with {@code {1}}, and that twin is what nearly every recipient receives. An override
 * replaces both twins at once, so its required placeholders are the union over
 * {@code subject}, {@code subject.named}, {@code body} and {@code body.named}: an edit that
 * dropped the campaign name would otherwise pass the check and quietly stop telling people
 * which campaign the message is about. {@code EmailComposer} sends the shipped copy instead
 * for the old notifications that carry no name, so keeping {@code {1}} never leaves a gap.
 */
@Component
public class ShippedCopy {

    private static final String PREFIX = "email.";

    /** Every key a type's email may have — {@code EmailComposer} reads exactly these. */
    private static final List<String> KEYS =
            List.of("subject", "headline", "body", "body2", "account", "action", "line");

    private static final String NAMED = ".named";

    private final MessageSource messages;

    public ShippedCopy(MessageSource messages) {
        this.messages = messages;
    }

    /** The shipped copy of one type in one of §21.1's languages. */
    public Copy of(NotificationType type, String locale) {
        Locale resolved = ReaderLocale.of(locale);
        String subject = optional(type, "subject", resolved);
        String body = optional(type, "body", resolved);
        String subjectNamed = optional(type, "subject" + NAMED, resolved);
        String bodyNamed = optional(type, "body" + NAMED, resolved);

        Set<String> required = new TreeSet<>(ShippedCopy::byNumber);
        for (String pattern : new String[] {subject, body, subjectNamed, bodyNamed}) {
            if (pattern != null) {
                required.addAll(EditedCopy.indicesInPattern(pattern));
            }
        }

        // The greeting's slot is always filled, whatever the type. Everything else is offered
        // only if some part of this message already uses it, because that is the evidence the
        // message carries the fact at all.
        Set<String> available = new TreeSet<>(ShippedCopy::byNumber);
        available.add("0");
        for (String key : KEYS) {
            for (String variant : List.of(key, key + NAMED)) {
                String pattern = optional(type, variant, resolved);
                if (pattern != null) {
                    available.addAll(EditedCopy.indicesInPattern(pattern));
                }
            }
        }

        return new Copy(
                plain(subject),
                plain(body),
                subjectNamed == null ? null : plain(subjectNamed),
                bodyNamed == null ? null : plain(bodyNamed),
                new LinkedHashSet<>(required),
                new LinkedHashSet<>(available));
    }

    private String optional(NotificationType type, String suffix, Locale locale) {
        try {
            return messages.getMessage(PREFIX + type.name() + "." + suffix, null, null, locale);
        } catch (NoSuchMessageException e) {
            return null;
        }
    }

    /**
     * A catalogue pattern as the editor's plain-text convention writes it.
     *
     * <p>{@code ''} is how {@code MessageFormat} spells an apostrophe and {@link EditedCopy}
     * spells it {@code '}. Converted here so that an editor starting from the shipped copy and
     * saving it unchanged sends exactly what the catalogue sends. Missing copy is a build failure
     * caught by {@code EmailCopyTests}; the screen shows it as empty rather than failing.
     */
    private static String plain(String pattern) {
        return pattern == null ? "" : pattern.replace("''", "'");
    }

    private static int byNumber(String left, String right) {
        return Integer.compare(Integer.parseInt(left), Integer.parseInt(right));
    }

    /**
     * One type's shipped copy in one language.
     *
     * @param subjectNamed the campaign-named subject, or null when the type has none
     * @param bodyNamed the campaign-named first paragraph, or null when the type has none
     * @param required the slots an override must keep, in numeric order
     * @param available the slots an override may use, in numeric order
     */
    public record Copy(
            String subject,
            String body,
            String subjectNamed,
            String bodyNamed,
            Set<String> required,
            Set<String> available) {

        /** Refuses an edit that would not render. */
        public void check(EditedCopy edited) {
            EditedCopy.check("subject", edited.subject(), available);
            EditedCopy.check("body", edited.body(), available);
        }

        /** The required slots an edit leaves out, in numeric order. Empty when it keeps them all. */
        public List<String> missingFrom(EditedCopy edited) {
            Set<String> present = new LinkedHashSet<>(EditedCopy.indicesIn(edited.subject()));
            present.addAll(EditedCopy.indicesIn(edited.body()));
            return required.stream().filter(index -> !present.contains(index)).toList();
        }
    }
}
