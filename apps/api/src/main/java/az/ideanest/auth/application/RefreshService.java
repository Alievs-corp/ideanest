package az.ideanest.auth.application;

import az.ideanest.auth.application.AccessTokenIssuer.IssuedAccessToken;
import az.ideanest.auth.domain.RefreshToken;
import az.ideanest.shared.SecureTokens;
import az.ideanest.auth.domain.Session;
import az.ideanest.auth.domain.SessionRevocationReason;
import az.ideanest.auth.infrastructure.RefreshTokenRepository;
import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import az.ideanest.shared.maintenance.MaintenanceGate;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rotating a refresh token, and signing out.
 *
 * <p><strong>Rotation with reuse detection.</strong> Every refresh spends the
 * presented token and issues a new one into the same session. A token that has
 * already been spent should never be presented again, so when one is, two
 * parties hold the same credential — and there is no way to tell which of them
 * is the user. Revoking only the presented token would leave whichever party
 * holds the newest one signed in, and that might be the thief. So the whole
 * session dies.
 *
 * <p>The cost lands on clients that fire two refreshes at once, which signs the
 * user out. That is a real cost and it is the client's to avoid: refresh has to
 * be single-flight, with concurrent requests waiting on one in-flight call
 * rather than each starting their own.
 */
@Service
public class RefreshService {

    /** The same refusal for every cause. See {@link AuthenticationFailedException}. */
    private static final String REFUSAL = "This session is no longer valid. Sign in again.";

    private final RefreshTokenRepository refreshTokens;
    private final SessionRepository sessions;
    private final SessionRevoker revoker;
    private final AccessTokenIssuer accessTokens;
    private final UserAccounts users;
    private final MaintenanceGate maintenance;
    private final Clock clock;

    public RefreshService(
            RefreshTokenRepository refreshTokens,
            SessionRepository sessions,
            SessionRevoker revoker,
            AccessTokenIssuer accessTokens,
            UserAccounts users,
            MaintenanceGate maintenance,
            Clock clock) {
        this.refreshTokens = refreshTokens;
        this.sessions = sessions;
        this.revoker = revoker;
        this.accessTokens = accessTokens;
        this.users = users;
        this.maintenance = maintenance;
        this.clock = clock;
    }

    @Transactional
    public IssuedTokens refresh(String presentedToken) {
        Instant now = clock.instant();

        RefreshToken presented = refreshTokens
                .findByTokenHash(SecureTokens.hash(presentedToken))
                .orElseThrow(() -> new AuthenticationFailedException(REFUSAL));

        Session session = sessions.findById(presented.getSessionId())
                .orElseThrow(() -> new AuthenticationFailedException(REFUSAL));

        if (presented.isUsed()) {
            // Revoked in its own transaction, because this method is about to
            // throw and a rollback would undo the revocation — leaving the
            // session alive for whoever tries next.
            revoker.revoke(session.getId(), SessionRevocationReason.TOKEN_REUSE, now);
            throw new AuthenticationFailedException(REFUSAL);
        }

        if (presented.isExpired(now) || !session.isLive(now)) {
            throw new AuthenticationFailedException(REFUSAL);
        }

        // #214. Before the rotation, so a reader refused during maintenance keeps the
        // refresh token they came with and can use it once the window ends — refusing
        // after rotating would sign them out for a closure that was not about them.
        maintenance.admitSession(session.getUserId());

        String nextTokenValue = SecureTokens.generate();
        // The successor never outlives the session. A refresh token that could
        // would quietly turn a thirty-day session into a permanent one, one
        // refresh at a time.
        RefreshToken next = refreshTokens.save(RefreshToken.issue(
                session.getId(), SecureTokens.hash(nextTokenValue), now, session.getExpiresAt()));

        int claimed = refreshTokens.claimForRotation(presented.getId(), now, next.getId());
        if (claimed == 0) {
            // Somebody else rotated this token between the read above and here.
            // Indistinguishable from theft, and treated as such.
            revoker.revoke(session.getId(), SessionRevocationReason.TOKEN_REUSE, now);
            throw new AuthenticationFailedException(REFUSAL);
        }

        session.touch(now);
        sessions.save(session);

        UserAccount account = users.findById(session.getUserId())
                .orElseThrow(() -> new AuthenticationFailedException(REFUSAL));

        // The standing is re-read, so a deletion requested — or cancelled —
        // since the last refresh reaches the next token rather than the one
        // after that. The second factor is not: a refresh proves possession of
        // a token, not a factor, so it is carried across the rotation from the
        // session. Re-deriving it would sign a creator out of a payout every
        // fifteen minutes; inventing it would be worse.
        IssuedAccessToken accessToken = accessTokens.issue(
                session.getUserId(),
                session.getId(),
                new AccessTokenIssuer.AccountStanding(account.emailVerified(), account.deletionPending()),
                session.isTwoFactorAuthenticated(),
                now);

        return new IssuedTokens(
                accessToken.value(),
                accessToken.expiresAt(),
                nextTokenValue,
                session.getExpiresAt(),
                session.getId());
    }

    /**
     * Ends the session the token belongs to.
     *
     * <p>An unknown token is not an error. The caller wanted to be signed out
     * and is; saying "that token does not exist" would only tell whoever sent it
     * that it does not, which is a small oracle for no benefit.
     */
    @Transactional
    public void signOut(String presentedToken) {
        Instant now = clock.instant();

        Optional<RefreshToken> presented = refreshTokens.findByTokenHash(SecureTokens.hash(presentedToken));
        presented.ifPresent(token ->
                revoker.revoke(token.getSessionId(), SessionRevocationReason.SIGNED_OUT, now));
    }
}
