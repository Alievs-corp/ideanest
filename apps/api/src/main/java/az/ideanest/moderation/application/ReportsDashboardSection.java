package az.ideanest.moderation.application;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.dashboard.DashboardSection;
import java.sql.Timestamp;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reports nobody has answered yet, and how long the longest has waited — #222.
 *
 * <p>Needs {@code MODERATE_CONTENT}, which is what the report queues ask for.
 *
 * <p>{@link ReportQueuePage} declines to count a queue because a page of it does not need a total
 * to answer "is there more". This is a different question, asked by somebody who wants the size
 * of the backlog on one screen, and it is answered by a single count over
 * {@code content_reports_queue_idx}, which is ordered by state first.
 */
@Component
public class ReportsDashboardSection implements DashboardSection {

    private final NamedParameterJdbcTemplate jdbc;

    public ReportsDashboardSection(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return "reports";
    }

    @Override
    public int order() {
        return 30;
    }

    @Override
    public Set<StaffCapability> requiresAny() {
        return Set.of(StaffCapability.MODERATE_CONTENT);
    }

    @Override
    @Transactional(readOnly = true)
    public Reading read(UUID staffId, Window window) {
        return jdbc.query(
                "SELECT count(*) AS n, min(created_at) AS oldest FROM content_reports WHERE state = 'OPEN'",
                new MapSqlParameterSource(),
                rs -> {
                    rs.next();
                    Timestamp oldest = rs.getTimestamp("oldest");
                    return Reading.of(List.of(Figure.count(
                            "openReports", rs.getLong("n"), oldest == null ? null : oldest.toInstant())));
                });
    }
}
