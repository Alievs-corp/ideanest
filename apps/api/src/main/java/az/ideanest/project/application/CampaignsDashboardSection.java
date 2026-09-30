package az.ideanest.project.application;

import az.ideanest.project.domain.ProjectState;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.dashboard.DashboardSection;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Where the campaigns are: running, waiting for a moderator, waiting for their creator — #222.
 *
 * <p>Needs {@code MODERATE_CONTENT}, which is what the campaign directory and the submission queue
 * already ask for, so a campaign count is shown to the people who could open the list it counts.
 *
 * <h2>Running is three states, not one</h2>
 *
 * <p>A campaign in its closing window or extended is still taking pledges and is still running,
 * so {@code running} is {@code LIVE}, {@code CLOSING_WINDOW} and {@code EXTENDED} together. A
 * count of {@code LIVE} alone would drop a campaign from "running" on the day it reaches its
 * deadline, which is the day somebody most wants to see it.
 *
 * <h2>Counted by state, off the index</h2>
 *
 * <p>One grouped count over {@code projects_state_deadline_idx}, not a scan. The figure for the
 * submission queue also carries when its oldest item arrived, read from the transition that put
 * each campaign there, so the page can say how long the longest wait is: the number a queue's
 * owner actually acts on.
 *
 * <p>Sums and counts only. There is no row here for a campaign, its creator or its content.
 */
@Component
public class CampaignsDashboardSection implements DashboardSection {

    private static final Set<ProjectState> RUNNING =
            Set.of(ProjectState.LIVE, ProjectState.CLOSING_WINDOW, ProjectState.EXTENDED);

    private final NamedParameterJdbcTemplate jdbc;

    public CampaignsDashboardSection(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return "campaigns";
    }

    @Override
    public int order() {
        return 20;
    }

    @Override
    public Set<StaffCapability> requiresAny() {
        return Set.of(StaffCapability.MODERATE_CONTENT);
    }

    @Override
    @Transactional(readOnly = true)
    public Reading read(UUID staffId, Window window) {
        Map<ProjectState, Long> byState = new EnumMap<>(ProjectState.class);
        jdbc.query("SELECT state, count(*) AS n FROM projects GROUP BY state", rs -> {
            byState.put(ProjectState.valueOf(rs.getString("state")), rs.getLong("n"));
        });

        long running = RUNNING.stream().mapToLong(state -> byState.getOrDefault(state, 0L)).sum();

        List<Figure> figures = new ArrayList<>();
        figures.add(Figure.count("running", running));
        figures.add(Figure.count(
                "awaitingModeration", byState.getOrDefault(ProjectState.SUBMITTED, 0L), oldestWaitingForModeration()));
        figures.add(Figure.count(
                "awaitingLaunch",
                byState.getOrDefault(ProjectState.APPROVED, 0L) + byState.getOrDefault(ProjectState.SCHEDULED, 0L)));
        figures.add(Figure.count("changesRequested", byState.getOrDefault(ProjectState.CHANGES_REQUESTED, 0L)));
        figures.add(Figure.count("createdInPeriod", createdIn(window)));

        // Every state, zeros included, so the page can draw the whole picture and a state that has
        // nothing in it reads as nothing rather than being missing.
        for (ProjectState state : ProjectState.values()) {
            figures.add(Figure.count("state." + state.name(), byState.getOrDefault(state, 0L)));
        }
        return Reading.of(figures);
    }

    /** When the longest-waiting submission was submitted, or null when the queue is empty. */
    private Instant oldestWaitingForModeration() {
        Timestamp oldest = jdbc.queryForObject(
                """
                SELECT min(arrived.at)
                  FROM projects p
                  JOIN LATERAL (
                        SELECT max(t.created_at) AS at
                          FROM project_state_transitions t
                         WHERE t.project_id = p.id AND t.to_state = 'SUBMITTED') arrived ON true
                 WHERE p.state = 'SUBMITTED'
                """,
                new MapSqlParameterSource(),
                Timestamp.class);
        return oldest == null ? null : oldest.toInstant();
    }

    private long createdIn(Window window) {
        Long created = jdbc.queryForObject(
                "SELECT count(*) FROM projects WHERE created_at >= :from AND created_at < :to",
                new MapSqlParameterSource()
                        .addValue("from", Timestamp.from(window.start()))
                        .addValue("to", Timestamp.from(window.end())),
                Long.class);
        return created == null ? 0 : created;
    }
}
