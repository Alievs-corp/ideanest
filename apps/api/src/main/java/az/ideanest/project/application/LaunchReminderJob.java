package az.ideanest.project.application;

import az.ideanest.project.ProjectProperties;
import az.ideanest.shared.jobs.ScheduledJob;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §8.4's {@code reminder-sender}, in the half of it this issue owns.
 *
 * <p>The table gives the job two responsibilities, "launch and deadline
 * reminders". Only the first is here: a deadline reminder needs a campaign with a
 * deadline, a notification preference model, and the "48 hours remaining" and "24
 * hours remaining" rows of §4.10, none of which exist. Writing half of it now
 * would be a job that looks finished.
 *
 * <p><strong>On the durable scheduler since #134.</strong> The sweep did not need
 * the lease to be correct — {@link LaunchReminderDelivery} claims each row with a
 * conditional update, so exactly one caller sends and the others find it already
 * done — but it is the job where doing the work three times was most visible: every
 * replica read the same list of campaigns owed notices, every minute, and two of
 * them threw the answer away.
 *
 * <p>This one is <em>not</em> indifferent to running late. A launch notice that
 * arrives an hour after the campaign opened is a worse message than one that arrives
 * in a minute, which is why {@link LaunchReminderListener} exists beside it rather
 * than instead of it — and why the lease is a minute rather than an hour.
 */
@Component
public class LaunchReminderJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(LaunchReminderJob.class);

    private final LaunchReminderSender sender;
    private final ProjectProperties properties;

    public LaunchReminderJob(LaunchReminderSender sender, ProjectProperties properties) {
        this.sender = sender;
        this.properties = properties;
    }

    /**
     * Paused while a maintenance window is in force (#214). It sends launch reminders to
     * followers.
     */
    @Override
    public boolean pausesDuringMaintenance() {
        return true;
    }

    /** §8.4's {@code reminder-sender}, in the half of it this job owns. */
    @Override
    public String name() {
        return "reminder-sender";
    }

    /**
     * The schedule is a property so that the test profile can set it to {@code -}
     * and drive {@link #sendDueReminders()} directly. A timer firing in the
     * background of a test suite is a source of failures that reproduce once a
     * fortnight — and this one would fire every minute.
     */
    @Override
    public String schedule() {
        return properties.reminders().sendSchedule();
    }

    @Override
    public void run() {
        sendDueReminders();
    }

    /**
     * One pass: every live campaign that still owes somebody a launch notice.
     *
     * @return how many messages this pass produced
     */
    public int sendDueReminders() {
        List<UUID> owed = sender.projectsOwedNotices();

        int sent = 0;
        for (UUID projectId : owed) {
            try {
                sent += sender.notifyFollowers(projectId);
            } catch (RuntimeException e) {
                // One campaign per iteration, and one failure must not stop the
                // rest: the campaigns behind this one in the list launched too.
                log.error("Could not send launch reminders for project {}; they stay pending.", projectId, e);
            }
        }

        if (sent > 0) {
            log.info("Sent {} launch reminders across {} campaigns.", sent, owed.size());
        }
        return sent;
    }
}
