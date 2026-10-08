package az.ideanest.shared.jobs;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;

/**
 * Puts every {@link ScheduledJob} on a timer, and every timer behind a lease.
 *
 * <p><strong>Spring's {@code TaskScheduler} is still the clock.</strong> #134 is not
 * a replacement for the timer — an in-process timer is fine, and a fleet of them is
 * a feature: sixteen jobs on three replicas is forty-eight triggers, of which
 * sixteen do the work and thirty-two find the job already claimed. What was missing
 * was the claim, and that is the only thing this package adds. It is also why no
 * dependency arrived with it: PostgreSQL and a cron expression are the whole
 * mechanism, and ShedLock or Quartz would bring a second scheduler, a second set of
 * tables, and a second place to look when a job did not run.
 *
 * <p><strong>Registered after the application is ready</strong>, not during the
 * refresh. A trigger that fired while beans were still being created would run work
 * against a half-built context, and the first tick of {@code outbox-relay} is one
 * second after the timer exists.
 *
 * <p>Correlation comes from {@code ObservabilityConfiguration}, which puts
 * {@code CorrelationTaskDecorator} on this very scheduler: the decorator is applied
 * per execution, so each pass of each job carries its own identifiers and a sweep's
 * log lines can be gathered by something other than their timestamps.
 *
 * <p><strong>What is deliberately not here</strong>: nothing schedules a job it was
 * not given. There is no registry to call, no annotation to remember, and no way to
 * run a job on a timer without also giving it a lease — which is the only property
 * that makes the count of replicas stop mattering.
 */
@Component
public class JobScheduler implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(JobScheduler.class);

    private final List<ScheduledJob> jobs;
    private final JobLease lease;
    private final JobRunner runner;
    private final TaskScheduler timers;
    private final Clock clock;

    /** The threads of {@link ScheduledJob#isLongRunning} jobs, shut down with the context. */
    private final List<ThreadPoolTaskScheduler> ownThreads = new ArrayList<>();

    public JobScheduler(
            List<ScheduledJob> jobs, JobLease lease, JobRunner runner, TaskScheduler timers, Clock clock) {
        this.jobs = List.copyOf(jobs);
        this.lease = lease;
        this.runner = runner;
        this.timers = timers;
        this.clock = clock;
    }

    /**
     * Writes every job down and starts the triggers.
     *
     * <p>Registration happens for every job, including one whose schedule is
     * disabled: the row is the job's identity and its retry state, and a deployment
     * that runs a job by hand, or a test that drives it directly, still expects to
     * find it. Only the timer is conditional.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void registerJobs() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Set<String> named = new HashSet<>();

        for (ScheduledJob job : jobs) {
            if (!named.add(job.name())) {
                // Two jobs under one name share one lease, so each of them stops the
                // other from running roughly half the time — a scheduler that mostly
                // works, which is the worst thing for it to be. Refusing to start is
                // the only symptom anybody would ever see in time.
                throw new IllegalStateException(
                        "Two scheduled jobs are called '%s'; the name is the identity the lease is taken on"
                                .formatted(job.name()));
            }

            lease.register(job.name(), now);

            String schedule = job.schedule();
            if (Scheduled.CRON_DISABLED.equals(schedule)) {
                // Spring's own value for "do not schedule this", kept so that the test
                // profile's existing `-` still means what it meant when these were
                // annotations.
                log.info("Job {} is registered but has no schedule here.", job.name());
                continue;
            }

            // UTC, as every one of these was when it was an annotation. A cron read in
            // the deployment's local zone runs at a different hour twice a year, and
            // the daily jobs are the ones where that is least likely to be noticed.
            timersFor(job).schedule(() -> runner.run(job), new CronTrigger(schedule, ZoneOffset.UTC));
            log.info("Job {} runs on '{}'.", job.name(), schedule);
        }
    }

    /**
     * The shared scheduler, or a thread of the job's own when a pass can take minutes —
     * see {@link ScheduledJob#isLongRunning}.
     */
    private TaskScheduler timersFor(ScheduledJob job) {
        if (!job.isLongRunning()) {
            return timers;
        }
        ThreadPoolTaskScheduler own = new ThreadPoolTaskScheduler();
        own.setPoolSize(1);
        own.setThreadNamePrefix("job-" + job.name() + "-");
        own.setWaitForTasksToCompleteOnShutdown(false);
        own.initialize();
        ownThreads.add(own);
        return own;
    }

    @Override
    public void destroy() {
        ownThreads.forEach(ThreadPoolTaskScheduler::shutdown);
    }
}
