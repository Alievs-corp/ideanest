package az.ideanest.auth.infrastructure;

import az.ideanest.auth.domain.RecoveryCode;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RecoveryCodeRepository extends JpaRepository<RecoveryCode, UUID> {

    /**
     * The lookup a presented code performs. Returns spent codes too: the caller
     * has to be able to tell "already used" from "never existed" without a
     * second query, even though it answers both the same way.
     */
    Optional<RecoveryCode> findByCodeHash(byte[] codeHash);

    /**
     * Spends one code, if it is still unspent.
     *
     * <p>A conditional update, not a read followed by a write. Two requests
     * carrying the same code arrive together, both read it as unused, and both
     * proceed — unless the condition is in the statement and the database picks
     * a winner. "Single use" that tolerates a second use is not single use.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE RecoveryCode c
               SET c.usedAt = :at
             WHERE c.id = :id
               AND c.usedAt IS NULL
            """)
    int claim(@Param("id") UUID id, @Param("at") Instant at);

    /**
     * Removes every code a user has.
     *
     * <p>Used when two-factor is switched off, when a fresh set is issued, and
     * when the account is anonymised ({@code AuthAccountSecurity.forget}, #645).
     * Deleted rather than marked spent: unlike a refresh token there is no theft
     * signal in keeping them, and a row that could still match a code somebody
     * wrote down years ago is a liability rather than a record.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM RecoveryCode c WHERE c.userId = :userId")
    int deleteAllForUser(@Param("userId") UUID userId);
}
