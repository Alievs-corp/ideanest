package az.ideanest.auth.application;

import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.AccessTokenIssuer.IssuedAccessToken;
import az.ideanest.auth.domain.RefreshToken;
import az.ideanest.shared.SecureTokens;
import az.ideanest.auth.domain.Session;
import az.ideanest.auth.infrastructure.RefreshTokenRepository;
import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.shared.maintenance.MaintenanceGate;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turning "this person is who they say they are" into a session and a pair of
 * tokens.
 *
 * <p>Its own bean because two paths now reach it: a password on its own, and a
 * password followed by a second factor. Leaving it inside {@code SignInService}
 * and calling that from the two-factor path would have made the sign-in service
 * depend on the shape of a flow it does not run; copying it would have made
 * "how long is a refresh token" a thing with two answers.
 *
 * <p>{@code twoFactorProved} is recorded on the session rather than inferred
 * later from the account. An account can have two-factor switched on and still
 * hold sessions that were started before it was, and a payout action needs to
 * know what <em>this</em> sign-in proved.
 */
@Service
public class SessionStarter {

    private final SessionRepository sessions;
    private final RefreshTokenRepository refreshTokens;
    private final AccessTokenIssuer accessTokens;
    private final MaintenanceGate maintenance;
    private final AuthProperties properties;
    private final Clock clock;

    public SessionStarter(
            SessionRepository sessions,
            RefreshTokenRepository refreshTokens,
            AccessTokenIssuer accessTokens,
            MaintenanceGate maintenance,
            AuthProperties properties,
            Clock clock) {
        this.sessions = sessions;
        this.refreshTokens = refreshTokens;
        this.accessTokens = accessTokens;
        this.maintenance = maintenance;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * @param deviceLabel what the user will see in their device list
     * @param userAgent recorded for the same reason
     * @param ipAddress recorded so that an unexpected session can be recognised
     * @param standing what the token will say about the account: whether the
     *     address is proven, and whether a deletion is pending. A record rather
     *     than two booleans in a row, which are eventually passed in the wrong
     *     order with nothing to say so
     * @param twoFactorProved whether a second factor was entered for this
     *     sign-in, minutes ago at most
     */
    public record NewSession(
            UUID userId,
            AccessTokenIssuer.AccountStanding standing,
            String deviceLabel,
            String userAgent,
            String ipAddress,
            boolean twoFactorProved) {
    }

    @Transactional
    public IssuedTokens start(NewSession request) {
        // #214: every way in — password, two-factor completion, a provider's ID token —
        // ends here, so this is the one check that cannot be forgotten by a new one.
        maintenance.admitSession(request.userId());

        Instant now = clock.instant();
        Instant expiresAt = now.plus(properties.token().refreshTokenTtl());

        Session session = Session.start(request.userId(), now, expiresAt)
                .describedAs(request.deviceLabel(), request.userAgent(), request.ipAddress());
        if (request.twoFactorProved()) {
            session.withSecondFactor(now);
        }
        sessions.save(session);

        String refreshToken = SecureTokens.generate();
        refreshTokens.save(RefreshToken.issue(session.getId(), SecureTokens.hash(refreshToken), now, expiresAt));

        IssuedAccessToken accessToken = accessTokens.issue(
                request.userId(), session.getId(), request.standing(), request.twoFactorProved(), now);

        return new IssuedTokens(
                accessToken.value(), accessToken.expiresAt(), refreshToken, expiresAt, session.getId());
    }
}
