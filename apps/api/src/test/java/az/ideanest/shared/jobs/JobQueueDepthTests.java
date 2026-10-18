package az.ideanest.shared.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The scheduler's contribution to the queue gauges — #316.
 *
 * <p>It publishes its dead jobs, which the {@code QueueDeadLetters} alert pages on, and nothing
 * as a backlog: it used to count every job that had finished a run as waiting, which put about
 * two dozen "waiting" on a healthy platform's health screen.
 */
class JobQueueDepthTests {

    @Test
    @DisplayName("publishes its dead jobs, waits for nothing, and is not listed as a queue")
    void deadJobsOnly() {
        JobRecordRepository jobs = mock(JobRecordRepository.class);
        when(jobs.countByState(JobState.DEAD)).thenReturn(2L);

        JobQueueDepth depth = new JobQueueDepth(jobs);

        assertThat(depth.queueName()).isEqualTo("scheduled-jobs");
        assertThat(depth.dead()).isEqualTo(2L);
        assertThat(depth.waiting()).isZero();
        assertThat(depth.listedAsQueue()).isFalse();
    }
}
