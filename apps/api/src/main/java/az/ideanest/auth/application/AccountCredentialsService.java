package az.ideanest.auth.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.auth.AuthProperties;
import az.ideanest.auth.application.AuthEvents.EmailChangeAttemptedOnExistingAccount;
import az.ideanest.auth.application.AuthEvents.EmailChangeNoticeToPreviousAddress;
import az.ideanest.auth.application.AuthEvents.EmailChangeRequested;
import az.ideanest.auth.application.AuthEvents.PasswordChanged;
import az.ideanest.auth.domain.EmailChangeRequest;
import az.ideanest.auth.domain.SessionRevocationReason;
import az.ideanest.auth.infrastructure.EmailChangeRequestRepository;
import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.SecureTokens;
import az.ideanest.user.application.AccountNotFoundException;
import az.ideanest.user.application.IncorrectPasswordException;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §4.1's A-12 and A-13: changing the password, and changing the address that signs in.
 *
 * <h2>One service, because both are the same act</h2>
 *
 * <p>Each of them replaces a credential, each of them requires the current password
 * first, and each of them ends by telling an address that something changed. Split in
 * two, the current-password check becomes two implementations of one rule, and the one
 * that is edited second is the one that stops matching.
 *
 * <h2>The current password is required, and it is not the access token</h2>
 *
 * <p>The caller is already authenticated — this is behind a bearer token — so the
 * password is a <em>second</em> check rather than the first, and it is what makes a
 * stolen access token useless for taking an account over. Fifteen minutes of somebody
 * else's token should not be able to move the address that resets the password, which
 * is the whole path an account takeover takes.
 *
 * <p>{@link IncorrectPasswordException} rather than an authentication failure, and the
 * user module's exception rather than a new one: the caller <em>is</em> authenticated,
 * and a 401 would send a client into signing them in again over a password they typed
 * into the wrong box.
 *
 * <h2>A-13 kills every session, and A-12 kills none</h2>
 *
 * <p>A password change revokes every session, including the one that made the request
 * — the reason {@code UserCredential} states, which is that a password is changed
 * precisely when somebody believes the old one is known, and leaving the sessions it
 * issued alive makes the change ceremonial. The client signs in again, which is the
 * correct amount of inconvenience.
 *
 * <p>An address change revokes nothing, because nothing about the credential changed.
 * The sessions were issued to the same person and the same password still opens them.
 *
 * <h2>The address does not move until the new one answers</h2>
 *
 * <p>V44 carries the argument at length: writing the new address immediately means one
 * typo puts the account behind a mailbox nobody can read, and sign-in — and the reset
 * that would fix it — both go to the address on the account. So the request is held in
 * {@code email_change_requests} and {@code users.email} moves in one statement when the
 * link is spent.
 *
 * <p><strong>Both addresses are written to</strong>, which is what the capability asks
 * for. The new one gets the link. The old one gets a notice with no link at all: it
 * cannot approve the change and does not need to, and what it is for is that somebody
 * losing their account finds out at the address they still hold.
 */
@Service
public class AccountCredentialsService {

    /**
     * Said for a wrong password on either endpoint, and said identically.
     *
     * <p>The alternative — "that is not your password" on one and something else on the
     * other — tells whoever is holding a stolen token which of the two checks they got
     * past.
     */
    private static final String WRONG_PASSWORD = "That is not the password on this account.";

    private final UserAccounts users;
    private final UserCredentialRepository credentials;
    private final EmailChangeRequestRepository emailChanges;
    private final PasswordHasher passwordHasher;
    private final PasswordPolicy passwordPolicy;
    private final SessionRevoker sessions;
    private final ApplicationEventPublisher events;
    private final AuditLog audit;
    private final AuthProperties properties;
    private final Clock clock;

