package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.CreatorDebt;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** IDN-EXT-01 (#43). */
public interface CreatorDebtRepository extends JpaRepository<CreatorDebt, UUID> {

    /** A creator's unsettled debts in one currency, oldest first, locked for recovery. */
    @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query(
            """
            SELECT d FROM CreatorDebt d
            WHERE d.creatorId = :creatorId AND d.currency = :currency AND d.settledAt IS NULL
            ORDER BY d.createdAt ASC
            """)
    List<CreatorDebt> outstandingFor(@Param("creatorId") UUID creatorId, @Param("currency") String currency);

    boolean existsByDisputeId(UUID disputeId);

    /**
     * #587: everything a campaign's creator was made to owe for it, recovered or not, in one currency.
     *
     * <p>{@code LedgerReconciliation}'s answer to a campaign that holds less than nothing: a chargeback lost
     * after its payout takes the money out of escrow and puts it on the creator, so a shortfall this sum
     * covers is explained, and one it does not cover is what the check is for.
     */
    @Query("SELECT COALESCE(SUM(d.amount), 0) FROM CreatorDebt d WHERE d.projectId = :projectId AND d.currency = :currency")
    BigDecimal owedFor(@Param("projectId") UUID projectId, @Param("currency") String currency);
}
