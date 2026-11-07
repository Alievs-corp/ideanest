package az.ideanest.auth.infrastructure;

import az.ideanest.auth.domain.IdentityProvider;
import az.ideanest.auth.domain.ProviderIdentity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProviderIdentityRepository extends JpaRepository<ProviderIdentity, UUID> {

    /**
     * The lookup every social sign-in starts with, and the only one that
     * authenticates: a verified {@code (provider, subject)} pair is the account,
     * whatever the address on it says today.
     */
    Optional<ProviderIdentity> findByProviderAndSubject(IdentityProvider provider, String subject);

    /** Whether this person already signed in with this provider under another subject. */
    Optional<ProviderIdentity> findByUserIdAndProvider(UUID userId, IdentityProvider provider);

    /**
     * Removes every provider link an account has — §17.4's anonymisation (#645).
     *
     * <p>Called from {@code AuthAccountSecurity.forget}. A link is the provider's
     * identifier for the person plus the address it last asserted, both of which
     * anonymisation exists to remove. Left behind, it would also keep the person out:
     * their next sign-in with the same provider would find the link, resolve it to an
     * account that no longer exists, and be refused, rather than start a new account.
     * The foreign key cascades on a real delete; this covers the anonymisation, which
     * is not one.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM ProviderIdentity i WHERE i.userId = :userId")
    int deleteAllForUser(@Param("userId") UUID userId);
}
