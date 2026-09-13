package az.ideanest.pledge;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Pledge settings.
 *
 * @param reservation how long a checkout may hold a limited reward's place, and
 *     how the places are given back
 * @param rateLimit §17.3's bound on how often one account may pledge
 * @param report the bounds on §4.7's backer report and its export
 */
@ConfigurationProperties(prefix = "ideanest.pledge")
public record PledgeProperties(Reservation reservation, RateLimit rateLimit, Report report) {

    public PledgeProperties {
        // A deployment that configures nothing still starts, for the reason
        // ProjectProperties gives: a nested record binds to null when its whole
        // block is absent, and a null here would be a NullPointerException at the
        // first checkout rather than a configuration error at start-up.
        reservation = reservation == null ? Reservation.defaults() : reservation;
        rateLimit = rateLimit == null ? RateLimit.defaults() : rateLimit;
        report = report == null ? Report.defaults() : report;
    }

    /**
     * §4.7's CD-10 and CD-11: what the backer report will hand out, and how often.
     *
     * <p>Configuration rather than constants because every number here is a judgement
     * about somebody else's campaign. A platform whose largest campaign has four hundred
     * backers and one whose largest has forty thousand want different answers, and finding
     * that out should not need a release.
     *
     * @param pageSize how many backers a page holds when the caller asks for no size.
     *     Fifty, which is what fits a screen a creator scrolls rather than pages through
     * @param maxPageSize the largest page the report will build. A bound on the response
     *     rather than a preference: every row carries a name and an email address, so an
     *     unbounded page is an unbounded amount of personal data in one body
     * @param exportRowCap how many rows one export may contain. <strong>Fifty thousand
     *     is far beyond any campaign this platform has run</strong>, and the point of it is
     *     not the size — it is that the export knows when it hit the ceiling and says so in
     *     the response, rather than handing back a file that is quietly short
     * @param exportsPerAccount how many exports one account may take a window. Low, because
     *     an export is the single most valuable request a stolen token can make on this
     *     surface: it is every backer's name and email address in one file
     * @param exportWindow the period {@link #exportsPerAccount()} is counted over
     */
    public record Report(
            int pageSize, int maxPageSize, int exportRowCap, int exportsPerAccount, Duration exportWindow) {

        private static final int DEFAULT_PAGE_SIZE = 50;

        private static final int DEFAULT_MAX_PAGE_SIZE = 200;

        private static final int DEFAULT_EXPORT_ROW_CAP = 50_000;

        private static final int DEFAULT_EXPORTS_PER_ACCOUNT = 5;

        private static final Duration DEFAULT_EXPORT_WINDOW = Duration.ofMinutes(1);

        static Report defaults() {
            return new Report(
                    DEFAULT_PAGE_SIZE,
                    DEFAULT_MAX_PAGE_SIZE,
                    DEFAULT_EXPORT_ROW_CAP,
                    DEFAULT_EXPORTS_PER_ACCOUNT,
                    DEFAULT_EXPORT_WINDOW);
        }

        public Report {
            // Binding leaves an omitted property at zero, and every zero here is a
            // report nobody can read. The documented default is the fallback rather
            // than "unlimited", for RateLimit's reason.
            pageSize = pageSize == 0 ? DEFAULT_PAGE_SIZE : pageSize;
            maxPageSize = maxPageSize == 0 ? DEFAULT_MAX_PAGE_SIZE : maxPageSize;
            exportRowCap = exportRowCap == 0 ? DEFAULT_EXPORT_ROW_CAP : exportRowCap;
            exportsPerAccount = exportsPerAccount == 0 ? DEFAULT_EXPORTS_PER_ACCOUNT : exportsPerAccount;
            exportWindow = exportWindow == null ? DEFAULT_EXPORT_WINDOW : exportWindow;

            if (pageSize < 1 || maxPageSize < 1 || exportRowCap < 1 || exportsPerAccount < 1) {
                throw new IllegalArgumentException("A backer report returns at least one row, and one export");
            }
            if (pageSize > maxPageSize) {
                // Otherwise a caller that asked for nothing would be refused the
                // default, which is the one page size that must always work.
                throw new IllegalArgumentException(
                        "The default page size (" + pageSize + ") is within the maximum (" + maxPageSize + ")");
            }
            if (!exportWindow.isPositive()) {
                throw new IllegalArgumentException("A rate-limit window is a positive duration");
            }
        }
    }

    /**
     * §17.3: "pledge 10/min per user".
     *
     * <p>Per account rather than per address, like every other limit that applies to
     * a request carrying a token: one stolen access token should be worth one
     * checkout at a time, and an attacker with one token can come from anywhere.
     *
     * <p>What it bounds is not fraud — a card is not even touched here — but the work
     * one caller can make the platform do: every draft settles a stale pledge, reads
     * a campaign, resolves tiers and rates, and takes a row lock on a reward tier. A
     * script looping on the checkout of a popular campaign is contention on exactly
     * the row every other backer needs.
     *
     * @param pledgesPerUser ten. Generous for a person, who makes one draft and
     *     confirms it; low enough that a loop is stopped within seconds
     * @param window one minute
     */
    public record RateLimit(int pledgesPerUser, Duration window) {

