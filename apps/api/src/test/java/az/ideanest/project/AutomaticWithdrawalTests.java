package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.application.AutomaticWithdrawalJob;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code automatic-withdrawal} — IDN-EXT-01 (#41), §5.1: a successful campaign the creator did not
 * withdraw is withdrawn for them 30 days after funding ended, measured from the extension's end when
 * there was one.
 */
class AutomaticWithdrawalTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private AutomaticWithdrawalJob job;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("thirty days after the first deadline a successful campaign is withdrawn by the platform")
    void thirtyDaysAfterTheDeadline() {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        UUID due = successful(now.minus(Duration.ofDays(31)), null);
        UUID notYet = successful(now.minus(Duration.ofDays(29)), null);

        job.withdrawDue(now);

        assertThat(state(due)).isEqualTo("WITHDRAWN");
        assertThat(state(notYet)).isEqualTo("SUCCESSFUL");
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT actor_role FROM project_state_transitions WHERE project_id = ? AND to_state = 'WITHDRAWN'",
                                String.class,
                                due))
                .isEqualTo("SYSTEM");
    }

    @Test
    @DisplayName("an extended campaign is measured from the end of its extension")
    void measuredFromTheExtension() {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        UUID due = successful(now.minus(Duration.ofDays(60)), now.minus(Duration.ofDays(31)));
        UUID notYet = successful(now.minus(Duration.ofDays(60)), now.minus(Duration.ofDays(10)));

        job.withdrawDue(now);

        assertThat(state(due)).isEqualTo("WITHDRAWN");
        assertThat(state(notYet)).isEqualTo("SUCCESSFUL");
    }

    private UUID successful(Instant deadline, Instant extendedUntil) {
        UUID creator = Campaigns.creator(dataSource, "auto-withdraw-" + SEQUENCE.incrementAndGet());
        Campaigns.Seed seed = Campaigns.seed(dataSource, creator, "auto-withdraw-" + SEQUENCE.incrementAndGet())
                .state("SUCCESSFUL")
                .goal("1000.00")
                .pledged("900.00")
                .backers(2)
                .launchedAt(deadline.minus(Duration.ofDays(30)))
                .deadline(deadline);
        if (extendedUntil != null) {
            seed.extendedUntil(extendedUntil);
        }
        UUID project = seed.insert();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects SET finalized_at = now(), outcome_goal_amount = goal_amount,
                               outcome_pledged_amount = pledged_amount, outcome_backers_count = backers_count
                         WHERE id = ?
                        """,
                        project);
        return project;
    }

    private String state(UUID project) {
        return new JdbcTemplate(dataSource).queryForObject("SELECT state FROM projects WHERE id = ?", String.class, project);
    }
}
