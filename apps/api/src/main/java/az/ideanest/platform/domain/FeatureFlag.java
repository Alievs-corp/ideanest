package az.ideanest.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One switch — V50's row, issue #312.
 *
 * <p><strong>The evaluation lives here rather than in the service</strong>, which is
 * unusual for this codebase and is the right place for exactly one reason: it has to be
 * the same function every time. A rollout percentage is only stable if the same account
 * always lands on the same side of it, and a hash computed in two places is a hash that
 * eventually differs — at which point somebody who saw the feature yesterday does not
 * today, for no reason anybody can find.
 *
 * <p>{@code enabledAccounts} is a PostgreSQL array rather than a join table. V50's header
 * has the argument: the list is read in full on every evaluation, never queried from the
 * other direction, and rewritten whole by the screen that edits it.
 */
@Entity
@Table(name = "feature_flags")
public class FeatureFlag {

    /**
     * What V50's {@code feature_flags_key_shape} accepts, checked before the row is written.
     *
     * <p>A name the {@code CHECK} refuses used to reach the database and come back as a 500.
     * It is the caller's mistake, and it is answered as one.
     */
    public static final Pattern KEY_SHAPE = Pattern.compile("^[a-z][a-z0-9-]{1,62}[a-z0-9]$");

    /** How much of a description an audit row repeats. The whole text is on the flag. */
    private static final int DESCRIBED_DESCRIPTION = 160;

