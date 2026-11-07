package az.ideanest.auth.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.SecureTokens;
import az.ideanest.auth.domain.SessionRevocationReason;
import az.ideanest.auth.infrastructure.EmailChangeRequestRepository;
import az.ideanest.auth.infrastructure.ProviderIdentityRepository;
import az.ideanest.auth.infrastructure.RecoveryCodeRepository;
import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.auth.infrastructure.TwoFactorChallengeRepository;
import az.ideanest.auth.infrastructure.TwoFactorSecretRepository;
import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.auth.infrastructure.VerificationTokenRepository;
import az.ideanest.user.application.AccountSecurity;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What {@code user} asked for, answered from the tables {@code auth} owns.
 *
 * <p>The interface belongs to the other module and the implementation is here,
 * which is the wrong way round only if you read the package names. {@code auth}
 * already depends on {@code user}; a call in the opposite direction would make
 * the two a cycle. This way the dependency arrow does not change and neither
 * module reaches into the other's internals.
 */
@Service
public class AuthAccountSecurity implements AccountSecurity {

    private final UserCredentialRepository credentials;
    private final TwoFactorSecretRepository twoFactorSecrets;
    private final RecoveryCodeRepository recoveryCodes;
    private final TwoFactorChallengeRepository twoFactorChallenges;
    private final ProviderIdentityRepository providerIdentities;
    private final EmailChangeRequestRepository emailChanges;
    private final SessionRepository sessions;
    private final VerificationTokenRepository verificationTokens;
    private final PasswordHasher passwordHasher;
    private final AuditLog audit;
    private final RevokedSessions revokedSessions;

    /**
     * The same trick {@code SignInService} uses. An account with no credential
     * would otherwise be refused in a millisecond while a wrong password costs
     * Argon2, and the difference is measurable by whoever is holding the token.
     */
    private final String decoyHash;

    public AuthAccountSecurity(
            UserCredentialRepository credentials,
            TwoFactorSecretRepository twoFactorSecrets,
            RecoveryCodeRepository recoveryCodes,
            TwoFactorChallengeRepository twoFactorChallenges,
            ProviderIdentityRepository providerIdentities,
            EmailChangeRequestRepository emailChanges,
            SessionRepository sessions,
            VerificationTokenRepository verificationTokens,
            PasswordHasher passwordHasher,
            AuditLog audit,
            RevokedSessions revokedSessions) {
        this.credentials = credentials;
        this.twoFactorSecrets = twoFactorSecrets;
        this.recoveryCodes = recoveryCodes;
        this.twoFactorChallenges = twoFactorChallenges;
        this.providerIdentities = providerIdentities;
        this.emailChanges = emailChanges;
        this.sessions = sessions;
        this.verificationTokens = verificationTokens;
        this.passwordHasher = passwordHasher;
        this.audit = audit;
        this.revokedSessions = revokedSessions;
        this.decoyHash = passwordHasher.hash(SecureTokens.generate());
    }

    @Override
    @Transactional(readOnly = true)
    public boolean passwordMatches(UUID userId, String rawPassword) {
        return credentials
                .findById(userId)
                .map(credential -> passwordHasher.matches(rawPassword, credential.getPasswordHash()))
                .orElseGet(() -> {
                    passwordHasher.matches(rawPassword, decoyHash);
                    return false;
                });
    }

    @Override
    @Transactional(readOnly = true)
    public boolean twoFactorEnabled(UUID userId) {
        // The same question sign-in asks, through the same query, so the settings screen
        // and the challenge cannot disagree about whether a code will be demanded.
        return twoFactorSecrets.findByUserIdAndConfirmedAtIsNotNull(userId).isPresent();
    }

    @Override
    @Transactional
    public void endAllSessions(UUID userId, Instant at) {
        // The repository rather than SessionRevoker: the revoker commits in its
        // own transaction, which is right when the caller is about to throw and
        // wrong here. If the deletion request that triggered this fails, the
        // user should not be left signed out of a deletion that did not happen.
        int revoked = sessions.revokeAllForUser(userId, SessionRevocationReason.USER_REVOKED, at);
        if (revoked > 0) {
            // After this transaction commits, and not if it rolls back -- see RevokedSessions.
            revokedSessions.revocationCommitting();
        }

        // And the audit row is written the same way, in this transaction rather
        // than in one of its own — for the same reason and with the same effect. A
        // deletion request that rolls back leaves neither dead sessions nor a record
        // claiming they were killed. This is the path SessionRevoker's own recording
        // deliberately does not cover, because this method deliberately does not go
        // through it.
        if (revoked > 0) {
            audit.record(
                    AuditAction.SESSIONS_REVOKED,
                    userId,
                    AuditActor.user(userId),
                    AuditOutcome.SUCCEEDED,
                    revoked + " sessions, reason " + SessionRevocationReason.USER_REVOKED);
        }
    }

    @Override
    @Transactional
    public void forget(UUID userId) {
        // The password hash goes. It is not a record of anything — it is a
        // credential for an account that can no longer be signed in to, and
        // people reuse passwords, so keeping it is a liability to somebody's
        // other accounts and an asset to nobody.
        credentials.deleteById(userId);
        verificationTokens.deleteAllForUser(userId);
        // The second factor goes for the password's reason (#645): the TOTP secret
        // and the recovery codes are credentials for an account nobody can sign in
        // to any more. The challenges are not credentials once spent, but each one
        // carries the device label, user agent and IP address of a sign-in, which
        // is what stripPersonalDetails removes from the sessions below.
        twoFactorSecrets.deleteForUser(userId);
        recoveryCodes.deleteAllForUser(userId);
        twoFactorChallenges.deleteAllForUser(userId);
        // The provider links are the person's identifier at Google or Apple and
        // the address the provider last asserted. Left behind, the next sign-in
        // with the same provider would also resolve to this account and be
        // refused, instead of starting a new one.
        providerIdentities.deleteAllForUser(userId);
        // A pending address change is a capability plus an address (#645).
        emailChanges.deleteAllForUser(userId);
        // Every one of these tables cascades from users, and the cascade never
        // fires because the row is never deleted. Each statement deletes nothing
        // on a second run, which keeps this method idempotent.
        sessions.stripPersonalDetails(userId);
        // Refresh tokens are left alone. A row there is a SHA-256 of 256 bits we
        // generated plus two timestamps: it identifies nobody, and V2 keeps
        // spent tokens on purpose so that a replay is distinguishable from a
        // token that never existed.
    }

    @Override
    @Transactional(readOnly = true)
    public SecurityHistory historyFor(UUID userId) {
        List<SessionRecord> sessionRecords = sessions.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(session -> new SessionRecord(
                        session.getId(),
                        session.getDeviceLabel(),
                        session.getUserAgent(),
                        session.getIpAddress(),
                        session.getCreatedAt(),
                        session.getLastSeenAt(),
                        session.getExpiresAt(),
                        session.getRevokedAt(),
                        Objects.toString(session.getRevokedReason(), null)))
                .toList();

        List<VerificationRecord> verificationRecords = verificationTokens.findByUserIdOrderByCreatedAt(userId).stream()
                // The hash is not exported. It is a credential, not a fact about
                // the person, and it is the one field on the row that could be
                // used against the account.
                .map(token -> new VerificationRecord(
                        token.getPurpose().name(),
                        token.getCreatedAt(),
                        token.getExpiresAt(),
                        token.getConsumedAt()))
                .toList();

        return new SecurityHistory(sessionRecords, verificationRecords);
    }
}
