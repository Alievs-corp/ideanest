package az.ideanest.shared.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import az.ideanest.shared.maintenance.ActiveMaintenance;
import az.ideanest.shared.maintenance.MaintenanceGate;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A job that sends money or messages out does not claim work during a window — #214.
 *
 * <p>The lease is a mock because the assertion is about what the runner does not do:
 * a paused job must not even claim, or its next attempt would move on as though it had run.
 * {@code MaintenanceApiTests} checks the same against the real lease and the real list of
 * jobs that pause.
 */
class JobRunnerMaintenanceTests {

    private static final Instant NOW = Instant.parse("2026-10-04T22:10:00Z");

    private final JobLease lease = mock(JobLease.class);

    private final SwitchableGate gate = new SwitchableGate();

    private final JobRunner runner = new JobRunner(
            lease, new JobProperties(null, null, 0, null, null), gate, Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    @DisplayName("during a window a pausing job is not claimed and does not run")
    void pausedDuringAWindow() {
        gate.active = true;
        CountingJob job = new CountingJob(true);

        assertThat(runner.run(job)).isFalse();

        assertThat(job.runs.get()).isZero();
        verify(lease, never()).claim(anyString(), any(), any(), any());
    }

    @Test
    @DisplayName("during a window a job that does not pause runs as usual")
    void otherJobsRun() {
        gate.active = true;
        when(lease.claim(anyString(), any(), any(), any())).thenReturn(true);
        CountingJob job = new CountingJob(false);

        assertThat(runner.run(job)).isTrue();
        assertThat(job.runs.get()).isEqualTo(1);
    }

    @Test
    @DisplayName("outside a window a pausing job runs, so it resumes when the window ends")
    void resumesAfterTheWindow() {
        gate.active = false;
        when(lease.claim(anyString(), any(), any(), any())).thenReturn(true);
        CountingJob job = new CountingJob(true);

        assertThat(runner.run(job)).isTrue();
        assertThat(job.runs.get()).isEqualTo(1);
    }

    private static final class CountingJob implements ScheduledJob {

        private final boolean pauses;

        private final AtomicInteger runs = new AtomicInteger();

        CountingJob(boolean pauses) {
            this.pauses = pauses;
        }

        @Override
        public String name() {
            return "maintenance-counting-job";
        }

        @Override
        public String schedule() {
            return "-";
        }

        @Override
        public void run() {
            runs.incrementAndGet();
        }

        @Override
        public boolean pausesDuringMaintenance() {
            return pauses;
        }
    }

    private static final class SwitchableGate implements MaintenanceGate {

        private boolean active;

        @Override
        public Optional<ActiveMaintenance> active() {
            return active ? Optional.of(new ActiveMaintenance(NOW.minusSeconds(60), null)) : Optional.empty();
        }

        @Override
        public void admitSession(UUID accountId) {
            throw new UnsupportedOperationException();
        }
    }
}