    @Id
    @Column(name = "key", nullable = false, updatable = false)
    private String key;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "rollout_percentage", nullable = false)
    private short rolloutPercentage;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "enabled_accounts", nullable = false)
    private UUID[] enabledAccounts;

    /**
     * When the flag was last saved.
     *
     * <p>Written from the service's clock on every save. It used to be read-only to
     * Hibernate and filled by V50's {@code DEFAULT now()} on insert, and nothing changed it
     * after that: the console said "last changed" beside the day a flag was created.
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false)
    private UUID updatedBy;

    /**
     * V110's version, which a save has to name — see {@code FeatureFlags.save}.
     *
     * <p>A wrapper rather than a primitive so that a flag nobody has saved yet is new to
     * Spring Data: with a primitive it would be merged, which reads before it writes and
     * turns a duplicate name into a quiet overwrite rather than a key violation.
     */
    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    protected FeatureFlag() {
        // Hibernate.
    }

    public FeatureFlag(
            String key,
            String description,
            boolean enabled,
            short rolloutPercentage,
            List<UUID> enabledAccounts,
            UUID updatedBy,
            Instant updatedAt) {

        this.key = Objects.requireNonNull(key, "key");
        this.description = Objects.requireNonNull(description, "description");
        this.enabled = enabled;
        this.rolloutPercentage = rolloutPercentage;
        this.enabledAccounts = distinct(enabledAccounts);
        this.updatedBy = Objects.requireNonNull(updatedBy, "updatedBy");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt");
    }

    /**
     * Replaces everything about the flag except its name.
     *
     * <p>One method rather than a setter per column, so that an edit is one statement and
     * one audit row. A screen that could change the percentage without saying who did it
     * is a screen whose changes cannot be reviewed.
     */
    public void update(
            String description,
            boolean enabled,
            short rolloutPercentage,
            List<UUID> enabledAccounts,
            UUID by,
            Instant at) {

        this.description = Objects.requireNonNull(description, "description");
        this.enabled = enabled;
        this.rolloutPercentage = rolloutPercentage;
        this.enabledAccounts = distinct(enabledAccounts);
        this.updatedBy = Objects.requireNonNull(by, "by");
        this.updatedAt = Objects.requireNonNull(at, "at");
    }

    /**
     * The list as it is stored: each account once, in the order first given.
     *
     * <p>The screen adds accounts one at a time, and a repeated one is a mistake rather than
     * an intention. Kept, it would count twice against V50's bound of two hundred and be
     * compared twice on every evaluation. A null is refused here as well as by the request's
     * validation, because {@link #isOnFor} compares every entry and would throw on one.
     */
    private static UUID[] distinct(List<UUID> accounts) {
        Set<UUID> seen = new LinkedHashSet<>();
        for (UUID account : accounts) {
            seen.add(Objects.requireNonNull(account, "enabledAccounts entry"));
        }
        return seen.toArray(UUID[]::new);
    }

    /**
     * Whether this account sees the feature.
     *
     * <p><strong>{@code enabled} is checked first and it is a kill switch.</strong> An
     * account on the explicit list does not see a disabled flag — "I turned it off and it
     * is still on for some people" is the worst possible property of a switch somebody
     * reaches for during an incident, and V50's header says the same thing about the
     * column.
     *
     * <p>The percentage is decided by hashing the pair rather than by sampling a set.
     * Hashing is stable, so widening a rollout only ever adds people; a stored sample has
     * to be recomputed when the percentage moves, and every recomputation takes the
     * feature away from somebody who had it.
     *
     * <p>The bucket is the first four bytes of SHA-256 over {@code key:accountId}. It used
     * to be {@code 31 * key.hashCode() + accountId.hashCode()}, which put every account in
     * the same place relative to every flag, give or take a shift: the tenth of accounts
     * inside one ten-percent rollout were very nearly the tenth inside every other, so one
     * group of people saw every experiment and the rest saw none. A digest of the pair has
     * no such correlation, and it is specified, so it cannot move on a JDK upgrade.
     */
    public boolean isOnFor(UUID accountId) {
        if (!enabled) {
            return false;
        }
        if (rolloutPercentage >= 100) {
            return true;
        }
        if (accountId == null) {
            // A signed-out visitor has no stable identity to hash, and inventing one from
            // the request would make the flag flicker between page loads. They get the
            // feature only when it is on for everybody.
            return false;
        }
        for (UUID enabledAccount : enabledAccounts) {
            if (enabledAccount.equals(accountId)) {
                return true;
            }
        }
        if (rolloutPercentage <= 0) {
            return false;
        }

        return bucket(key, accountId) < rolloutPercentage;
    }

    /** Where an account falls for a flag, nought to ninety-nine. Stable for the pair. */
    public static int bucket(String key, UUID accountId) {
        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            // Every Java platform is required to provide SHA-256.
            throw new IllegalStateException(impossible);
        }
        byte[] digest = sha256.digest((key + ":" + accountId).getBytes(StandardCharsets.UTF_8));
        long unsigned = Integer.toUnsignedLong(ByteBuffer.wrap(digest, 0, Integer.BYTES).getInt());
        return (int) (unsigned % 100);
    }

    /**
     * The flag in one line, for an audit row's before and after.
     *
     * <p>The description is shortened and the accounts are counted rather than listed: an
     * audit row is bounded, and the two hundred identifiers a flag may hold would push the
     * rest of the line off its end. {@code FeatureFlags.save} names the accounts that came
     * and went, which is the part of the list a reviewer is asking about.
     */
    public String describe() {
        String text = description.length() > DESCRIBED_DESCRIPTION
                ? description.substring(0, DESCRIBED_DESCRIPTION) + "..."
                : description;
        return "enabled=%s, rollout=%d, accounts=%d, description=\"%s\""
                .formatted(enabled, rolloutPercentage, enabledAccounts.length, text);
    }

    /** The accounts in {@code after} that are not in {@code before}, in {@code after}'s order. */
    public static List<UUID> added(List<UUID> before, List<UUID> after) {
        Set<UUID> had = Set.copyOf(before);
        List<UUID> added = new ArrayList<>();
        for (UUID account : after) {
            if (!had.contains(account)) {
                added.add(account);
            }
        }
        return added;
    }

    public String key() {
        return key;
    }

    public String description() {
        return description;
    }

    public boolean enabled() {
        return enabled;
    }

    public short rolloutPercentage() {
        return rolloutPercentage;
    }

    public List<UUID> enabledAccounts() {
        return List.of(enabledAccounts);
    }

    public Instant updatedAt() {
        return updatedAt;
    }

    public UUID updatedBy() {
        return updatedBy;
    }

    /** The version this row was read at. Zero for a row saved before V110. */
    public long version() {
        return version == null ? 0L : version;
    }
}
