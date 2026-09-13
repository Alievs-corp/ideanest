package az.ideanest.payment;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Payment settings: which provider, how a campaign is collected, and §9.6's schedule.
 *
 * @param provider which adapter the platform uses. See {@link Provider}
 * @param collection §8.4's two collection jobs and §9.6's timings
 * @param circuitBreaker what happens when the provider stops answering
 * @param webhooks §17.2's replay tolerance
 */
@ConfigurationProperties(prefix = "ideanest.payment")
public record PaymentProperties(
        Provider provider,
        Collection collection,
        CircuitBreaker circuitBreaker,
        Webhooks webhooks,
        Reconciliation reconciliation,
        Epoint epoint) {

    public PaymentProperties {
        // A deployment that configures none of these still starts, for ProjectProperties'
        // reason: a nested record binds to null when its whole block is absent, and a null
        // here would be a NullPointerException at the first collection rather than a
        // configuration error at start-up.
        provider = provider == null ? Provider.defaults() : provider;
        collection = collection == null ? Collection.defaults() : collection;
        circuitBreaker = circuitBreaker == null ? CircuitBreaker.defaults() : circuitBreaker;
        webhooks = webhooks == null ? Webhooks.defaults() : webhooks;
        reconciliation = reconciliation == null ? Reconciliation.defaults() : reconciliation;
        epoint = epoint == null ? Epoint.defaults() : epoint;
    }

    /**
     * §8.4's {@code ledger-reconciliation} — issue #70.
     *
     * @param schedule when the pass fires, as a UTC cron expression, or {@code -} to register
     *     the job without scheduling it. §8.4 says daily; the hour is deliberately not
     *     midnight, because midnight is when every other daily job on every other system runs
     *     and a reconciliation that competes with the nightly backup for the same connections
     *     is a reconciliation that is slow for a reason nobody will find
     */
    /**
     * The Epoint.az adapter, API v1.0.3 — IDN-EXT-01 (#38).
     *
     * <p>Used only when {@code provider.primary} is {@code EPOINT}, and then all three of the base
     * URL and the two keys are required at start-up: a deployment naming a provider it cannot sign
     * requests for is discovered on a backer's first payment otherwise.
     *
     * @param baseUrl Epoint's API root, {@code https://epoint.az/api/1}
     * @param publicKey the merchant identifier Epoint issues
     * @param privateKey the signing key. Never printed — see {@link #toString()}
     * @param language the payment page's language when a request names none: az, en or ru
     */
    public record Epoint(String baseUrl, String publicKey, String privateKey, String language) {

        public static Epoint defaults() {
            return new Epoint("", "", "", "az");
        }

        public Epoint {
            baseUrl = baseUrl == null ? "" : baseUrl.trim();
            publicKey = publicKey == null ? "" : publicKey.trim();
            privateKey = privateKey == null ? "" : privateKey.trim();
            language = language == null || language.isBlank() ? "az" : language.trim();
        }

        public boolean isComplete() {
            return !baseUrl.isBlank() && !publicKey.isBlank() && !privateKey.isBlank();
        }

        /** A record prints every component, and the private key would reach a log with it. */
        @Override
        public String toString() {
            return "Epoint[baseUrl=" + baseUrl + ", publicKey=" + publicKey + ", privateKey=<redacted>, language="
                    + language + "]";
        }
    }

    public record Reconciliation(String schedule) {

        private static final String DEFAULT_SCHEDULE = "0 30 2 * * *";

        public static Reconciliation defaults() {
            return new Reconciliation(DEFAULT_SCHEDULE);
        }

        public Reconciliation {
            schedule = schedule == null || schedule.isBlank() ? DEFAULT_SCHEDULE : schedule;
        }
    }

    /**
     * Which provider the platform charges through.
     *
     * @param primary the {@code ProviderName} of the adapter to use, or blank for none.
     *     <strong>Blank is the shipped default and the deployed reality</strong>: #60 has
     *     not been answered, no adapter exists, and §9.2 says why a stub would be worse
     *     than nothing. A blank value is what makes {@code CollectionRun} refuse to
     *     collect rather than fail per pledge.
     *     <p>A value naming a provider with no adapter on the classpath is a start-up
     *     failure and not a warning: a deployment that thinks it can collect and cannot
     *     is the configuration mistake that is only discovered on the day a campaign
     *     closes.
     */
    public record Provider(String primary) {

        public static Provider defaults() {
            return new Provider("");
        }

        public Provider {
            primary = primary == null ? "" : primary.trim();
        }

        /** Whether a deployment has named a provider at all. */
        public boolean isConfigured() {
            return !primary.isEmpty();
        }
    }

    /**
     * §8.4's {@code charge-processor} and {@code charge-retry}, and §9.6's schedule.
     *
     * @param schedule when {@code charge-processor} fires. Every minute in §8.4, and
     *     {@code -} in the test profile so that a timer does not charge the very pledges
     *     a test is about to charge itself
     * @param retrySchedule when {@code charge-retry} fires. Every six hours in §8.4,
     *     which is the right granularity for a schedule measured in days
     * @param campaignsPerPass how many campaigns one pass may open the collection of.
     *     Bounded because campaigns cluster at midnight
     * @param chargesPerPass <strong>§9.3's R-09, expressed as a rate.</strong> This is the
     *     rate limit: at a hundred charges a minute the platform makes roughly 1.7
     *     requests a second to a provider, which is a figure that can be put in front of
     *     one rather than discovered by it. The remainder is a minute away
     * @param dropsPerPass how many pledges past their window one retry pass may drop
     * @param retryWindow §9.6's seven days, after which a pledge is dropped. Frozen onto
     *     each pledge when it is queued, so changing this does not move a window already
     *     promised — V42 has the argument
     * @param attemptDelays §9.6's four rows, as delays from the campaign's close:
     *     immediately, +24 hours, +72 hours, +5 days. <strong>A list rather than four
     *     properties</strong>, because the number of attempts is part of the policy — a
     *     fifth attempt is one entry here rather than a code change — and because the
     *     list's length is the only place "how many attempts does a backer get" is
     *     written down
     * @param unresolvedRecheck how long to wait before asking the provider again about a
     *     charge it accepted and has not decided. Not one of §9.6's attempts and
     *     deliberately much shorter than any of them: the platform is waiting on an
     *     answer rather than on a backer to change their card
     * @param statementDescriptor what a backer sees on their statement. A charge sixty
     *     days after a pledge is exactly the charge somebody disputes because they did
     *     not recognise it
     */
    public record Collection(
            String schedule,
            String retrySchedule,
            int campaignsPerPass,
            int chargesPerPass,
            int dropsPerPass,
            Duration retryWindow,
            List<Duration> attemptDelays,
            Duration unresolvedRecheck,
            String statementDescriptor) {

        private static final List<Duration> DEFAULT_DELAYS =
                List.of(Duration.ZERO, Duration.ofHours(24), Duration.ofHours(72), Duration.ofDays(5));

        public static Collection defaults() {
            return new Collection(
                    "0 * * * * *",
                    "0 0 0/6 * * *",
                    20,
                    100,
                    200,
                    Duration.ofDays(7),
                    DEFAULT_DELAYS,
                    Duration.ofHours(1),
                    "IdeaNest");
        }

        public Collection {
            schedule = schedule == null || schedule.isBlank() ? "0 * * * * *" : schedule;
            retrySchedule = retrySchedule == null || retrySchedule.isBlank() ? "0 0 0/6 * * *" : retrySchedule;
            campaignsPerPass = campaignsPerPass < 1 ? 20 : campaignsPerPass;
            chargesPerPass = chargesPerPass < 1 ? 100 : chargesPerPass;
            dropsPerPass = dropsPerPass < 1 ? 200 : dropsPerPass;
            retryWindow = retryWindow == null ? Duration.ofDays(7) : retryWindow;
            attemptDelays = attemptDelays == null || attemptDelays.isEmpty()
                    ? DEFAULT_DELAYS
                    : List.copyOf(attemptDelays);
            unresolvedRecheck = unresolvedRecheck == null ? Duration.ofHours(1) : unresolvedRecheck;
            statementDescriptor = statementDescriptor == null || statementDescriptor.isBlank()
                    ? "IdeaNest"
                    : statementDescriptor.trim();

            for (Duration delay : attemptDelays) {
                if (delay == null || delay.isNegative()) {
                    throw new IllegalArgumentException("§9.6's delays run forwards; one is " + delay);
                }
            }
        }

        /** How many attempts §9.6 gives a backer. The length of the schedule, and nothing else. */
        public int maxAttempts() {
            return attemptDelays.size();
        }
    }

    /**
     * §9.3's warning made operational: "if the primary is unavailable on the day a large
     * campaign closes, the entire business stops".
     *
     * <p>The breaker does not keep the business running — only a second provider does,
     * and that is #61's interface plus an adapter nobody has written. What it does is
     * stop the platform spending a whole pass, every minute, discovering the same outage
     * four thousand times, and stop it turning a provider's bad ten minutes into four
     * thousand rows in its own log.
     *
     * @param failureThreshold how many consecutive {@code ProviderUnavailableException}s
     *     open it. <strong>Declines never count</strong> — §9.6 puts them at 5–15% of a
     *     campaign, so a breaker that counted them would open on a perfectly healthy
     *     Tuesday
     * @param cooldown how long it stays open. One pass of {@code charge-processor} by
     *     default, so the next tick tries again: long enough that the pass which found
     *     the outage stops, short enough that recovery is automatic and unnoticed
     */
    public record CircuitBreaker(int failureThreshold, Duration cooldown) {

        public static CircuitBreaker defaults() {
            return new CircuitBreaker(5, Duration.ofMinutes(1));
        }

        public CircuitBreaker {
            failureThreshold = failureThreshold < 1 ? 5 : failureThreshold;
            cooldown = cooldown == null ? Duration.ofMinutes(1) : cooldown;
        }
    }

    /**
     * §17.2's webhook controls.
     *
     * @param tolerance how far a provider's signed timestamp may be from ours before the
     *     delivery is refused as a replay. Five minutes: long enough to absorb clock
     *     skew and a provider's own queueing, short enough that a captured request is
     *     not a usable instruction an hour later. The signature stays valid for ever —
     *     that is what a signature is — so this window is the only thing that expires
     */
    public record Webhooks(Duration tolerance) {

        public static Webhooks defaults() {
            return new Webhooks(Duration.ofMinutes(5));
        }

        public Webhooks {
            tolerance = tolerance == null ? Duration.ofMinutes(5) : tolerance;
        }
    }
}
