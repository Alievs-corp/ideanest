package az.ideanest.support;

import az.ideanest.staff.domain.StaffRole;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Makes an account a member of staff holding one role, by writing the grant row.
 *
 * <p>SQL rather than {@code PUT /v1/admin/staff/{id}/roles/{role}}, for the reason
 * {@code ConsoleReadApiTests} gives: a suite about who may use an endpoint would otherwise
 * depend on the staff administration endpoint, its audit write and its own refusals.
 *
 * <p>The account grants the role to itself. V48 requires {@code granted_by} to name an
 * account and draws no line between the two; a separate administrator would be a second
 * account for every suite to create and clean up.
 *
 * <p><strong>Every suite clears its grants by note after each test.</strong>
 * {@code staff_role_grants} references {@code users}, so a row left behind makes the next
 * suite's {@code DELETE FROM users} fail with a foreign key violation that points nowhere near
 * here.
 */
public final class StaffGrants {

    private StaffGrants() {
    }

    /** Grants {@code role} to the account, recorded under {@code note}. */
    public static void grant(DataSource dataSource, UUID accountId, StaffRole role, String note) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT DO NOTHING
                        """,
                        accountId,
                        role.name(),
                        accountId,
                        note);
    }

    /** Removes every grant recorded under {@code note}. */
    public static void clear(DataSource dataSource, String note) {
        new JdbcTemplate(dataSource).update("DELETE FROM staff_role_grants WHERE note = ?", note);
    }
}
