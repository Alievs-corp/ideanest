package az.ideanest.shared;

import java.util.List;
import java.util.Locale;

/**
 * §21.1's four languages, and the one place a stored tag becomes a {@link Locale} — issue #324.
 *
 * <p><strong>Why this is in {@code shared} rather than beside the thing that needed it.</strong>
 * Three modules already spell this list: {@code Taxonomy} resolves category names against it,
 * {@code users_locale_supported} in {@code V2__create_identity_schema.sql} constrains the column,
 * and the web client keeps a third copy that {@code locale.test.ts} asserts. The notification
 * module needs it too now, to send in the recipient's language, and it may not reach into
 * {@code project} to get it — {@code ModuleBoundaryTests} is explicit that a fact belonging to no
 * one feature belongs here. {@code Taxonomy} reads this rather than repeating it, so the
 * fourth spelling is a delegation instead of a copy.
 *
 * <p><strong>Why a {@link Locale} at all.</strong> {@code users.locale} is a BCP 47 primary
 * subtag — {@code az}, not {@code az-Latn-AZ} — and everything that consumes it wants a
 * {@code Locale}: {@code MessageSource} selects a bundle with one, Thymeleaf takes one on its
 * context, and {@code MessageFormat} formats numbers and dates against one. Building it at each
 * call site is how a null column becomes {@code Locale.forLanguageTag(null)} and throws four
 * frames from the thing that stored it.
 *
 * <p><strong>An unknown tag falls back rather than throwing.</strong> A value that is not one of
 * the four can only come from a row written before a constraint, or by hand; the honest answer is
 * an email in the primary language rather than an email that is not sent at all. That is the same
 * decision {@code localeOrDefault} makes in the web client, and the same one {@code Taxonomy}
 * makes about a requested language it has no rows for.
 */
public final class ReaderLocale {

    /** §21.1's primary language. What an unreadable or absent preference resolves to. */
    public static final String PRIMARY = "az";

    /** The four codes, in §21.1's phase order, and the same set the database checks. */
    public static final List<String> SUPPORTED = List.of("az", "en", "ru", "tr");

    private ReaderLocale() {}

    /** Whether a tag is one of §21.1's languages. */
    public static boolean supported(String tag) {
        return tag != null && SUPPORTED.contains(tag);
    }

    /**
     * The {@link Locale} for a stored tag, or the primary language for anything else.
     *
     * <p>{@link Locale#forLanguageTag} rather than {@code new Locale(tag)}: the deprecated
     * constructor accepts anything at all, so a column holding {@code "english"} would produce a
     * locale that quietly matches no bundle rather than falling back here where it is visible.
     */
    public static Locale of(String tag) {
        return Locale.forLanguageTag(supported(tag) ? tag : PRIMARY);
    }

    /**
     * The language to answer in, from an {@code Accept-Language} header.
     *
     * <p>RFC 4647 lookup, through {@link Locale#lookupTag}, rather than reading
     * the first two characters: a browser sends {@code en-GB,en;q=0.9,az;q=0.8}
     * and the quality values are the user's stated order of preference. Lookup
     * also truncates a range, so {@code en-GB} finds {@code en} — a client asking
     * for British English gets English rather than Azerbaijani.
     *
     * <p>Anything unparseable, absent, or outside {@link #SUPPORTED} resolves to
     * {@link #PRIMARY}. A malformed header is a client bug and must not become a
     * 400 on a public, cacheable read.
     *
     * @return one of {@link #SUPPORTED}, never null
     */
    public static String fromAcceptLanguage(String acceptLanguage) {
        if (acceptLanguage == null || acceptLanguage.isBlank()) {
            return PRIMARY;
        }
        List<Locale.LanguageRange> ranges;
        try {
            ranges = Locale.LanguageRange.parse(acceptLanguage);
        } catch (IllegalArgumentException e) {
            return PRIMARY;
        }
        String matched = Locale.lookupTag(ranges, SUPPORTED);
        return matched == null ? PRIMARY : matched;
    }
}
