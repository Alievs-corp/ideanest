package az.ideanest.fx.application;

import az.ideanest.fx.FxProperties;
import az.ideanest.shared.jobs.ScheduledJob;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §21.2's hourly cache: {@code exchange-rate-refresh} — issue #327.
 *
 * <h2>Hourly, over a source that publishes daily</h2>
 *
 * Those are not in conflict, and it is worth saying which is which. §21.2 asks for the rates
 * to be "cached hourly"; the Central Bank of Azerbaijan publishes on working days. The hour
 * is therefore <strong>how quickly the platform notices a new publication</strong>, not how
 * often the number changes — and the practical value of it is the morning a new rate lands,
 * where an hourly pass has it inside the hour and a daily pass might not until tomorrow.
 *
 * <p>Eleven of the twelve daily passes therefore write nothing. That is the design and not
 * waste: {@link RateStore} asks one indexed question per currency, and the alternative — an
 * UPSERT — would keep the table at forty rows and lose the answer to "what was the official
 * rate the day this pledge was made".
 *
 * <h2>The fetch is outside the transaction, and the write is inside one</h2>
 *
 * {@link RateStore} is a separate bean rather than a {@code @Transactional} method here, and
 * the reason is mechanical rather than stylistic: a self-invoked annotated method does not
 * go through the proxy, so the annotation would have had no effect at all. Splitting them
 * also puts the boundary where it belongs — an HTTP call to a third party has no business
 * inside a database transaction.
 *
 * <h2>NOTHING IS ASKED FOR WHEN THE FEATURE IS OFF</h2>
 *
 * {@code ideanest.fx.enabled} is false by default, and the check is here rather than only at
 * the scheduler: turning the feature on means the service makes an outbound call to a third
 * party on a timer, and a deployment that has not decided to do that must not start because
 * it upgraded. A disabled deployment registers the job — so {@code /admin/health} lists it
 * and says it is not running — and the pass returns without a request.
 *
 * <h2>A source that cannot be reached is a WARN and not a failure</h2>
 *
 * Throwing is how a {@code ScheduledJob} reports that it could not run: the runner counts
 * the attempt, backs off exponentially and eventually marks the job {@code DEAD}. Applied
 * here that would mean a central bank's bad afternoon permanently stopping the refresh until
 * somebody reset a row by hand — for a feature whose failure mode is that an approximation
 * disappears from a screen.
 *
 * <p>So an outage is logged and the pass returns. What makes that safe rather than silent is
 * the age check on the other side: {@code ExchangeRates} stops offering a currency whose
 * newest rate is older than {@code ideanest.fx.max-age}, so a source that is genuinely gone
 * takes the feature off the screen within days rather than leaving a stale figure on it for
 * ever.
 */
@Component
public class ExchangeRateRefreshJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(ExchangeRateRefreshJob.class);

    private final RateSource source;
    private final RateStore store;
    private final FxProperties properties;

    public ExchangeRateRefreshJob(RateSource source, RateStore store, FxProperties properties) {
        this.source = source;
        this.store = store;
        this.properties = properties;
    }

    /** §8.4's name for it. */
    @Override
    public String name() {
        return "exchange-rate-refresh";
    }

    @Override
    public String schedule() {
        return properties.refreshSchedule();
    }

    @Override
    public void run() {
        refresh();
    }

    /**
     * One pass.
     *
     * @return how many rates were stored — zero on almost every pass, because the source
     *     publishes daily and this asks hourly
     */
    public int refresh() {
        if (!properties.enabled()) {
            return 0;
        }

        List<PublishedRate> published;
        try {
            published = source.fetch();
        } catch (RateSourceUnavailableException unavailable) {
            // WARN and not ERROR, and not a throw. See the class note: the consequence of
            // this failing is an approximation disappearing from a screen, and §18.1's
            // ERROR level is reserved for things somebody is woken for.
            log.warn("Could not refresh exchange rates; the last ones stand until they age out.", unavailable);
            return 0;
        }

        return store.store(source.name(), published);
    }
}
