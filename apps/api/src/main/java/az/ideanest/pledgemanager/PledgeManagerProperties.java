package az.ideanest.pledgemanager;

import az.ideanest.shared.crypto.Keyring;
import java.time.Duration;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The pledge manager's settings — §4.8 (#73, #74, #75).
 *
 * <p>Every value has a default that a deployment configuring nothing still gets,
 * following {@code CommunityProperties}: binding leaves an omitted property at its
 * zero value, and a page size of zero is a screen that always looks empty.
 *
 * <p><strong>{@link Addresses} is the exception, and deliberately so.</strong> There
 * is no default encryption key. A platform that generated one at start-up would
 * encrypt every address under a key that changes on the next deploy, which is worse
 * than not encrypting them — the rows become unreadable and nobody finds out until a
 * creator tries to ship. So an unconfigured deployment starts, and refuses the first
 * write of an address with a message naming the property. See that record.
 *
 * @param surveys what the survey endpoints allow
 * @param addresses how postal addresses are encrypted at rest
 * @param fulfilment what one tracking import may carry
 */
@ConfigurationProperties(prefix = "ideanest.pledge-manager")
public record PledgeManagerProperties(Surveys surveys, Addresses addresses, Fulfilment fulfilment) {

    public PledgeManagerProperties {
        surveys = surveys == null ? Surveys.defaults() : surveys;
        addresses = addresses == null ? Addresses.unconfigured() : addresses;
        fulfilment = fulfilment == null ? Fulfilment.defaults() : fulfilment;
    }

    public static PledgeManagerProperties defaults() {
        return new PledgeManagerProperties(Surveys.defaults(), Addresses.unconfigured(), Fulfilment.defaults());
    }

    /**
     * What one tracking import may carry — §4.8's PM-20 (#80).
     *
     * @param importRowCap how many parcels one file may describe. It bounds two things
     *     at once and deliberately: the rows read from the document, and the campaign's
     *     backings loaded to check them against. Ten thousand is above every campaign
     *     this platform has run and below the number at which one request holds a
     *     spreadsheet in memory long enough to matter. A file longer than this is not
     *     silently shortened — the response says it was truncated, which is §4.7's
     *     CD-11's rule about a fulfilment list that looks complete and is not
     * @param maxReportedErrors how many refused rows the response names. A creator who
     *     exported the wrong column has four thousand identical failures, and a
     *     response listing all of them is a response the size of the file they sent.
     *     The count is always exact; this bounds only the list
     */
    public record Fulfilment(int importRowCap, int maxReportedErrors) {

        private static final int DEFAULT_IMPORT_ROW_CAP = 10_000;

        private static final int DEFAULT_MAX_REPORTED_ERRORS = 50;

        public static Fulfilment defaults() {
            return new Fulfilment(DEFAULT_IMPORT_ROW_CAP, DEFAULT_MAX_REPORTED_ERRORS);
        }

        public Fulfilment {
            importRowCap = importRowCap == 0 ? DEFAULT_IMPORT_ROW_CAP : importRowCap;
            maxReportedErrors = maxReportedErrors == 0 ? DEFAULT_MAX_REPORTED_ERRORS : maxReportedErrors;

            if (importRowCap < 1) {
                throw new IllegalArgumentException("A tracking import carries at least one parcel");
            }
            if (maxReportedErrors < 1) {
                // Zero would mean an import that refused every row and said which of
                // them only in a log line the creator cannot read.
                throw new IllegalArgumentException("A refused import names at least one of its bad rows");
            }
        }
    }