    public AccountCredentialsService(
            UserAccounts users,
            UserCredentialRepository credentials,
            EmailChangeRequestRepository emailChanges,
            PasswordHasher passwordHasher,
            PasswordPolicy passwordPolicy,
            SessionRevoker sessions,
            ApplicationEventPublisher events,
            AuditLog audit,
            AuthProperties properties,
            Clock clock) {
        this.users = users;
        this.credentials = credentials;
        this.emailChanges = emailChanges;
        this.passwordHasher = passwordHasher;
        this.passwordPolicy = passwordPolicy;
        this.sessions = sessions;
        this.events = events;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * §4.1's A-13: replaces the password, given the current one.
     *
     * @throws IncorrectPasswordException if the current password is wrong, or if the
     *     account has no password at all — somebody who signed up through a provider
     *     has nothing to confirm with and reaches a new password through A-06's reset
     *     rather than through here
     * @throws WeakPasswordException if the new password does not satisfy
     *     {@link PasswordPolicy}
     */
    @Transactional
    public void changePassword(UUID userId, String currentPassword, String newPassword) {
        Instant now = clock.instant();
        UserAccount account = require(userId);

        // The policy first, and against the account's own address, exactly as
        // registration does. A password that will be refused should be refused before
        // an Argon2 verification is spent on the old one.
        passwordPolicy.check(newPassword, account.email());
        requireCurrentPassword(userId, currentPassword);

        credentials
                .findById(userId)
                .orElseThrow(() -> new IncorrectPasswordException(WRONG_PASSWORD))
                .changePassword(passwordHasher.hash(newPassword), passwordHasher.algorithm(), now);

        /*
         * INCLUDING THE SESSION THAT ASKED. Excluding it is the friendlier option and
         * it is wrong: the person changing a password on a machine they suspect is the
         * one who most needs every other session to end, and "every session except one"
         * is a rule the client would then have to be trusted to have picked correctly.
         * The client signs in again.
         *
         * `SessionRevoker` commits in a transaction of its own, which is the right way
         * round here rather than a hazard. If this transaction then rolls back the user
         * is signed out and their password is unchanged — recoverable, and they sign in
         * with the old one. The opposite ordering fails the other way: a committed new
         * password with live sessions issued under the old one, which is exactly the
         * state the revocation exists to prevent.
         */
        sessions.revokeAllFor(userId, SessionRevocationReason.PASSWORD_CHANGED, now);

        audit.record(
                AuditAction.PASSWORD_CHANGED,
                userId,
                AuditActor.user(userId),
                AuditOutcome.SUCCEEDED,
                "password changed with the current password");

        events.publishEvent(new PasswordChanged(account.email(), account.locale()));
    }

    /**
     * §4.1's A-12, first half: asks for an address change and sends both messages.
     *
     * <p>Nothing about the account changes here. Until the link in the first message is
     * followed, {@code users.email} is what it was and the old address still signs in.
     *
     * <p><strong>An address that already has an account is answered exactly like one
     * that does not</strong> (#587). It used to be a 409, which made this endpoint a
     * free "is this address registered here?" oracle for anybody with an account and a
     * list. Now the caller sees the same 202, their current address gets the same
     * notice, an outstanding link is retired the same way — and the owner of the
     * address they named is told, as registration tells them, instead of being sent a
     * link that could move somebody else's account onto their address.
     *
     * @throws IncorrectPasswordException if the current password is wrong
     */
    @Transactional
    public void requestEmailChange(UUID userId, String currentPassword, EmailAddress newEmail) {
        Instant now = clock.instant();
        UserAccount account = require(userId);

        requireCurrentPassword(userId, currentPassword);

        if (account.email().equals(newEmail)) {
            // Not an error and not worth two emails. The account is already where the
            // caller is asking it to go, and a confirmation link to the address that is
            // already on the account teaches people to click links that do nothing.
            return;
        }
        // Whatever was outstanding is retired first. Two live links mean two addresses
        // this account could move to, and the one nobody wants any more is the one
        // still sitting in a mailbox that may have been lost. Retired for a taken
        // address too, or the old link still working would be the oracle the 202 hides.
        emailChanges.consumeOutstanding(userId, now);

        if (users.isEmailTaken(newEmail)) {
            // Recorded for staff, who may need to see somebody walking a list of
            // addresses through this form. The row is about the caller's account and
            // names neither address.
            audit.record(
                    AuditAction.EMAIL_CHANGE_REQUESTED,
                    userId,
                    AuditActor.user(userId),
                    AuditOutcome.REFUSED,
                    "the address asked for already has an account; its owner was told");
            // The owner's language when they still have an account to have one, and
            // the caller's otherwise -- registration's choice for its own notice.
            String ownersLocale = users.findByEmail(newEmail).map(UserAccount::locale).orElse(account.locale());
            events.publishEvent(new EmailChangeAttemptedOnExistingAccount(newEmail, ownersLocale));
            events.publishEvent(new EmailChangeNoticeToPreviousAddress(account.email(), newEmail, account.locale()));
            return;
        }

        String token = SecureTokens.generate();
        emailChanges.save(EmailChangeRequest.issue(
                userId, newEmail, SecureTokens.hash(token), now.plus(properties.emailChangeTokenTtl())));

        audit.record(
                AuditAction.EMAIL_CHANGE_REQUESTED,
                userId,
                AuditActor.user(userId),
                AuditOutcome.SUCCEEDED,
                "address change awaiting confirmation");

        events.publishEvent(new EmailChangeRequested(newEmail, token, account.locale()));
        events.publishEvent(new EmailChangeNoticeToPreviousAddress(account.email(), newEmail, account.locale()));
    }

    /**
     * §4.1's A-12, second half: spends the link and moves the address.
     *
     * <p><strong>Unauthenticated on purpose.</strong> The credential is the token in the
     * message, exactly as it is for email verification, and requiring a session as well
     * would mean the link only works in the browser that asked — which is the browser
     * least likely to be reading the new mailbox.
     *
     * @throws VerificationRejectedException for a link that is not one, has expired, has
     *     already been spent, or belongs to an account that has since closed
     * @throws EmailAlreadyInUseException if somebody took the address in between. The
     *     link is <em>not</em> spent in that case, so a change that becomes possible
     *     again can still be confirmed
     */
    @Transactional
    public void confirmEmailChange(String rawToken) {
        Instant now = clock.instant();

        EmailChangeRequest request = emailChanges
                .findByTokenHash(SecureTokens.hash(rawToken))
                .orElseThrow(() -> new VerificationRejectedException("This link is not valid."));

        if (request.isExpired(now)) {
            throw new VerificationRejectedException("This link has expired. Ask for a new one.");
        }

        UserAccount account = users.findById(request.getUserId())
                .orElseThrow(() -> new VerificationRejectedException("This link is not valid."));

        EmailAddress previous = account.email();

        // Claimed before the address moves, and with a conditional update: two clicks
        // arriving together would otherwise both move it, and the second would do so
        // after the first had already published the change.
        if (emailChanges.claim(request.getId(), now) == 0) {
            throw new VerificationRejectedException("This link has already been used.");
        }

        if (!users.changeEmail(account.id(), request.getNewEmail(), now)) {
            /*
             * Somebody registered the address between the request and the click. The
             * exception rolls this transaction back — the claim above with it — so the
             * link survives and can be spent if the address frees up. Claiming it would
             * strand a person who did nothing wrong.
             */
            throw new EmailAlreadyInUseException("That address now has an account. Ask for the change again.");
        }

        audit.record(
                AuditAction.EMAIL_CHANGED,
                account.id(),
                AuditActor.user(account.id()),
                AuditOutcome.SUCCEEDED,
                "address changed from a confirmation link");

        // The notice about a *completed* change goes to the address being left, which is
        // still reachable and is the one that has just lost the account. The new address
        // needs no confirmation of a link it has this second followed.
        events.publishEvent(
                new EmailChangeNoticeToPreviousAddress(previous, request.getNewEmail(), account.locale()));
    }

    private UserAccount require(UUID userId) {
        return users.findById(userId).orElseThrow(() -> new AccountNotFoundException(userId));
    }

    /**
     * The second check, and the reason a stolen access token cannot take an account
     * over.
     *
     * <p>No constant-time decoy, unlike {@code AuthAccountSecurity.passwordMatches} and
     * {@code SignInService}. Those answer an unauthenticated caller who is trying to
     * learn whether an account exists; this one answers a caller who already holds a
     * token for the account and can learn nothing from the timing that the token has
     * not already told them.
     */
    private void requireCurrentPassword(UUID userId, String currentPassword) {
        boolean matches = credentials
                .findById(userId)
                .map(credential -> passwordHasher.matches(currentPassword, credential.getPasswordHash()))
                .orElse(false);

        if (!matches) {
            throw new IncorrectPasswordException(WRONG_PASSWORD);
        }
    }
}
