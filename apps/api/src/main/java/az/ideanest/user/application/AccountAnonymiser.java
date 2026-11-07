package az.ideanest.user.application;

import az.ideanest.user.infrastructure.SocialLinkRepository;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Anonymising one account, in one transaction.
 *
 * <p><strong>Anonymisation, not deletion.</strong> §17.4 says the grace period
 * ends in anonymisation and that financial records are kept for the statutory
 * period, and those two sentences are the same sentence. A pledge is a
 * financial record; "pledge #123 was made by user X" has to remain true after X
 * leaves, or the ledger no longer reconciles against the money that actually
 * moved. Every one of those rows is a foreign key to {@code users.id}, so the
 * row survives and its contents do not.
 *
 * <p><strong>What is overwritten:</strong> the email address, the display name,
 * the public slug, the avatar, the biography, the site, the location, every
 * social link, the proof that the address was verified, the password credential,
 * the second factor (its secret, recovery codes and sign-in challenges), every
 * Google and Apple link, every pending address change, every unspent verification
 * link, every push registration, and the device label, user agent, and IP address
 * of every session. Everything from the credential on lives in {@code auth} and goes
 * through {@link AccountSecurity#forget} (#645).
 *
 * <p><strong>The push registrations are deleted here for the links' reason</strong>
 * (#643): {@code push_devices} cascades from {@code users}, and the cascade never
 * fires. They belong to {@code notification}, which depends on this module, so they
 * are reached through {@link AccountPushRegistrations} the way the credentials are
 * reached through {@link AccountSecurity}.
 *
 * <p><strong>#276's four go with the rest of the profile, and §17.4 is not
 * satisfied without them.</strong> A row whose name reads "Deleted account" and
 * whose Instagram address is still attached has not been anonymised — a link to
 * somebody's account elsewhere identifies them more directly than the name above
 * it, since it resolves to a page with their photograph on it. The site and the
 * location are cleared by {@code User.anonymise} because they are columns on this
 * row; the links are deleted here, because an entity cannot delete rows in a table
 * it does not map. {@code ON DELETE CASCADE} on {@code user_social_links} is no
 * help and was never meant to be: {@code users} rows are never hard-deleted, which
 * is the whole point of anonymising rather than deleting.
 *
 * <p><strong>What survives:</strong> the row's identifier and timestamps, the
 * locale and currency (neither identifies anybody, and the currency is the unit
 * the retained financial rows are denominated in), the sessions themselves —
 * when they started and why they ended is a security record with no person left
 * in it — the hashes of refresh tokens, and every financial row that refers to
 * this identifier.
 *
 * <p>Separate from {@link AccountAnonymisationJob} for the same reason
 * {@code SessionRevoker} is separate: the transaction is per account, and a
 * self-invocation from the loop would not pass through the proxy, so the
 * annotation would be silently ignored and the whole batch would run in one
 * transaction — or in none.
 */
@Service
public class AccountAnonymiser {

    private static final Logger log = LoggerFactory.getLogger(AccountAnonymiser.class);

    private final UserRepository users;
    private final SocialLinkRepository socialLinks;
    private final AccountSecurity security;
    private final AccountPushRegistrations pushRegistrations;

    public AccountAnonymiser(
            UserRepository users,
            SocialLinkRepository socialLinks,
            AccountSecurity security,
            AccountPushRegistrations pushRegistrations) {
        this.users = users;
        this.socialLinks = socialLinks;
        this.security = security;
        this.pushRegistrations = pushRegistrations;
    }

    /**
     * Anonymises the account if its grace period has elapsed.
     *
     * <p>Idempotent, and safe when two instances call it at once: the row is
     * locked first, so the second caller waits, re-reads, finds
     * {@code anonymised_at} already set, and returns false. Everything inside
     * the transaction is also individually repeatable, so a crash halfway
     * leaves the account still due and the next run finishes the job.
     *
     * @return whether this call was the one that did the work
     */
    @Transactional
    public boolean anonymise(UUID userId, Instant now) {
        return users.findByIdForUpdate(userId)
                .filter(user -> user.isAnonymisationDue(now))
                .map(user -> {
                    user.anonymise(now);
                    // Written before the credentials are destroyed, and the
                    // order is not cosmetic: the statements behind forget() are
                    // bulk updates that clear the persistence context, which
                    // detaches this entity. Mutating it afterwards would leave
                    // the profile untouched, the job would report success, and
                    // the account would stay readable under its real name.
                    users.saveAndFlush(user);
                    // After the flush, for the reason above it: this is a bulk DELETE, and a
                    // bulk statement issued before the entity was written would be one more
                    // thing between the mutation and the row it has to reach. Repeatable on
                    // its own -- deleting nothing is what a second run does -- which is what
                    // keeps the whole method idempotent.
                    socialLinks.deleteByUserId(userId);
                    // Bulk as well, and repeatable for the same reason (#643). Usually nothing is
                    // left by now -- the deletion request already deleted them (#645) and a closing
                    // account cannot register again -- but an account closed before that change
                    // still has its rows, and this is what reaches them.
                    pushRegistrations.forgetAll(userId);
                    security.forget(userId);
                    log.info("Account {} anonymised.", userId);
                    return true;
                })
                .orElse(false);
    }
}
