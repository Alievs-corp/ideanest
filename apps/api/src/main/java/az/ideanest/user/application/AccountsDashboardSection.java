package az.ideanest.user.application;

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
 * How many accounts were opened in the window — #222.
 *
 * <p>Needs {@code ADMINISTER_ACCOUNTS}, which is what the account directory asks for. A count and
 * nothing else: no name, address or identifier leaves this class, which is what makes it safe to
 * sit on a page for everybody who holds the capability. Accounts closed since are not counted.
 */
@Component
public class AccountsDashboardSection implements DashboardSection {

    private final NamedParameterJdbcTemplate jdbc;

    public AccountsDashboardSection(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return "accounts";
    }

    @Override
    public int order() {
        return 50;
    }

    @Override
    public Set<StaffCapability> requiresAny() {
        return Set.of(StaffCapability.ADMINISTER_ACCOUNTS);
    }

    @Override
    @Transactional(readOnly = true)
    public Reading read(UUID staffId, Window window) {
        Long opened = jdbc.queryForObject(
                """
                SELECT count(*) FROM users
                 WHERE created_at >= :from AND created_at < :to AND deleted_at IS NULL
                """,
                new MapSqlParameterSource()
                        .addValue("from", Timestamp.from(window.start()))
                        .addValue("to", Timestamp.from(window.end())),
                Long.class);
        return Reading.of(List.of(Figure.count("newAccounts", opened == null ? 0 : opened)));
    }
}