    /**
     * What the survey endpoints allow — §4.8's PM-01 to PM-06 and PM-24.
     *
     * @param maxQuestions how many questions one survey may hold. A bound rather than
     *     a preference: every question is asked of every backer, so a survey is a form
     *     several thousand people have to finish, and the response rate is what the
     *     creator actually needs. Thirty is more than any campaign has ever needed
     * @param maxRecipients how many backers one send reaches. Kept beside the
     *     platform's audience ceiling rather than derived from it, because a survey is
     *     not a notification fan-out — it writes a row per recipient only when they
     *     answer — and the number that bounds it is the size of a campaign rather than
     *     the cost of a delivery
     * @param nudgeAttempts how many reminders a non-responder gets before the platform
     *     stops. Three: PM-24 asks for reminders, and the difference between a reminder
     *     and a campaign of its own is where this number is set
     * @param nudgeInterval how long after the last contact a reminder may go. Seven
     *     days, so a backer who is away for a week comes back to one message rather
     *     than five
     * @param nudgeSchedule §8.4's {@code survey-nudge}, daily. A property rather than a
     *     constant so the test profile can set it to {@code -} and drive the sweep
     *     directly — a timer firing in the background of a suite acts on the very rows
     *     a test is about to assert on, which is what {@code DeadlineReminderJob}
     *     learned the hard way
     * @param defaultPageSize how many responses a creator's page holds when the request
     *     names no size
     * @param maxPageSize the ceiling on that
     */
    public record Surveys(
            int maxQuestions,
            int maxRecipients,
            int nudgeAttempts,
            Duration nudgeInterval,
            String nudgeSchedule,
            int defaultPageSize,
            int maxPageSize) {

        private static final int DEFAULT_MAX_QUESTIONS = 30;

        private static final int DEFAULT_MAX_RECIPIENTS = 5000;

        private static final int DEFAULT_NUDGE_ATTEMPTS = 3;

        private static final Duration DEFAULT_NUDGE_INTERVAL = Duration.ofDays(7);

        /** §8.4: daily, at nine in the morning. A reminder nobody is judging on promptness. */
        private static final String DEFAULT_NUDGE_SCHEDULE = "0 0 9 * * *";

        private static final int DEFAULT_PAGE_SIZE = 50;

        private static final int DEFAULT_MAX_PAGE_SIZE = 200;

        public static Surveys defaults() {
            return new Surveys(
                    DEFAULT_MAX_QUESTIONS,
                    DEFAULT_MAX_RECIPIENTS,
                    DEFAULT_NUDGE_ATTEMPTS,
                    DEFAULT_NUDGE_INTERVAL,
                    DEFAULT_NUDGE_SCHEDULE,
                    DEFAULT_PAGE_SIZE,
                    DEFAULT_MAX_PAGE_SIZE);
        }

        public Surveys {
            maxQuestions = maxQuestions == 0 ? DEFAULT_MAX_QUESTIONS : maxQuestions;
            maxRecipients = maxRecipients == 0 ? DEFAULT_MAX_RECIPIENTS : maxRecipients;
            nudgeAttempts = nudgeAttempts == 0 ? DEFAULT_NUDGE_ATTEMPTS : nudgeAttempts;
            nudgeInterval = nudgeInterval == null ? DEFAULT_NUDGE_INTERVAL : nudgeInterval;
            nudgeSchedule = nudgeSchedule == null || nudgeSchedule.isBlank()
                    ? DEFAULT_NUDGE_SCHEDULE
                    : nudgeSchedule.trim();
            defaultPageSize = defaultPageSize == 0 ? DEFAULT_PAGE_SIZE : defaultPageSize;
            maxPageSize = maxPageSize == 0 ? DEFAULT_MAX_PAGE_SIZE : maxPageSize;

            if (maxQuestions < 1) {
                throw new IllegalArgumentException("A survey holds at least one question");
            }
            if (maxRecipients < 1) {
                throw new IllegalArgumentException("A survey reaches at least one backer");
            }
            if (nudgeAttempts < 0) {
                // Zero is legitimate and switches reminders off, which is a
                // configuration a deployment might want. Negative is not a number of
                // reminders.
                throw new IllegalArgumentException("A number of reminders is not negative");
            }
            if (!nudgeInterval.isPositive()) {
                throw new IllegalArgumentException("A reminder interval is a length of time");
            }
            if (defaultPageSize < 1 || maxPageSize < 1) {
                throw new IllegalArgumentException("A page of responses holds at least one response");
            }
            if (defaultPageSize > maxPageSize) {
                throw new IllegalArgumentException("The default page cannot exceed the maximum");
            }
        }

        /** Clamped rather than refused. See {@code CommunityProperties.Signals#pageSize}. */
        public int pageSize(Integer requested) {
            if (requested == null || requested < 1) {
                return defaultPageSize;
            }
            return Math.min(requested, maxPageSize);
        }
    }

    /**
     * How postal addresses are encrypted at rest — §17.2 and V36.
     *
     * <h2>There is no default key, and that is the design</h2>
     *
     * <p>A generated one would change on every deploy and would make every stored
     * address unreadable, discovered by a creator trying to ship. A constant one
     * committed to this repository would be a published key, which is not encryption.
     * So an unconfigured deployment has no keys, starts normally, serves every other
     * endpoint, and refuses the first write of an address with a message naming this
     * property.
     *
     * <p><strong>Why start at all rather than fail fast.</strong> The addresses
     * feature is one endpoint of a hundred. A missing key stopping the whole service
     * would take discovery, checkout and the creator dashboard down over a feature the
     * deployment may not have reached yet — and would do it at the worst moment, which
     * is a rolling deploy that has already replaced half the fleet.
     *
     * <p>Since #393 the rules are {@link Keyring}'s, shared with every other keyring, and
     * this record stays where #75 put it so that no deployment's configuration moves.
     *
     * @param primaryKeyId which key new addresses are sealed under. Rotation is: add
     *     the new key to {@code keys}, deploy, then move this label — so that every
     *     instance can read the new key before any instance writes under it
     * @param keys label to base64 key material, 32 bytes each for AES-256. Old keys
     *     stay here after a rotation so that rows written under them remain readable;
     *     a row re-saved is re-sealed under the primary, which is what makes rotation a
     *     migration rather than a rewrite
     */
    public record Addresses(String primaryKeyId, Map<String, String> keys) {

        public static Addresses unconfigured() {
            return new Addresses(null, Map.of());
        }

        public Addresses {
            // The rules are every keyring's, so they are Keyring's: blank is
            // unconfigured, a primary label must name a configured key, and every key
            // is 32 bytes of base64 under a label V36's check constraint accepts.
            Keyring validated = new Keyring(primaryKeyId, keys);
            primaryKeyId = validated.primaryKeyId();
            keys = validated.keys();
        }

        /** The same keys as the shared cipher reads them. */
        public Keyring keyring() {
            return new Keyring(primaryKeyId, keys);
        }

        /** Whether this deployment can store an address at all. */
        public boolean isConfigured() {
            return primaryKeyId != null;
        }

        @Override
        public String toString() {
            // Labels only, for the reason Keyring#toString gives.
            return "Addresses[primary=" + primaryKeyId + ", keys=" + keys.keySet() + "]";
        }
    }
}
