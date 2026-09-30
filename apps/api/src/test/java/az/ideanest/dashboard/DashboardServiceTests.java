package az.ideanest.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditLog;
import az.ideanest.dashboard.application.Dashboard;
import az.ideanest.dashboard.application.DashboardService;
import az.ideanest.dashboard.application.InvalidDashboardRangeException;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.dashboard.DashboardSection;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * How the front page is assembled — #222.
 *
 * <p>A plain unit test. None of this is about persistence: it is about which sections a caller is
 * handed, in what order, and what happens when one of them breaks. The sections themselves are
 * fakes, which is the point of the published {@link DashboardSection}: the assembly can be tested
 * without a single one of the modules that contribute to it.
 */
class DashboardServiceTests {

    private static final UUID STAFF = UUID.randomUUID();
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2050-06-15T10:00:00Z"), ZoneOffset.UTC);

    private final PlatformStaff staff = mock(PlatformStaff.class);
    private final AuditLog audit = mock(AuditLog.class);

    private DashboardService service(DashboardSection... sections) {
        return new DashboardService(List.of(sections), staff, audit, CLOCK);
    }

    private void holds(StaffCapability... capabilities) {
        when(staff.capabilitiesOf(STAFF)).thenReturn(Set.of(capabilities));
    }

    @Test
    @DisplayName("a section is served only to a caller who holds one of its capabilities")
    void sectionsAreGatedByCapability() {
        holds(StaffCapability.MODERATE_CONTENT);

        Dashboard page = service(
                        fake("money", 10, Set.of(StaffCapability.VIEW_FINANCE)),
                        fake("queue", 20, Set.of(StaffCapability.MODERATE_CONTENT)))
                .read(STAFF, null, null);

        // The money is absent, not present and empty: a moderator's page has no revenue on it.
        assertThat(page.sections()).extracting(Dashboard.Served::key).containsExactly("queue");
    }

    @Test
    @DisplayName("holding any one of a section's capabilities is enough")
    void anyOneCapabilitySuffices() {
        holds(StaffCapability.MANAGE_DISPUTES);

        Dashboard page = service(fake(
                        "disputes", 10, Set.of(StaffCapability.VIEW_FINANCE, StaffCapability.MANAGE_DISPUTES)))
                .read(STAFF, null, null);

        assertThat(page.sections()).extracting(Dashboard.Served::key).containsExactly("disputes");
    }

    @Test
    @DisplayName("a member of staff who holds none of them gets an empty page, not an error")
    void noCapabilityMeansAnEmptyPage() {
        holds(StaffCapability.VIEW_PARTNER_STATISTICS);

        Dashboard page = service(
                        fake("money", 10, Set.of(StaffCapability.VIEW_FINANCE)),
                        fake("queue", 20, Set.of(StaffCapability.MODERATE_CONTENT)))
                .read(STAFF, null, null);

        // The case a partner is: staff, holding one capability, none of which any section wants.
        assertThat(page.sections()).isEmpty();
    }

    @Test
    @DisplayName("sections come back in page order whatever order the container listed them in")
    void sectionsAreOrdered() {
        holds(StaffCapability.VIEW_FINANCE);

        Dashboard page = service(
                        fake("third", 30, Set.of(StaffCapability.VIEW_FINANCE)),
                        fake("first", 10, Set.of(StaffCapability.VIEW_FINANCE)),
                        fake("second", 20, Set.of(StaffCapability.VIEW_FINANCE)))
                .read(STAFF, null, null);

        assertThat(page.sections()).extracting(Dashboard.Served::key).containsExactly("first", "second", "third");
    }

