package az.ideanest.user.application;

import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Slugs;
import az.ideanest.user.domain.User;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The user module's front door.
 *
 * <p>Every other module goes through here, and gets {@link UserAccount} back
 * rather than the entity. That is the module boundary in practice, and
 * {@code ModuleBoundaryTests} enforces it.
 */
@Service
public class UserAccounts {

    /**
     * How many numbered slugs to try before giving up on a readable one. Ten
     * people can be called Ismet; the eleventh gets a random suffix rather than
     * a query loop that grows with the popularity of a name.
     */
    private static final int SLUG_ATTEMPTS = 10;

    /** Leaves room for a suffix inside the sixty-character column limit. */
    private static final int SLUG_BASE_LIMIT = 50;

    /** The fallback when a name folds to nothing this can transliterate. */
    private static final String SLUG_FALLBACK = "user";

    private final UserRepository users;

    public UserAccounts(UserRepository users) {
        this.users = users;
    }

    /**
     * Creates an unverified account.
     *
     * <p>Callers are expected to have established that the address is free.
     * This does not check again, because the unique index is the check that
     * cannot lose a race — two simultaneous registrations both see a free
     * address, and one of them gets a constraint violation.
     */
    @Transactional
    public UserAccount register(EmailAddress email, String name, String locale, String currency) {
        User user = User.register(email, name, allocateSlug(name), locale, currency);
        return toAccount(users.save(user));
    }

    @Transactional(readOnly = true)
    public Optional<UserAccount> findByEmail(EmailAddress email) {
        return users.findByEmailAndDeletedAtIsNull(email).map(UserAccounts::toAccount);
    }

    @Transactional(readOnly = true)
    public Optional<UserAccount> findById(UUID id) {
        return users.findByIdAndDeletedAtIsNull(id).map(UserAccounts::toAccount);
    }

