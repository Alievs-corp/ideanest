package az.ideanest.project;

import az.ideanest.project.domain.CampaignOutcome;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Campaign settings.
 *
 * @param story how much of a story's editing history is kept
 * @param collaborators how invitations to work on a campaign behave
 * @param submission the bounds §5.3 leaves to configuration
 * @param reminders how launch reminders are collected and sent
 * @param finalisation how often §5.1 is applied at the deadline, and to how many
 *     campaigns at once
 * @param latePledges how long a campaign may keep taking pledges after it closed
 * @param submissions how much of the moderation submission queue one request may read
 * @param directory how much of the console's campaign directory one request may read
 * @param launches how often campaigns whose launch time has arrived are taken live
 */
@ConfigurationProperties(prefix = "ideanest.project")
public record ProjectProperties(
        Story story,
        Collaborators collaborators,
        Submission submission,
        Reminders reminders,
        Finalisation finalisation,
        LatePledges latePledges,
        Submissions submissions,
        Directory directory,
        Launches launches) {

    public ProjectProperties {
        // A deployment that configures neither section still starts. Nested records
        // bind to null when the whole block is absent, and a null here would be a
        // NullPointerException at the first autosave or the first invitation rather
        // than a configuration error at start-up — which is the wrong end of the day
        // to find it.
        story = story == null ? Story.defaults() : story;
        collaborators = collaborators == null ? Collaborators.defaults() : collaborators;
        submission = submission == null ? Submission.defaults() : submission;
        reminders = reminders == null ? Reminders.defaults() : reminders;
        finalisation = finalisation == null ? Finalisation.defaults() : finalisation;
        latePledges = latePledges == null ? LatePledges.defaults() : latePledges;
        submissions = submissions == null ? Submissions.defaults() : submissions;
        directory = directory == null ? Directory.defaults() : directory;
        launches = launches == null ? Launches.defaults() : launches;
    }

    /**
     * How much of the campaign directory one request may read.
     *
     * <p>Its own block rather than {@link Submissions} borrowed, which is the argument
     * that block makes about {@code ModerationProperties.Queue}: this bounds a query over
     * every campaign on the platform rather than over the few waiting on a moderator, and
     * one number governing both is a number that cannot be tuned for either.
     *
     * @param defaultPageSize what a request that names no size gets
     * @param maxPageSize the ceiling. Not an abuse control — the caller is signed-in staff
     *     — but what stops one request from loading every campaign ever created into one
     *     response and one screen
     */
    public record Directory(int defaultPageSize, int maxPageSize) {

        private static final int DEFAULT_PAGE_SIZE = 25;

        private static final int DEFAULT_MAX_PAGE_SIZE = 100;

        static Directory defaults() {
            return new Directory(DEFAULT_PAGE_SIZE, DEFAULT_MAX_PAGE_SIZE);
        }

        public Directory {
            // Zero is what an absent property binds to, and is read as "not set" rather
            // than as a page holding nothing.
            defaultPageSize = defaultPageSize == 0 ? DEFAULT_PAGE_SIZE : defaultPageSize;
            maxPageSize = maxPageSize == 0 ? DEFAULT_MAX_PAGE_SIZE : maxPageSize;

            if (defaultPageSize < 1 || maxPageSize < 1) {
                throw new IllegalArgumentException("A directory page holds at least one campaign");
            }
            if (defaultPageSize > maxPageSize) {
                throw new IllegalArgumentException("The default directory page cannot exceed the maximum");
            }
        }
    }

    /**
     * The sweep that keeps §6.1's scheduled launch a promise rather than a sentence.
     *
     * <p>A creator sets a launch time in the editor and the review tab tells them the
     * campaign "goes live when you launch it, or at the launch time you set". Nothing kept
     * the second half: {@code ProjectTransitionService.launch} was the only producer of
     * {@code LIVE}, so a campaign with a launch time and a creator asleep at it stayed
     * approved and invisible.
     *
     * @param schedule how often the sweep runs. Every minute, the same interval
     *     {@link Finalisation} uses and for the same reason: the gap between the time a
     *     creator chose and the campaign actually opening is exactly this number, and it is
     *     visible to everybody they told
     * @param batchSize a bound on one pass, not a target. Launch times cluster on the hour
     *     and at the start of months; the pass takes the oldest and comes back a minute
     *     later for the rest
     */
    public record Launches(String schedule, int batchSize) {

        /** Every minute, matching §8.4's other campaign sweep. */
        private static final String DEFAULT_SCHEDULE = "0 * * * * *";

        private static final int DEFAULT_BATCH_SIZE = 100;

        static Launches defaults() {
            return new Launches(DEFAULT_SCHEDULE, DEFAULT_BATCH_SIZE);
        }

        public Launches {
            schedule = schedule == null || schedule.isBlank() ? DEFAULT_SCHEDULE : schedule;
            batchSize = batchSize == 0 ? DEFAULT_BATCH_SIZE : batchSize;

            if (batchSize < 1) {
                // A pass that launches nothing is the feature switched off, and switched off
                // silently: every scheduled campaign sitting approved past its own launch
                // time with nothing in the log saying why. An operator sees this at start-up
                // instead.
                throw new IllegalArgumentException("A launch pass that opens no campaigns never opens any");
            }
        }
    }

    /**
     * How much of the submission queue one request may read.
     *
     * <p>The same shape and the same argument as {@code ModerationProperties.Queue},
     * kept here rather than borrowed from it: that block bounds the report queue, this
     * one bounds a different query over a different table, and one number governing
     * both is a number that cannot be tuned for either.
     *
     * @param defaultPageSize what a request that names no size gets
     * @param maxPageSize the ceiling. Not an abuse control — the caller is a signed-in
     *     moderator — but what stops one request from loading every campaign ever
     *     submitted into one response and one screen
     */
    public record Submissions(int defaultPageSize, int maxPageSize) {

        private static final int DEFAULT_PAGE_SIZE = 25;

        private static final int DEFAULT_MAX_PAGE_SIZE = 100;

        static Submissions defaults() {
            return new Submissions(DEFAULT_PAGE_SIZE, DEFAULT_MAX_PAGE_SIZE);
        }

        public Submissions {
            // Zero is what an absent property binds to, and is read as "not set"
            // rather than as a page holding nothing.
            defaultPageSize = defaultPageSize == 0 ? DEFAULT_PAGE_SIZE : defaultPageSize;
            maxPageSize = maxPageSize == 0 ? DEFAULT_MAX_PAGE_SIZE : maxPageSize;

            if (defaultPageSize < 1 || maxPageSize < 1) {
                throw new IllegalArgumentException("A queue page holds at least one campaign");
            }
            if (defaultPageSize > maxPageSize) {
                // Otherwise every request naming no size is refused by the ceiling --
                // a start-up problem wearing a runtime costume.
                throw new IllegalArgumentException("The default queue page cannot exceed the maximum");
            }
        }
    }

    /**
     * §4.5's PL-16 and §4.8's PM-23 (#81): the window a creator may keep open after
     * their campaign has closed.
     *
     * @param maxWindow the furthest ahead a late-pledge window may end, measured from
     *     the moment it is opened. Ninety days, which is a bound on a promise rather
     *     than a technical limit: a late pledge is a commitment to send somebody a
     *     reward, and a campaign still taking money nine months after it closed is one
     *     whose backers are indistinguishable from customers of a shop that has no
     *     stock. A creator who needs longer reopens the window, which is one decision
     *     they have to take again rather than one they took once
     */
    public record LatePledges(Duration maxWindow) {

        private static final Duration DEFAULT_MAX_WINDOW = Duration.ofDays(90);

        public static LatePledges defaults() {
            return new LatePledges(DEFAULT_MAX_WINDOW);
        }

        public LatePledges {
            maxWindow = maxWindow == null ? DEFAULT_MAX_WINDOW : maxWindow;

            if (maxWindow.isZero() || maxWindow.isNegative()) {
                // Zero would mean a window that is closed the moment it opens, which
                // is a campaign that offers late pledges and refuses every one of
                // them. Switching the feature off is `latePledgeEnabled`, per
                // campaign, and it is the creator's rather than an operator's.
                throw new IllegalArgumentException("A late-pledge window is some length of time");
            }
        }
    }

    /**
     * §8.4's {@code campaign-finalizer} (#63).
     *
     * @param schedule when the sweep fires, as a UTC cron expression, or {@code -} to
     *     register the job without scheduling it. <strong>Every minute in production, and
     *     not negotiable downwards.</strong> The value is configuration because
     *     {@link az.ideanest.shared.jobs.ScheduledJob#schedule()} requires every job's to
     *     be — the test profile disables it and drives the pass directly — and not because
     *     an operator has a reason to slow it down: the interval is the maximum time a
     *     campaign spends taking money after its countdown has reached zero
     * @param batchSize the most campaigns one pass closes. <strong>A bound on the pass, not
     *     a target.</strong> Campaigns cluster at midnight and at the ends of months, so
     *     the honest failure mode is a hundred deadlines in the same second; the pass takes
     *     the oldest of them and returns a minute later for the rest, rather than becoming
     *     one run that overlaps its own next tick. Two hundred, matching
     *     {@link Reminders#sendBatchSize()}, because both are one short transaction per row
     *     against an indexed lookup and there is no reason for the platform to hold two
     *     different opinions about how big a sweep is
     * @param successThreshold the share of the goal at which a campaign succeeds — §5.1,
     *     IDN-EXT-01 (#31). {@code 0.80}. Configuration because it is a product decision that
     *     has already moved once, from one hundred per cent; refused at start-up outside
     *     {@code (0, 1]} by the same check {@code CampaignOutcome} applies, so a mistyped
     *     {@code 80} stops the service instead of failing every campaign on the platform
     */
    public record Finalisation(String schedule, int batchSize, BigDecimal successThreshold) {

        /** Every minute, which is what §8.4 says {@code campaign-finalizer} runs at. */
        private static final String DEFAULT_SCHEDULE = "0 * * * * *";

        private static final int DEFAULT_BATCH_SIZE = 200;

        /** IDN-EXT-01: success from eighty per cent of the goal. */
        private static final BigDecimal DEFAULT_SUCCESS_THRESHOLD = new BigDecimal("0.80");

        static Finalisation defaults() {
            return new Finalisation(DEFAULT_SCHEDULE, DEFAULT_BATCH_SIZE, DEFAULT_SUCCESS_THRESHOLD);
        }

        public Finalisation {
            schedule = schedule == null || schedule.isBlank() ? DEFAULT_SCHEDULE : schedule;
            batchSize = batchSize == 0 ? DEFAULT_BATCH_SIZE : batchSize;
            successThreshold = CampaignOutcome.requireThreshold(
                    successThreshold == null ? DEFAULT_SUCCESS_THRESHOLD : successThreshold);

            if (batchSize < 1) {
                // A sweep that closes no campaigns is the feature switched off, and it
                // would be switched off silently — every campaign staying LIVE past its
                // deadline, with nothing in the log saying why. An operator sees this at
                // start-up instead.
                throw new IllegalArgumentException("A finalisation pass that closes no campaigns never closes any");
            }
        }
    }

    /**
     * The story's version history.
     *
     * @param versionInterval how long after the newest version another one may be
     *     written. <strong>This is the number that decides whether the feature is
     *     usable or ruinous.</strong> The editor autosaves every few seconds while
     *     somebody types, so a version per save is thousands of {@code jsonb}
     *     documents for one afternoon's work — a history nobody can read and a
     *     table dominated by rows that differ by one word. Configuration rather
     *     than a literal because it is a judgement about how much work a creator
     *     may lose, and the answer for a staging environment being exercised by a
     *     test is not the answer for production
     * @param versionsKept how many versions survive per project, oldest pruned
     *     first. Fifty at the configured interval is a working day and a half of
     *     recoverable history, which is longer than anybody remembers what they
     *     changed
     */
    public record Story(Duration versionInterval, int versionsKept) {

        /** Contract §5: five minutes, and the last fifty. */
        private static final Duration DEFAULT_INTERVAL = Duration.ofMinutes(5);

        private static final int DEFAULT_VERSIONS_KEPT = 50;

        static Story defaults() {
            return new Story(DEFAULT_INTERVAL, DEFAULT_VERSIONS_KEPT);
        }

        public Story {
            // Binding leaves an omitted property at its zero value, so an
            // operator who configures the interval and not the count gets the
            // documented default rather than a history of nothing.
            versionInterval = versionInterval == null ? DEFAULT_INTERVAL : versionInterval;
            versionsKept = versionsKept == 0 ? DEFAULT_VERSIONS_KEPT : versionsKept;

            if (versionInterval.isNegative()) {
                throw new IllegalArgumentException("The story version interval cannot be negative");
            }
            if (versionsKept < 1) {
                // A negative count is a typo, and "keep no history" is not a
                // configuration of this feature — it is the feature being off, and
                // a version written and pruned in the same transaction is worse
                // than one never written. Refused at start-up, where an operator
                // sees it, rather than at the first autosave.
                throw new IllegalArgumentException("At least one story version has to be kept");
            }
        }
    }

    /**
     * The three numbers §5.3 states as somebody else's decision.
     *
     * <p>Everything else in §5.3 is a literal — sixty characters, sixty days, five
     * hundred characters — and lives in {@code SubmissionChecklist} as a constant.
     * These three do not, and the difference is not stylistic: the goal bounds are
     * a commercial position and the reward floor is a fact about the payment
     * provider (§9.3). Compiling either into the service would mean a release to
     * change a number that was never ours to begin with.
     *
     * <p>Bound here and turned into a {@code SubmissionLimits} by
     * {@code ProjectChecklistService}, so the rules themselves stay a pure type
     * with no Spring in sight.
     *
     * @param goalMinimum the smallest goal a campaign may be submitted with.
     *     Below this the platform spends more on moderating the campaign than the
     *     campaign is trying to raise, and a goal of a few manats is almost always
     *     a test project somebody forgot about
     * @param goalMaximum the largest. Not a technical bound — {@code numeric(14,2)}
     *     holds far more — but a commercial one: above it the platform is
     *     underwriting a collection it has no basis to expect, and the answer
     *     belongs to whoever carries that risk rather than to this file
     * @param rewardPriceMinimum the smallest amount that can be charged at all.
     *     A tier below it is a tier no backer can ever pay for, and §5.3 puts the
     *     floor under every one of them for that reason. One AZN by default,
     *     which is the usual order of magnitude for a card network's minimum;
     *     the real number comes from the provider when there is one
     */
    public record Submission(BigDecimal goalMinimum, BigDecimal goalMaximum, BigDecimal rewardPriceMinimum) {

        /** What {@code application.yml} configures, so an absent block behaves the same. */
        private static final BigDecimal DEFAULT_GOAL_MINIMUM = new BigDecimal("100.00");

        private static final BigDecimal DEFAULT_GOAL_MAXIMUM = new BigDecimal("1000000.00");

        private static final BigDecimal DEFAULT_REWARD_PRICE_MINIMUM = new BigDecimal("1.00");

        static Submission defaults() {
            return new Submission(DEFAULT_GOAL_MINIMUM, DEFAULT_GOAL_MAXIMUM, DEFAULT_REWARD_PRICE_MINIMUM);
        }

        public Submission {
            // Binding leaves an omitted property null, so an operator who sets the
            // maximum and not the minimum gets the documented default rather than a
            // NullPointerException on the first checklist. The bounds themselves are
            // validated by SubmissionLimits, which is where the rule lives.
            goalMinimum = goalMinimum == null ? DEFAULT_GOAL_MINIMUM : goalMinimum;
            goalMaximum = goalMaximum == null ? DEFAULT_GOAL_MAXIMUM : goalMaximum;
            rewardPriceMinimum =
                    rewardPriceMinimum == null ? DEFAULT_REWARD_PRICE_MINIMUM : rewardPriceMinimum;
        }
    }

    /**
     * @param invitationTtl how long an invitation link works. An invitation is not
     *     a standing offer: an address left unaccepted for a week is usually a typo
     *     or somebody who has left the company, and a link that never expires is
     *     edit access to a campaign sitting in an old mailbox. Long enough to
     *     survive a holiday, short enough that a forwarded message is not a
     *     permanent key — the same trade-off as
     *     {@code ideanest.auth.verification-token-ttl}, decided one way for a link
     *     somebody is waiting for and another for one they were not expecting.
     * @param logInvitationLinks whether to write invitation links to the log.
     *     <strong>Local development only</strong>, and false by default. There is
     *     no mail transport (#86), so without this a developer cannot accept an
     *     invitation at all; with it on anywhere else, anybody who can read logs can
     *     take over the editing of an unlaunched campaign. See
     *     {@code application-local.yml} and {@code SmtpVerificationNotifier},
     *     which keeps the same flag for the same reason now that the auth messages
     *     are sent for real.
     */
    public record Collaborators(Duration invitationTtl, boolean logInvitationLinks) {

        /** What {@code application.yml} configures, so an absent block behaves the same. */
        private static final Duration DEFAULT_TTL = Duration.ofDays(7);

        static Collaborators defaults() {
            // Logging is off, which is the safe half of the pair: a developer who
            // needs the link turns it on in application-local.yml deliberately.
            return new Collaborators(DEFAULT_TTL, false);
        }

        public Collaborators {
            invitationTtl = invitationTtl == null ? DEFAULT_TTL : invitationTtl;

            if (!invitationTtl.isPositive()) {
                // Zero is every invitation expiring before the mail is read, which
                // reads to a creator as the feature being broken. An operator sees
                // this at start-up instead.
                throw new IllegalArgumentException("An invitation has to be valid for some length of time");
            }
        }
    }

    /**
     * Launch reminders: how many a stranger may register, and how they are sent.
     *
     * @param signupsPerClient how many reminders one source address may register
     *     per window. {@code POST /v1/projects/{id}/remind} is an unauthenticated
     *     write that puts an arbitrary email address into our database and
     *     promises to send mail to it, which is the shape of an open relay if it
     *     is left unbounded — so the endpoint is limited exactly as registration
     *     is, and for the same reason
     * @param signupsPerAddress how many reminders may be registered <em>for</em>
     *     one address per window, counted separately. The per-client limit alone
     *     bounds a script and does not bound a botnet, and the harm being bounded
     *     here is different: subscribing somebody else's address to every campaign
     *     on the platform is mail-bombing them with our domain on it
     * @param window the period both limits are measured over
     * @param sendSchedule the cron expression §8.4's {@code reminder-sender} runs
     *     on. A property rather than a literal so that the test profile can set it
     *     to {@code -} and drive the sweep directly — a timer firing in the
     *     background of a test suite is a source of failures that reproduce once a
     *     fortnight. The same arrangement as {@code AccountAnonymisationJob}
     * @param sendBatchSize how many reminders one pass of the sweep claims. A
     *     bound on one run rather than a target: a campaign with fifty thousand
     *     followers must not be one transaction, and the sweep runs again a minute
     *     later
     * @param logUnsubscribeLinks whether to write unsubscribe tokens to the log.
     *     <strong>Local development only</strong>, and false by default. There is
     *     no mail transport (#86), so without this a developer cannot exercise the
     *     unsubscribe path at all
     * @param deadlineSchedule the cron expression §8.4's {@code deadline-reminder}
     *     runs on (#90). Five minutes rather than the launch sweep's minute, and
     *     {@code DeadlineReminderJob} argues it: the thresholds are measured in
     *     hours, so nobody can tell a notice sent at 48:00 from one sent at 47:56
     * @param deadlineBatchSize how many campaigns one pass announces per
     *     threshold. A bound on one run rather than a target, exactly as
     *     {@code sendBatchSize} is — and the candidate query is ordered by
     *     deadline, so what a small batch leaves behind is always the least urgent
     *     part of the backlog
     * @param deadlineThresholdHours which of §4.10's thresholds the sweep acts on,
     *     largest first. Configurable rather than a constant because an operator
     *     may need to <em>stop</em> one — a threshold removed here stops being
     *     announced without a release — but the values it may hold are bounded by
     *     {@code deadline_notices_threshold_known}, so adding one is still a
     *     migration and a decision rather than a configuration change
     */
    public record Reminders(
            int signupsPerClient,
            int signupsPerAddress,
            Duration window,
            String sendSchedule,
            int sendBatchSize,
            boolean logUnsubscribeLinks,
            String deadlineSchedule,
            int deadlineBatchSize,
            List<Integer> deadlineThresholdHours) {

        private static final int DEFAULT_SIGNUPS_PER_CLIENT = 20;

        private static final int DEFAULT_SIGNUPS_PER_ADDRESS = 5;

        private static final Duration DEFAULT_WINDOW = Duration.ofMinutes(15);

        /** Every minute, which is what §8.4 says {@code reminder-sender} runs at. */
        private static final String DEFAULT_SCHEDULE = "0 * * * * *";

        private static final int DEFAULT_BATCH_SIZE = 200;

        /** Every five minutes. See {@code DeadlineReminderJob} for why not every minute. */
        private static final String DEFAULT_DEADLINE_SCHEDULE = "0 */5 * * * *";

        private static final int DEFAULT_DEADLINE_BATCH_SIZE = 200;

        /** §4.10's two deadline rows, largest first. */
        private static final List<Integer> DEFAULT_DEADLINE_THRESHOLDS = List.of(48, 24);

        static Reminders defaults() {
            return new Reminders(
                    DEFAULT_SIGNUPS_PER_CLIENT,
                    DEFAULT_SIGNUPS_PER_ADDRESS,
                    DEFAULT_WINDOW,
                    DEFAULT_SCHEDULE,
                    DEFAULT_BATCH_SIZE,
                    false,
                    DEFAULT_DEADLINE_SCHEDULE,
                    DEFAULT_DEADLINE_BATCH_SIZE,
                    DEFAULT_DEADLINE_THRESHOLDS);
        }

        public Reminders {
            // Binding leaves an omitted property at its zero value, so an operator
            // who configures the window and not the counts gets the documented
            // defaults rather than an endpoint that refuses everybody.
            signupsPerClient = signupsPerClient == 0 ? DEFAULT_SIGNUPS_PER_CLIENT : signupsPerClient;
            signupsPerAddress = signupsPerAddress == 0 ? DEFAULT_SIGNUPS_PER_ADDRESS : signupsPerAddress;
            window = window == null ? DEFAULT_WINDOW : window;
            sendSchedule = sendSchedule == null || sendSchedule.isBlank() ? DEFAULT_SCHEDULE : sendSchedule;
            sendBatchSize = sendBatchSize == 0 ? DEFAULT_BATCH_SIZE : sendBatchSize;
            deadlineSchedule = deadlineSchedule == null || deadlineSchedule.isBlank()
                    ? DEFAULT_DEADLINE_SCHEDULE
                    : deadlineSchedule;
            deadlineBatchSize = deadlineBatchSize == 0 ? DEFAULT_DEADLINE_BATCH_SIZE : deadlineBatchSize;
            // Null is "not configured" and gets the defaults; an explicitly empty list is an
            // operator switching the sweep off, which is a configuration of it and is kept.
            deadlineThresholdHours =
                    deadlineThresholdHours == null ? DEFAULT_DEADLINE_THRESHOLDS : List.copyOf(deadlineThresholdHours);

            if (signupsPerClient < 1 || signupsPerAddress < 1) {
                // A limit of zero is the endpoint switched off, which is not a
                // configuration of this feature. An operator sees this at start-up
                // rather than as every follower being refused.
                throw new IllegalArgumentException("A reminder rate limit has to allow at least one attempt");
            }
            if (!window.isPositive()) {
                throw new IllegalArgumentException("A rate limit window has to be a length of time");
            }
            if (sendBatchSize < 1) {
                throw new IllegalArgumentException("A sweep that claims no reminders never sends any");
            }
            if (deadlineBatchSize < 1) {
                throw new IllegalArgumentException("A sweep that announces no campaigns never announces any");
            }
            for (Integer threshold : deadlineThresholdHours) {
                if (threshold == null || threshold < 1) {
                    // Refused at start-up rather than at the first sweep, where it would be an
                    // interval of zero hours -- a window matching every campaign that has
                    // already closed, which the lower bound then rejects one row at a time.
                    throw new IllegalArgumentException(
                            "A deadline threshold is a positive number of hours, not " + threshold);
                }
            }
        }
    }
}
