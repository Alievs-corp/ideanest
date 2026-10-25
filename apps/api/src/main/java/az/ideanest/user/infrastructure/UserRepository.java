package az.ideanest.user.infrastructure;

import az.ideanest.shared.EmailAddress;
import az.ideanest.user.domain.User;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Users, by the things they are actually looked up by.
 *
 * <p>Every finder here excludes soft-deleted rows. A deleted account must not
 * be signed in to, must not appear on a profile page, and must not be handed a
 * password reset; making each caller remember that is how one of the three
 * eventually gets missed.
 *
 * <p>Lookups take {@link EmailAddress} rather than {@code String} so that the
 * parameter is normalised the same way the stored value was. A raw string would
 * be bound as {@code varchar} and compared as text, and a sign-in typed with a
 * capital letter would find nothing.
 */
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByIdAndDeletedAtIsNull(UUID id);

    /**
     * Several accounts in one query, for a caller holding a page of rows that each
     * name one.
     *
     * <p>Deleted accounts are excluded, exactly as the single finder excludes them, so
     * that a caller cannot get through this method what the other one refuses.
     */
    List<User> findAllByIdInAndDeletedAtIsNull(Collection<UUID> ids);

    Optional<User> findByEmailAndDeletedAtIsNull(EmailAddress email);

    Optional<User> findBySlugAndDeletedAtIsNull(String slug);

    /**
     * Includes deleted accounts, unlike the finders. An address belonging to a
     * closed account must not be registered again: the new owner would receive
     * password resets and receipts for the old account's history.
     */
    boolean existsByEmail(EmailAddress email);

    boolean existsBySlug(String slug);

    /**
     * Accounts whose grace period has elapsed and which have not been
     * anonymised yet, oldest first.
     *
     * <p>Identifiers rather than entities, and a page rather than everything:
     * the job reloads each one inside its own transaction, so loading the whole
     * backlog here would hold a result set open for the length of the batch and
     * hand the next instance a list that is already stale.
     *
     * <p>Note what is <em>not</em> excluded: a soft-deleted row. Deletion is
     * requested without soft-deleting, but an account banned or removed by some
     * other route still has a request to honour.
     */
    @Query("""
            SELECT u.id FROM User u
            WHERE u.anonymisedAt IS NULL
              AND u.deletionScheduledAt IS NOT NULL
              AND u.deletionScheduledAt <= :now
            ORDER BY u.deletionScheduledAt
            """)
    List<UUID> findDueForAnonymisation(@Param("now") Instant now, Pageable batch);

    /*
     * The two below are the admin user list -- §4.11's AD-04 (#104), folded and indexed by
     * #413.
     *
     * TWO QUERIES BECAUSE ONE OF THEM SEARCHES. They used to be one, with `:term IS NULL`
     * standing for "everything"; that is one statement whose plan has to serve two reads that
     * have nothing in common, and on the searching half it quietly costs the indexes this
     * issue is about. PostgreSQL folds `$1 IS NULL` away while it is planning with the actual
     * value, and stops folding it the moment the statement is hot enough to earn a generic
     * plan -- at which point the disjunction becomes a filter and the read falls back to the
     * sequential scan it was just taken off. A filter that disappears under load is worse than
     * one that was never claimed. Spelled as two, each is exactly the plan it says it is.
     *
     * It is also the call `PaymentTransactionRepository` makes about its own status filter,
     * for the same reason and in the same words.
     *
     * MATCHED ON `ideanest_fold` AND NOT ON `lower`. §11.3's fold is the platform's one
     * comparison form -- `Slugs.fold` in Java, `ideanest_fold(text)` in the database (V13) --
     * and every other search on the platform uses it. This one did not, because JPQL may only
     * name a function the dialect knows and nothing had registered it; `SearchFoldFunctionContributor`
     * is that registration, and it is what makes the two halves of #413 one change.
     *
     * What it fixes is two things at once. `lower()` leaves ə, ı, ö, ü, ğ, ş and ç alone, so
     * this screen found "Köhnə" from `köhnə` and not from `kohne` while the campaign directory
     * beside it found both. And an expression index only serves a query repeating the
     * expression exactly, so V63's `users_name_trgm_idx` and `users_slug_trgm_idx` -- built on
     * the fold, and used by the campaign directory's creator search -- could not serve this
     * one. V64 adds the third, over the address, because a disjunction is only as indexed as
     * its least indexed branch: leaving `lower(email)` in the OR would have left all three
     * predicates behind a sequential scan and made the other two indexes decorative.
     *
     * The term is matched against three columns and never against a name alone. Staff arrive
     * holding whatever the complaint gave them -- an address, a display name, or the slug out
     * of a profile URL -- and an endpoint that matched one of those would send them to guess
     * which.
     *
     * KEYSET, ON THE IDENTIFIER, in both. `Identifiers` mints UUID v7, so descending by
     * identifier is newest first and the cursor is the last row of the previous page. An offset
     * would drift as accounts are created underneath the reader, which on this list means a
     * moderator paging past the account they are looking for. `:after IS NULL` is left as it
     * was: unlike the term it does not gate the indexed predicates, so a generic plan applies
     * it as the filter it already is.
     *
     * Soft-deleted accounts are excluded from both, like every finder above. An account that
     * has been anonymised has nothing left to inspect, and suspending one would be a decision
     * about somebody the platform has finished forgetting.
     */

    /** The list a moderator opens before they have typed anything. */
    @Query("""
            SELECT u FROM User u
            WHERE u.deletedAt IS NULL
              AND (:suspendedOnly = FALSE OR u.suspendedAt IS NOT NULL)
              AND (:after IS NULL OR u.id < :after)
            ORDER BY u.id DESC
            """)
    List<User> list(
            @Param("suspendedOnly") boolean suspendedOnly, @Param("after") UUID after, Pageable page);

    /**
     * The same list narrowed to a search.
     *
     * @param term a {@code LIKE} pattern that has already been folded and wrapped in wildcards
     *     by {@code UserDirectory.patternOf} — folded there by {@code Slugs.fold}, which is
     *     {@code ideanest_fold}'s mirror, because a term folded one way and a column folded the
     *     other match nothing at all. Never null: an absent term is {@link #list} instead
     */
    @Query("""
            SELECT u FROM User u
            WHERE u.deletedAt IS NULL
              AND (ideanest_fold(u.email) LIKE :term ESCAPE '!'
                   OR ideanest_fold(u.name) LIKE :term ESCAPE '!'
                   OR ideanest_fold(u.slug) LIKE :term ESCAPE '!')
              AND (:suspendedOnly = FALSE OR u.suspendedAt IS NOT NULL)
              AND (:after IS NULL OR u.id < :after)
            ORDER BY u.id DESC
            """)
    List<User> search(
            @Param("term") String term,
            @Param("suspendedOnly") boolean suspendedOnly,
            @Param("after") UUID after,
            Pageable page);

    /**
     * The row, locked until the transaction ends.
     *
     * <p>The one place a write lock is taken. Anonymisation reads the row, decides
     * whether it is due, and overwrites it; two instances running the job at the
     * same moment would otherwise both read a due row and both proceed. With the
     * lock the second one waits, re-reads, finds the work already done, and does
     * nothing — which is what "safe on more than one instance" has to mean in
     * practice rather than in a comment.
     *
     * <p>Ignores {@code deleted_at}, unlike every other finder here: this is the
     * one operation whose whole purpose is to act on an account nobody may sign
     * in to.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT u FROM User u WHERE u.id = :id")
    Optional<User> findByIdForUpdate(@Param("id") UUID id);

    /**
     * Whether the account is suspended, read from the row as it is now and share-locked
     * until the transaction ends — #576.
     *
     * <p>A scalar rather than the entity on purpose. Sign-in has usually loaded this user
     * already in the same transaction, and a locking query that returns an entity the
     * persistence context already holds hands back the stale instance, not the row it just
     * locked. {@code FOR SHARE} conflicts with the {@code FOR UPDATE} that
     * {@link #findByIdForUpdate} takes for a ban, so one of the two waits for the other:
     * either the ban commits first and this reads it, or the session this transaction is
     * about to write is committed before the ban's revocation runs and is revoked with the
     * rest.
     *
     * @return empty for an identifier that names nothing or a deleted account
     */
    @Query(
            value = "SELECT suspended_at IS NOT NULL FROM users"
                    + " WHERE id = :id AND deleted_at IS NULL FOR SHARE",
            nativeQuery = true)
    Optional<Boolean> isSuspendedForShare(@Param("id") UUID id);
}
