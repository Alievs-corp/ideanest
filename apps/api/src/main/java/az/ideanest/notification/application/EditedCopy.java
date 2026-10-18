package az.ideanest.notification.application;

import java.text.MessageFormat;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * A subject and a first paragraph somebody wrote in the template editor — #315.
 *
 * <h2>Plain text with placeholders, not a {@code MessageFormat} pattern</h2>
 *
 * <p>The shipped catalogue is {@code MessageFormat}, and that syntax has a trap an editor
 * cannot be expected to know: an apostrophe starts a quoted section. "IdeyaNest'də" written
 * into a pattern swallows everything after the apostrophe, placeholders included, and the
 * message goes out saying less than the screen showed. Turkish and Azerbaijani copy uses the
 * apostrophe all the time.
 *
 * <p>So an edited text is read as what it looks like: every apostrophe is a literal
 * apostrophe, and the only syntax is {@code {n}}, the slot of one of {@code EmailFacts}' six
 * facts. That is done by escaping every apostrophe before the text is handed to
 * {@code MessageFormat} — deliberately escaped rather than refused, because refusing the
 * apostrophe would refuse ordinary Turkish. The cost is that an edited text cannot quote a
 * brace; braces are for placeholders, and an unbalanced one is refused on write by
 * {@link #check}.
 *
 * <p>A format inside a placeholder ({@code {2,number}}) is refused too. Every fact arrives
 * already formatted as a string, so a number format would throw at send time rather than
 * format anything.
 */
public record EditedCopy(String subject, String body) {

    /** How many facts {@code EmailFacts} carries: {@code {0}} to {@code {5}}. */
    public static final int SLOTS = 6;

    public EditedCopy {
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(body, "body");
    }

    /** One edited text rendered with the facts of one message. */
    public static String format(String text, Object[] arguments, Locale locale) {
        return compile(text, locale).format(arguments);
    }

    /** Whether either text names the campaign, {@code {1}} — see {@code EmailComposer}. */
    public boolean namesCampaign() {
        return indicesIn(subject).contains("1") || indicesIn(body).contains("1");
    }

    /**
     * Refuses a text that would not render, before it is stored.
     *
     * @param field which of the two it is, for the refusal
     * @param allowed the slots this message fills. A placeholder outside them would render as
     *     an empty gap in every message sent
     * @throws TemplateCopyMalformedException for an unbalanced brace, a placeholder that is not
     *     a bare number, a format inside one, or a slot the message has no fact for
     */
    public static void check(String field, String text, Set<String> allowed) {
        MessageFormat format;
        try {
            format = compile(text, Locale.ROOT);
        } catch (IllegalArgumentException e) {
            throw new TemplateCopyMalformedException(field, TemplateCopyMalformedException.Reason.SYNTAX, null);
        }
        for (java.text.Format inner : format.getFormats()) {
            if (inner != null) {
                throw new TemplateCopyMalformedException(field, TemplateCopyMalformedException.Reason.SYNTAX, null);
            }
        }
        for (String index : indicesOf(format)) {
            if (!allowed.contains(index)) {
                throw new TemplateCopyMalformedException(
                        field, TemplateCopyMalformedException.Reason.UNKNOWN_PLACEHOLDER, index);
            }
        }
    }

    /**
     * The slots an edited text uses, found by formatting it rather than by pattern-matching.
     *
     * <p>Formatting is what the sender does, so a placeholder counts as present exactly when it
     * would expand in a real message. Empty for a text that does not compile, which
     * {@link #check} refuses before it matters.
     */
    public static Set<String> indicesIn(String text) {
        try {
            return indicesOf(compile(text, Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return Set.of();
        }
    }

    /** The same, for a shipped catalogue pattern, which is real {@code MessageFormat}. */
    static Set<String> indicesInPattern(String pattern) {
        try {
            return indicesOf(new MessageFormat(pattern, Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return Set.of();
        }
    }

    private static MessageFormat compile(String text, Locale locale) {
        return new MessageFormat(text.replace("'", "''"), locale);
    }

    /**
     * Every argument index a compiled format expands, by formatting it with markers.
     *
     * <p>Sorted numerically, so the order a refusal or a screen names them in is stable.
     */
    private static Set<String> indicesOf(MessageFormat format) {
        int width = format.getFormatsByArgumentIndex().length;
        Object[] markers = new Object[width];
        for (int i = 0; i < width; i++) {
            markers[i] = marker(i);
        }
        String rendered = format.format(markers);

        Set<Integer> found = new TreeSet<>();
        for (int i = 0; i < width; i++) {
            if (rendered.contains(marker(i))) {
                found.add(i);
            }
        }
        Set<String> indices = new LinkedHashSet<>();
        found.forEach(index -> indices.add(String.valueOf(index)));
        return indices;
    }

    private static String marker(int index) {
        return "\u0000" + index + "\u0001";
    }
}
