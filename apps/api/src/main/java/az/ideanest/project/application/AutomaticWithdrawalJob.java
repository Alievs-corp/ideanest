package az.ideanest.project.application;

import az.ideanest.project.ProjectProperties;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * {@code automatic-withdrawal} — IDN-EXT-01 (#41), §5.1: a creator who does not withdraw is withdrawn
 * for, 30 days after funding ended, so the money reaches them fourteen days later on day 44.
 */
@Component
public class AutomaticWithdrawalJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(AutomaticWithdrawalJob.class);

    private static final int PAGE = 100;

    private final ProjectRepository projects;
    private final ProjectTransitionService transitions;
    private final ProjectProperties properties;
    private final Clock clock;

    public AutomaticWithdrawalJob(
            ProjectRepository projects, ProjectTransitionService transitions, ProjectProperties properties, Clock clock) {
        this.projects = projects;
        this.transitions = transitions;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "automatic-withdrawal";
    }

    @Override
    public String schedule() {
        return properties.withdrawal().automaticSchedule();
    }

    @Override
    public void run() {
        withdrawDue(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /** @return how many campaigns this pass withdrew */
    public int withdrawDue(Instant now) {
        List<UUID> due = projects.findDueForAutomaticWithdrawal(
                now.minus(properties.withdrawal().automaticAfter()), PageRequest.ofSize(PAGE));
        int withdrawn = 0;
        for (UUID projectId : due) {
            try {
                if (transitions.withdrawAutomatically(projectId, now).isPresent()) {
                    withdrawn++;
                }
            } catch (RuntimeException e) {
                log.error("Could not withdraw campaign {} automatically; the next pass tries again.", projectId, e);
            }
        }
        if (withdrawn > 0) {
            log.info("automatic-withdrawal: {} campaigns withdrawn.", withdrawn);
        }
        return withdrawn;
    }
}
