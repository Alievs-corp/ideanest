package az.ideanest.staff.infrastructure;

import az.ideanest.staff.application.PartnerProfileView;
import az.ideanest.staff.domain.PartnerSection;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * V89's two tables, by the questions asked of them — #204.
 *
 * <p>SQL rather than entities, like {@code PostgresPlaces}: a partner is a row and a short set
 * of names, there is no behaviour to put on an aggregate, and every write here needs to be one
 * statement whose effect the caller can read back ({@code RETURNING}) rather than a managed
 * entity that flushes at some later point.
 *
 * <p><strong>{@link #lockTotal()} and V89's trigger take the same advisory lock.</strong> The
 * service takes it before it reads the total so that two super admins editing at once are
 * serialised and the second one is told how much is actually left; the trigger takes it again
 * so that an UPDATE written by hand is held to the same rule.
 */
@Repository
public class PartnerProfileRepository {

    private static final String SELECT_PROFILES =
            """
            SELECT p.account_id, p.percentage, p.created_at, p.created_by, p.updated_at, p.updated_by,
                   COALESCE((SELECT string_agg(g.section, ',') FROM partner_section_grants g
                              WHERE g.account_id = p.account_id), '') AS sections
              FROM partner_profiles p
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public PartnerProfileRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Serialises writers of the total. Held until the transaction ends. */
    public void lockTotal() {
        jdbc.getJdbcTemplate().execute("SELECT pg_advisory_xact_lock(hashtext('partner_profiles_total'))");
    }

    /** The sum of every partner's percentage except one account's, which may be absent. */
    public BigDecimal totalExcluding(UUID accountId) {
        BigDecimal total = jdbc.queryForObject(
                "SELECT COALESCE(SUM(percentage), 0) FROM partner_profiles WHERE account_id <> :accountId",
                new MapSqlParameterSource("accountId", accountId),
                BigDecimal.class);
        return total == null ? BigDecimal.ZERO : total;
    }

    /**
     * Creates the profile or changes its percentage.
     *
     * @return {@code true} when this call created it, {@code false} when it changed an existing
     *     one. {@code xmax = 0} is how an upsert says which, and it is cheaper than reading first
     *     and racing the answer
     */
    public boolean upsert(UUID accountId, BigDecimal percentage, UUID actor) {
        Boolean inserted = jdbc.queryForObject(
                """
                INSERT INTO partner_profiles (account_id, percentage, created_by, updated_by)
                VALUES (:accountId, :percentage, :actor, :actor)
                ON CONFLICT (account_id) DO UPDATE
                   SET percentage = EXCLUDED.percentage,
                       updated_at = now(),
                       updated_by = EXCLUDED.updated_by
                RETURNING (xmax = 0)
                """,
                new MapSqlParameterSource()
                        .addValue("accountId", accountId)
                        .addValue("percentage", percentage)
                        .addValue("actor", actor),
                Boolean.class);
        return Boolean.TRUE.equals(inserted);
    }

    /** Makes exactly these sections the open ones. */
    public void replaceSections(UUID accountId, Set<PartnerSection> sections) {
        MapSqlParameterSource account = new MapSqlParameterSource("accountId", accountId);
        jdbc.update("DELETE FROM partner_section_grants WHERE account_id = :accountId", account);
        for (PartnerSection section : sections) {
            jdbc.update(
                    "INSERT INTO partner_section_grants (account_id, section) VALUES (:accountId, :section)",
                    new MapSqlParameterSource()
                            .addValue("accountId", accountId)
                            .addValue("section", section.name()));
        }
    }

    /** One partner, or empty. */
    public Optional<PartnerProfileView> find(UUID accountId) {
        List<PartnerProfileView> found = jdbc.query(
                SELECT_PROFILES + " WHERE p.account_id = :accountId",
                new MapSqlParameterSource("accountId", accountId),
                PartnerProfileRepository::map);
        return found.stream().findFirst();
    }

    /** Every partner, oldest first. Unpaged: there are as many as there are business partners. */
    public List<PartnerProfileView> findAll() {
        return jdbc.query(
                SELECT_PROFILES + " ORDER BY p.created_at ASC, p.account_id ASC",
                PartnerProfileRepository::map);
    }

    /** The sections opened to one account. Empty for an account with no profile. */
    public Set<PartnerSection> sectionsOf(UUID accountId) {
        List<String> names = jdbc.queryForList(
                "SELECT section FROM partner_section_grants WHERE account_id = :accountId",
                new MapSqlParameterSource("accountId", accountId),
                String.class);
        return toSections(names);
    }

    /**
     * Removes the profile; its sections go with it.
     *
     * @return 1 when a profile existed, 0 when there was none
     */
    public int delete(UUID accountId) {
        return jdbc.update(
                "DELETE FROM partner_profiles WHERE account_id = :accountId",
                new MapSqlParameterSource("accountId", accountId));
    }

    private static PartnerProfileView map(ResultSet rs, int row) throws SQLException {
        String joined = rs.getString("sections");
        List<String> names = new ArrayList<>();
        if (joined != null && !joined.isEmpty()) {
            names.addAll(List.of(joined.split(",")));
        }
        return new PartnerProfileView(
                rs.getObject("account_id", UUID.class),
                rs.getBigDecimal("percentage"),
                toSections(names),
                rs.getObject("created_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getObject("created_by", UUID.class),
                rs.getObject("updated_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getObject("updated_by", UUID.class));
    }

    private static Set<PartnerSection> toSections(List<String> names) {
        Set<PartnerSection> sections = EnumSet.noneOf(PartnerSection.class);
        for (String name : names) {
            sections.add(PartnerSection.valueOf(name));
        }
        return sections;
    }
}
