package az.ideanest.pledge.infrastructure;

import az.ideanest.pledge.application.BackedPledges;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * {@link BackedPledges} against {@code pledges}.
 *
 * <p><strong>SQL rather than JPA</strong>, following {@code PledgeProjectAudiences}
 * and for the same reason: the question is a projection of four columns over a state
 * filter, and loading entities to build a record out of would fetch six amounts and
 * an idempotency key per row on a query whose whole purpose is to be cheap enough to
 * run over a campaign's entire backer list.
 *
 * <p>The state list is the same one {@code PledgeProjectAudiences} uses and is
 * copied rather than shared, which is a decision worth naming. Extracting it would
 * mean a constant in {@code shared} that both read — and "which states are a
 * backing" is §6.2's rule about this module's own table, not a platform vocabulary.
 * What keeps the two honest is that they are three lines apart in the same package
 * and {@code ComputedAudienceTests} would notice one of them drifting.
 */
@Component
public class BackedPledgeFacts implements BackedPledges {

    /**
     * §6.2's states in which a pledge is somebody backing a campaign.
     *
     * <p>Inlined rather than bound, for {@code PledgeProjectAudiences}' reason: they
     * are a constant of this class and an {@code IN} list of literals is what lets
     * the planner use {@code pledges_project_backer_active_key}.
     */
    private static final String BACKING_STATES = "'COLLECTED', 'FULFILLED'";

    private static final String COLUMNS = "id, project_id, backer_id, reward_tier_id, shipping_country";

    private final NamedParameterJdbcTemplate jdbc;

    public BackedPledgeFacts(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<BackedPledge> pledge(UUID pledgeId) {
        List<BackedPledge> found = jdbc.query(
                "SELECT " + COLUMNS + " FROM pledges WHERE id = :pledgeId AND state IN (" + BACKING_STATES + ")",
                Map.of("pledgeId", pledgeId),
                (row, index) -> map(row));
        return found.stream().findFirst();
    }

    @Override
    public List<BackedPledge> onProject(UUID projectId, int limit) {
        if (limit < 1) {
            // A send to nobody is a bug in whoever computed the bound, and answering
            // "there are no backers" would report it as an empty campaign.
            throw new IllegalArgumentException("A bounded read is of at least one pledge, not " + limit);
        }
        // Oldest first, so a truncated audience is the campaign's earliest backers
        // rather than whatever the planner happened to return.
        return jdbc.query(
                "SELECT " + COLUMNS + " FROM pledges"
                        + " WHERE project_id = :projectId AND state IN (" + BACKING_STATES + ")"
                        + " ORDER BY confirmed_at, id LIMIT :limit",
                Map.of("projectId", projectId, "limit", limit),
                (row, index) -> map(row));
    }

    @Override
    public List<BackedPledge> ofBacker(UUID backerId) {
        return jdbc.query(
                "SELECT " + COLUMNS + " FROM pledges"
                        + " WHERE backer_id = :backerId AND state IN (" + BACKING_STATES + ")"
                        + " ORDER BY confirmed_at DESC, id DESC",
                Map.of("backerId", backerId),
                (row, index) -> map(row));
    }

    @Override
    public boolean isBacking(UUID projectId, UUID backerId) {
        // `pledges_project_backer_active_key` is on exactly these columns, so this is an index
        // probe on the read a signed-in reader makes per campaign page.
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pledges"
                        + " WHERE project_id = :projectId AND backer_id = :backerId"
                        + " AND state IN (" + BACKING_STATES + "))",
                Map.of("projectId", projectId, "backerId", backerId),
                Boolean.class);
        return Boolean.TRUE.equals(found);
    }

    private static BackedPledge map(java.sql.ResultSet row) throws java.sql.SQLException {
        return new BackedPledge(
                row.getObject("id", UUID.class),
                row.getObject("project_id", UUID.class),
                row.getObject("backer_id", UUID.class),
                row.getObject("reward_tier_id", UUID.class),
                row.getString("shipping_country"));
    }
}
