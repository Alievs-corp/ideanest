package az.ideanest.auth.application;

import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.SignInService.SignInCommand;
import az.ideanest.shared.SecureTokens;
import az.ideanest.auth.domain.TwoFactorChallenge;
import az.ideanest.auth.domain.TwoFactorSecret;
import az.ideanest.auth.infrastructure.TwoFactorChallengeRepository;
import az.ideanest.auth.infrastructure.TwoFactorSecretRepository;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The second half of a sign-in: issuing the challenge, and spending it together
 * with a code.
 *
 * <p>Everything here answers a failure the same way, with
 * {@link AuthenticationFailedException} and one message. A challenge that never
 * existed, one that expired, one already spent, a wrong code, a replayed code,
 * a recovery code that was used last week — telling them apart would tell an
 * attacker which half of the pair they got right.
 *
 * <p><strong>Rate limiting is the control that matters here.</strong> A code is
 * six digits and three of them are valid at once across the skew window, so
 * without a limit an attacker with a stolen password guesses one in a few
 * hundred thousand attempts, which is minutes of scripting. The limit is per
 * challenge, and a challenge is retired when a new one is issued, so collecting
 * challenges does not buy more guesses.
 */
@Service
public class TwoFactorChallenges {

    /** The same refusal for every cause. See the class comment. */
    private static final String REFUSAL = "That code is not valid.";

    private final TwoFactorChallengeRepository challenges;
    private final TwoFactorSecretRepository secrets;
    private final SecondFactors secondFactors;
    private final SessionStarter sessionStarter;
    private final UserAccounts users;
    private final RateLimiter rateLimiter;
    private final AuthProperties properties;
    private final Clock clock;

    public TwoFactorChallenges(
            TwoFactorChallengeRepository challenges,
            TwoFactorSecretRepository secrets,
            SecondFactors secondFactors,
            SessionStarter sessionStarter,
            UserAccounts users,
            RateLimiter rateLimiter,
            AuthProperties properties,
            Clock clock) {
        this.challenges = challenges;
        this.secrets = secrets;
        this.secondFactors = secondFactors;
        this.sessionStarter = sessionStarter;
        this.users = users;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * @param challenge the value handed out by the first call
     * @param code a six-digit code from the authenticator, or null
     * @param recoveryCode one of the codes printed at enrolment, or null.
     *     Exactly one of the two is expected; sending both is not a way to get
     *     two guesses
     */
    public record CompletionCommand(String challenge, String code, String recoveryCode) {
    }

    /**
     * Issues the challenge that stands in for a session until a code arrives.
     *
     * <p>Any outstanding challenge for this user is retired first. Ten correct
     * password submissions must not leave ten live challenges behind, each with
     * its own allowance of guesses.
     */
    @Transactional
    public SignInOutcome.TwoFactorRequired issue(UUID userId, SignInCommand command, Instant now) {
        return issue(userId, command.deviceLabel(), command.userAgent(), command.ipAddress(), now);
    }

    /**
     * The same, for a sign-in that had no password to describe itself with.
     *
     * <p>A provider sign-in reaches a second factor by the same route: what
     * proved the first factor differs, what the second factor demands does not.
     */
    @Transactional
    public SignInOutcome.TwoFactorRequired issue(
            UUID userId, String deviceLabel, String userAgent, String ipAddress, Instant now) {
        // #576. No session, no tokens, and no challenge for a suspended account, here
        // rather than in each caller because both sign-in paths end up here and the
        // provider one used not to ask. Asking a banned person for a code only to refuse
        // them after it would be the loop AccountSuspendedException exists to avoid.
        // A ban that lands after this is caught when the challenge is spent:
        // SessionStarter asks again.
        if (users.isSuspendedForSignIn(userId)) {
            throw new AccountSuspendedException();
        }

        challenges.consumeOutstanding(userId, now);

        String value = SecureTokens.generate();
        Instant expiresAt = now.plus(properties.twoFactor().challengeTtl());

        challenges.save(TwoFactorChallenge.issue(userId, SecureTokens.hash(value), now, expiresAt)
                .describedAs(deviceLabel, userAgent, ipAddress));

        return new SignInOutcome.TwoFactorRequired(value, expiresAt);
    }

    /** Spends a challenge and a code, and starts the session the password alone did not. */
    @Transactional
    public IssuedTokens complete(CompletionCommand command) {
        Instant now = clock.instant();

        TwoFactorChallenge challenge = challenges
                .findByChallengeHash(SecureTokens.hash(command.challenge()))
                .orElseThrow(() -> new AuthenticationFailedException(REFUSAL));

        // Keyed on the challenge rather than the address or the account: it is
        // the only identifier here that the caller cannot vary, and it bounds
        // guessing at exactly the thing being guessed against.
        AuthProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt(
                "2fa:challenge:" + challenge.getId(), limits.twoFactorCodesPerChallenge(), limits.window()));

        if (!challenge.isRedeemable(now)) {
            throw new AuthenticationFailedException(REFUSAL);
        }

        // Gone between the two calls: two-factor was switched off, or the
        // account was deleted. The challenge proves a password, which is no
        // longer enough to say anything about, so it buys nothing.
        TwoFactorSecret secret = secrets
                .findByUserIdAndConfirmedAtIsNotNull(challenge.getUserId())
                .orElseThrow(() -> new AuthenticationFailedException(REFUSAL));

        if (!secondFactors.accepts(secret, command.code(), command.recoveryCode(), now)) {
            throw new AuthenticationFailedException(REFUSAL);
        }

        // Spent last, and conditionally: two requests carrying the same
        // challenge and the same code would otherwise both be handed a session.
        if (challenges.claim(challenge.getId(), now) == 0) {
            throw new AuthenticationFailedException(REFUSAL);
        }

        UserAccount account = users.findById(challenge.getUserId())
                .orElseThrow(() -> new AuthenticationFailedException(REFUSAL));

        return sessionStarter.start(new SessionStarter.NewSession(
                account.id(),
                new AccessTokenIssuer.AccountStanding(account.emailVerified(), account.deletionPending()),
                // From the challenge, not from this request: the device that
                // signed in is the one that sent the password.
                challenge.getDeviceLabel(),
                challenge.getUserAgent(),
                challenge.getIpAddress(),
                true));
    }

}
