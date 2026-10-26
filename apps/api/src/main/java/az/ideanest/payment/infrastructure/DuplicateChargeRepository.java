package az.ideanest.payment.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * V119's record of a second payment for one pledge — #587.
 *
 * <p>Not an entity, for {@link HostedChargeCheckRepository}'s reason: one insert, and the reads are the
 * joins in the refund and payout queries that leave such a charge out of what the creator is owed.
 */
@Repository
public class DuplicateChargeRepository {

    private final JdbcTemplate jdbc;

    public DuplicateChargeRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    /**
     * Records a settled charge as a second payment for its pledge. Idempotent on the charge, so a
     * settlement retried after a rollback cannot record it twice.
     *
     * @return whether this call recorded it
     */
    public boolean record(UUID chargeTransactionId, UUID pledgeId, Instant at) {
        return jdbc.update(
                        """
                        INSERT INTO duplicate_charges (charge_transaction_id, pledge_id, recorded_at)
                        VALUES (?, ?, ?)
                        ON CONFLICT (charge_transaction_id) DO NOTHING
                        """,
                        chargeTransactionId,
                        pledgeId,
                        Timestamp.from(at))
                > 0;
    }
}
