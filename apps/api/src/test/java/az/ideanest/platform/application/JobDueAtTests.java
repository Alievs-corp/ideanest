package az.ideanest.platform.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.support.CronExpression;

/**
 * A job is late against its trigger, not against when it last finished — #478.
 */
class JobDueAtTests {

    private static final Optional<CronExpression> HOURLY = Optional.of(CronExpression.parse("0 0 * * * *"));

    @Test
    @DisplayName("an hourly job that finished at 13:00:04 is due at 14:00, not at 13:00:04")
    void aSucceededJobIsDueAtItsNextFiring() {
        Instant finished = Instant.parse("2026-10-14T13:00:04Z");

        assertThat(SystemHealthService.dueAt(finished, HOURLY)).isEqualTo(Instant.parse("2026-10-14T14:00:00Z"));
    }

    @Test
    @DisplayName("a job eligible exactly on a firing is due at that firing")
    void eligibleOnTheFiringIsDueThen() {
        Instant onTheHour = Instant.parse("2026-10-14T14:00:00Z");

        assertThat(SystemHealthService.dueAt(onTheHour, HOURLY)).isEqualTo(onTheHour);
    }

    @Test
    @DisplayName("a job backing off is due at the first firing after the backoff")
    void aBackoffEndsAtTheNextFiring() {
        Instant backoffEnds = Instant.parse("2026-10-14T13:05:00Z");

        assertThat(SystemHealthService.dueAt(backoffEnds, HOURLY)).isEqualTo(Instant.parse("2026-10-14T14:00:00Z"));
    }

    @Test
    @DisplayName("a row with no schedule on this deployment keeps its column")
    void noScheduleKeepsTheColumn() {
        Instant eligible = Instant.parse("2026-10-14T13:00:04Z");

        assertThat(SystemHealthService.dueAt(eligible, Optional.empty())).isEqualTo(eligible);
    }
}
