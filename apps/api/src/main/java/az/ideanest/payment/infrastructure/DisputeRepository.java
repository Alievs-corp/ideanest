package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.Dispute;
import az.ideanest.payment.domain.DisputeState;
import az.ideanest.payment.domain.ProviderName;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * V54's disputes — issues #68 and #308.
 *
 * <p><strong>{@link #byProviderCase} is what makes webhook intake idempotent.</strong>
 * V43 establishes that a provider delivers a webhook more than once by design, so the
 * second delivery has to find the case rather than open a duplicate — and the unique index
 * on {@code (provider, provider_dispute_id)} is what guarantees it even when two
 * deliveries arrive at once.
 *
 * <p>The queue is ordered by deadline with nulls last. A provider that sends no deadline
 * is less urgent than one that does, not more — sorting nulls first would put the cases
 * nobody has a date for above the ones that expire tomorrow.
 */
public interface DisputeRepository extends JpaRepository<Dispute, UUID> {

    /** The case a provider is talking about, if the platform has already opened it. */
    @Query("SELECT d FROM Dispute d WHERE d.provider = :provider AND d.providerDisputeId = :providerDisputeId")
    Optional<Dispute> byProviderCase(
            @Param("provider") ProviderName provider, @Param("providerDisputeId") String providerDisputeId);

    /**
     * The queue: everything unresolved, soonest deadline first.
     *
     * <p>{@code NULLS LAST} in JPQL is spelled with an explicit {@code CASE}, because
     * {@code NULLS LAST} is not portable across every provider's HQL translation — and the
     * one thing worse than a wrong sort on this screen is a sort that is right in
     * development.
     */
    @Query(
            """
            SELECT d FROM Dispute d
            WHERE d.state IN (
                az.ideanest.payment.domain.DisputeState.OPEN,
                az.ideanest.payment.domain.DisputeState.UNDER_REVIEW)
            ORDER BY CASE WHEN d.evidenceDueAt IS NULL THEN 1 ELSE 0 END ASC,
                     d.evidenceDueAt ASC,
                     d.openedAt ASC
            """)
    List<Dispute> queue(Pageable pageable);

    /**
     * Whether the card network is contesting this charge right now — #399. A refund of it is not paid by
     * bank transfer while it is: if the network finds for the backer, they are paid twice.
     */
    @Query(
            """
            SELECT COUNT(d) > 0 FROM Dispute d
            WHERE d.chargeTransactionId = :chargeId
              AND d.state IN (
                  az.ideanest.payment.domain.DisputeState.OPEN,
                  az.ideanest.payment.domain.DisputeState.UNDER_REVIEW)
            """)
    boolean openOnCharge(@Param("chargeId") UUID chargeId);

    /** Every dispute, newest first, for the history behind a resolved one. */
    @Query("SELECT d FROM Dispute d ORDER BY d.openedAt DESC")
    List<Dispute> page(Pageable pageable);

    /** The same, narrowed to one state. Two queries rather than a nullable parameter. */
    @Query("SELECT d FROM Dispute d WHERE d.state = :state ORDER BY d.openedAt DESC")
    List<Dispute> pageByState(@Param("state") DisputeState state, Pageable pageable);
}
