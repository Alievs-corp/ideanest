package az.ideanest.ticket.application;

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
 * Support tickets that still need somebody, and how long the longest has waited — #222.
 *
 * <p>Needs {@code HANDLE_SUPPORT}, which is what the support console asks for. Open and pending
 * together, because a pending ticket is one waiting on the requester and is still the team's until
 * it is resolved. Counted over {@code support_tickets_open_queue}, the partial index that holds
 * exactly these two states.
 */
@Component
public class SupportDashboardSection implements DashboardSection {

    private final NamedParameterJdbcTemplate jdbc;

    public SupportDashboardSection(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return "support";
    }

    @Override
    public int order() {
        return 40;
    }

    @Override
    public Set<StaffCapability> requiresAny() {
        return Set.of(StaffCapability.HANDLE_SUPPORT);
    }

    @Override
    @Transactional(readOnly = true)
    public Reading read(UUID staffId, Window window) {
        return jdbc.query(
                """
                SELECT count(*) AS n, min(created_at) AS oldest
                  FROM support_tickets
                 WHERE state IN ('OPEN', 'PENDING')
                """,
                new MapSqlParameterSource(),
                rs -> {
                    rs.next();
                    Timestamp oldest = rs.getTimestamp("oldest");
                    return Reading.of(List.of(Figure.count(
                            "openTickets", rs.getLong("n"), oldest == null ? null : oldest.toInstant())));
                });
    }
}
