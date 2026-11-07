package az.ideanest.auth.infrastructure;

import az.ideanest.auth.domain.TwoFactorChallenge;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TwoFactorChallengeRepository extends JpaRepository<TwoFactorChallenge, UUID> {

    /**
     * Returns spent and expired challenges as well. The caller answers all three
     * cases identically, but it has to know which it is looking at before it can
     * decide that.
     */
    Optional<TwoFactorChallenge> findByChallengeHash(byte[] challengeHash);

    /**
     * Spends one challenge, if it is still unspent.
     *
     * <p>The condition is what makes a challenge single-use under concurrency:
     * two requests presenting the same challenge and the same code would
     * otherwise both read it as live and both be handed a session.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE TwoFactorChallenge c
               SET c.consumedAt = :at
             WHERE c.id = :id
               AND c.consumedAt IS NULL
            """)
    int claim(@Param("id") UUID id, @Param("at") Instant at);

    /**
     * Retires every outstanding challenge for a user.
     *
     * <p>Called when a new one is issued. Without it, somebody who submits a
     * correct password ten times holds ten live challenges, and each is a
     * separate allowance of code guesses against the rate limit that is keyed
     * per challenge.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE TwoFactorChallenge c
               SET c.consumedAt = :at
             WHERE c.userId = :userId
               AND c.consumedAt IS NULL
            """)
    int consumeOutstanding(@Param("userId") UUID userId, @Param("at") Instant at);

    /**
     * Removes every challenge a user has, spent or not — §17.4's anonymisation (#645).
     *
     * <p>Called from {@code AuthAccountSecurity.forget}. A spent challenge is no longer a
     * credential, but it still carries the device label, user agent and IP address of the
     * sign-in that made it, which is the personal data anonymisation strips from the
     * sessions. Deleted rather than stripped: unlike a session, a challenge records
     * nothing the security history needs. The foreign key cascades on a real delete;
     * this covers the anonymisation, which is not one.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM TwoFactorChallenge c WHERE c.userId = :userId")
    int deleteAllForUser(@Param("userId") UUID userId);
}
