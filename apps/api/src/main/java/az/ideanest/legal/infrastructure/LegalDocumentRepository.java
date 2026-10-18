package az.ideanest.legal.infrastructure;

import az.ideanest.legal.domain.DocumentKind;
import az.ideanest.legal.domain.LegalDocument;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * V65's versions, by the five questions asked of them — issue #425.
 *
 * <p><strong>{@link #inForce} is the one on a hot path</strong> — every campaign submission
 * and every pledge confirmation asks it — and it is the one V65's
 * {@code legal_documents_in_force} partial index exists for. It is deliberately a query
 * about the whole kind rather than about one language: a version is published in every
 * language it has been translated into under one number, and the governing row is the
 * Azerbaijani one, so the answer is "the highest version of this kind whose effective date
 * has arrived" and the locale is chosen from that answer.
 *
 * <p><strong>{@link #draftOf} is what makes V65's one-draft-per-(kind, locale) index a
 * usable rule</strong> rather than a constraint violation an administrator meets after
 * typing a page of terms. The index is still what makes it true under a race.
 */
public interface LegalDocumentRepository extends JpaRepository<LegalDocument, UUID> {

    /**
     * The highest version of this kind that is published and effective now.
     *
     * <p>Returns every language of that version, in a stable order, because the caller
     * wants the governing row and #439's routes want all of them. A query per locale would
     * be four index hits for one answer.
     */
    @Query(
            """
            SELECT d FROM LegalDocument d
             WHERE d.kind = :kind
               AND d.version = (
                   SELECT MAX(effective.version) FROM LegalDocument effective
                    WHERE effective.kind = :kind
                      AND effective.publishedAt IS NOT NULL
                      AND effective.effectiveFrom <= :now)
               AND d.publishedAt IS NOT NULL
             ORDER BY d.locale ASC
            """)
    List<LegalDocument> inForce(@Param("kind") DocumentKind kind, @Param("now") Instant now);

    /** The open draft of this document in this language, if an administrator has started one. */
    @Query("SELECT d FROM LegalDocument d WHERE d.kind = :kind AND d.locale = :locale AND d.publishedAt IS NULL")
    Optional<LegalDocument> draftOf(@Param("kind") DocumentKind kind, @Param("locale") String locale);

    /** Every open draft of this document, in every language somebody has started one in. */
    @Query("SELECT d FROM LegalDocument d WHERE d.kind = :kind AND d.publishedAt IS NULL ORDER BY d.locale ASC")
    List<LegalDocument> draftsOf(@Param("kind") DocumentKind kind);

    /**
     * The highest version number this kind has reached in any language.
     *
     * <p>Across languages on purpose: {@code LegalDocument.draft} allocates per kind so that
     * version 4 of the creator agreement is version 4 in all four. Null when the document
     * has never been drafted, which the caller reads as "the next one is 1".
     */
    @Query("SELECT MAX(d.version) FROM LegalDocument d WHERE d.kind = :kind")
    Integer highestVersionOf(@Param("kind") DocumentKind kind);

    /**
     * Every version of this document, newest first, for the console's history.
     *
     * <p>Unpaged. Eight documents changing a few times a year is a list that fits on a
     * screen, and a cursor here would be machinery protecting nothing.
     */
    @Query("SELECT d FROM LegalDocument d WHERE d.kind = :kind ORDER BY d.version DESC, d.locale ASC")
    List<LegalDocument> historyOf(@Param("kind") DocumentKind kind);

    /** Every language of one published version, in a stable order. */
    @Query(
            """
            SELECT d FROM LegalDocument d
             WHERE d.kind = :kind AND d.version = :version AND d.publishedAt IS NOT NULL
             ORDER BY d.locale ASC
            """)
    List<LegalDocument> publishedVersion(@Param("kind") DocumentKind kind, @Param("version") int version);

    /** One published version in one language, for #439's archive route. */
    @Query(
            """
            SELECT d FROM LegalDocument d
             WHERE d.kind = :kind AND d.locale = :locale AND d.version = :version AND d.publishedAt IS NOT NULL
            """)
    Optional<LegalDocument> published(
            @Param("kind") DocumentKind kind, @Param("locale") String locale, @Param("version") int version);

    /**
     * Serialises every write to one kind until the transaction ends.
     *
     * <p>Drafting, publishing and choosing a version all read the kind's rows and then write on
     * the strength of what they read. Two of them at once used to meet V65's trigger or its
     * one-draft index as a 500: two publications both found the same drafts and the second
     * tried to publish rows the first already had, and a draft saved during a publication
     * rewrote a row that had just become immutable. With this taken first, the second waits,
     * then reads what the first committed — no drafts left, so {@code NOTHING_TO_PUBLISH}; a
     * published row, so a fresh draft of the next version.
     */
    @Query(
            value = "SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(:key))) AS locked",
            nativeQuery = true)
    Integer lockForWriting(@Param("key") String key);

    /** Whether a published version of this kind took effect in {@code (after, upTo]}. */
    @Query(
            """
            SELECT COUNT(d) > 0 FROM LegalDocument d
             WHERE d.kind = :kind
               AND d.publishedAt IS NOT NULL
               AND d.effectiveFrom > :after
               AND d.effectiveFrom <= :upTo
            """)
    boolean tookEffectBetween(
            @Param("kind") DocumentKind kind, @Param("after") Instant after, @Param("upTo") Instant upTo);

    /**
     * The governing rows of every version that took effect in {@code (after, upTo]}.
     *
     * <p>What the {@code legal-taking-effect} pass announces. Served by
     * {@code legal_documents_in_force}'s leading columns only loosely, which is acceptable for a
     * table of eight documents changing a few times a year.
     */
    @Query(
            """
            SELECT d FROM LegalDocument d
             WHERE d.locale = :locale
               AND d.publishedAt IS NOT NULL
               AND d.effectiveFrom > :after
               AND d.effectiveFrom <= :upTo
             ORDER BY d.effectiveFrom ASC
            """)
    List<LegalDocument> tookEffectBetween(
            @Param("locale") String locale, @Param("after") Instant after, @Param("upTo") Instant upTo);

    /** The soonest date any published version is still waiting for, or null when none is. */
    @Query("SELECT MIN(d.effectiveFrom) FROM LegalDocument d WHERE d.publishedAt IS NOT NULL AND d.effectiveFrom > :now")
    Instant nextTakingEffect(@Param("now") Instant now);
}
