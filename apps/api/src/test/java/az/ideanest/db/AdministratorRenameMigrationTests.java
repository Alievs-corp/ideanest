package az.ideanest.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.support.AbstractIntegrationTest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * V90, the contract half of renaming ADMINISTRATOR to SUPER_ADMIN — #212, part of #202.
 *
 * <p><strong>Its data statements, run for real, on rows that have the awkward shapes.</strong>
 * By the time this suite starts the schema is already at V90, so the real table can no longer
 * hold the old name and cannot be used to show the conversion. The statements are therefore
 * read out of the migration file itself and run against a copy of the table in a scratch
 * schema, where the old name is allowed. What is tested is the SQL that ships, not a
 * restatement of it: a test that retyped the {@code UPDATE} would pass however the file read.
 *
 * <p>Three shapes matter. An account holding only the old name, which must keep who granted it
 * and when. An account holding both names, where converting in place would collide with its
 * primary key. And an account holding neither, which must not be touched.
 */
class AdministratorRenameMigrationTests extends AbstractIntegrationTest {

    private static final String SCHEMA = "v90_scratch";

    private static final Path MIGRATION =
            Path.of("src/main/resources/db/migration/V90__convert_administrator_to_super_admin.sql");

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("an account holding only the old name is converted in place, keeping who granted it and when")
    void theOldNameIsConvertedInPlace() throws Exception {
        UUID admin = UUID.randomUUID();
        UUID grantor = UUID.randomUUID();

        Map<String, Object> converted = runInScratchSchema(
                jdbc -> {
                    insert(jdbc, admin, "ADMINISTRATOR", grantor, "Platforma administratoru.", "2025-01-01T00:00:00Z");
                },
                jdbc -> jdbc.queryForMap("SELECT role, granted_by, note, granted_at FROM staff_role_grants"));

        assertThat(converted).containsEntry("role", "SUPER_ADMIN");
        // Who let this person in, and why, is still the original answer.
        assertThat(converted).containsEntry("granted_by", grantor).containsEntry("note", "Platforma administratoru.");
        assertThat(converted.get("granted_at").toString()).startsWith("2025-01-01");
    }

    @Test
    @DisplayName("an account holding both names ends with one row, and it is the one that was already SUPER_ADMIN")
    void aDuplicateCollapsesToTheExistingRow() throws Exception {
        UUID both = UUID.randomUUID();
        UUID grantor = UUID.randomUUID();

        List<Map<String, Object>> rows = runInScratchSchema(
                jdbc -> {
                    insert(jdbc, both, "ADMINISTRATOR", grantor, "old", "2024-01-01T00:00:00Z");
                    insert(jdbc, both, "SUPER_ADMIN", grantor, "new", "2026-01-01T00:00:00Z");
                },
                jdbc -> jdbc.queryForList("SELECT role, note FROM staff_role_grants"));

        // A plain UPDATE would have collided on (account_id, role). The account already held the
        // highest role, so the old row is removed and the newer one stands.
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("role", "SUPER_ADMIN").containsEntry("note", "new");
    }

    @Test
    @DisplayName("nobody else's grants are touched, and nothing is left under the old name")
    void otherRolesAreUntouched() throws Exception {
        UUID moderator = UUID.randomUUID();
        UUID partner = UUID.randomUUID();
        UUID admin = UUID.randomUUID();
        UUID grantor = UUID.randomUUID();

        List<Map<String, Object>> rows = runInScratchSchema(
                jdbc -> {
                    insert(jdbc, moderator, "MODERATOR", grantor, null, "2025-02-01T00:00:00Z");
                    insert(jdbc, partner, "PARTNER", grantor, "partner profile", "2025-03-01T00:00:00Z");
                    insert(jdbc, admin, "ADMINISTRATOR", grantor, null, "2025-01-01T00:00:00Z");
                },
                jdbc -> jdbc.queryForList("SELECT account_id, role FROM staff_role_grants"));

        assertThat(rows).hasSize(3);
        assertThat(rows).noneMatch(row -> "ADMINISTRATOR".equals(row.get("role")));
        assertThat(rows).anyMatch(row -> moderator.equals(row.get("account_id")) && "MODERATOR".equals(row.get("role")));
        assertThat(rows).anyMatch(row -> partner.equals(row.get("account_id")) && "PARTNER".equals(row.get("role")));
        assertThat(rows).anyMatch(row -> admin.equals(row.get("account_id")) && "SUPER_ADMIN".equals(row.get("role")));
    }

