package az.ideanest.platform.infrastructure;

import az.ideanest.platform.domain.MaintenanceWindow;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** V91's windows — #214. There is no delete: a window is ended or cancelled, never removed. */
public interface MaintenanceWindowRepository extends JpaRepository<MaintenanceWindow, UUID> {

    /**
     * Every window that is in force or still to come, soonest first.
     *
     * <p>What {@code MaintenanceWindows} caches. Not only the announced ones: a window
     * that becomes announced or active between two refreshes must already be in the
     * snapshot, so the switch happens at its instant rather than up to ten seconds later.
     */
    @Query("""
            SELECT w FROM MaintenanceWindow w
            WHERE w.endedAt IS NULL AND w.cancelledAt IS NULL AND (w.endsAt IS NULL OR w.endsAt > :now)
            ORDER BY w.startsAt ASC
            """)
    List<MaintenanceWindow> live(@Param("now") Instant now);

    /**
     * The console's history: windows that are over, the most recently finished first.
     *
     * <p>Over means ended, cancelled, or past an announced end — the complement of
     * {@link #live}. This used to be every window by start, so the one in force was listed
     * twice on the console with its buttons twice, a confirmation opened in both rows at
     * once, and a window scheduled for next month sat at the top of "Recent". Ordered by
     * when each finished rather than when it began, because that is what "recent" means to
     * somebody looking back at the last few.
     */
    @Query("""
            SELECT w FROM MaintenanceWindow w
            WHERE w.endedAt IS NOT NULL OR w.cancelledAt IS NOT NULL OR w.endsAt <= :now
            ORDER BY COALESCE(w.cancelledAt, w.endedAt, w.endsAt) DESC, w.createdAt DESC
            """)
    List<MaintenanceWindow> recent(@Param("now") Instant now, Pageable page);
}
