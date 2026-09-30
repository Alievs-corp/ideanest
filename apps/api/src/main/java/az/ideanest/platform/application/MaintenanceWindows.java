package az.ideanest.platform.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.platform.PlatformProperties;
import az.ideanest.platform.application.MaintenanceWindowConflictException.Reason;
import az.ideanest.platform.domain.MaintenanceWindow;
import az.ideanest.platform.domain.MaintenanceWindow.State;
import az.ideanest.platform.infrastructure.MaintenanceWindowRepository;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.Patched;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.maintenance.ActiveMaintenance;
import az.ideanest.shared.maintenance.MaintenanceGate;
import az.ideanest.shared.maintenance.MaintenanceInProgressException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * When the platform is closed for maintenance — issue #214.
 *
 * <h2>Cached exactly as {@code FeatureFlags} is</h2>
 *
 * <p>Asked on every request by the servlet filter, on every poll of {@code GET
 * /v1/status}, and on every job tick. So: the windows that are in force or still to come,
 * held for {@link PlatformProperties.Flags#cacheTtl()} (ten seconds), refreshed on read,
 * and <strong>cleared on every edit</strong> — both when the edit is made and again when
 * it commits, so that a request that re-reads the table in between cannot put the old
 * answer back for another ten seconds. The delay between instances is therefore the
 * TTL at most, which is the acceptance criterion: a switch that takes minutes to reach
 * the other instances is not a switch.
 *
 * <p>What is cached is rows, not an answer. Whether a window is active or announced is
 * judged against the clock on every call, so a scheduled start takes effect on every
 * instance at its instant, not at the next refresh.
 *
 * <h2>Fail open</h2>
 *
 * <p>If the refresh cannot read the table, the previous snapshot is kept and retried a
 * TTL later. The filter asks this on every request, so a refresh that threw would turn a
 * database blip into every request failing — and a platform that cannot read its own
 * maintenance table is one the edge is about to answer for anyway.
 *
 * <h2>At most one window at a time</h2>
 *
 * <p>A window occupies its span from announcement to effective end, and no two spans may
 * overlap: two would give the status endpoint two answers and a reader two banners. The
 * check here gives a readable refusal; V91's exclusion constraint is what makes it hold
 * when two administrators schedule at once.
 */
@Service
public class MaintenanceWindows implements MaintenanceGate {

    private static final Logger log = LoggerFactory.getLogger(MaintenanceWindows.class);

    /** The issue's default: readers are told a day ahead. */
    static final Duration DEFAULT_NOTICE = Duration.ofHours(24);

    /**
     * How far in the past a start may be and still be read as "now". A form submitted a
     * few seconds after the minute it was filled in is not a mistake; a start an hour ago
     * is, and silently closing the platform because of it would be the worst reading.
     */
    static final Duration START_SKEW = Duration.ofSeconds(60);

    /** V91's bound on the internal note. */
    static final int MAX_NOTE = 2000;

    /** The console's history length. */
    static final int RECENT = 20;

    private final MaintenanceWindowRepository windows;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final PlatformProperties properties;

    /** One reference holding rows and read time together — {@code FeatureFlags} has why. */
    private final AtomicReference<Snapshot> snapshot = new AtomicReference<>(Snapshot.empty());

    public MaintenanceWindows(
            MaintenanceWindowRepository windows,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock,
            PlatformProperties properties) {
        this.windows = windows;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.properties = properties;
    }

    // ------------------------------------------------------------------
    // Reads, from the snapshot
    // ------------------------------------------------------------------

    @Override
    public Optional<ActiveMaintenance> active() {
        return activeWindow().map(window -> new ActiveMaintenance(window.startsAt(), window.endsAt()));
    }

    @Override
    public void admitSession(UUID accountId) {
        Optional<ActiveMaintenance> window = active();
        if (window.isEmpty()) {
            return;
        }
        boolean isStaff;
        try {
            isStaff = staff.isStaff(accountId);
        } catch (RuntimeException e) {
            // Fail closed here, unlike the snapshot: the question is whether to hand a
            // session to somebody while the platform is shut, and "could not tell" is not
            // "yes".
            log.warn("Could not tell whether {} is staff during maintenance; refusing the session.", accountId, e);
            isStaff = false;
        }
        if (!isStaff) {
            throw new MaintenanceInProgressException(window.get(), window.get().retryAfterSeconds(now()));
        }
    }

    /** What {@code GET /v1/status} reports: the window in force and the one announced. */
    public Status status() {
        Instant now = now();
        List<MaintenanceWindow> live = current(now).live();
        return new Status(
                live.stream().filter(window -> window.isActiveAt(now)).findFirst(),
                live.stream().filter(window -> window.isAnnouncedAt(now)).findFirst());
    }

    /**
     * @param active in force now, if any
     * @param upcoming announced and not yet started, if any. Both can be present only for
     *     the instant a window ends as the next one's announcement begins
     */
    public record Status(Optional<MaintenanceWindow> active, Optional<MaintenanceWindow> upcoming) {
    }

    private Optional<MaintenanceWindow> activeWindow() {
        Instant now = now();
        return current(now).live().stream().filter(window -> window.isActiveAt(now)).findFirst();
    }

    // ------------------------------------------------------------------
    // The console
    // ------------------------------------------------------------------

    /**
     * @param current in force now
     * @param upcoming every window still to come, announced or not, soonest first
     * @param recent the last twenty by start, in any state
     */
    public record Overview(
            Optional<MaintenanceWindow> current, List<MaintenanceWindow> upcoming, List<MaintenanceWindow> recent) {
    }

    @Transactional(readOnly = true)
    public Overview overview(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        Instant now = now();
        // The table rather than the snapshot: the console is where an operator checks
        // that an edit took, and a screen up to ten seconds behind would say it did not.
        List<MaintenanceWindow> live = windows.live(now);
        return new Overview(
                live.stream().filter(window -> window.isActiveAt(now)).findFirst(),
                live.stream()
                        .filter(window -> window.stateAt(now) == State.SCHEDULED
                                || window.stateAt(now) == State.ANNOUNCED)
                        .toList(),
                windows.recent(PageRequest.ofSize(RECENT)));
    }

    /**
     * Schedules a window.
     *
     * @param startsAt when the platform closes. A start up to a minute in the past is
     *     read as now; earlier is refused
     * @param endsAt when it reopens, or null for "until further notice"
     * @param announceFrom when readers start being told, or null for a day before the
     *     start. Never set in the past: a window scheduled now is announced from now
     */
    @Transactional
    public MaintenanceWindow schedule(
            UUID staffId, Instant startsAt, Instant endsAt, Instant announceFrom, String note) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        Instant now = now();

        if (startsAt == null) {
            throw new InvalidMaintenanceWindowException("A window needs a start.");
        }
        if (startsAt.isBefore(now.minus(START_SKEW))) {
            throw new InvalidMaintenanceWindowException("A window cannot start in the past.");
        }
        Instant start = latest(truncate(startsAt), now);
        Instant end = endsAt == null ? null : truncate(endsAt);
        if (end != null && !end.isAfter(start)) {
            throw new InvalidMaintenanceWindowException("A window has to end after it starts.");
        }
        Instant announce = announceFrom == null ? start.minus(DEFAULT_NOTICE) : truncate(announceFrom);
        if (announce.isAfter(start)) {
            throw new InvalidMaintenanceWindowException("A window cannot be announced after it starts.");
        }
        announce = latest(announce, now);

        MaintenanceWindow window = new MaintenanceWindow(
                Identifiers.newIdentifier(), start, end, announce, normalise(note), staffId, now);
        refuseOverlap(window, windows.live(now));
        MaintenanceWindow saved = save(window);

        audit.record(
                AuditAction.MAINTENANCE_WINDOW_SCHEDULED,
                saved.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "before: none; after: " + saved.describe());
        log.info("Maintenance window {} scheduled by {} for {} to {}", saved.id(), staffId, start, end);
        return saved;
    }

    /** Closes the platform now with a window that was scheduled for later. */
    @Transactional
    public MaintenanceWindow startNow(UUID staffId, UUID windowId) {
        return edit(staffId, windowId, AuditAction.MAINTENANCE_WINDOW_STARTED, (window, now) -> {
            requireNotStarted(window, now);
            window.startAt(now);
        });
    }

    /** Reopens the platform now, before the window's announced end. */
    @Transactional
    public MaintenanceWindow endNow(UUID staffId, UUID windowId) {
        return edit(staffId, windowId, AuditAction.MAINTENANCE_WINDOW_ENDED, (window, now) -> {
            if (window.stateAt(now) != State.ACTIVE) {
                throw new MaintenanceWindowConflictException(
                        Reason.MAINTENANCE_WINDOW_NOT_ACTIVE, "Only a window that is in force can be ended.");
            }
            window.endAt(now);
        });
    }

    /**
     * Moves the end, or edits the note, of a window that is not over.
     *
     * @param endsAt absent to leave it; null for "until further notice"
     * @param note absent to leave it; null or blank to clear it
     */
    @Transactional
    public MaintenanceWindow change(UUID staffId, UUID windowId, Patched<Instant> endsAt, Patched<String> note) {
        return edit(staffId, windowId, AuditAction.MAINTENANCE_WINDOW_CHANGED, (window, now) -> {
            State state = window.stateAt(now);
            if (state == State.ENDED || state == State.CANCELLED) {
                throw new MaintenanceWindowConflictException(
                        Reason.MAINTENANCE_WINDOW_OVER, "A window that is over is not edited.");
            }
            if (endsAt.isPresent()) {
                Instant end = endsAt.value() == null ? null : truncate(endsAt.value());
                if (end != null && !end.isAfter(latest(window.startsAt(), now))) {
                    // Past the start, and past now: an end moved into the past would end
                    // the window by accident. End now is the verb for that.
                    throw new InvalidMaintenanceWindowException(
                            "The end has to be after the start and in the future. Use end now to end it.");
                }
                window.changeEnd(end);
            }
            note.ifPresent(value -> {
                String normalised = normalise(value);
                if (normalised != null && normalised.length() > MAX_NOTE) {
                    throw new InvalidMaintenanceWindowException("A note is at most 2000 characters.");
                }
                window.changeNote(normalised);
            });
        });
    }

    /** Calls off a window that has not started. */
    @Transactional
    public MaintenanceWindow cancel(UUID staffId, UUID windowId) {
        return edit(staffId, windowId, AuditAction.MAINTENANCE_WINDOW_CANCELLED, (window, now) -> {
            requireNotStarted(window, now);
            window.cancelAt(now);
        });
    }

    /**
     * Forgets the snapshot, so the next read goes to the table.
     *
     * <p>Every edit calls this. Public so that a test which writes rows directly can too.
     */
    public void invalidate() {
        snapshot.set(Snapshot.empty());
    }

    // ------------------------------------------------------------------

    private interface Edit {
        void apply(MaintenanceWindow window, Instant now);
    }

    private MaintenanceWindow edit(UUID staffId, UUID windowId, AuditAction action, Edit edit) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        Instant now = now();

        MaintenanceWindow window =
                windows.findById(windowId).orElseThrow(() -> new MaintenanceWindowNotFoundException(windowId));
        String before = window.describe();
        // Read before the edit is applied: a query after it would flush the change first,
        // and an overlap would then surface as a constraint violation from the read rather
        // than as the refusal below.
        List<MaintenanceWindow> live = windows.live(now);

        edit.apply(window, now);
        refuseOverlap(window, live);
        MaintenanceWindow saved = save(window);

        audit.record(
                action,
                saved.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "before: " + before + "; after: " + saved.describe());
        log.info("Maintenance window {}: {} by {}", saved.id(), action.action(), staffId);
        return saved;
    }

    private static void requireNotStarted(MaintenanceWindow window, Instant now) {
        State state = window.stateAt(now);
        if (state == State.ENDED || state == State.CANCELLED) {
            throw new MaintenanceWindowConflictException(Reason.MAINTENANCE_WINDOW_OVER, "This window is over.");
        }
        if (state == State.ACTIVE) {
            throw new MaintenanceWindowConflictException(
                    Reason.MAINTENANCE_WINDOW_ALREADY_STARTED, "This window has already started.");
        }
    }

    private static void refuseOverlap(MaintenanceWindow window, List<MaintenanceWindow> live) {
        boolean overlaps = live.stream()
                .filter(other -> !other.id().equals(window.id()))
                .anyMatch(window::overlaps);
        if (overlaps) {
            throw overlap();
        }
    }

    private static MaintenanceWindowConflictException overlap() {
        return new MaintenanceWindowConflictException(
                Reason.MAINTENANCE_WINDOW_OVERLAPS,
                "Another maintenance window is active or announced for part of that time.");
    }

    /**
     * Flushed, so that V91's exclusion constraint answers here as the same 409 the check
     * above gives — the race it exists for is two instances passing that check at once.
     */
    private MaintenanceWindow save(MaintenanceWindow window) {
        MaintenanceWindow saved;
        try {
            saved = windows.saveAndFlush(window);
        } catch (DataIntegrityViolationException e) {
            if (String.valueOf(e.getMostSpecificCause().getMessage()).contains("maintenance_windows_no_overlap")
                    || String.valueOf(e.getMessage()).contains("maintenance_windows_no_overlap")) {
                throw overlap();
            }
            throw e;
        }
        forgetOnCommit();
        return saved;
    }

    /** Now, and once more when the transaction commits — see the class comment on why both. */
    private void forgetOnCommit() {
        invalidate();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    invalidate();
                }
            });
        }
    }

    private Snapshot current(Instant now) {
        Snapshot held = snapshot.get();

        if (held.readAt() != null && held.readAt().plus(properties.flags().cacheTtl()).isAfter(now)) {
            return held;
        }

        List<MaintenanceWindow> live;
        try {
            live = List.copyOf(windows.live(now));
        } catch (RuntimeException e) {
            log.warn("Could not read maintenance windows; keeping the previous answer for another interval.", e);
            live = held.live();
        }

        Snapshot fresh = new Snapshot(live, now);
        snapshot.compareAndSet(held, fresh);
        return fresh;
    }

    private Instant now() {
        return truncate(clock.instant());
    }

    /** At the resolution PostgreSQL stores, so a value read back equals the one written. */
    private static Instant truncate(Instant instant) {
        return instant.truncatedTo(ChronoUnit.MICROS);
    }

    private static Instant latest(Instant a, Instant b) {
        return a.isAfter(b) ? a : b;
    }

    private static String normalise(String note) {
        return note == null || note.isBlank() ? null : note.strip();
    }

    /** @param readAt null on the empty snapshot — {@code FeatureFlags} has why */
    private record Snapshot(List<MaintenanceWindow> live, Instant readAt) {

        static Snapshot empty() {
            return new Snapshot(List.of(), null);
        }
    }
}