        /** §17.3's numbers. */
        private static final int DEFAULT_PLEDGES_PER_USER = 10;

        private static final Duration DEFAULT_WINDOW = Duration.ofMinutes(1);

        static RateLimit defaults() {
            return new RateLimit(DEFAULT_PLEDGES_PER_USER, DEFAULT_WINDOW);
        }

        public RateLimit {
            // Binding leaves an omitted property at its zero value, and a limit of
            // zero is an endpoint nobody can call. §17.3's number is the fallback
            // rather than "unlimited", because failing open on a rate limit is a
            // configuration mistake with no symptom until it is exploited.
            pledgesPerUser = pledgesPerUser == 0 ? DEFAULT_PLEDGES_PER_USER : pledgesPerUser;
            window = window == null ? DEFAULT_WINDOW : window;

            if (pledgesPerUser < 1) {
                throw new IllegalArgumentException("A backer may make at least one pledge a window");
            }
            if (!window.isPositive()) {
                throw new IllegalArgumentException("A rate-limit window is a positive duration");
            }
        }
    }

    /**
     * The reservation window and the sweep that closes it.
     *
     * @param ttl how long a DRAFT pledge holds its place. <strong>Five minutes, and
     *     it is §4.5's number</strong> — "Reserve stock (5 min TTL)" in the pledge
     *     sequence — but it is configuration rather than a constant because it is a
     *     judgement with two costs on opposite sides. Too short and a backer who
     *     goes to find their card comes back to a sold-out tier they had already
     *     chosen; too long and one abandoned checkout keeps a place out of the
     *     market for as long as it lasts, which on a limited early-bird tier is the
     *     difference between a campaign's best hour and its worst. The right answer
     *     will come from watching real checkouts, and it should not need a
     *     deployment
     * @param cleanupSchedule §8.4's {@code reservation-cleaner}, every minute. A
     *     property so that the test profile can set it to {@code -} — Spring's own
     *     value for "do not schedule this" — and drive the sweep directly. A timer
     *     firing in the background of a test suite would claim the very rows a test
     *     is about to assert on, and this one fires every minute
     * @param cleanupBatchSize a bound on one pass, not a target. A campaign that
     *     closed with thousands of drafts in flight must not be one transaction;
     *     the sweep returns a minute later for the rest
     */
    public record Reservation(Duration ttl, String cleanupSchedule, int cleanupBatchSize, Duration paymentWindow) {

        /** §4.5's sequence diagram: "Reserve stock (5 min TTL)". */
        private static final Duration DEFAULT_TTL = Duration.ofMinutes(5);

        /** Every minute, which is what §8.4 says {@code reservation-cleaner} runs at. */
        private static final String DEFAULT_SCHEDULE = "0 * * * * *";

        private static final int DEFAULT_BATCH_SIZE = 200;

        /** IDN-EXT-01 (#39): how long a draft is held once its backer is on the payment page. */
        private static final Duration DEFAULT_PAYMENT_WINDOW = Duration.ofMinutes(15);

        static Reservation defaults() {
            return new Reservation(DEFAULT_TTL, DEFAULT_SCHEDULE, DEFAULT_BATCH_SIZE, DEFAULT_PAYMENT_WINDOW);
        }

        public Reservation {
            // Binding leaves an omitted property at its zero value, so an operator
            // who sets the schedule and not the TTL gets the documented default
            // rather than a reservation that has already expired when it is made.
            ttl = ttl == null ? DEFAULT_TTL : ttl;
            paymentWindow = paymentWindow == null ? DEFAULT_PAYMENT_WINDOW : paymentWindow;
            if (!paymentWindow.isPositive()) {
                throw new IllegalArgumentException("A payment window is a positive duration");
            }
            cleanupSchedule = cleanupSchedule == null || cleanupSchedule.isBlank()
                    ? DEFAULT_SCHEDULE
                    : cleanupSchedule;
            cleanupBatchSize = cleanupBatchSize == 0 ? DEFAULT_BATCH_SIZE : cleanupBatchSize;

            if (!ttl.isPositive()) {
                // A zero or negative TTL is every reservation lapsing the instant it
                // is taken: the sweep would release each place before the backer
                // reached the card form, and the symptom would be checkouts failing
                // at random rather than a configuration error.
                throw new IllegalArgumentException("A reservation TTL is a positive duration");
            }
            if (cleanupBatchSize < 1) {
                throw new IllegalArgumentException("A cleanup batch releases at least one reservation");
            }
        }
    }
}
