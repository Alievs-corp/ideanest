package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.ProviderName;
import az.ideanest.payment.domain.SubscriptionCharge;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SubscriptionChargeRepository extends JpaRepository<SubscriptionCharge, UUID> {

    /**
     * The page a provider event is about, locked: the callback and the sweep can settle the same page
     * at the same moment, and the second must find it settled rather than settle it again.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM SubscriptionCharge c WHERE c.provider = :provider AND c.providerTransactionId = :reference")
    Optional<SubscriptionCharge> lockByOrder(
            @Param("provider") ProviderName provider, @Param("reference") String reference);

    /** #587: whether a plan's page under this order is in this state — for the webhook's gate, PENDING. */
    boolean existsByProviderAndProviderTransactionIdAndStatus(
            ProviderName provider, String providerTransactionId, SubscriptionCharge.Status status);

    /** The newest page still waiting for this subscription, which a second click returns to. */
    Optional<SubscriptionCharge> findFirstBySubscriptionIdAndStatusOrderByOpenedAtDesc(
            UUID subscriptionId, SubscriptionCharge.Status status);

    /**
     * Pages whose callback has not come, opened inside the sweep's window, least recently asked about
     * first — {@code HostedChargeSweepJob}'s queue for pledges, kept the same way.
     */
    /** #457: payments taken for subscriptions that had ended, oldest first — the refund window closes first. */
    @Query("""
            SELECT c FROM SubscriptionCharge c
            WHERE c.status = az.ideanest.payment.domain.SubscriptionCharge.Status.UNAPPLIED
            ORDER BY c.settledAt ASC
            """)
    List<SubscriptionCharge> unapplied();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM SubscriptionCharge c WHERE c.id = :id")
    Optional<SubscriptionCharge> lockById(@Param("id") UUID id);

    @Query("""
            SELECT c FROM SubscriptionCharge c
            WHERE c.status = az.ideanest.payment.domain.SubscriptionCharge.Status.PENDING
              AND c.openedAt >= :openedAfter
              AND c.openedAt < :openedBefore
            ORDER BY c.checkedAt ASC NULLS FIRST, c.openedAt ASC
            """)
    List<SubscriptionCharge> unsettled(
            @Param("openedAfter") Instant openedAfter, @Param("openedBefore") Instant openedBefore, Limit limit);
}