    @Test
    @DisplayName("the real table refuses the old name now, so no release can write it")
    void theRealConstraintRefusesTheOldName() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        // The CHECK is evaluated before the foreign keys, so a random account is enough to see it
        // fire, and nothing is written.
        assertThatThrownBy(() -> jdbc.update(
                        "INSERT INTO staff_role_grants (account_id, role, granted_by) VALUES (?, 'ADMINISTRATOR', ?)",
                        UUID.randomUUID(),
                        UUID.randomUUID()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("staff_role_grants_known");
    }

    // ------------------------------------------------------------------

    /**
     * Seeds a scratch copy of the table, runs the migration's DELETE and UPDATE against it, and
     * reads the result, then drops the scratch schema whatever happened.
     */
    private <T> T runInScratchSchema(Seed seed, Read<T> read) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(true);
            try (Statement statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
                statement.execute("CREATE SCHEMA " + SCHEMA);
                // The same columns and primary key as V48, with no CHECK and no foreign keys: the
                // point is to hold the old name, which the real table no longer can.
                statement.execute(
                        """
                        CREATE TABLE %s.staff_role_grants (
                            account_id uuid NOT NULL,
                            role text NOT NULL,
                            granted_at timestamptz NOT NULL DEFAULT now(),
                            granted_by uuid NOT NULL,
                            note text,
                            PRIMARY KEY (account_id, role))
                        """
                                .formatted(SCHEMA));
            }

            // Everything below runs with the scratch schema first on the path, so the
            // migration's unqualified `staff_role_grants` resolves to the copy.
            try (Statement statement = connection.createStatement()) {
                statement.execute("SET search_path TO " + SCHEMA);
            }
            try {
                JdbcTemplate jdbc = new JdbcTemplate(new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                        connection, true));
                seed.apply(jdbc);
                for (String sql : dataStatementsOfTheMigration()) {
                    jdbc.execute(sql);
                }
                return read.apply(jdbc);
            } finally {
                try (Statement statement = connection.createStatement()) {
                    statement.execute("SET search_path TO DEFAULT");
                    statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
                }
            }
        }
    }

    /** The migration's {@code DELETE} and {@code UPDATE} statements, exactly as written in the file. */
    private static List<String> dataStatementsOfTheMigration() throws IOException {
        String withoutComments = new ArrayList<>(Files.readAllLines(MIGRATION, StandardCharsets.UTF_8))
                .stream()
                .filter(line -> !line.trim().startsWith("--"))
                .reduce("", (joined, line) -> joined + line + "\n");

        List<String> statements = new ArrayList<>();
        for (String raw : withoutComments.split(";")) {
            String sql = raw.trim();
            if (sql.regionMatches(true, 0, "DELETE", 0, 6) || sql.regionMatches(true, 0, "UPDATE", 0, 6)) {
                statements.add(sql);
            }
        }
        assertThat(statements)
                .withFailMessage("Expected V90 to hold a DELETE and an UPDATE; found %s", statements)
                .hasSize(2);
        return statements;
    }

    private static void insert(
            JdbcTemplate jdbc, UUID account, String role, UUID grantedBy, String note, String grantedAt) {
        jdbc.update(
                "INSERT INTO staff_role_grants (account_id, role, granted_by, note, granted_at)"
                        + " VALUES (?, ?, ?, ?, ?::timestamptz)",
                account,
                role,
                grantedBy,
                note,
                grantedAt);
    }

    @FunctionalInterface
    private interface Seed {
        void apply(JdbcTemplate jdbc);
    }

    @FunctionalInterface
    private interface Read<T> {
        T apply(JdbcTemplate jdbc);
    }
}
