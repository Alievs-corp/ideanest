package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import com.zaxxer.hikari.HikariDataSource;
import java.math.BigDecimal;
import java.sql.Array;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * V107 (#470) against data written at V106, in a database of its own so the shared schema is
 * left at the latest version.
 */
class RetiredPledgeStatesMigrationTests extends AbstractIntegrationTest {

    @Autowired
    private DataSource dataSource;

    private final String database = "v107_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

    private DataSource legacy;
    private JdbcTemplate jdbc;

    @BeforeEach
    void createDatabase() {
        new JdbcTemplate(dataSource).execute("CREATE DATABASE " + database);
        HikariDataSource shared = (HikariDataSource) dataSource;
        String url = shared.getJdbcUrl().replaceFirst("/[^/?]+(\\?|$)", "/" + database + "$1");
        legacy = new DriverManagerDataSource(url, shared.getUsername(), shared.getPassword());
        jdbc = new JdbcTemplate(legacy);
        flyway("106").migrate();
    }

    @AfterEach
    void dropDatabase() {
        new JdbcTemplate(dataSource).execute("DROP DATABASE IF EXISTS " + database + " WITH (FORCE)");
    }

    @Test
    @DisplayName("V107 ends the stored-card pledges as EXPIRED, gives their places back and keeps paid ones")
    void retiredPledgesExpireAndReleaseTheirPlaces() {
        UUID creator = Campaigns.creator(legacy, "v107-creator");
        UUID project = Campaigns.seed(legacy, creator, "v107-campaign").state("LIVE").insert();
        UUID tier = tier(project, false, 4);
        UUID addon = tier(project, true, 3);

        UUID confirmedBacker = Campaigns.creator(legacy, "v107-confirmed");
        UUID confirmed = pledge(project, confirmedBacker, tier, "CONFIRMED");
        jdbc.update(
                "INSERT INTO pledge_addons (pledge_id, reward_tier_id, project_id, quantity) VALUES (?, ?, ?, 2)",
                confirmed, addon, project);
        UUID supplement = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO pledge_supplements (id, pledge_id, project_id, kind, amount, currency)
                VALUES (?, ?, ?, 'ADDONS', 15.00, 'AZN')
                """,
                supplement, confirmed, project);
        jdbc.update(
                "INSERT INTO supplement_addons (supplement_id, reward_tier_id, quantity) VALUES (?, ?, 1)",
                supplement, addon);

        UUID pending = pledge(project, Campaigns.creator(legacy, "v107-pending"), tier, "CHARGE_PENDING");
        UUID dropped = pledge(project, Campaigns.creator(legacy, "v107-dropped"), tier, "DROPPED");
        UUID paid = pledge(project, Campaigns.creator(legacy, "v107-paid"), tier, "COLLECTED");

        UUID committedSegment = segment(project, creator, "ARRAY['CONFIRMED', 'FULFILLED']::text[]");
        UUID queuedSegment = segment(project, creator, "ARRAY['CHARGE_PENDING', 'CHARGE_FAILED']::text[]");

        flyway(null).migrate();

        assertThat(state(confirmed)).isEqualTo("EXPIRED");
        assertThat(state(pending)).isEqualTo("EXPIRED");
        assertThat(state(dropped)).isEqualTo("EXPIRED");
        assertThat(state(paid)).isEqualTo("COLLECTED");
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM pledges WHERE state = 'EXPIRED' AND canceled_at IS NULL", Integer.class))
                .isZero();

        assertThat(claimed(tier)).as("only the paid pledge still holds a place").isEqualTo(1);
        assertThat(claimed(addon)).as("both add-ons and the supplement's one went back").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pledge_supplements", Integer.class)).isZero();

        assertThat(states(committedSegment)).containsExactly("COLLECTED", "FULFILLED");
        assertThat(states(queuedSegment)).containsExactly("COLLECTED");

        assertThatCode(() -> jdbc.update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, reservation_expires_at)
                        VALUES (?, ?, ?, 'DRAFT', 25.00, now() + interval '5 minutes')
                        """,
                        UUID.randomUUID(), project, confirmedBacker))
                .as("an expired legacy pledge no longer stops its backer pledging again")
                .doesNotThrowAnyException();

        assertThat(columns("pledges"))
                .doesNotContain(
                        "charge_attempts",
                        "next_charge_attempt_at",
                        "charge_window_ends_at",
                        "is_late_pledge",
                        "payment_method_id");
        assertThat(columns("projects")).doesNotContain("late_pledge_enabled", "late_pledge_ends_at");
    }

    private Flyway flyway(String target) {
        var configuration = Flyway.configure().dataSource(legacy).locations("classpath:db/migration");
        return (target == null ? configuration : configuration.target(target)).load();
    }

    private UUID tier(UUID project, boolean addon, int claimed) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                """
                INSERT INTO reward_tiers (id, project_id, title, amount, limit_quantity, is_addon, claimed_quantity)
                VALUES (?, ?, ?, ?, 10, ?, ?)
                """,
                id, project, addon ? "A mug" : "A boxed set", new BigDecimal("25.00"), addon, claimed);
        return id;
    }

    private UUID pledge(UUID project, UUID backer, UUID tier, String state) {
        UUID id = UUID.randomUUID();
        boolean queued = state.startsWith("CHARGE_");
        jdbc.update(
                """
                INSERT INTO pledges (id, project_id, backer_id, reward_tier_id, state, base_amount, currency,
                                     reservation_expires_at, next_charge_attempt_at, charge_window_ends_at)
                VALUES (?, ?, ?, ?, ?, 25.00, 'AZN',
                        now() + interval '5 minutes',
                        CASE WHEN ? THEN now() END,
                        CASE WHEN ? THEN now() + interval '7 days' END)
                """,
                id, project, backer, tier, state, queued, queued);
        return id;
    }

    private UUID segment(UUID project, UUID creator, String states) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO backer_segments (id, project_id, name, states, created_by) VALUES (?, ?, ?, %s, ?)"
                        .formatted(states),
                id, project, "Segment " + id.toString().substring(0, 8), creator);
        return id;
    }

    private String state(UUID pledge) {
        return jdbc.queryForObject("SELECT state FROM pledges WHERE id = ?", String.class, pledge);
    }

    private int claimed(UUID tier) {
        return jdbc.queryForObject("SELECT claimed_quantity FROM reward_tiers WHERE id = ?", Integer.class, tier);
    }

    private List<String> states(UUID segment) {
        return jdbc.queryForObject(
                "SELECT states FROM backer_segments WHERE id = ?",
                (row, index) -> {
                    Array array = row.getArray(1);
                    return Arrays.asList((String[]) array.getArray());
                },
                segment);
    }

    private List<String> columns(String table) {
        return jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
                String.class,
                table.toLowerCase(Locale.ROOT));
    }
}
