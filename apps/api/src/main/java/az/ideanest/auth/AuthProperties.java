package az.ideanest.auth;

import az.ideanest.auth.domain.IdentityProvider;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Everything about authentication that an operator might need to change without
 * a deployment, and nothing that they should not.
 *
 * @param verificationTokenTtl how long an email verification link works. Long
 *     enough to survive a mail queue and a night's sleep, short enough that a
 *     forwarded message is not a standing key to the account.
 * @param passwordResetTokenTtl how long §4.1's A-06 reset link works. One hour,
 *     and deliberately not the verification link's twenty-four: that link proves
 *     an address, this one replaces a credential, and it should stop being a key
 *     to the account long before it stops being a proof of the mailbox.
 * @param emailChangeTokenTtl how long §4.1's A-12 confirmation link works. Longer
 *     than a reset, because the person following it has to reach a mailbox they
 *     may not have configured on the device they are holding — and shorter than a
 *     verification, because until it is spent the account is in two minds about
 *     where it lives.
 * @param passwordMinLength minimum password length. Length is the only property
 *     that reliably resists guessing; composition rules mostly produce
 *     {@code Password1!} and a written-down note.
 * @param passwordMaxLength an upper bound, because the hash is deliberately
 *     expensive and an unbounded input is a denial of service against ourselves.
 * @param argon2 hashing parameters.
 * @param rateLimit how many attempts, and over what window.
 * @param token access and refresh token lifetimes and signing keys.
 * @param twoFactor time-based one-time passwords.
 * @param oauth the identity providers a person may sign in with.
 * @param refreshCookie how the refresh token is delivered to a browser.
 * @param logVerificationLinks whether to write verification links to the log.
 *     Local development only — see {@code application-local.yml}.
 * @param synchronousMail whether auth mail is sent on the request's own thread.
 *     False everywhere but the test suite, which reads what was sent the moment a
 *     request returns. Sending on the request thread is what made a password reset
 *     for a registered address measurably slower than one for an unknown address
 *     (#587) — see {@code VerificationNotificationListener}. Named for the exception
 *     so that a configuration which omits it gets the safe behaviour.
 */
@ConfigurationProperties(prefix = "ideanest.auth")
public record AuthProperties(
        Duration verificationTokenTtl,
        Duration passwordResetTokenTtl,
        Duration emailChangeTokenTtl,
        int passwordMinLength,
        int passwordMaxLength,
        Argon2 argon2,
        RateLimit rateLimit,
        Token token,
        TwoFactor twoFactor,
        OAuth oauth,
        RefreshCookie refreshCookie,
        boolean logVerificationLinks,
        boolean synchronousMail) {

    /**
     * Argon2id parameters.
     *
     * <p>The defaults follow the OWASP recommendation of 19 MiB, two
     * iterations, one degree of parallelism. They are configurable because the
     * right setting is "as expensive as this machine can afford", which is a
     * property of the machine — and because raising them is how the hash keeps
     * up with hardware. Argon2's encoded output carries the parameters it was
     * produced with, so raising them rehashes on next sign-in rather than
     * locking anybody out.
     *
     * @param memoryKib memory cost in kibibytes. This is the parameter that
     *     makes a GPU no better at this than a CPU; lowering it is what turns a
     *     stolen table into a weekend of cracking.
     * @param iterations time cost.
     * @param parallelism lanes.
     * @param saltLength bytes of salt. Per password, so two identical passwords
     *     do not produce identical hashes.
     * @param hashLength bytes of output.
     */
    public record Argon2(int memoryKib, int iterations, int parallelism, int saltLength, int hashLength) {
    }

    /**
     * @param registrationsPerAddress registration attempts from one IP address
     * @param registrationsPerEmail registration attempts for one email address,
     *     counted separately so that a distributed attempt on one account is
     *     still bounded
     * @param verificationsPerAddress verification attempts from one IP address.
     *     A verification token is 256 bits, so this is not about guessing it; it
     *     is about not letting one client spend our database on the attempt
     * @param passwordResetsPerAddress reset requests from one IP address. The form
     *     is unauthenticated and every accepted request sends mail, so this is the
     *     control that keeps it from being a way to spend our mail reputation
     * @param passwordResetsPerEmail reset requests for one address, counted
     *     separately for the reason the registration pair gives: an attacker with
     *     many source addresses is otherwise unbounded against one account, and
     *     what they are buying is a mailbox full of reset links, which is a
     *     credible way to make somebody stop reading them
     * @param credentialChangesPerUser password and address changes attempted by one
     *     account in a window. Each costs an Argon2 verification, so this bounds
     *     what a stolen access token can spend as well as what it can guess — the
     *     same argument {@code twoFactorChangesPerUser} makes
     * @param twoFactorCodesPerChallenge how many codes may be offered against
     *     one sign-in challenge. This is <em>the</em> control on a six-digit
     *     secret: with one step of skew either side, three codes are valid at
     *     any moment, so each attempt is three chances in a million and only
     *     the count of attempts keeps that a small number
     * @param twoFactorChangesPerUser how many times a user may try to switch
     *     two-factor on or off in a window. Each attempt costs an Argon2
     *     verification, so this bounds what a stolen access token can spend as
     *     much as what it can guess
     * @param signInsPerAddress failed sign-ins from one IP address in a window.
     *     Failures only (#587): a correct password gives its attempt back, so an
     *     office or a mobile carrier's shared address is not throttled for its
     *     own successful sign-ins
     * @param signInsPerEmail failed sign-ins against one account from one address
     *     before that address starts to back off. Not a lockout: past this many,
     *     each further attempt from the address has to wait {@code signInBackoff},
     *     doubling per failure up to {@code signInBackoffCeiling}, measured from the
     *     last failure. Other addresses are not held back by it. A completed
     *     sign-in clears the count; a wrong two-factor code adds to it
     * @param socialSignInsPerAddress provider sign-in attempts from one IP
     *     address. Not about guessing an ID token — one cannot be guessed — but
     *     about the work each attempt costs us: a signature verification and,
     *     when the key set has rotated, a call to the provider
     * @param signInFailuresPerAccount failed sign-ins and wrong two-factor codes
     *     against one account from every address together, inside
     *     {@code signInFailuresPerAccountWindow}, before the account refuses every
     *     attempt — its owner's included — until the oldest leaves the window. The
     *     bound on guessing from many addresses; higher than one address can reach
     *     alone, so that keeping an owner out takes many. See {@code SignInBackoff}
     * @param signInBackoff the first wait once {@code signInsPerEmail} failures
     *     have been spent
     * @param signInBackoffCeiling the longest any one wait grows to
     * @param signInFailureMemory how long an account's failures are remembered
     *     after the last of them. Longer than the ceiling, so that waiting out
     *     one delay does not also hand back the free attempts
     * @param signInFailuresPerAccountWindow the period
     *     {@code signInFailuresPerAccount} is counted over, sliding
     * @param window the period the counted limits are measured over
     */
    public record RateLimit(
            int registrationsPerAddress,
            int registrationsPerEmail,
            int verificationsPerAddress,
            int passwordResetsPerAddress,
            int passwordResetsPerEmail,
            int credentialChangesPerUser,
            int signInsPerAddress,
            int signInsPerEmail,
            int twoFactorCodesPerChallenge,
            int twoFactorChangesPerUser,
            int socialSignInsPerAddress,
            int signInFailuresPerAccount,
            Duration signInBackoff,
            Duration signInBackoffCeiling,
            Duration signInFailureMemory,
            Duration signInFailuresPerAccountWindow,
            Duration window) {

        public RateLimit {
            // Binding leaves an omitted duration null. A null back-off would be a
            // NullPointerException on the first wrong password -- or, written
            // defensively, no back-off at all, which is the failure nobody
            // notices. AbuseProperties makes the same argument.
            signInBackoff = signInBackoff == null ? Duration.ofSeconds(30) : signInBackoff;
            signInBackoffCeiling = signInBackoffCeiling == null ? Duration.ofMinutes(15) : signInBackoffCeiling;
            signInFailureMemory = signInFailureMemory == null ? Duration.ofHours(24) : signInFailureMemory;
            // An omitted int binds as 0, which here would refuse every sign-in.
            signInFailuresPerAccount = signInFailuresPerAccount == 0 ? 50 : signInFailuresPerAccount;
            signInFailuresPerAccountWindow =
                    signInFailuresPerAccountWindow == null ? Duration.ofHours(1) : signInFailuresPerAccountWindow;
            if (signInFailuresPerAccount <= signInsPerEmail || !signInFailuresPerAccountWindow.isPositive()) {
                // At or below one address's free failures, a single address would reach
                // the account-wide ceiling on its own: the lockout the per-address
                // back-off exists to prevent.
                throw new IllegalArgumentException(
                        "The per-account sign-in ceiling must exceed one address's free failures");
            }
            if (!signInBackoff.isPositive() || signInBackoffCeiling.compareTo(signInBackoff) < 0) {
                throw new IllegalArgumentException("A sign-in back-off is positive and no longer than its ceiling");
            }
            if (signInFailureMemory.compareTo(signInBackoffCeiling) < 0) {
                throw new IllegalArgumentException(
                        "Sign-in failures must be remembered for at least the back-off ceiling");
            }
        }
    }

    /**
     * Access and refresh tokens.
     *
     * @param issuer the {@code iss} claim, and what the decoder requires. A
     *     token minted for staging must not be accepted in production, and this
     *     is the field that says so.
     * @param audience the {@code aud} claim. Same argument, from the other side.
     * @param accessTokenTtl how long an access token is good for. Short, though
     *     it is no longer the window in which a revoked session still works:
     *     since #587 a token whose session is revoked is refused at its next
     *     request ({@code RevokedSessions}). It still bounds how long a copied
     *     token is worth anything to whoever copied it.
     * @param refreshTokenTtl how long a refresh token — and with it a session —
     *     survives without use.
     * @param privateKeyPem RSA private key, PKCS#8 PEM, for signing. Supplied by
     *     the secret store. Absent outside local and test, the service refuses
     *     to start rather than inventing one.
     * @param publicKeyPem the matching public key, X.509 PEM, for verifying.
     */
    public record Token(
            String issuer,
            String audience,
            Duration accessTokenTtl,
            Duration refreshTokenTtl,
            String privateKeyPem,
            String publicKeyPem) {
    }

    /**
     * Time-based one-time passwords.
     *
     * @param issuer what an authenticator app shows above the six digits. It is
     *     part of the {@code otpauth://} label, so changing it after people have
     *     enrolled renames their existing entry only when they re-enrol —
     *     harmless, but not retroactive.
     * @param challengeTtl how long the proof of a correct password is good for
     *     before a code has to be entered. Minutes: it exists to carry one
     *     person across one form, and every second beyond that is a window in
     *     which a challenge captured from a proxy log is still spendable.
     */
    public record TwoFactor(String issuer, Duration challengeTtl) {
    }

    /**
     * Signing in with Google or Apple.
     *
     * <p>The client obtains an ID token from the provider — through a native SDK
     * or the web flow — and sends it here. Nothing in that token is believed
     * until its signature has been checked against the provider's published
     * keys, so every value below is part of an authentication decision rather
     * than a convenience.
     *
     * @param clockSkew how far the provider's clock may be from ours before a
     *     token is called expired or not yet valid. Small: this is tolerance for
     *     clock drift, and every second of it is a second a dead token still
     *     works.
     * @param maxTokenAge how old an ID token may be when it reaches us,
     *     measured from {@code iat}. Google's ID tokens are valid for an hour,
     *     which is an hour in which a token captured anywhere it was logged can
     *     still be spent here. A sign-in that has just happened produces a token
     *     seconds old, so the honest limit is minutes, not the provider's.
     * @param providers configuration per provider. A provider absent from this
     *     map is not enabled in this environment and its endpoint says so; see
     *     {@code JwksOidcIdentityVerifier}.
     */
    public record OAuth(Duration clockSkew, Duration maxTokenAge, Map<IdentityProvider, Provider> providers) {

        /**
         * @param issuer the {@code iss} the token must carry —
         *     {@code https://accounts.google.com} or
         *     {@code https://appleid.apple.com}. A token from anywhere else is
         *     somebody else's user.
         * @param jwksUri where the provider publishes the keys it signs with.
         *     Fetched by us, never taken from the token: a {@code jku} header is
         *     a suggestion from whoever made the token.
         * @param audiences the client identifiers we accept in {@code aud} —
         *     one per platform, so the web, iOS, and Android clients are all
         *     listed. <strong>This is the check that keeps somebody else's app
         *     from signing people in here.</strong> Google will happily issue a
         *     valid, correctly signed token to any developer; what makes it ours
         *     is that it names our client. Empty means the provider is not
         *     configured.
         * @param requireNonce whether a token must be bound to the nonce the
         *     client sent in its authorisation request. True for our own
         *     clients, all of which send one.
         */
        public record Provider(String issuer, String jwksUri, List<String> audiences, boolean requireNonce) {

            /**
             * <strong>The audience list is what enables a provider.</strong> The
             * issuer and the key set are facts about Google and Apple and are
             * checked into the repository as such; the client identifiers are
             * per environment and come from the environment. So a provider with
             * no audience is one this environment was not given credentials for,
             * which is a normal state and not an error.
             */
            public boolean isConfigured() {
                return hasAudience() && hasText(issuer) && hasText(jwksUri);
            }

            /**
             * Client identifiers, and nowhere to check them against.
             *
             * <p>Somebody enabled the provider and removed — or misspelled — the
             * issuer or the key set. That is not a decision anybody made, and
             * left alone it surfaces as a 401 during a demo rather than as a
             * message at start-up.
             */
            public boolean isPartiallyConfigured() {
                return hasAudience() && !isConfigured();
            }

            private boolean hasAudience() {
                return audiences != null && audiences.stream().anyMatch(Provider::hasText);
            }

            private static boolean hasText(String value) {
                return value != null && !value.isBlank();
            }
        }
    }

    /**
     * The cookie a browser stores the refresh token in.
     *
     * <p>A refresh token in {@code localStorage} is readable by any script that
     * gets onto the page, which is what makes one cross-site scripting bug into
     * a permanent account takeover. An httpOnly cookie is not.
     *
     * @param name the cookie name
     * @param secure whether to mark it Secure. Always true except on plain-HTTP
     *     localhost, where a Secure cookie is simply never sent
     * @param path scoped to the auth endpoints, so it is not attached to every
     *     request to the API
     * @param sameSite {@code Strict}: the cookie is not sent on any cross-site
     *     request at all, which is what stops another origin from spending the
     *     victim's refresh token
     */
    public record RefreshCookie(String name, boolean secure, String path, String sameSite) {
    }
}
