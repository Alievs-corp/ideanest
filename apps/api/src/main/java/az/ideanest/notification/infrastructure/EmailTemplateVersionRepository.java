package az.ideanest.notification.infrastructure;

import az.ideanest.notification.domain.EmailTemplateVersion;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * V52's overrides — issue #315.
 *
 * <p><strong>{@link #liveFor} is on the render path</strong> and is a single index lookup
 * against {@code email_template_versions_one_live}. Most templates have no override at all,
 * so the common answer is an empty result from an index probe — which is what makes it
 * acceptable to ask on every message the platform sends. {@code TemplateOverrides} caches
 * the answers on top of it.
 */
public interface EmailTemplateVersionRepository extends JpaRepository<EmailTemplateVersion, UUID> {

    /** The version that renders, if this template and locale have been edited. */
    @Query(
            """
            SELECT v FROM EmailTemplateVersion v
            WHERE v.templateKey = :templateKey AND v.locale = :locale AND v.live = true
            """)
    Optional<EmailTemplateVersion> liveFor(
            @Param("templateKey") String templateKey, @Param("locale") String locale);

    /** Every live override, for the cache to load in one query rather than one per type. */
    @Query("SELECT v FROM EmailTemplateVersion v WHERE v.live = true")
    List<EmailTemplateVersion> allLive();

    /** The history of one template in one locale, newest first. */
    @Query(
            """
            SELECT v FROM EmailTemplateVersion v
            WHERE v.templateKey = :templateKey AND v.locale = :locale
            ORDER BY v.version DESC
            """)
    List<EmailTemplateVersion> historyOf(
            @Param("templateKey") String templateKey, @Param("locale") String locale);

    /**
     * Serialises the writes to one template in one language until the transaction ends.
     *
     * <p>Two administrators saving at once used to race between reading the live version and
     * writing the next: both withdrew version two, both wrote version three, and the second
     * met V52's unique constraint as a 500. A transaction-scoped advisory lock on the pair
     * makes the second wait for the first and then build on it, so both saves land as
     * consecutive versions and the history shows each. Keyed by text hash, as
     * {@code PartnerProfileRepository} does; a collision between two pairs only makes two
     * unrelated saves wait for each other.
     */
    @Query(
            value = "SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(:key))) AS locked",
            nativeQuery = true)
    Integer lockForWriting(@Param("key") String key);

    /**
     * The highest version written for this template and locale.
     *
     * <p>Read inside the transaction that writes the next one, after {@link #lockForWriting}.
     * V52's unique constraint on {@code (template_key, locale, version)} stays the guarantee
     * underneath.
     */
    @Query(
            """
            SELECT COALESCE(MAX(v.version), 0) FROM EmailTemplateVersion v
            WHERE v.templateKey = :templateKey AND v.locale = :locale
            """)
    int highestVersionOf(@Param("templateKey") String templateKey, @Param("locale") String locale);
}