    /**
     * Several accounts at once, keyed by identifier.
     *
     * <p>For a caller holding a page of rows that each name an account — the moderation
     * submission queue is the first — where the alternative is {@link #findById} in a
     * loop and therefore one query per row on a screen whose whole purpose is a list.
     *
     * <p><strong>An identifier with no account is absent from the map rather than
     * mapped to null.</strong> Deleted and anonymised accounts both disappear here, and
     * a caller that cannot tell "no such account" from "a null name" would render one
     * as the other. Callers are expected to have something to say about a row whose
     * author is gone, because §17.4 leaves those rows behind on purpose.
     */
    @Transactional(readOnly = true)
    public Map<UUID, UserAccount> findAllById(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            // Spring Data would answer an empty list anyway; this saves the round trip
            // on the common case of a page with nothing in it.
            return Map.of();
        }
        Map<UUID, UserAccount> accounts = new LinkedHashMap<>();
        for (User user : users.findAllByIdInAndDeletedAtIsNull(ids)) {
            accounts.put(user.getId(), toAccount(user));
        }
        return accounts;
    }

    /**
     * The account behind a public profile path — §10.2's {@code /v1/users/{slug}}.
     *
     * <p>Added by #90, which is the first thing outside this module to address an
     * account by anything other than its identifier: following is done from a
     * creator's page, and that page is reached by slug. A closed account is not
     * found, exactly as it is not by {@link #findById} — following somebody who
     * has left would be a subscription to nothing that the sender then has to
     * skip on every launch.
     */
    @Transactional(readOnly = true)
    public Optional<UserAccount> findBySlug(String slug) {
        if (slug == null || slug.isBlank()) {
            return Optional.empty();
        }
        return users.findBySlugAndDeletedAtIsNull(slug).map(UserAccounts::toAccount);
    }

    /** Whether an address is spoken for, including by a closed account. */
    @Transactional(readOnly = true)
    public boolean isEmailTaken(EmailAddress email) {
        return users.existsByEmail(email);
    }

    /**
     * Records that the address has been proven. Doing nothing on a second call
     * is deliberate: a user clicking a link twice should see a verified
     * account, not an error.
     */
    @Transactional
    public void markEmailVerified(UUID userId, Instant at) {
        users.findByIdAndDeletedAtIsNull(userId).ifPresent(user -> user.markEmailVerified(at));
    }

    /**
     * P-10's language half: which of §21.1's four languages this account is written to
     * (#324).
     *
     * <p><strong>The value is not checked here, and that is the one thing worth saying
     * about this method.</strong> {@code LocaleRequest} refuses anything that is not one of
     * §21.1's four before the handler runs, and {@code users_locale_supported} refuses the
     * same four one layer down; a third check in the middle would be a third place for the
     * list to drift, and the one that falls behind is whichever is furthest from the
     * migration. What this does instead is go through the entity rather than issue an
     * UPDATE, so that the row is loaded, the check constraint sees the write, and a value
     * that somehow reached here without passing the first check fails as a constraint
     * violation on a known row rather than silently updating none.
     *
     * <p>Idempotent, like {@code PublicProfiles.setVisibility}: setting the language the
     * account already holds does nothing and reports success, so a retry after a dropped
     * connection leaves the account where the person put it.
     *
     * <p>No audit row. {@code AuditLog} records privileged actions taken over an account,
     * and this is its owner choosing the language of their own mail — reversible by the
     * person who made the change, in the same request they made it with.
     *
     * @throws AccountNotFoundException for a genuine token whose account is no longer
     *     there — deleted between issue and use. The same answer {@code setVisibility}
     *     gives for the same fact, and it becomes 404 rather than 401 at the edge: the
     *     token is ours and the account is not, so sending the client back to sign in
     *     again would be an instruction it cannot carry out
     */
    @Transactional
    public void setLocale(UUID accountId, String locale) {
        User account = users.findByIdAndDeletedAtIsNull(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
        account.setLocale(locale);
    }

    /**
     * §4.2's P-10, the currency half (#327): which currency this account reads amounts in.
     *
     * <p>Everything {@link #setLocale} says applies unchanged — the entity rather than an
     * UPDATE so the check constraint sees the write, idempotent so a retry is harmless, and
     * no audit row because this is somebody choosing how their own screen reads.
     *
     * <p><strong>What is NOT here is the question of whether the platform can honour it.</strong>
     * {@code users_currency_shape} accepts any three letters and this method accepts anything
     * that constraint does. Which currencies are actually offered is a property of the
     * deployment's rate source rather than of an account — a currency that was available last
     * week is not this week if the source stopped publishing it — so it is checked at the
     * edge, by {@code CurrencyPreferenceController}, against what {@code ExchangeRates} can
     * currently answer. Putting it here would make this module depend on a rate table to
     * store a three-letter code.
     */
    @Transactional
    public void setCurrency(UUID accountId, String currency) {
        User account = users.findByIdAndDeletedAtIsNull(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
        account.setCurrency(currency);
    }

    /**
     * §4.1's A-12 (#277): moves the account to an address that has just proved itself.
     *
     * <p><strong>The uniqueness check is here and it is not the one that decides.</strong>
     * Two accounts asking to move to one address is a race this cannot win by reading —
     * both see it free — and the unique index on {@code users.email} is what refuses the
     * second. What the check buys is the ordinary case: somebody who typed an address
     * that is already registered is told so by the endpoint that took the confirmation,
     * rather than by a constraint violation surfacing as a 500.
     *
     * <p>Answers {@code false} rather than throwing when the address is taken, because
     * the caller has more to say about it than this module does: it holds the request
     * row, and it is the one that has to decide whether the link is spent.
     *
     * @return whether the address moved
     */
    @Transactional
    public boolean changeEmail(UUID userId, EmailAddress newEmail, Instant at) {
        Optional<User> account = users.findByIdAndDeletedAtIsNull(userId);
        if (account.isEmpty()) {
            return false;
        }
        if (account.get().getEmail().equals(newEmail)) {
            // Already there. Not a failure — a second click on the same link, or a
            // change that was confirmed and then asked for again — and answering true
            // is what makes the confirmation endpoint idempotent in the way that
            // matters: the account ends up at the address the link named.
            return true;
        }
        if (users.existsByEmail(newEmail)) {
            return false;
        }
        account.get().changeEmail(newEmail, at);
        return true;
    }

    private String allocateSlug(String name) {
        String base = Slugs.slugify(name);
        if (base.length() < 3) {
            // Too short for the column's constraint, and unhelpful in a URL. A
            // name in a script we do not transliterate lands here.
            base = SLUG_FALLBACK;
        }
        if (base.length() > SLUG_BASE_LIMIT) {
            base = trimTrailingHyphen(base.substring(0, SLUG_BASE_LIMIT));
        }

        // A reserved word is never free: it is a route, not an address (Slugs.RESERVED).
        if (!Slugs.isReserved(base) && !users.existsBySlug(base)) {
            return base;
        }
        for (int suffix = 2; suffix <= SLUG_ATTEMPTS; suffix++) {
            String candidate = base + "-" + suffix;
            if (!users.existsBySlug(candidate)) {
                return candidate;
            }
        }
        // Past that, stop asking. This is still checked by the unique index, so
        // the pathological case is a retry, not a duplicate.
        return base + "-" + Long.toString(Math.abs(UUID.randomUUID().getMostSignificantBits()), 36);
    }

    private static String trimTrailingHyphen(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '-') {
            end--;
        }
        return value.substring(0, end);
    }

    static UserAccount toAccount(User user) {
        return new UserAccount(
                user.getId(),
                user.getEmail(),
                user.getName(),
                user.getSlug(),
                user.isEmailVerified(),
                user.getDeletionScheduledAt(),
                user.getSuspendedAt(),
                user.getLocale(),
                user.getCurrency());
    }
}
