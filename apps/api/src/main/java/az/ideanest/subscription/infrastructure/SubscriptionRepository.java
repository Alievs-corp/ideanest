package az.ideanest.subscription.infrastructure;

import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionState;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * V62's subscriptions, by the three questions asked of them — #367's successor.
 *
 * <p><strong>{@link #openFor} is the one on the hot path.</strong> It is asked on every
 * campaign submission and every load of the pricing page by a signed-in creator, and
 * {@code subscriptions_by_account} serves it.
 *
 * <p>It returns the <em>open</em> subscription and not the entitling one, deliberately.
 * The difference is a lapsed row: {@code entitlesAt} says no and the caller still needs to
 * see it, because "your Growth plan ended on 3 August" is a different sentence from "you
 * have never subscribed", and a query that filtered on the clock could not tell them
 * apart. V62's unique index guarantees there is at most one.
 */
public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

    /**
     * The account's subscription, if it holds one that has not ended.
     *
     * <p>Pending or active — V62's index makes "at most one" true, so this is an
     * {@link Optional} rather than a list that the caller has to reason about.
     */
    @Query(
            """
            SELECT s FROM Subscription s
            WHERE s.accountId = :accountId
              AND s.state IN (az.ideanest.subscription.domain.SubscriptionState.PENDING_PAYMENT,
                              az.ideanest.subscription.domain.SubscriptionState.ACTIVE)
            """)
    Optional<Subscription> openFor(@Param("accountId") UUID accountId);

    /** The row, locked: a card payment and a member of staff can change it at the same moment (#449). */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM Subscription s WHERE s.id = :id")
    Optional<Subscription> lockById(@Param("id") UUID id);

    /**
     * Everything this account has ever held, newest first.
     *
     * <p>For the console, which is answering "what happened to this person's
     * subscription", and for a creator's own history. Unpaged: a monthly plan produces
     * twelve rows a year, and an account with enough of them to need a cursor is one
     * somebody should be looking at for a different reason.
     */
    @Query("SELECT s FROM Subscription s WHERE s.accountId = :accountId ORDER BY s.createdAt DESC")
    List<Subscription> historyFor(@Param("accountId") UUID accountId);

    /**
     * The console's queue and its lists, by state.
     *
     * <p>Oldest first for {@code PENDING_PAYMENT}, because the person who has been waiting
     * longest for their transfer to be recorded is the one to serve, and
     * {@code subscriptions_awaiting_payment} is a partial index in that order.
     */
    @Query("SELECT s FROM Subscription s WHERE s.state = :state ORDER BY s.createdAt ASC")
    List<Subscription> inState(@Param("state") SubscriptionState state);

    /** Every subscription, newest first, for the console's full list. */
    @Query("SELECT s FROM Subscription s ORDER BY s.createdAt DESC")
    List<Subscription> recent();
}
