package az.ideanest.auth.application;

import az.ideanest.shared.SecureTokens;
import az.ideanest.auth.domain.UserCredential;
import az.ideanest.auth.infrastructure.TwoFactorSecretRepository;
import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import az.ideanest.shared.maintenance.MaintenanceGate;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Exchanging an email address and a password for a session, or for a demand for the second factor. */
@Service
public class SignInService {

    /**
     * One message for every way of failing. Which of them happened is not the
     * caller's business, and telling them turns sign-in into the account
     * enumeration oracle that registration is written to avoid.
     */
    private static final String REFUSAL = "Those credentials are not valid.";

    private final UserAccounts users;
    private final UserCredentialRepository credentials;
    private final TwoFactorSecretRepository twoFactorSecrets;
    private final TwoFactorChallenges challenges;
    private final SessionStarter sessionStarter;
    private final PasswordHasher passwordHasher;
    private final MaintenanceGate maintenance;
    private final Clock clock;

    /**
     * A hash of a password nobody has, verified against when no account exists.
     *
     * <p>Without it, "no such account" returns in a millisecond and "wrong
     * password" takes as long as Argon2 does. That difference is measurable
     * over the network, and it answers "does this address have an account
     * here?" for anybody willing to time it — the same question the identical
     * error message refuses to answer.
     */
    private final String decoyHash;

    public SignInService(
            UserAccounts users,
            UserCredentialRepository credentials,
            TwoFactorSecretRepository twoFactorSecrets,
            TwoFactorChallenges challenges,
            SessionStarter sessionStarter,
            PasswordHasher passwordHasher,
            MaintenanceGate maintenance,
            Clock clock) {
        this.users = users;
        this.credentials = credentials;
        this.twoFactorSecrets = twoFactorSecrets;
        this.challenges = challenges;
        this.sessionStarter = sessionStarter;
        this.passwordHasher = passwordHasher;
        this.maintenance = maintenance;
        this.clock = clock;
        this.decoyHash = passwordHasher.hash(SecureTokens.generate());
    }

    /**
     * @param deviceLabel what the user will see in their device list
     * @param userAgent recorded for the same reason
     * @param ipAddress recorded so that an unexpected session can be recognised
     */
    public record SignInCommand(
            EmailAddress email, String password, String deviceLabel, String userAgent, String ipAddress) {
    }

    @Transactional
    public SignInOutcome signIn(SignInCommand command) {
        Instant now = clock.instant();

        Optional<UserAccount> account = users.findByEmail(command.email());
        Optional<UserCredential> credential = account.flatMap(found -> credentials.findById(found.id()));

        if (credential.isEmpty()) {
            // Spend the same time as a real verification would, then refuse.
            passwordHasher.matches(command.password(), decoyHash);
            throw new AuthenticationFailedException(REFUSAL);
        }

        UserCredential stored = credential.get();
        if (!passwordHasher.matches(command.password(), stored.getPasswordHash())) {
            throw new AuthenticationFailedException(REFUSAL);
        }

        if (passwordHasher.needsRehash(stored.getPasswordHash())) {
            // The only moment the password is in hand. Rehashing here is what
            // makes raising the Argon2 parameters a gradual migration instead
            // of a decision that only applies to accounts created afterwards.
            stored.rehash(passwordHasher.hash(command.password()), passwordHasher.algorithm());
            credentials.save(stored);
        }

        UserAccount user = account.orElseThrow();

        // §4.11's AD-04 (#104). After the password and before anything that issues
        // anything: a suspended account gets no session, no tokens, and no two-factor
        // challenge. Checked here rather than at the token filter because the ban revokes
        // every session in the same transaction, so this is the one way back in that is
        // left -- and refusing it with the usual "those details are wrong" would send
        // somebody round a password reset that cannot help them.
        if (user.suspended()) {
            throw new AccountSuspendedException();
        }

        // #214. After the password, so the refusal says nothing to somebody who does not
        // hold it, and before the two-factor challenge, so a reader is not asked for a
        // code only to be refused after it. Staff pass: they have to be able to sign in
        // while the platform is closed to everybody else.
        maintenance.admitSession(user.id());

        // A confirmed enrolment, not merely a row: somebody who scanned a code
        // and never entered one has not proved they can, and demanding a code
        // from them would be a lockout rather than a control.
        if (twoFactorSecrets.findByUserIdAndConfirmedAtIsNotNull(user.id()).isPresent()) {
            // No session, no tokens, and nothing the caller can do with what
            // comes back except present a code. That this reveals two-factor is
            // on for the account is unavoidable — and costs the correct
            // password to learn, which is not an oracle anyone needs.
            return challenges.issue(user.id(), command, now);
        }

        // Sign-in is deliberately allowed before the address is verified. The
        // account can be used to browse and to be reminded; what verification
        // gates is money and messaging, and those checks read the claim.
        // An account inside its deletion grace period may sign in. That is the
        // only way back from a deletion it may have requested by mistake, or
        // that somebody else requested for it. The token says so, and every
        // endpoint but a handful refuses it.
        return new SignInOutcome.Authenticated(sessionStarter.start(new SessionStarter.NewSession(
                user.id(),
                new AccessTokenIssuer.AccountStanding(user.emailVerified(), user.deletionPending()),
                command.deviceLabel(),
                command.userAgent(),
                command.ipAddress(),
                false)));
    }
}
