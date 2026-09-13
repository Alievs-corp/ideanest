package az.ideanest.payout.infrastructure;

import az.ideanest.payout.domain.BackerDispute;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** IDN-EXT-01 (#43). */
public interface BackerDisputeRepository extends JpaRepository<BackerDispute, UUID> {

    @Query(
            """
            SELECT d FROM BackerDispute d
            WHERE d.pledgeId = :pledgeId AND d.state = az.ideanest.payout.domain.BackerDisputeState.OPEN
            """)
    Optional<BackerDispute> openFor(@Param("pledgeId") UUID pledgeId);

    @Query(
            """
            SELECT d FROM BackerDispute d
            WHERE d.state = az.ideanest.payout.domain.BackerDisputeState.OPEN
            ORDER BY d.openedAt ASC
            """)
    List<BackerDispute> queue(Pageable page);
}
