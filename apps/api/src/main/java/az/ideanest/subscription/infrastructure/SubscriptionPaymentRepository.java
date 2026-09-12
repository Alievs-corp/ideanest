package az.ideanest.subscription.infrastructure;

import az.ideanest.subscription.domain.SubscriptionPayment;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * V73's journal, by the two questions this release asks of it.
 *
 * <p><strong>Nothing here updates or deletes.</strong> {@link JpaRepository} offers both,
 * and V73's trigger refuses both at the statement — so a caller that reached for
 * {@code save} on a managed instance would meet a {@code restrict_violation} rather than a
 * compile error. {@code SubscriptionPayment} has no mutator for exactly that reason: there
 * is nothing to change on a row that would make Hibernate emit the UPDATE.
 *
 * <p>The period totals the revenue report needs are not here yet. They are a projection
 * over a date range grouped by plan and currency, and they arrive with the report rather
 * than ahead of it — {@code subscription_payments_by_period} is the index that will serve
 * them.
 */
public interface SubscriptionPaymentRepository extends JpaRepository<SubscriptionPayment, UUID> {

    /**
     * What this account has paid, newest first.
     *
     * <p>The console's account page and the creator's own receipts. Unpaged, for
     * {@code SubscriptionRepository.historyFor}'s reason: a monthly plan produces twelve
     * rows a year.
     */
    @Query("SELECT p FROM SubscriptionPayment p WHERE p.accountId = :accountId ORDER BY p.receivedAt DESC")
    List<SubscriptionPayment> forAccount(@Param("accountId") UUID accountId);

    /**
     * What was paid against one subscription, newest first.
     *
     * <p>One row in the ordinary case, two when a payment has been reversed — which is the
     * case this is asked about.
     */
    @Query(
            """
            SELECT p FROM SubscriptionPayment p
            WHERE p.subscriptionId = :subscriptionId
            ORDER BY p.receivedAt DESC
            """)
    List<SubscriptionPayment> forSubscription(@Param("subscriptionId") UUID subscriptionId);
}
