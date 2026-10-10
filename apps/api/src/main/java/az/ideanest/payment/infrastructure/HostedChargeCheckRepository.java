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
