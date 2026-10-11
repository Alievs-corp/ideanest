package az.ideanest.legal.api;

import az.ideanest.legal.application.AcceptanceRecords;
import az.ideanest.legal.domain.LegalDocument;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What the legal endpoints answer with — issue #425.
 *
 * <p>Assembled here rather than by serialising the entities, following every other module's
 * API layer: an entity on the wire is a schema change every time a column moves, and
 * {@code legal_documents} carries a column — the body — that most callers do not want and
 * that is a megabyte when they do.
 *
 * <p><strong>{@link Summary} and {@link Document} differ only by the body</strong>, and that
 * is the point. A list of eight documents in four languages that carried every body would be
 * several megabytes of terms nobody asked for; a reader who wants one asks for one.
 */
public final class LegalResponses {

    private LegalResponses() {
    }

    /**
     * One version, without its text.
     *
     * @param contentHash included deliberately. It is what #429's signature is taken over,
     *     and publishing it is what lets somebody who accepted a version check afterwards
     *     that the text they are shown is the text they agreed to
     */
    public record Summary(
            String kind,
            String locale,
            int version,
            String title,
            String contentHash,
            Instant effectiveFrom,
            Instant publishedAt) {

        public static Summary of(LegalDocument document) {
            return new Summary(
                    document.getKind().name(),
                    document.getLocale(),
                    document.getVersion(),
                    document.getTitle(),
                    document.getContentHash(),
                    document.getEffectiveFrom(),
                    document.getPublishedAt());
        }
    }

    /** One version, with its text. What #439's routes render. */
    public record Document(
            String kind,
            String locale,
            int version,
            String title,
            String body,
            String contentHash,
            Instant effectiveFrom,
            Instant publishedAt) {

        public static Document of(LegalDocument document) {
            return new Document(
                    document.getKind().name(),
                    document.getLocale(),
                    document.getVersion(),
                    document.getTitle(),
                    document.getBody(),
                    document.getContentHash(),
                    document.getEffectiveFrom(),
                    document.getPublishedAt());
        }
    }

    /** Everything published and in force, so a footer can list what exists. */
    public record Catalogue(List<Summary> documents) {

        public static Catalogue of(List<LegalDocument> documents) {
            return new Catalogue(documents.stream().map(Summary::of).toList());
        }
    }

    /**
     * A document's whole history, for the console.
     *
     * @param drafts the open drafts, which is what the editor loads. Separate from
     *     {@code versions} rather than mixed in with a flag, because the two are edited by
     *     different verbs and a screen that had to filter would eventually forget to
     */
    public record History(String kind, List<Summary> versions, List<Document> drafts, Integer inForceVersion) {
    }

    /**
     * One thing an account agreed to, with the version it agreed to.
     *
     * <p>The address is on the body. It is evidence, the console is where evidence about an
     * account is read, and the read is audited — {@code AcceptanceRecords} argues that. A
     * screen that had to say "accepted, details unavailable" would send somebody to the
     * database.
     */
    public record Acceptance(
            UUID id,
            String kind,
            String locale,
            int version,
            String title,
            String contentHash,
            Instant acceptedAt,
            String ipAddress,
            String userAgent,
            UUID signatureId) {

        public static Acceptance of(AcceptanceRecords.AcceptedDocument accepted) {
            LegalDocument document = accepted.document();
            return new Acceptance(
                    accepted.acceptance().getId(),
                    document == null ? null : document.getKind().name(),
                    document == null ? null : document.getLocale(),
                    document == null ? 0 : document.getVersion(),
                    document == null ? null : document.getTitle(),
                    document == null ? null : document.getContentHash(),
                    accepted.acceptance().getAcceptedAt(),
                    accepted.acceptance().getIpAddress(),
                    accepted.acceptance().getUserAgent(),
                    accepted.acceptance().getSignatureId());
        }
    }

    /** What one account has agreed to, newest first. */
    public record AcceptanceRecord(UUID accountId, List<Acceptance> acceptances) {

        public static AcceptanceRecord of(UUID accountId, List<AcceptanceRecords.AcceptedDocument> accepted) {
            return new AcceptanceRecord(accountId, accepted.stream().map(Acceptance::of).toList());
        }
    }
}
