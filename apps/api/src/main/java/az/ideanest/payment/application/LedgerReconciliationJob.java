package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.shared.jobs.ScheduledJob;
import az.ideanest.shared.observability.ReconciliationStatusSource;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §8.4's {@code ledger-reconciliation}, on its trigger — issue #70.
 *
 * <p>{@link LedgerReconciliation} decides what is wrong; this decides when to ask and what
 * happens to the answer. The split is the one every job in this service makes, and here it is
 * load-bearing: the arithmetic is a pure function of two queries and is unit-tested as one,
 * while the logging and the alarm level are operational choices that change without the
 * arithmetic changing.
 *
 * <h2>ERROR, and it means it</h2>
 *
 * Most failures in this service are logged at WARN because they self-heal — a cache hint that
 * was dropped, a provider that was briefly unreachable. A ledger that does not balance does
 * not self-heal, and every hour it stays unnoticed is an hour of money movements built on top
 * of a discrepancy nobody has explained. It is one of the three things §8.4 asks to be alerted
 * on, and it is the one that means somebody is woken up.
 *
 * <p><strong>The job does not throw when it finds something.</strong> Throwing is how a
 * {@code ScheduledJob} reports that it could not run — the runner counts the attempt, backs
 * off and eventually stops scheduling it. A pass that ran perfectly and found a discrepancy
 * has not failed; treating it as a failure would make the platform stop looking, which is
 * precisely the wrong response to having found something.
 *
 * <h2>The last report is kept, and being asked is the point</h2>
 *
 * §8.4's alert is on the imbalance, and there is a second, quieter failure it does not cover:
 * a reconciliation that stops running looks exactly like a platform whose books balance. So
 * the last report is held here and published through {@link #lastReport()}, timestamp
 * included, for §4.11's health screen and for whatever scrapes it — a check that has not run
 * since Tuesday is a finding of its own.
 */
@Component
public class LedgerReconciliationJob implements ScheduledJob, ReconciliationStatusSource {

    private static final Logger log = LoggerFactory.getLogger(LedgerReconciliationJob.class);

    private final LedgerReconciliation reconciliation;
    private final PaymentProperties properties;

    /**
     * The most recent pass, or {@link ReconciliationReport#neverRun()}.
     *
     * <p>An {@link AtomicReference} rather than a field: the job runs on the scheduler's thread
     * and this is read from whichever thread is serving the health endpoint. In memory rather
     * than in a table because it is a fact about this process — two replicas reconcile the same
     * books and either answer is the truth, and a row would be a schema, a migration and a
     * retention rule for something that is regenerated every night.
     */
    private final AtomicReference<ReconciliationReport> last =
            new AtomicReference<>(ReconciliationReport.neverRun());

    public LedgerReconciliationJob(LedgerReconciliation reconciliation, PaymentProperties properties) {
        this.reconciliation = reconciliation;
        this.properties = properties;
    }

    /**
     * Paused while a maintenance window is in force (#214). A reconciliation pass reads the
     * provider's side while the ledger may be mid-migration, and would raise alarms about a
     * difference the maintenance itself is causing.
     */
    @Override
    public boolean pausesDuringMaintenance() {
        return true;
    }

    /** §8.4's {@code ledger-reconciliation}. */
    @Override
    public String name() {
        return "ledger-reconciliation";
    }

    /**
     * The schedule is a property so that the test profile can set it to {@code -} and drive
     * {@link #reconcileNow()} directly. A pass firing in the background of a test suite reads
     * the very ledger rows a payment test is in the middle of writing.
     */
    @Override
    public String schedule() {
        return properties.reconciliation().schedule();
    }

    @Override
    public void run() {
        reconcileNow();
    }

    /**
     * One pass, with its result recorded and reported.
     *
     * @return what it found, so a caller driving it directly can assert on it
     */
    public ReconciliationReport reconcileNow() {
        ReconciliationReport report = reconciliation.reconcile();
        last.set(report);

        if (report.balanced()) {
            // INFO and not DEBUG. "The books balanced at 02:30" is the line somebody looks for
            // when they want to know how long a discrepancy could have been there.
            log.info(
                    "Ledger reconciliation: {} account positions checked, nothing out of place.",
                    report.accountsChecked());
            return report;
        }

        log.error(
                "LEDGER RECONCILIATION FAILED: {} finding(s) across {} account positions. Nothing has been "
                        + "corrected automatically — see §8.4 and issue #70.",
                report.findings().size(),
                report.accountsChecked());
        for (ReconciliationFinding finding : report.findings()) {
            // One line per finding, so a log search on the kind returns the count as well as
            // the fact. The detail carries the figures; §18.1 keeps money out of the general
            // log stream and makes this the exception, because a discrepancy nobody can size
            // is one nobody can triage.
            log.error("Reconciliation finding [{}] in {}: {}", finding.kind(), finding.currency(), finding.detail());
        }
        return report;
    }

    /** The most recent pass. Never null; see {@link ReconciliationReport#hasRun()}. */
    public ReconciliationReport lastReport() {
        return last.get();
    }

    /* ---------------------------------------------------------------------
     * ReconciliationStatusSource — #138's alert reads the same report the log line did.
     * ------------------------------------------------------------------ */

    @Override
    public int findings() {
        return last.get().findings().size();
    }

    @Override
    public Instant lastRunAt() {
        return last.get().runAt();
    }
}
