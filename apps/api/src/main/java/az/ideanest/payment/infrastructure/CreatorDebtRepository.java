package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.CreatorDebt;
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
}
