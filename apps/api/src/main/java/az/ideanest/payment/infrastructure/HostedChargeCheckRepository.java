package az.ideanest.payment.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * V95's bookkeeping for the hosted-charge sweep — #353.
 *
 * <p>Not an entity: one row per payment page, written over each time the provider is asked, and read
 * only by {@link PaymentTransactionRepository#unsettledHostedCharges}'s ordering.
 */
@Repository
public class HostedChargeCheckRepository {

    /** What the provider said, as stored in {@code last_state}. */
    public enum State {
        PENDING,
        SUCCEEDED,
        FAILED,
        RETURNED,
        /** The provider could not be asked, or has no adapter here. */
        UNANSWERED
    }

    private final JdbcTemplate jdbc;

    public HostedChargeCheckRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    /**
     * #356: how many unsettled pages opened after {@code openedAfter} were last answered with
     * {@code state} — what the attention gauge publishes.
     */
    public long unsettledLastAnswered(State state, Instant openedAfter) {
        Long count = jdbc.queryForObject(
                """
                SELECT count(*) FROM hosted_charge_checks c
                  JOIN transactions t ON t.id = c.transaction_id
                 WHERE c.last_state = ?
                   AND t.created_at > ?
                   AND NOT EXISTS (SELECT 1 FROM transactions s
                                    WHERE s.provider = t.provider
                                      AND s.provider_transaction_id = t.provider_transaction_id
                                      AND s.status IN ('SUCCEEDED', 'FAILED'))
                """,
                Long.class,
                state.name(),
                Timestamp.from(openedAfter));
        return count == null ? 0 : count;
    }

    public void checked(UUID transactionId, Instant at, State state) {
        jdbc.update(
                """
                INSERT INTO hosted_charge_checks (transaction_id, checked_at, last_state)
                VALUES (?, ?, ?)
                ON CONFLICT (transaction_id) DO UPDATE
                    SET checked_at = EXCLUDED.checked_at, last_state = EXCLUDED.last_state
                """,
                transactionId,
                Timestamp.from(at),
                state.name());
    }
}
