package az.ideanest.platform.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.platform.PlatformProperties;
import az.ideanest.platform.application.FeatureFlagRefusedException.Reason;
import az.ideanest.platform.domain.FeatureFlag;
import az.ideanest.platform.infrastructure.FeatureFlagRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What is switched on, for whom — §4.11's AD-12, issue #312.
 *
 * <h2>Why this one caches and {@code StaffDirectory} does not</h2>
 *
 * <p>{@code StaffDirectory} queries on every call, and its comment explains that a role
 * withdrawn has to stop working on the next request rather than on the next restart. The
 * same reasoning gives the opposite answer here, because the two are asked at different
 * rates and cost different things when stale.
 *
 * <p>A capability is checked once per privileged request — a few hundred a day — and the
 * cost of a stale answer is that somebody keeps an authority they should have lost. A
 * flag is checked on every page render on the platform, and the cost of a stale answer is
 * that a feature appears a few seconds late.
 *
 * <p>So: the whole table, held for {@link PlatformProperties.Flags#cacheTtl()}, refreshed
 * on read. Tens of rows. <strong>An edit clears it immediately</strong>, so the delay is
 * only ever between one instance and another, and only for as long as the window — which
 * matters because the thing an operator reaches for during an incident is
 * {@code enabled = false}, and a switch that takes a minute is not a kill switch.
 *
 * <h2>Nothing reads a flag yet</h2>
 *
 * <p>{@link #isOn} and {@link #evaluateAll} are what a feature asks, and
 * {@code GET /v1/feature-flags} is how a client asks the second one. No product feature is
 * behind a flag today, so switching one changes the answer the platform gives and nothing
 * else; the console says exactly that. The day a feature reads one, the switch is a kill
 * switch for it within {@link PlatformProperties.Flags#cacheTtl()}.
 *
 * <h2>An unknown flag is off</h2>
 *
 * <p>{@link #isOn} answers false for a key with no row. Fail-closed, for the reason every
 * default on this platform is: a feature that switches itself on because somebody forgot
 * to insert a row is a feature nobody decided to ship.
 */
@Service
public class FeatureFlags {

    private static final Logger log = LoggerFactory.getLogger(FeatureFlags.class);

    private final FeatureFlagRepository flags;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final PlatformProperties properties;

    /**
     * The cached table and when it was read.
     *
     * <p>One {@link AtomicReference} holding both, rather than two fields: a reader must
     * never see a fresh timestamp beside a stale map, which is exactly what two
     * independently updated fields would eventually produce.
     */
    private final AtomicReference<Snapshot> snapshot = new AtomicReference<>(Snapshot.empty());

    public FeatureFlags(
            FeatureFlagRepository flags,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock,
            PlatformProperties properties) {
        this.flags = flags;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.properties = properties;
    }

    /**
     * Whether this account sees the feature.
     *
     * @param accountId the signed-in account, or null for a visitor. A visitor sees a
     *     partial rollout only when it has reached everybody — {@code FeatureFlag.isOnFor}
     *     has why
     */
    public boolean isOn(String key, UUID accountId) {
        FeatureFlag flag = current().flags().get(key);
        return flag != null && flag.isOnFor(accountId);
    }

    /**
     * Every flag and whether this account sees it, for a client that asks once per page.
     *
     * <p>Sorted by name, so that two answers with the same content are the same bytes and
     * a cached copy is recognisably the same one.
     */
    public Map<String, Boolean> evaluateAll(UUID accountId) {
        return current().flags().values().stream()
                .collect(Collectors.toMap(
                        FeatureFlag::key, flag -> flag.isOnFor(accountId), (a, b) -> a, TreeMap::new));
    }

    /** AD-12's screen. */
    @Transactional(readOnly = true)
    public List<FeatureFlag> list(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        return flags.allFlags();
    }

    /**
     * Creates a flag, or replaces everything about one, from the version the caller read.
     *
     * <p><strong>One endpoint for both, and the version says which.</strong> No version is a
     * create, and a create of a name that exists is refused with {@code FEATURE_FLAG_EXISTS}
     * rather than applied. The console's "add a flag" form used to send a disabled flag at
     * nought percent for whatever name was typed, and this method used to apply it to an
     * existing row — so typing a live flag's name into the form switched it off for
     * everybody, with no question asked and nothing on the screen to say it had happened.
     *
     * <p>A version is an edit of that version. An edit made from a list somebody else has
     * since saved over is refused with {@code FEATURE_FLAG_CHANGED}, checked twice: once
     * against the row as read, which is the ordinary case of a stale screen, and once by
     * V111's column when the row is written, which catches two saves in the same instant.
     *
     * <p>The cache is cleared inside the transaction rather than after it commits, which
     * is technically early — a rollback would leave this instance re-reading a table that
     * did not change, which costs one query. The alternative is an after-commit hook that
     * can be skipped, and a switch that sometimes does not take effect is worse than one
     * that sometimes clears its cache for nothing.
     *
     * @param version the version the caller read, or null to create the flag
     */
    @Transactional
    public FeatureFlag save(
            UUID staffId,
            String key,
            String description,
            boolean enabled,
            short rolloutPercentage,
            List<UUID> enabledAccounts,
            Long version) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        if (key == null || !FeatureFlag.KEY_SHAPE.matcher(key).matches()) {
            throw new FeatureFlagRefusedException(
                    Reason.FEATURE_FLAG_KEY_INVALID, "A flag's name is lower case letters, digits and hyphens.");
        }
        Instant now = clock.instant();
        String text = description.strip();

        Optional<FeatureFlag> existing = flags.findById(key);
        FeatureFlag flag;
        String before;
        List<UUID> accountsBefore;
        if (version == null) {
            if (existing.isPresent()) {
                throw new FeatureFlagRefusedException(Reason.FEATURE_FLAG_EXISTS, "A flag named " + key + " exists.");
            }
            flag = new FeatureFlag(key, text, enabled, rolloutPercentage, enabledAccounts, staffId, now);
            before = "none";
            accountsBefore = List.of();
        } else {
            flag = existing.orElseThrow(() -> new FeatureFlagRefusedException(
                    Reason.FEATURE_FLAG_NOT_FOUND, "There is no flag named " + key + "."));
            if (flag.version() != version) {
                throw changed(key);
            }
            before = flag.describe();
            accountsBefore = flag.enabledAccounts();
            flag.update(text, enabled, rolloutPercentage, enabledAccounts, staffId, now);
        }

        FeatureFlag saved;
        try {
            // Flushed here rather than at commit, so that a collision is answered as one —
            // a key violation or a stale version — instead of surfacing from the commit as
            // a 500 after this method has returned.
            saved = flags.saveAndFlush(flag);
        } catch (OptimisticLockingFailureException concurrent) {
            throw changed(key);
        } catch (DataIntegrityViolationException duplicate) {
            if (version == null) {
                throw new FeatureFlagRefusedException(Reason.FEATURE_FLAG_EXISTS, "A flag named " + key + " exists.");
            }
            throw duplicate;
        }
        snapshot.set(Snapshot.empty());

        List<UUID> added = FeatureFlag.added(accountsBefore, saved.enabledAccounts());
        List<UUID> removed = FeatureFlag.added(saved.enabledAccounts(), accountsBefore);
        audit.record(
                AuditAction.FEATURE_FLAG_CHANGED,
                // The entity is a UUID everywhere in audit_logs and a flag's identity is
                // its name, so the name is hashed into a stable identifier rather than a
                // random one — two edits to one flag are then a history rather than two
                // unrelated rows. The name itself is in the detail, where it is readable.
                UUID.nameUUIDFromBytes(key.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "key=%s; before: %s; after: %s; accounts added=%s; accounts removed=%s"
                        .formatted(key, before, saved.describe(), added, removed));

        log.info("Feature flag {} set by {} (enabled={}, rollout={})", key, staffId, enabled, rolloutPercentage);
        return saved;
    }

    private static FeatureFlagRefusedException changed(String key) {
        return new FeatureFlagRefusedException(
                Reason.FEATURE_FLAG_CHANGED, "Flag " + key + " was changed by somebody else after it was read.");
    }

    private Snapshot current() {
        Snapshot held = snapshot.get();
        Instant now = clock.instant();

        if (held.readAt() != null && held.readAt().plus(properties.flags().cacheTtl()).isAfter(now)) {
            return held;
        }

        Snapshot fresh = new Snapshot(
                flags.allFlags().stream().collect(Collectors.toMap(FeatureFlag::key, Function.identity())), now);

        // compareAndSet rather than set: two threads finding the cache stale at once both
        // read, and the loser's result is as good as the winner's — but overwriting a
        // *newer* snapshot with an older one would move the cache backwards in time.
        snapshot.compareAndSet(held, fresh);
        return fresh;
    }

    /**
     * The table as it was at an instant.
     *
     * @param readAt null on the empty snapshot, which is what "nothing is cached" means.
     *     A zero instant would be an instant, and would then be compared against the TTL
     *     as though a read had happened at the beginning of the epoch
     */
    private record Snapshot(Map<String, FeatureFlag> flags, Instant readAt) {

        static Snapshot empty() {
            return new Snapshot(Map.of(), null);
        }
    }
}
