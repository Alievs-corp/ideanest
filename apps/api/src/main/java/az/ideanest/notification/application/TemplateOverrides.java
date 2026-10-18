package az.ideanest.notification.application;

import az.ideanest.notification.domain.EmailTemplateVersion;
import az.ideanest.notification.infrastructure.EmailTemplateVersionRepository;
import az.ideanest.shared.ReaderLocale;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What the platform sends when somebody has rewritten it — §12.3 and AD-15, issue #315.
 *
 * <h2>Overrides, not templates</h2>
 *
 * <p>V52's header has the argument at length. The message catalogue stays authoritative:
 * it is translated, reviewed and shipped with the code that reads it, so a template living
 * only in the database would mean a deployment that added a notification type shipped code
 * rendering a template nobody had inserted yet — and the first missing row is a
 * notification that cannot be sent.
 *
 * <p>So a row exists only for copy somebody has edited, and its absence means "send what
 * the code says". That is what makes this class a lookup with a miss rather than a
 * resolver with a fallback.
 *
 * <h2>What can be edited, and what cannot</h2>
 *
 * <p>The subject and the body paragraph. The headline, the button label and the digest's
 * lines stay in the catalogue, and that is a scope decision rather than an oversight: those
 * three are structural — a button with no label is a broken email rather than a badly
 * worded one — and §12.3's argument about editing is about the words a recipient reads.
 *
 * <p><strong>Placeholders are checked on write, not here.</strong>
 * {@code EmailTemplateEditor} refuses an override whose body drops a {@code {n}} the
 * shipped copy carries — the payment-failure notice that no longer says which card was
 * declined is the case #315 named, and no role check catches it because the administrator
 * editing it is exactly the person allowed to.
 *
 * <h2>The cache</h2>
 *
 * <p>Every override in one map, replaced whole on an edit. Loaded lazily and never
 * expiring on a timer, unlike {@code FeatureFlags}: an edit goes through
 * {@code EmailTemplateEditor}, which clears it, and there is no other writer — where a flag
 * can be changed on another instance and has to be re-read. What that leaves is the window
 * between one instance's edit and another instance's next restart, which is why
 * {@link #reload} is public and the editor calls it.
 */
@Service
public class TemplateOverrides {

    /**
     * The language an override for a recipient reading in {@code locale} is stored under.
     *
     * <p>One of §21.1's four. An override is per language, because that is what a translation
     * is: editing the Azerbaijani does not rewrite what an English reader receives, and a
     * language with no override sends its own shipped copy. Anything the platform does not
     * translate into reads the primary language, exactly as {@code ReaderLocale} resolves it for
     * the shipped copy, so the two can never disagree about which text a recipient gets.
     *
     * <p>This replaced a single {@code "und"} key that applied one override to every language.
     * V52's CHECK only admits a two-letter code, so no {@code und} row ever existed — every
     * write under it failed — and nothing had to be migrated.
     */
    public static String localeOf(Locale locale) {
        String language = locale == null ? null : locale.getLanguage();
        return ReaderLocale.supported(language) ? language : ReaderLocale.PRIMARY;
    }

    private final EmailTemplateVersionRepository versions;

    /**
     * Every live override, keyed by {@code templateKey + ':' + locale}.
     *
     * <p>Null until first read. A null map and an empty one are different states here —
     * empty means "there are no overrides", and null means "nobody has looked yet" — and
     * conflating them would make the first message the platform sends after a restart
     * ignore every override in the table.
     */
    private final AtomicReference<Map<String, EmailTemplateVersion>> cache = new AtomicReference<>();

    public TemplateOverrides(EmailTemplateVersionRepository versions) {
        this.versions = versions;
    }

    /**
     * The live version of this template in this language, if somebody has edited it.
     *
     * @param locale §21.1's code — see {@link #localeOf}
     */
    public Optional<EmailTemplateVersion> liveFor(String templateKey, String locale) {
        return Optional.ofNullable(current().get(key(templateKey, locale)));
    }

    /** What renders in place of the shipped subject and first paragraph, if anything. */
    public Optional<EditedCopy> editedFor(String templateKey, String locale) {
        return liveFor(templateKey, locale).map(version -> new EditedCopy(version.subject(), version.body()));
    }

    /**
     * Every live override, grouped by template, for the list that says which are rewritten.
     *
     * <p>From the cache rather than the table, so the list and the sender cannot disagree.
     */
    public Map<String, List<EmailTemplateVersion>> liveByTemplate() {
        Map<String, List<EmailTemplateVersion>> grouped = new TreeMap<>();
        for (EmailTemplateVersion version : current().values()) {
            grouped.computeIfAbsent(version.templateKey(), key -> new ArrayList<>()).add(version);
        }
        grouped.values().forEach(list -> list.sort(Comparator.comparing(EmailTemplateVersion::locale)));
        return grouped;
    }

    /** Drops the cache. Called by the editor after every write. */
    public void reload() {
        cache.set(null);
    }

    @Transactional(readOnly = true)
    Map<String, EmailTemplateVersion> current() {
        Map<String, EmailTemplateVersion> held = cache.get();
        if (held != null) {
            return held;
        }

        Map<String, EmailTemplateVersion> loaded = new HashMap<>();
        for (EmailTemplateVersion version : versions.allLive()) {
            loaded.put(key(version.templateKey(), version.locale()), version);
        }

        Map<String, EmailTemplateVersion> immutable = Map.copyOf(loaded);
        cache.compareAndSet(null, immutable);

        // The winner's map is returned rather than this one, so that two threads loading at
        // once cannot hand out two different snapshots of the same table.
        Map<String, EmailTemplateVersion> settled = cache.get();
        return settled == null ? immutable : settled;
    }

    private static String key(String templateKey, String locale) {
        return templateKey + ':' + locale;
    }
}
