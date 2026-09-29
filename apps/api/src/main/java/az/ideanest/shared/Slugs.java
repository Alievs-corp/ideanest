package az.ideanest.shared;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Turns a display name into the lowercase, hyphenated form that appears in a
 * URL.
 *
 * <p>Azerbaijani is the primary language, so the folding is written for it
 * rather than inherited from a library that assumes Latin-1. {@code ə} has no
 * decomposition — Unicode normalisation leaves it untouched — so a name like
 * "Səbinə" would otherwise slug to something containing a character that half
 * the systems downstream will percent-encode and the other half will mangle.
 * The same applies to {@code ı}, whose uppercase is {@code I} and whose
 * lowercase in a Turkish locale is not what a default {@code toLowerCase} would
 * produce; every case conversion here is explicitly {@link Locale#ROOT}.
 *
 * <p>The folding matches {@code docs/architecture.md} §11.3, which asks the
 * search index to fold the same characters. A slug and a search term that
 * disagree about what "Sabina" folds to would be two answers to one question.
 * {@link #fold} is that one answer: {@code Tag.slugOf} and the search index both
 * go through it, and the database's {@code ideanest_fold} is its mirror.
 */
public final class Slugs {

    private static final Pattern NON_SLUG = Pattern.compile("[^a-z0-9]+");
    private static final Pattern EDGE_HYPHENS = Pattern.compile("^-+|-+$");

    /**
     * The Azerbaijani letters Unicode normalisation will not decompose. The
     * rest — é, ü as u-with-diaeresis, and so on — are handled by NFKD below.
     */
    private static final String[][] FOLDINGS = {
        {"ə", "e"}, {"Ə", "e"},
        {"ı", "i"}, {"İ", "i"},
        {"ğ", "g"}, {"Ğ", "g"},
        {"ş", "s"}, {"Ş", "s"},
        {"ç", "c"}, {"Ç", "c"},
        {"ö", "o"}, {"Ö", "o"},
        {"ü", "u"}, {"Ü", "u"},
    };

    /**
     * Slugs a user, creator or campaign may not have, because the web already
     * uses them as static route segments.
     *
     * <p>The public campaign page is {@code /projects/{creatorSlug}/{projectSlug}},
     * and the same {@code /projects/[id]/} segment has static children that take a
     * project id: {@code back}, {@code dashboard}, {@code edit} and
     * {@code prelaunch}. Next.js matches a static segment before a dynamic one, so
     * a campaign whose slug is {@code back} would have the checkout as its public
     * address. {@code new} is the mirror case one level up: {@code /projects/new}
     * is the new-campaign page, so a creator slugged {@code new} would lose every
     * campaign address.
     *
     * <p>One list for both kinds of slug, because a word that is safe today in
     * one position is one route away from not being. {@code ReservedSlugsTests}
     * reads {@code apps/web/src/app/[locale]/projects/} and fails when a static
     * child is added there without being added here. V82 moved the existing rows
     * off these words.
     */
    public static final Set<String> RESERVED = Set.of("back", "dashboard", "edit", "new", "prelaunch");

    private Slugs() {
    }

    /** Whether a slug is one of {@link #RESERVED}; an allocator skips straight to {@code -2}. */
    public static boolean isReserved(String slug) {
        return RESERVED.contains(slug);
    }

    /**
     * §11.3's fold, and nothing else: the seven pairs in both cases, then lower
     * case.
     *
     * <p><strong>This is the platform's one definition of the fold, and it has a
     * mirror in the database.</strong> {@code ideanest_fold(text)} — V13 — does
     * exactly this, because the search index is built from the folded text and a
     * query folded only in Java would not match an index folded differently. The
     * two are pinned to each other over a shared table of cases by
     * {@code SearchFoldingTests}; if this method changes and that function does
     * not, that suite fails rather than the search quietly returning nothing.
     *
     * <p>The fold runs <strong>before</strong> the lower-casing and covers both
     * cases of each letter, because {@code "İ".toLowerCase(Locale.ROOT)} produces
     * an {@code i} followed by a combining dot above rather than a plain
     * {@code i} — a difference invisible in a diff and fatal to a unique index,
     * and one PostgreSQL's {@code lower()} makes differently again depending on
     * the database's ctype. Mapping {@code İ} straight to {@code i} makes the
     * answer the same in both languages.
     *
     * <p>No transliteration beyond those seven pairs, and no normalisation: this
     * is the comparison form of a word, not a slug. {@link #slugify} adds NFKD and
     * the hyphenation on top.
     *
     * @param text any text; null folds to an empty string, because a caller
     *     comparing "nothing" against a stored value wants no match rather than a
     *     null check at every site
     */
    public static String fold(String text) {
        if (text == null) {
            return "";
        }
        String folded = text;
        for (String[] folding : FOLDINGS) {
            folded = folded.replace(folding[0], folding[1]);
        }
        return folded.toLowerCase(Locale.ROOT);
    }

    /**
     * The slug for a name, or an empty string if nothing survives folding —
     * a name written entirely in a script this does not transliterate, for
     * instance. Callers decide what to do with that; silently inventing a slug
     * here would hide the case.
     */
    public static String slugify(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        // Decomposes the accented characters that do decompose — é to e plus a
        // combining acute — so that stripping the marks leaves the letter. The
        // seven pairs of §11.3 have already gone through fold(), which is why the
        // decomposition cannot reach them: ə has no decomposition at all.
        String folded = Normalizer.normalize(fold(raw), Normalizer.Form.NFKD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT);

        String slug = NON_SLUG.matcher(folded).replaceAll("-");
        return EDGE_HYPHENS.matcher(slug).replaceAll("");
    }
}