    @Test
    @DisplayName("one section failing is served as unavailable and the others are untouched")
    void oneFailureDoesNotBlankThePage() {
        holds(StaffCapability.VIEW_FINANCE);
        DashboardSection broken = new DashboardSection() {
            public String key() { return "broken"; }
            public int order() { return 20; }
            public Set<StaffCapability> requiresAny() { return Set.of(StaffCapability.VIEW_FINANCE); }
            public Reading read(UUID staffId, Window window) { throw new IllegalStateException("the table is gone"); }
        };

        Dashboard page = service(fake("before", 10, Set.of(StaffCapability.VIEW_FINANCE)), broken,
                        fake("after", 30, Set.of(StaffCapability.VIEW_FINANCE)))
                .read(STAFF, null, null);

        assertThat(page.sections()).extracting(Dashboard.Served::key).containsExactly("before", "broken", "after");
        assertThat(page.sections()).extracting(Dashboard.Served::status)
                .containsExactly(Dashboard.Status.READY, Dashboard.Status.UNAVAILABLE, Dashboard.Status.READY);
        // No figures from a section that failed, and the ones that worked still have theirs.
        assertThat(page.sections().get(1).reading().figures()).isEmpty();
        assertThat(page.sections().get(0).reading().figures()).hasSize(1);
        assertThat(page.sections().get(2).reading().figures()).hasSize(1);
    }

    @Test
    @DisplayName("a section that requires no capability is refused at start-up, not shown to everybody")
    void aSectionMustRequireSomething() {
        assertThatThrownBy(() -> service(fake("open", 10, Set.of())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("'open'")
                .hasMessageContaining("shown to everybody");
    }

    @Test
    @DisplayName("two sections with one key are refused at start-up")
    void keysMustBeUnique() {
        assertThatThrownBy(() -> service(
                        fake("same", 10, Set.of(StaffCapability.VIEW_FINANCE)),
                        fake("same", 20, Set.of(StaffCapability.VIEW_FINANCE))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("'same'");
    }

    @Test
    @DisplayName("the window defaults to thirty days ending today in Baku")
    void theDefaultWindowIsThirtyDays() {
        holds(StaffCapability.VIEW_FINANCE);

        Dashboard page = service(fake("money", 10, Set.of(StaffCapability.VIEW_FINANCE))).read(STAFF, null, null);

        // 10:00 UTC is 14:00 in Baku, still the 15th. Thirty days inclusive starts on the 17th of May.
        assertThat(page.to()).isEqualTo(LocalDate.parse("2050-06-15"));
        assertThat(page.from()).isEqualTo(LocalDate.parse("2050-05-17"));
        assertThat(page.timeZone()).isEqualTo("Asia/Baku");
    }

    @Test
    @DisplayName("a window that runs backwards or covers more than a year is refused")
    void badWindowsAreRefused() {
        holds(StaffCapability.VIEW_FINANCE);
        DashboardService service = service(fake("money", 10, Set.of(StaffCapability.VIEW_FINANCE)));

        assertThatThrownBy(() -> service.read(STAFF, LocalDate.parse("2050-06-10"), LocalDate.parse("2050-06-01")))
                .isInstanceOf(InvalidDashboardRangeException.class);
        assertThatThrownBy(() -> service.read(STAFF, LocalDate.parse("2048-01-01"), LocalDate.parse("2050-06-01")))
                .isInstanceOf(InvalidDashboardRangeException.class);

        // A year is fine: 366 days inclusive is the longest.
        assertThat(service.read(STAFF, LocalDate.parse("2049-06-15"), LocalDate.parse("2050-06-15")).sections())
                .hasSize(1);
    }

    @Test
    @DisplayName("every read is audited with which sections were served and which failed")
    void everyReadIsAudited() {
        holds(StaffCapability.VIEW_FINANCE);

        service(fake("money", 10, Set.of(StaffCapability.VIEW_FINANCE))).read(STAFF, null, null);

        verify(audit).recordIndependently(
                any(AuditAction.class), any(UUID.class), any(), any(), org.mockito.ArgumentMatchers.contains("sections=[money]"));
    }

    private static DashboardSection fake(String key, int order, Set<StaffCapability> requires) {
        return new DashboardSection() {
            public String key() { return key; }
            public int order() { return order; }
            public Set<StaffCapability> requiresAny() { return requires; }
            public Reading read(UUID staffId, Window window) {
                return Reading.of(List.of(Figure.count(key + ".figure", 1)));
            }
        };
    }
}
