package az.ideanest.dashboard.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.dashboard.DashboardSection;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Assembles the console's front page from whatever sections the modules publish — #222.
 *
 * <h2>The caller's capabilities decide what exists</h2>
 *
 * <p>A section is read only for a caller who holds at least one capability it requires, and is
 * absent otherwise. That is decided here, on the server, from the account's roles. The request
 * has two parameters, a first and a last day, and nothing that could widen the answer. A
 * partner holds none of the capabilities any section requires, so the page is empty for them and
 * their landing is their own statistics screen; no real platform figure can reach them through
 * here.
 *
 * <h2>One failing card does not blank the page</h2>
 *
 * <p>Each section is read on its own and a failure is caught and served as {@code UNAVAILABLE}
 * with the others untouched. This method opens <strong>no transaction of its own</strong>, and
 * that is deliberate: PostgreSQL aborts a transaction on the first SQL error, so one section's
 * failure inside a shared transaction would make every section after it fail too. Each section
 * runs in its own.
 *
 * <h2>Read, therefore audited</h2>
 *
 * <p>Every read is recorded with the window and which sections were served or failed, so "who
 * has been looking at the platform's figures" is answerable. Written independently: there is no
 * write to be atomic with.
 */
@Service
public class DashboardService {

    private static final Logger log = LoggerFactory.getLogger(DashboardService.class);

    /** Baku, where the bank statement a figure is checked against is dated. */
    public static final ZoneId ZONE = ZoneId.of("Asia/Baku");

    /** What a request that names no window gets: a month, as {@code /admin/analytics} opens on. */
    static final int DEFAULT_WINDOW_DAYS = 30;

    /** The longest window: a year, for {@link InvalidDashboardRangeException}'s reason. */
    static final int MAX_WINDOW_DAYS = 366;

    private final List<DashboardSection> sections;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public DashboardService(List<DashboardSection> sections, PlatformStaff staff, AuditLog audit, Clock clock) {
        // Fail at start-up, not on somebody's first visit: a section with no requirement would be
        // shown to every member of staff including a partner, and two sections with one key would
        // overwrite each other on the page.
        Set<String> keys = new HashSet<>();
        for (DashboardSection section : sections) {
            if (section.requiresAny().isEmpty()) {
                throw new IllegalStateException(
                        "Dashboard section '" + section.key() + "' requires no capability, so it would be shown to everybody");
            }
            if (!keys.add(section.key())) {
                throw new IllegalStateException("Two dashboard sections are called '" + section.key() + "'");
            }
        }
        this.sections = sections.stream().sorted(Comparator.comparingInt(DashboardSection::order)).toList();
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * The front page for {@code staffId} over a window.
     *
     * @param from the first day, inclusive. Absent means thirty days back from {@code to}
     * @param to the last day, inclusive. Absent means today in Baku
     * @throws InvalidDashboardRangeException when the window runs backwards or is longer than a year
     */
    public Dashboard read(UUID staffId, LocalDate from, LocalDate to) {
        staff.requireStaff(staffId);

        LocalDate end = to == null ? LocalDate.ofInstant(clock.instant(), ZONE) : to;
        LocalDate start = from == null ? end.minusDays(DEFAULT_WINDOW_DAYS - 1L) : from;
        if (start.isAfter(end)) {
            throw new InvalidDashboardRangeException("A reporting window does not run backwards");
        }
        if (ChronoUnit.DAYS.between(start, end) >= MAX_WINDOW_DAYS) {
            throw new InvalidDashboardRangeException("A reporting window covers at most " + MAX_WINDOW_DAYS + " days");
        }
        DashboardSection.Window window = new DashboardSection.Window(start, end, ZONE);

        Set<StaffCapability> held = staff.capabilitiesOf(staffId);
        List<Dashboard.Served> served = new ArrayList<>();
        List<String> failed = new ArrayList<>();
        for (DashboardSection section : sections) {
            if (Collections.disjoint(section.requiresAny(), held)) {
                continue;
            }
            try {
                served.add(Dashboard.Served.ready(section.key(), section.read(staffId, window)));
            } catch (RuntimeException failure) {
                // One card failing is a card that says so, not a page that does not load.
                log.warn("Dashboard section {} could not be read", section.key(), failure);
                served.add(Dashboard.Served.unavailable(section.key()));
                failed.add(section.key());
            }
        }

        audit.recordIndependently(
                AuditAction.DASHBOARD_READ,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "window=%s/%s; sections=%s; unavailable=%s"
                        .formatted(start, end, served.stream().map(Dashboard.Served::key).toList(), failed));

        Instant computedAt = clock.instant();
        return new Dashboard(start, end, computedAt, ZONE.getId(), served);
    }
}
