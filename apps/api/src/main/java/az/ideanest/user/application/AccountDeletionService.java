package az.ideanest.user.application;

import az.ideanest.user.UserProperties;
import az.ideanest.user.domain.User;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Closing an account, and changing one's mind about it.
 *
 * <p><strong>Deletion is deferred, not immediate.</strong> §17.4 gives thirty
 * days before anything is destroyed. Two things make that period worth the
 * complexity: people delete accounts in anger and regret it the next morning,
 * and an attacker who has got hold of a session should not be able to make a
 * person's history disappear in one request. Neither is a hypothetical.
 *
 * <p><strong>The password is required.</strong> An access token is a
 * fifteen-minute bearer credential that a cross-site scripting bug, a shared
 * machine, or a proxy log can leak. A deletion that needs only that is a
 * vandalism tool. The password is the thing the account's owner knows, and it
 * is asked for at exactly the point where the answer cannot be undone.
 *
 * <p><strong>What the account can do during the grace period.</strong> It can
 * sign in — that is the way back — read itself, export its data, and cancel.
 * Nothing else: {@code SecurityConfiguration} refuses every other authenticated
 * request from a token issued to an account in this state. A closing account
 * that could still pledge would be making commitments it has already said it
 * will not be around to honour.
 */
@Service
public class AccountDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    private static final String WRONG_PASSWORD = "That password is not correct.";

    private final UserRepository users;
    private final AccountSecurity security;
    private final AccountPushRegistrations pushRegistrations;
    private final UserProperties properties;
    private final Clock clock;

    public AccountDeletionService(
            UserRepository users,
            AccountSecurity security,
            AccountPushRegistrations pushRegistrations,
            UserProperties properties,
            Clock clock) {
        this.users = users;
        this.security = security;
        this.pushRegistrations = pushRegistrations;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * @param requestedAt when the account was closed
     * @param scheduledFor when it will be anonymised, and the last moment at
     *     which cancelling still recovers everything
     */
    public record DeletionSchedule(Instant requestedAt, Instant scheduledFor) {
    }

    /**
     * Starts the grace period.
     *
     * <p>Empty when there is no such live account — a token minted for one that
     * has since been anonymised, say. Asking twice returns the first schedule
     * rather than extending it.
     *
     * @throws IncorrectPasswordException when the password is not the account's
     */
    @Transactional
    public Optional<DeletionSchedule> request(UUID userId, String password) {
        Optional<User> found = users.findByIdAndDeletedAtIsNull(userId);
        if (found.isEmpty()) {
            // Still spend the time a real check would, so that this endpoint
            // does not answer "is this account still here?" by how fast it says
            // no. The password is wrong by definition against an account that
            // does not exist.
            security.passwordMatches(userId, password);
            return Optional.empty();
        }

        if (!security.passwordMatches(userId, password)) {
            throw new IncorrectPasswordException(WRONG_PASSWORD);
        }

        // Truncated to what the column can hold. PostgreSQL stores microseconds;
        // anything finer exists only until the row is read back, and a client
        // that asked twice would then be told two different dates for the same
        // deletion.
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        User user = found.get();
        user.requestDeletion(now, now.plus(properties.deletionGracePeriod()));

        // Every session, including the one that made this request. Someone
        // closing an account should not stay signed in on a device they may no
        // longer control — which is frequently the reason they are closing it.
        security.endAllSessions(userId, now);
        // And every push registration, for the same reason (#645). Ending the sessions
        // stops the phones asking; this stops them being told. Left until anonymisation,
        // a notification addressed to the closing account would keep reaching a phone it
        // may no longer control for thirty days. A closing account cannot register again
        // (POST /v1/me/devices is not one of its three paths), and a cancellation does not
        // put them back: the application registers its token again the next time it opens
        // signed in with a token that no longer carries the deletion claim. Repeatable, so
        // asking twice deletes nothing the second time.
        pushRegistrations.forgetAll(userId);

        log.info("Account {} scheduled for anonymisation at {}.", userId, user.getDeletionScheduledAt());
        return Optional.of(new DeletionSchedule(user.getDeletionRequestedAt(), user.getDeletionScheduledAt()));
    }

    /**
     * Withdraws a pending deletion.
     *
     * <p>Nothing has been overwritten yet, so the account comes back whole. The
     * sessions do not: they were revoked when the deletion was requested and
     * stay revoked, because the caller has just proved they can sign in and the
     * other devices have not. Nor do the push registrations: each phone that
     * still allows notifications registers again when it next opens signed in.
     *
     * <p>Cancelling when nothing is pending succeeds. The caller wanted an
     * account that is not being deleted and has one; refusing would only tell
     * them something they did not ask.
     *
     * @return false when there is no such live account
     */
    @Transactional
    public boolean cancel(UUID userId) {
        return users.findByIdAndDeletedAtIsNull(userId)
                .map(user -> {
                    if (user.isDeletionPending()) {
                        log.info("Account {} deletion cancelled inside the grace period.", userId);
                    }
                    user.cancelDeletion();
                    return true;
                })
                .orElse(false);
    }
}
