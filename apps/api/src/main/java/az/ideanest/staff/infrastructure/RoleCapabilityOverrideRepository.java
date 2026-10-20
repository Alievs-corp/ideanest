package az.ideanest.staff.infrastructure;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.domain.StaffRole;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * A super admin's adjustments to what each staff role confers — V114.
 *
 * <p>Plain JDBC, like {@link PartnerProfileRepository}: a row is a (role, capability, granted)
 * triple read in bulk on every authorisation, and an entity per triple would be mapping for its
 * own sake.
 */
@Repository
public class RoleCapabilityOverrideRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public RoleCapabilityOverrideRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Every adjustment, by role. A role with none is absent rather than mapped to an empty map.
     *
     * <p>A row naming a role or a capability this release does not know is skipped. V114 says
     * why the capability column is not constrained: a capability removed from the code must leave
     * a harmless row, not a refused request.
     */
    public Map<StaffRole, Map<StaffCapability, Boolean>> all() {
        Map<StaffRole, Map<StaffCapability, Boolean>> overrides = new EnumMap<>(StaffRole.class);
        jdbc.query(
                "SELECT role, capability, granted FROM staff_role_capability_overrides",
                rs -> {
                    StaffRole role = parse(StaffRole.class, rs.getString("role"));
                    StaffCapability capability = parse(StaffCapability.class, rs.getString("capability"));
                    if (role == null || capability == null) {
                        return;
                    }
                    overrides
                            .computeIfAbsent(role, ignored -> new EnumMap<>(StaffCapability.class))
                            .put(capability, rs.getBoolean("granted"));
                });
        return overrides;
    }

    /**
     * Serialises changes to one role's set, so two administrators saving the same role at once
     * end with one of their two sets rather than a mixture of both. Transaction-scoped.
     */
    public void lock(StaffRole role) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtext('staff_role_capability_overrides:' || :role))::text",
                new MapSqlParameterSource("role", role.name()),
                String.class);
    }

    /** Replaces one role's adjustments with these. An empty map puts the role back to its default. */
    public void replace(StaffRole role, Map<StaffCapability, Boolean> overrides, UUID actor) {
        jdbc.update(
                "DELETE FROM staff_role_capability_overrides WHERE role = :role",
                new MapSqlParameterSource("role", role.name()));
        for (Map.Entry<StaffCapability, Boolean> override : overrides.entrySet()) {
            jdbc.update(
                    """
                    INSERT INTO staff_role_capability_overrides (role, capability, granted, updated_by)
                    VALUES (:role, :capability, :granted, :actor)
                    """,
                    new MapSqlParameterSource()
                            .addValue("role", role.name())
                            .addValue("capability", override.getKey().name())
                            .addValue("granted", override.getValue())
                            .addValue("actor", actor));
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value) {
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }
}
