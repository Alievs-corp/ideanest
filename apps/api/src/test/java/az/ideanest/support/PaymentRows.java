package az.ideanest.support;

import java.util.Collection;
import java.util.UUID;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Removes the payment rows a suite wrote about its own pledges — IDN-EXT-01 (#39, #40).
 *
 * <p>{@code transactions} and {@code ledger_entries} refuse DELETE by trigger, which is the point of
 * them, and {@code refunds} points at both. A suite that pays for a pledge through the real flow
 * therefore leaves rows that make every other suite's {@code DELETE FROM pledges} or
 * {@code DELETE FROM projects} fail on a foreign key — which suite breaks depends only on the order
 * the classes happen to run in. So the suite that made them removes them, and only them, with the
 * user triggers switched off for the length of three statements, as {@code BackerAgreementApiTests}
 * does for published documents.
 *
 * <p>Safe because JUnit runs test classes one at a time here. The pledges themselves are left for
 * whichever suite clears pledges next; nothing refuses deleting them once these rows are gone.
 */
public final class PaymentRows {

    private PaymentRows() {
    }

    public static void clearPledges(DataSource dataSource, Collection<UUID> pledgeIds) {
        if (pledgeIds.isEmpty()) {
            return;
        }
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Object[] ids = pledgeIds.toArray();
        String in = pledgeIds.stream().map(id -> "?").collect(Collectors.joining(", "));
        jdbc.execute("ALTER TABLE ledger_entries DISABLE TRIGGER USER");
        jdbc.execute("ALTER TABLE refunds DISABLE TRIGGER USER");
        jdbc.execute("ALTER TABLE transactions DISABLE TRIGGER USER");
        try {
            jdbc.update(
                    "DELETE FROM ledger_entries WHERE transaction_id IN"
                            + " (SELECT id FROM transactions WHERE pledge_id IN (" + in + "))",
                    ids);
            jdbc.update(
                    "DELETE FROM creator_debts WHERE dispute_id IN (SELECT id FROM disputes WHERE pledge_id IN (" + in + "))",
                    ids);
            jdbc.update("DELETE FROM disputes WHERE pledge_id IN (" + in + ")", ids);
            jdbc.update("DELETE FROM refunds WHERE pledge_id IN (" + in + ")", ids);
            jdbc.update("DELETE FROM transactions WHERE pledge_id IN (" + in + ")", ids);
        } finally {
            jdbc.execute("ALTER TABLE transactions ENABLE TRIGGER USER");
            jdbc.execute("ALTER TABLE refunds ENABLE TRIGGER USER");
            jdbc.execute("ALTER TABLE ledger_entries ENABLE TRIGGER USER");
        }
    }

    /**
     * The payment rows about whole campaigns: {@link #clearPledges}' rows, and a payout's own transaction and
     * postings, which name no pledge. IDN-EXT-01 (#43).
     */
    public static void clearProjects(DataSource dataSource, Collection<UUID> projectIds) {
        if (projectIds.isEmpty()) {
            return;
        }
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Object[] ids = projectIds.toArray();
        String in = projectIds.stream().map(id -> "?").collect(Collectors.joining(", "));
        jdbc.update("DELETE FROM creator_debts WHERE project_id IN (" + in + ")", ids);
        jdbc.update("DELETE FROM payout_approvals WHERE payout_id IN (SELECT id FROM payouts WHERE project_id IN (" + in + "))", ids);
        jdbc.update("DELETE FROM payouts WHERE project_id IN (" + in + ")", ids);
        jdbc.execute("ALTER TABLE ledger_entries DISABLE TRIGGER USER");
        jdbc.execute("ALTER TABLE refunds DISABLE TRIGGER USER");
        jdbc.execute("ALTER TABLE transactions DISABLE TRIGGER USER");
        try {
            jdbc.update("DELETE FROM ledger_entries WHERE project_id IN (" + in + ")", ids);
            jdbc.update("DELETE FROM disputes WHERE project_id IN (" + in + ")", ids);
            jdbc.update("DELETE FROM refunds WHERE project_id IN (" + in + ")", ids);
            jdbc.update("DELETE FROM transactions WHERE project_id IN (" + in + ")", ids);
        } finally {
            jdbc.execute("ALTER TABLE transactions ENABLE TRIGGER USER");
            jdbc.execute("ALTER TABLE refunds ENABLE TRIGGER USER");
            jdbc.execute("ALTER TABLE ledger_entries ENABLE TRIGGER USER");
        }
    }
}
