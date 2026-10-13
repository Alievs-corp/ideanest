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
     *
     * <p>The account breaks a tie in {@code updatedAt}, since #419 pages the queue: two rows
     * written in the same instant are otherwise free to swap places between the read of one
     * page and the next, and a row is then shown twice or never.
     */
    @Query("select d from PayoutDestination d where d.state <> :verified order by d.updatedAt asc, d.userId asc")
    List<PayoutDestination> awaiting(DestinationState verified, Pageable page);

    /**
     * {@link #awaiting}, narrowed to one state — #419's filter, in the same order.
     *
     * <p>{@code VERIFIED} stays excluded rather than left to the caller, so asking for verified
     * rows answers an empty page: the queue holds none, whatever it is asked.
     */
    @Query("""
            select d from PayoutDestination d
             where d.state = :state and d.state <> :verified
             order by d.updatedAt asc, d.userId asc
            """)
    List<PayoutDestination> awaitingIn(DestinationState state, DestinationState verified, Pageable page);

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
