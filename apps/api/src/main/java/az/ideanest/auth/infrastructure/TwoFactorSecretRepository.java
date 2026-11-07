package az.ideanest.auth.infrastructure;

import az.ideanest.auth.domain.TwoFactorSecret;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** TOTP enrolments, keyed by the user they belong to. */
public interface TwoFactorSecretRepository extends JpaRepository<TwoFactorSecret, UUID> {

    /**
     * A confirmed enrolment, and nothing else.
     *
     * <p>Separate from {@code findById} because the two questions are different
     * and confusing them is the bug this feature can least afford: a row exists
     * as soon as somebody starts enrolling, and treating that as "two-factor is
     * on" would demand a code from a user who has never successfully produced
     * one.
     */
    Optional<TwoFactorSecret> findByUserIdAndConfirmedAtIsNotNull(UUID userId);

    /**
     * Removes an account's enrolment, confirmed or not — §17.4's anonymisation (#645).
     *
     * <p>Called from {@code AuthAccountSecurity.forget}. The secret is a credential for
     * an account that can no longer be signed in to, the same as the password hash
     * beside it. The foreign key cascades on a real delete; this covers the
     * anonymisation, which is not one. A statement rather than {@code deleteById},
     * so that an account with no enrolment is nothing to do rather than a lookup.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM TwoFactorSecret s WHERE s.userId = :userId")
    int deleteForUser(@Param("userId") UUID userId);
}
