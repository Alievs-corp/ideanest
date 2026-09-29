package az.ideanest.pledge.infrastructure;

import az.ideanest.pledge.domain.PledgeRaiseLine;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The add-on and hold lines of a raise — #171, V83. */
public interface PledgeRaiseLineRepository extends JpaRepository<PledgeRaiseLine, PledgeRaiseLine.Key> {

    @Query("SELECT line FROM PledgeRaiseLine line WHERE line.id.raiseId = :raiseId ORDER BY line.id.rewardTierId")
    List<PledgeRaiseLine> findByRaise(@Param("raiseId") UUID raiseId);
}
