package az.ideanest.legal.api;

import az.ideanest.legal.application.DocumentNotPublishedException;
import az.ideanest.legal.application.LegalDocuments;
import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.shared.ReaderLocale;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §22.2's documents, as anybody may read them — issues #425 and #439.
 *
 * <h2>Public, because that is the whole point of them</h2>
 *
 * <p>These are the pages a stranger and a regulator read. A terms of use behind
 * authentication is a document nobody can decide to be bound by, and §22.3 asks for a risk
 * statement and a fee disclosure that a person sees <em>before</em> they commit — which
 * means before they have an account.
 *
 * <h2>Cacheable, and by a shared cache</h2>
 *
 * <p>Nothing in any answer here belongs to a person: it is the same text for everybody, and
 * it changes a few times a year. That is the one shape a {@code public} cache directive is
 * actually correct for, and it is what stops eight documents in four languages being read
 * out of PostgreSQL on every footer render.
 *
 * <p>An hour rather than a day. The lag matters in one direction only — a version published
 * this morning should be what somebody accepting this afternoon is shown — and an hour bounds
 * that without making the pages dynamic. The gates check the database on every submission and
 * every confirmation, so a stale page can never produce a stale acceptance.
 *
 * <p><strong>Never past a version's effective date.</strong> When a published version is waiting
 * for its date, the directive is shortened to end at that moment, so a cache between the service
 * and a reader cannot keep serving the previous text after the new one starts to govern. The web's
 * own cache is dropped on the date by {@code LegalTakingEffectJob}.
 */
@RestController
public class LegalDocumentController {

    /** Long enough to be a cache, short enough that a publication lands the same morning. */
    private static final Duration CACHE_FOR = Duration.ofHours(1);

    /** An archived version cannot change — V65's trigger refuses it — so it is cached hard. */
    private static final Duration ARCHIVE_CACHE_FOR = Duration.ofDays(30);

    private final LegalDocuments documents;
    private final Clock clock;

    public LegalDocumentController(LegalDocuments documents, Clock clock) {
        this.documents = documents;
        this.clock = clock;
    }

    /**
     * The hour, or less when a version takes effect sooner.
     *
     * <p>Rounded up to the next second and never below one, so a date a few milliseconds away
     * is not a directive of zero that tells a cache to keep nothing at all.
     */
    private CacheControl inForceCaching() {
        Duration window = CACHE_FOR;
        java.util.Optional<Instant> next = documents.nextTakingEffect();
        if (next.isPresent()) {
            Duration until = Duration.between(clock.instant(), next.get());
            long seconds = Math.max(1, (until.toMillis() + 999) / 1000);
            if (seconds < window.toSeconds()) {
                window = Duration.ofSeconds(seconds);
            }
        }
        return CacheControl.maxAge(window).cachePublic();
    }

    /**
     * Everything published and in force, without the text.
     *
     * <p>What a footer draws, and what makes an absence visible: a platform that has not
     * published its creator agreement is a platform whose list is short. That is the state
     * this repository is in until #439 seeds the words, and it is why both gates treat an
     * unpublished agreement as no requirement rather than as a refusal.
     */
    @GetMapping(path = "/v1/legal/documents", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.Catalogue> catalogue(
            @RequestParam(name = "locale", required = false) String locale) {

        return ResponseEntity.ok()
                .cacheControl(inForceCaching())
                .body(LegalResponses.Catalogue.of(documents.inForce(readerLocale(locale))));
    }

    /**
     * One document in force, with its text, in the reader's language.
     *
     * <p>Falls back to the governing Azerbaijani text rather than to a 404 when a language
     * has not been translated — {@code LegalDocuments.inForce} argues why. A reader shown a
     * blank page has been told nothing; a reader shown the governing text has been told
     * exactly what binds them.
     */
    @GetMapping(path = "/v1/legal/documents/{kind}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.Document> current(
            @PathVariable DocumentKind kind, @RequestParam(name = "locale", required = false) String locale) {

        return documents
                .inForce(kind, readerLocale(locale))
                .map(document -> ResponseEntity.ok()
                        .cacheControl(inForceCaching())
                        .body(LegalResponses.Document.of(document)))
                .orElseThrow(() -> new DocumentNotPublishedException(kind));
    }

    /**
     * One archived version, by number.
     *
     * <p><strong>The archive matters more than it looks.</strong> Somebody who accepted
     * version 3 must be able to read version 3, not only whatever is current — otherwise the
     * acceptance record names a text the person it is about cannot see. V65 stores every
     * version precisely so this route can exist, and immutability is what makes it worth
     * having.
     */
    @GetMapping(path = "/v1/legal/documents/{kind}/versions/{version}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<LegalResponses.Document> archived(
            @PathVariable DocumentKind kind,
            @PathVariable int version,
            @RequestParam(name = "locale", required = false) String locale) {

        return documents
                .published(kind, readerLocale(locale), version)
                .or(() -> documents.published(kind, ReaderLocale.PRIMARY, version))
                .map(document -> ResponseEntity.ok()
                        .cacheControl(CacheControl.maxAge(ARCHIVE_CACHE_FOR)
                                .cachePublic()
                                .immutable())
                        .body(LegalResponses.Document.of(document)))
                .orElseThrow(() -> new DocumentNotPublishedException(kind));
    }

    /**
     * The requested language, or the governing one.
     *
     * <p>{@code ReaderLocale.supported} rather than a 400 for an unknown tag, for that
     * class's reason: a value that is not one of the four can only come from a hand-written
     * URL, and the honest answer is the governing text rather than an error page where the
     * terms of use should be.
     */
    private static String readerLocale(String requested) {
        return ReaderLocale.supported(requested) ? requested : ReaderLocale.PRIMARY;
    }
}
