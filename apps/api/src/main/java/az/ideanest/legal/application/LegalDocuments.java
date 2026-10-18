package az.ideanest.legal.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.legal.domain.LegalDocument;
import az.ideanest.legal.infrastructure.LegalDocumentRepository;
import az.ideanest.legal.infrastructure.LegalDocumentSelections;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §22.2's documents: drafted, published once, and read by everybody — issue #425.
 *
 * <h2>Two audiences, and only one of them is authorised</h2>
 *
 * <p>{@link #inForce} and {@link #published} are public: these are the pages a stranger and
 * a regulator read, and a terms of use behind authentication is a document nobody can
 * decide to be bound by. Everything that writes needs
 * {@link StaffCapability#PUBLISH_LEGAL_DOCUMENT}, which only {@code SUPER_ADMIN} holds.
 *
 * <p>The capability is checked here rather than by an annotation on the controller,
 * following {@code SubscriptionPlans} and {@code FeeSchedules}: this is also where the
 * change is recorded, and an authorised action nobody recorded and a recorded action nobody
 * authorised are the same defect from opposite ends.
 *
 * <p><strong>#436 narrowed it, and the prediction this comment carried held.</strong> It
 * shipped under {@code CONFIGURE_PLATFORM} — the authority that also changes a fee schedule
 * and a feature flag — and the narrowing was the change to {@code requireCapability} the
 * comment said it would be. The two are not the same decision: opening new fee terms prices
 * the next payout and is undone by opening further terms, and publishing a version of the
 * creator agreement changes what every creator submitting after it is bound by and cannot be
 * undone at all, because V65's trigger makes a published version immutable.
 *
 * <p><strong>One capability over all four staff methods, including the drafting ones.</strong>
 * Reading a draft, writing one and publishing it are three steps of one act: a draft exists
 * to be published, and an account that may write the text of the creator agreement but not
 * press publish is an account whose text still ends up governing, one click later, with
 * somebody else's name on the audit row. Splitting them would describe a separation that the
 * workflow does not have.
 *
 * <h2>Publishing is per document, not per translation</h2>
 *
 * <p>{@link #publish} takes a kind and publishes <strong>every open draft of it, in every
 * language, under one version number and one effective date.</strong> Three consequences,
 * all of them the point:
 *
 * <ul>
 *   <li>Version 4 of the creator agreement is version 4 in all four languages, so an
 *       acceptance naming a version identifies one agreement rather than one translation of
 *       an unknown one.
 *   <li>A publication cannot half-happen. Publishing Azerbaijani on Tuesday and English on
 *       Friday would leave three days in which what a reader agreed to and what governed
 *       them were different documents.
 *   <li><strong>Nothing publishes without the Azerbaijani text.</strong> That is the text
 *       that governs; the other three exist so a person can read what they are agreeing to.
 *       A publication missing it would be a platform binding people to a document it does
 *       not have.
 * </ul>
 *
 * <h2>Nothing is deleted and nothing published is edited</h2>
 *
 * <p>There is no delete method and no edit-after-publication method. V65's trigger refuses
 * both underneath, and {@code LegalDocument} refuses them above; what is here is the third
 * place the rule is stated, which is the absence of an entry point. A correction is
 * {@link #draft} followed by {@link #publish}, and the previous version stays readable
 * because somebody who accepted it is entitled to read what they accepted.
 *
 * <h2>A future date is a date the platform keeps</h2>
 *
 * <p>A version published for next month governs from next month, and three things follow
 * from it here: the version an administrator chose to show stays shown until the new one
 * takes effect, rather than being dropped the moment the future version is published; a
 * version cannot be chosen before its date; and {@link #announceTakingEffect} — run every
 * minute by {@code LegalTakingEffectJob} — announces the version on its date, so the web's
 * cached pages change then rather than up to an hour later.
 *
 * <h2>One writer per document at a time</h2>
 *
 * <p>Every write takes {@code LegalDocumentRepository.lockForWriting} on its kind first, so
 * two administrators publishing at once get one publication and one
 * {@code NOTHING_TO_PUBLISH}, rather than one publication and a 500 from V65's trigger.
 */
@Service
public class LegalDocuments {

    private static final Logger log = LoggerFactory.getLogger(LegalDocuments.class);

    private final LegalDocumentRepository documents;
    private final LegalDocumentSelections selections;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public LegalDocuments(
            LegalDocumentRepository documents,
            LegalDocumentSelections selections,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock,
            ApplicationEventPublisher events) {
        this.documents = documents;
        this.selections = selections;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.events = events;
    }

    /**
     * The version of this document that governs right now, in every language it exists in.
     *
     * <p>Empty when nothing of this kind has been published, or when everything published is
     * dated in the future. {@code LegalAgreements} reads that as "no requirement" and the
     * gates let the action through — see {@code Agreements} on why the legal gates fail open
     * where the subscription gate fails closed.
     */
    @Transactional(readOnly = true)
    public List<LegalDocument> inForce(DocumentKind kind) {
        Instant now = clock.instant();
        Optional<LegalDocumentSelections.Selection> selected = selections.selection(kind);
        // A choice holds until a version takes effect after it was made. Publishing for a
        // future date leaves the choice in place, so this is where it stops applying on that
        // date — read-side, so it is right even on a minute the job has not run yet.
        if (selected.isPresent() && !documents.tookEffectBetween(kind, selected.get().selectedAt(), now)) {
            List<LegalDocument> chosen = documents.publishedVersion(kind, selected.get().version()).stream()
                    .filter(document -> !document.getEffectiveFrom().isAfter(now))
                    .toList();
            if (!chosen.isEmpty()) {
                return chosen;
            }
        }
        return documents.inForce(kind, now);
    }

    /**
     * The version in force, in the reader's language, falling back to the governing text.
     *
     * <p>The fallback is to Azerbaijani rather than to nothing, for {@code ReaderLocale}'s
     * reason applied to a document: a person reading Russian who is shown the Azerbaijani
     * terms can at least see them, and a person shown a blank page cannot. Which language
     * they read changes nothing about what they are bound by, because there is one
     * governing text and it is the one the fallback lands on.
     */
    @Transactional(readOnly = true)
    public Optional<LegalDocument> inForce(DocumentKind kind, String locale) {
        List<LegalDocument> versions = inForce(kind);
        return versions.stream()
                .filter(document -> document.getLocale().equals(locale))
                .findFirst()
                .or(() -> versions.stream()
                        .filter(document -> document.getLocale().equals(ReaderLocale.PRIMARY))
                        .findFirst());
    }

    /**
     * Every document that is in force, one row per kind, in the reader's language.
     *
     * <p>What a footer draws. Eight queries rather than one, and that is deliberate: each
     * kind's "highest effective version" is its own question, the whole set is served by
     * {@code legal_documents_in_force}, and the alternative is a window function whose plan
     * nobody reading this file could predict. It is also read behind an hour of cache.
     *
     * <p>A kind with nothing published contributes nothing rather than a placeholder. The
     * shortness of the list is the signal — see {@code LegalDocumentController}.
     */
    @Transactional(readOnly = true)
    public List<LegalDocument> inForce(String locale) {
        List<LegalDocument> published = new ArrayList<>();
        for (DocumentKind kind : DocumentKind.values()) {
            inForce(kind, locale).ifPresent(published::add);
        }
        return List.copyOf(published);
    }

    /**
     * One published version by number, for the archive.
     *
     * <p>#439 exposes this, and it matters more than it looks: somebody who accepted version
     * 3 must be able to read version 3, not only whatever is current. V65 stores every
     * version precisely so this is possible.
     */
    @Transactional(readOnly = true)
    public Optional<LegalDocument> published(DocumentKind kind, String locale, int version) {
        return documents.published(kind, locale, version);
    }

    /**
     * Shows readers an already published version of a document instead of the latest one.
     *
     * <p>Nothing is copied or edited: the chosen version's rows stay exactly as published,
     * and the selection only decides which of them {@link #inForce} answers with. A version
     * that takes effect after the choice takes over from it, so a publication always does —
     * on its date, not before.
     *
     * @throws DocumentNotPublishedException when no such version was published
     * @throws VersionNotYetEffectiveException when the version's date has not arrived
     */
    @Transactional
    public List<LegalDocument> activate(UUID staffId, DocumentKind kind, int version) {
        staff.requireCapability(staffId, StaffCapability.PUBLISH_LEGAL_DOCUMENT);
        documents.lockForWriting(lockKey(kind));

        List<LegalDocument> rows = documents.publishedVersion(kind, version);
        LegalDocument governing = rows.stream()
                .filter(document -> document.getLocale().equals(ReaderLocale.PRIMARY))
                .findFirst()
                .orElseThrow(() -> new DocumentNotPublishedException(kind));
        if (governing.getEffectiveFrom().isAfter(clock.instant())) {
            throw new VersionNotYetEffectiveException(kind, version, governing.getEffectiveFrom());
        }

        selections.select(kind, governing.getId(), staffId, clock.instant().truncatedTo(ChronoUnit.MICROS));

        audit.record(
                AuditAction.LEGAL_DOCUMENT_ACTIVATED,
                governing.getId(),
                AuditActor.user(staffId),
                AuditOutcome.SUCCEEDED,
                "%s version %d shown to readers, governing hash %s"
                        .formatted(kind, version, governing.getContentHash()));

        events.publishEvent(new LegalDocumentInForceChanged(kind, version));

        return rows;
    }

    /** Every version of a document, newest first. The console's history. */
    @Transactional(readOnly = true)
    public List<LegalDocument> history(UUID staffId, DocumentKind kind) {
        staff.requireCapability(staffId, StaffCapability.PUBLISH_LEGAL_DOCUMENT);
        return documents.historyOf(kind);
    }

    /** The open drafts of a document, in whatever languages somebody has started one. */
    @Transactional(readOnly = true)
    public List<LegalDocument> drafts(UUID staffId, DocumentKind kind) {
        staff.requireCapability(staffId, StaffCapability.PUBLISH_LEGAL_DOCUMENT);
        return documents.draftsOf(kind);
    }

    /**
     * Writes the draft of the next version of a document in one language.
     *
     * <p><strong>Idempotent in the shape an editor needs.</strong> Calling it again replaces
     * the text of the open draft rather than starting a second one, because V65 allows one
     * draft per (kind, locale) and because an editor that produced a new row per save would
     * leave an administrator choosing between six drafts of the same paragraph.
     *
     * <p>The version is allocated once, when the draft is first opened, as one above the
     * highest this kind has reached in <em>any</em> language. So a translation started after
     * the Azerbaijani draft joins the same version, which is what makes them one document.
     *
     * @throws az.ideanest.legal.domain.PublishedDocumentIsImmutableException never from here
     *     — a published row is not returned by {@code draftOf} — but the mutator underneath
     *     raises it, which is what keeps the rule true if this query is ever loosened
     */
    @Transactional
    public LegalDocument draft(UUID staffId, DocumentKind kind, String locale, String title, String body) {
        staff.requireCapability(staffId, StaffCapability.PUBLISH_LEGAL_DOCUMENT);
        documents.lockForWriting(lockKey(kind));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Optional<LegalDocument> open = documents.draftOf(kind, locale);
        if (open.isPresent()) {
            LegalDocument existing = open.get();
            existing.rewrite(title, body, now);
            return drafted(staffId, documents.save(existing));
        }

        // A translation started after the Azerbaijani draft joins that draft's version
        // rather than taking the next one. This is the line that makes version 4 of the
        // creator agreement mean the same agreement in all four languages -- without it,
        // drafting az then en would produce versions 4 and 5 of the same text, and an
        // acceptance naming a version would identify a translation rather than a document.
        List<LegalDocument> siblings = documents.draftsOf(kind);
        int version;
        if (siblings.isEmpty()) {
            Integer highest = documents.highestVersionOf(kind);
            version = highest == null ? 1 : highest + 1;
        } else {
            version = siblings.getFirst().getVersion();
        }

        LegalDocument drafted =
                LegalDocument.draft(Identifiers.newIdentifier(), kind, locale, version, title, body, staffId, now);
        return drafted(staffId, documents.save(drafted));
    }

    /**
     * Records a saved draft.
     *
     * <p>A draft governs nobody, and it is still recorded: it is the text the next click makes
     * binding, and "who wrote this paragraph" is a question about the draft. The hash pins which
     * text this entry is about, since the row itself is rewritten by the next save.
     */
    private LegalDocument drafted(UUID staffId, LegalDocument saved) {
        audit.record(
                AuditAction.LEGAL_DOCUMENT_DRAFTED,
                saved.getId(),
                AuditActor.user(staffId),
                AuditOutcome.SUCCEEDED,
                "%s version %d in %s drafted, hash %s"
                        .formatted(saved.getKind(), saved.getVersion(), saved.getLocale(), saved.getContentHash()));
        return saved;
    }

    /**
     * Publishes every open draft of a document, from an instant it starts governing.
     *
     * <p>{@code effectiveFrom} may be in the future and may not be in the past. The future
     * is the useful case — a change announced a fortnight before it bites — and the past is
     * refused because backdating what somebody is bound by is the one thing this epic exists
     * to prevent. A version effective from now is written as now, which is what an absent
     * argument means.
     *
     * <p>One audit row, naming the governing version. Not one per language: they are one
     * publication, and four rows would make a reader count them to find out whether
     * something happened four times.
     *
     * @throws NothingToPublishException when no draft is open
     * @throws GoverningTextMissingException when the Azerbaijani draft is not among them
     * @throws EffectiveDateInThePastException when the date has already gone by
     */
    @Transactional
    public List<LegalDocument> publish(UUID staffId, DocumentKind kind, Instant effectiveFrom) {
        staff.requireCapability(staffId, StaffCapability.PUBLISH_LEGAL_DOCUMENT);
        documents.lockForWriting(lockKey(kind));

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Instant effective = effectiveFrom == null ? now : effectiveFrom.truncatedTo(ChronoUnit.MICROS);
        if (effective.isBefore(now)) {
            throw new EffectiveDateInThePastException(kind, effective, now);
        }

        List<LegalDocument> drafts = documents.draftsOf(kind);
        if (drafts.isEmpty()) {
            throw new NothingToPublishException(kind);
        }

        LegalDocument governing = drafts.stream()
                .filter(document -> document.getLocale().equals(ReaderLocale.PRIMARY))
                .findFirst()
                .orElseThrow(() -> new GoverningTextMissingException(kind));

        for (LegalDocument draft : drafts) {
            draft.publish(staffId, effective, now);
        }
        List<LegalDocument> saved = documents.saveAll(drafts);
        // Only when it governs from now. A version dated for next month leaves the version an
        // administrator chose on the site until then; inForce stops honouring the choice on
        // the date, and announceTakingEffect clears it.
        if (!effective.isAfter(now)) {
            selections.clear(kind);
        }

        // The governing row is the entity, because that is the text that governs and the row
        // an acceptance names. The hash is in the detail so that "is the document in the
        // table the document that was published" is answerable from the trail alone.
        audit.record(
                AuditAction.LEGAL_DOCUMENT_PUBLISHED,
                governing.getId(),
                AuditActor.user(staffId),
                AuditOutcome.SUCCEEDED,
                "%s version %d in %s, effective %s, governing hash %s"
                        .formatted(
                                kind,
                                governing.getVersion(),
                                saved.stream().map(LegalDocument::getLocale).sorted().toList(),
                                effective,
                                governing.getContentHash()));

        log.info(
                "Published {} version {} in {} languages, effective {}",
                kind,
                governing.getVersion(),
                saved.size(),
                effective);

        events.publishEvent(new LegalDocumentInForceChanged(kind, governing.getVersion()));

        return saved;
    }

    /**
     * Announces every version whose effective date passed in the last {@code lookback}.
     *
     * <p>The other half of publishing for a future date. Publishing drops the web's cached
     * legal pages at the moment of publication, when the new version does not govern yet; on
     * the day it starts to, nothing else would, and the site would keep the previous text for up
     * to the web's hour. So {@code LegalTakingEffectJob} calls this every minute, and an
     * administrator's earlier choice of version is cleared here too, now that a later version
     * has taken over from it.
     *
     * <p>Stateless on purpose: the window is longer than the interval between passes, so a
     * pass that ran on another replica or was missed to a restart is covered by the next one.
     * The cost is announcing one change a few times, which drops a cache that is already fresh.
     *
     * @return how many versions were announced
     */
    @Transactional
    public int announceTakingEffect(Instant now, Duration lookback) {
        List<LegalDocument> arrived = documents.tookEffectBetween(ReaderLocale.PRIMARY, now.minus(lookback), now);

        Map<DocumentKind, LegalDocument> latest = new LinkedHashMap<>();
        for (LegalDocument governing : arrived) {
            latest.merge(governing.getKind(), governing, (left, right) ->
                    right.getVersion() > left.getVersion() ? right : left);
        }

        for (LegalDocument governing : latest.values()) {
            DocumentKind kind = governing.getKind();
            selections.selection(kind)
                    .filter(selected -> selected.selectedAt().isBefore(governing.getEffectiveFrom()))
                    .ifPresent(selected -> selections.clear(kind));
            events.publishEvent(new LegalDocumentInForceChanged(kind, governing.getVersion()));
        }

        if (!latest.isEmpty()) {
            log.info("Announced {} legal version(s) whose effective date arrived", latest.size());
        }
        return latest.size();
    }

    /**
     * The soonest moment a published version starts to govern, if one is waiting.
     *
     * <p>{@code LegalDocumentController} shortens its cache directive to it, so no cache
     * between the service and a reader holds the previous version past that moment.
     */
    @Transactional(readOnly = true)
    public Optional<Instant> nextTakingEffect() {
        return Optional.ofNullable(documents.nextTakingEffect(clock.instant()));
    }

    private static String lockKey(DocumentKind kind) {
        return "legal_documents:" + kind.name();
    }
}
