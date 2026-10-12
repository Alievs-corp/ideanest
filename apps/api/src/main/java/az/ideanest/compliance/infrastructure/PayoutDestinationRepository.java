package az.ideanest.compliance.infrastructure;

import az.ideanest.compliance.domain.DestinationState;
import az.ideanest.compliance.domain.PayoutDestination;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** One row per account (#432). The account is the key, so the finder by it is inherited. */
public interface PayoutDestinationRepository extends JpaRepository<PayoutDestination, UUID> {

    /**
     * COMPLIANCE's queue: the destinations waiting on somebody, oldest first.
     *
     * <p>Oldest first rather than newest, because this is a queue and not a feed. A newest-first
     * list is one where a destination filed on a quiet afternoon in March is never reached.
     */
    @Query("select d from PayoutDestination d where d.state <> :verified order by d.updatedAt asc")
    List<PayoutDestination> awaiting(DestinationState verified, Pageable page);

    /**
     * How many other accounts have filed the same IBAN — #394.
     *
     * <p>By fingerprint, under every key still configured, which is what V97's partial index on
     * {@code reference} is for. Two creators paid into one account is either one person with two
     * accounts or somebody being paid on another's behalf, and either is worth a reviewer
     * knowing before they verify.
     */
    @Query("""
            select count(d) from PayoutDestination d
             where d.provider = :provider and d.reference in :fingerprints and d.userId <> :userId
            """)
    long countOthersWithReference(String provider, Collection<String> fingerprints, UUID userId);
}
