package az.ideanest.payment;

import az.ideanest.payment.domain.ProviderName;
import java.time.Duration;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Payment settings: which provider, and how its pages, refunds and callbacks are handled.
 *
 * @param provider which adapter the platform uses. See {@link Provider}
 * @param circuitBreaker what happens when the provider stops answering
 * @param webhooks §17.2's replay tolerance
 */
@ConfigurationProperties(prefix = "ideanest.payment")
public record PaymentProperties(
        Provider provider,
        CircuitBreaker circuitBreaker,
        Webhooks webhooks,
        Reconciliation reconciliation,
        Epoint epoint,
        Refunds refunds,
        Payriff payriff,
        HostedCharges hostedCharges) {

    public PaymentProperties {
        // A deployment that configures none of these still starts, for ProjectProperties'
        // reason: a nested record binds to null when its whole block is absent, and a null
        // here would be a NullPointerException at the first payment rather than a
        // configuration error at start-up.
        provider = provider == null ? Provider.defaults() : provider;
        circuitBreaker = circuitBreaker == null ? CircuitBreaker.defaults() : circuitBreaker;
        webhooks = webhooks == null ? Webhooks.defaults() : webhooks;
        reconciliation = reconciliation == null ? Reconciliation.defaults() : reconciliation;
        epoint = epoint == null ? Epoint.defaults() : epoint;
        refunds = refunds == null ? Refunds.defaults() : refunds;
        payriff = payriff == null ? Payriff.defaults() : payriff;
        hostedCharges = hostedCharges == null ? HostedCharges.defaults() : hostedCharges;
    }

    /**
     * {@code hosted-charge-sweep} — #353: the payment pages whose callback never came.
     *
     * @param schedule when the sweep fires, or {@code -} to register it without scheduling
     * @param perPass how many pages one pass asks the provider about
     * @param answeredAfter how old a pending page is before the provider is asked. Long enough that
     *     the callback, which normally arrives within seconds, has had every chance first
     * @param askedFor how long after it was opened a page is still asked about. A page abandoned
     *     unpaid stays pending at some providers for ever, and the window is what stops the sweep
     *     asking about it for ever
     */
    public record HostedCharges(String schedule, int perPass, Duration answeredAfter, Duration askedFor) {

        public static HostedCharges defaults() {
            return new HostedCharges("0 */5 * * * *", 50, Duration.ofMinutes(15), Duration.ofDays(7));
        }

        public HostedCharges {
            schedule = schedule == null || schedule.isBlank() ? "0 */5 * * * *" : schedule;
            perPass = perPass < 1 ? 50 : perPass;
            answeredAfter = answeredAfter == null ? Duration.ofMinutes(15) : answeredAfter;
            askedFor = askedFor == null ? Duration.ofDays(7) : askedFor;
            if (askedFor.compareTo(answeredAfter) <= 0) {
                throw new IllegalArgumentException(
                        "hosted-charges.asked-for (" + askedFor + ") must be longer than answered-after (" + answeredAfter + ")");
            }
        }
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

    /**
     * The Payriff adapter, Gateway API v3 — #351.
     *
     * <p>Used only when {@code provider.primary} is {@code PAYRIFF}, and then the secret key and an
     * https callback address are required at start-up. A Payriff application in Development status
     * is the sandbox: the same base URL, test cards only.
     *
     * @param baseUrl Payriff's v3 root, {@code https://api.payriff.com/api/v3}
     * @param secretKey the application's secret key, sent as {@code Authorization}. Never printed
     * @param callbackUrl where Payriff posts an order's news: this service's
     *     {@code /v1/webhooks/psp/payriff}
     * @param language the payment page's language when a request names none: az, en or ru
     * @param refundWindowClosedCodes the {@code /refund} answer codes that can mean "this payment is too
     *     old to refund" (#399), which route the refund to a bank transfer instead of failing it.
     *     Payriff confirmed {@code 01000} with the message "Refund time expired" (#417, support ticket
     *     840029). {@code 01000} is Payriff's general business refusal, so the code alone would turn an
     *     ordinary refusal into a bank transfer; {@code refundWindowClosedMessages} narrows it
     * @param refundWindowClosedMessages text one of which the answer's {@code message} must contain,
     *     ignoring case, for a listed code to mean a closed window. Empty means the code alone decides.
     *     Any other refusal is recorded failed and staff route it by hand
     *     ({@code POST /v1/admin/refunds/{id}/bank-transfer}); the refund window in
     *     {@link Refunds#windows} keeps most of them from reaching Payriff at all
     */
    public record Payriff(
            String baseUrl,
            String secretKey,
            String callbackUrl,
            String language,
            List<String> refundWindowClosedCodes,
            List<String> refundWindowClosedMessages) {

        private static final String DEFAULT_BASE_URL = "https://api.payriff.com/api/v3";

        public static Payriff defaults() {
            return new Payriff(DEFAULT_BASE_URL, "", "", "az", List.of("01000"), List.of("Refund time expired"));
        }

        public Payriff {
            baseUrl = baseUrl == null || baseUrl.isBlank() ? DEFAULT_BASE_URL : baseUrl.trim();
            secretKey = secretKey == null ? "" : secretKey.trim();
            callbackUrl = callbackUrl == null ? "" : callbackUrl.trim();
            language = language == null || language.isBlank() ? "az" : language.trim();
            refundWindowClosedCodes = trimmed(refundWindowClosedCodes);
            refundWindowClosedMessages = trimmed(refundWindowClosedMessages);
        }

        /** Whether a {@code /refund} answer says the payment is too old to refund. */
        public boolean meansWindowClosed(String code, String message) {
            if (code == null || !refundWindowClosedCodes.contains(code.trim())) {
                return false;
            }
            if (refundWindowClosedMessages.isEmpty()) {
                return true;
            }
            String said = message == null ? "" : message.toLowerCase(Locale.ROOT);
            return refundWindowClosedMessages.stream()
                    .anyMatch(text -> said.contains(text.toLowerCase(Locale.ROOT)));
        }

        private static List<String> trimmed(List<String> values) {
            return values == null
                    ? List.of()
                    : values.stream()
                            .filter(value -> value != null && !value.isBlank())
                            .map(String::trim)
                            .toList();
        }

        public boolean isComplete() {
            return !secretKey.isBlank() && !callbackUrl.isBlank();
        }

        /** A record prints every component, and the secret key would reach a log with it. */
        @Override
        public String toString() {
            return "Payriff[baseUrl=" + baseUrl + ", secretKey=<redacted>, callbackUrl=" + callbackUrl
                    + ", language=" + language + ", refundWindowClosedCodes=" + refundWindowClosedCodes
                    + ", refundWindowClosedMessages=" + refundWindowClosedMessages + "]";
        }
    }

    /**
     * §8.4's {@code campaign-refunds} — IDN-EXT-01 (#40).
     *
     * @param schedule when the sweep fires, or {@code -} to register it without scheduling
     * @param perPass how many paid pledges one pass may refund, and how many lost outcomes it settles
     * @param retryAfter how long a refused refund waits before it is sent again
     * @param unresolvedAfter how old a refund with no recorded outcome is before the provider is asked
     * @param windows #399: how long after a charge each provider still reverses it. A refund of a
     *     charge older than its provider's window is never sent to the provider: it waits for the
     *     backer's bank details and is paid by bank transfer. <strong>A provider with no entry has no
     *     window</strong>, which is the shipped default and the behaviour before #399 — every refund
     *     goes to the provider. Set per deployment, and only once every node runs the release that
     *     reads the new refund states (V99): {@code IDEANEST_PAYMENT_REFUNDS_WINDOWS_PAYRIFF=P28D},
     *     under Payriff's thirty days by a margin, because the window is measured from when the
     *     platform recorded the charge, which is later than when Payriff took it
     * @param withholdProviderFee #436: whether a charge taken <strong>from now on</strong> is refunded
     *     net of the provider's fee if its campaign fails, is suspended or is cancelled. Recorded on the
     *     charge when it is taken ({@code transactions.provider_fee_withheld_on_refund}) and never read
     *     again for that charge, so switching it changes no charge already taken. Off by default, which
     *     is refunded in full; switched on only once the checkout and the terms tell the backer, and
     *     once every node runs the release that reads {@code refunds.withheld_fee} (V101)
     */
    public record Refunds(
            String schedule,
            int perPass,
            Duration retryAfter,
            Duration unresolvedAfter,
            Map<ProviderName, Duration> windows,
            boolean withholdProviderFee) {

        public static Refunds defaults() {
            return new Refunds("0 */10 * * * *", 100, Duration.ofHours(6), Duration.ofHours(1), Map.of(), false);
        }

        public Refunds {
            schedule = schedule == null || schedule.isBlank() ? "0 */10 * * * *" : schedule;
            perPass = perPass < 1 ? 100 : perPass;
            retryAfter = retryAfter == null ? Duration.ofHours(6) : retryAfter;
            unresolvedAfter = unresolvedAfter == null ? Duration.ofHours(1) : unresolvedAfter;
            Map<ProviderName, Duration> checked = new EnumMap<>(ProviderName.class);
            if (windows != null) {
                windows.forEach((provider, window) -> {
                    if (provider == null || window == null) {
                        return;
                    }
                    if (window.isNegative() || window.isZero()) {
                        throw new IllegalArgumentException(
                                "refunds.windows." + provider.slug() + " must be positive, and is " + window);
                    }
                    checked.put(provider, window);
                });
            }
            windows = Map.copyOf(checked);
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
     * @param primary the {@code ProviderName} of the adapter to use, or blank for none. Blank
     *     is the shipped default: an environment that names no provider takes no payments.
     *     <p>A value naming a provider with no adapter on the classpath is a start-up
     *     failure and not a warning: a deployment that thinks it can take payments and
     *     cannot is the configuration mistake that is only discovered by a backer.
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
     * @param cooldown how long it stays open. A minute by default: long enough that the
     *     work which found the outage stops, short enough that recovery is automatic and
     *     unnoticed
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
