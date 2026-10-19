package az.ideanest.reward.infrastructure;

import az.ideanest.reward.domain.RewardTier;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reward tiers, by the campaign they belong to.
 *
 * <p>There is deliberately no <em>derived</em> method that writes
 * {@code claimed_quantity} or {@code reserved_quantity}. Spring Data would generate
 * one from a name, and it would be a path into the stock columns that takes no lock
 * and checks no limit. The five written by hand below — two of #51's, one of #52's
 * and two of #56's — are each a single conditional statement that cannot be called
 * wrongly: the condition that keeps the tier from overselling is inside the
 * {@code UPDATE}, not in the caller.
 *
 * <p><strong>Every one of them moves {@code n} places rather than one (#203).</strong>
 * They were written for the reward tier, where §7.2 gives a pledge a single
 * {@code reward_tier_id} and one place is all there ever is. An add-on is the same
 * kind of row — {@code is_addon} on {@code reward_tiers}, so it carries the same three
 * counters and the same {@code reward_tiers_stock_is_within_the_limit} — but §4.5's
 * PL-04 lets a backer take several of it, and until #203 nothing incremented anything
 * for one. Taking {@code n} places by issuing the one-place statement {@code n} times
 * would be {@code n} chances to be interrupted between the first and the last, and a
 * partial hold on a limited add-on is a checkout that has to be unwound by hand. So
 * the quantity moved into the statement and the condition moved with it:
 * {@code claimed + reserved + n <= limit} is evaluated by PostgreSQL, once, behind the
 * row lock, exactly as {@code < limit} was. At {@code n = 1} every statement below is
 * character for character what #51 and #52 shipped.
 */
public interface RewardTierRepository extends JpaRepository<RewardTier, UUID> {

    /**
     * The reward list of one campaign, in display order.
     *
     * <p>Ordered by {@code createdAt} within a {@code sortOrder} so that two tiers
     * that were never reordered — both at zero — come back in a stable order
     * rather than in whichever order the planner produced. A list that changes
     * order between two reads of the same data looks like a bug in the editor.
     */
    List<RewardTier> findByProjectIdOrderBySortOrderAscCreatedAtAsc(UUID projectId);

    long countByProjectId(UUID projectId);

    /**
     * The highest position in use, so a new tier can be appended.
     *
     * <p>Empty for a campaign with no tiers yet. Appending rather than inserting at
     * the top: a creator who adds a tier while looking at their list expects it
     * where they can see it was added, and reordering is a separate, explicit act.
     */
    @Query("SELECT max(tier.sortOrder) FROM RewardTier tier WHERE tier.projectId = :projectId")
    Optional<Integer> findHighestSortOrder(@Param("projectId") UUID projectId);

    /**
     * Takes {@code places} places on a tier, if the tier has that many left. #51, #203.
     *
     * <p><strong>This one statement is the reservation mechanism.</strong> The
     * {@code UPDATE} takes PostgreSQL's row lock on the tier, and under READ
     * COMMITTED it re-reads the row behind that lock and re-evaluates its
     * {@code WHERE} clause against what the transaction that held the lock actually
     * committed. So two checkouts racing for the last place are serialised by the
     * database: the second one's condition is false by the time it is evaluated, no
     * row is updated, and it is told the tier is full. A read followed by a write
     * cannot do that — both callers would read "one place left", and the code that
     * checked would not be wrong, merely not serialised.
     *
     * <p><strong>All {@code n} or none of them.</strong> A backer asking for three of
     * a limited add-on with two left is refused outright rather than sold two: the
     * quote they were shown, the amount they are about to be charged, and what the
     * creator has to put in the box are all for three. The arithmetic is inside the
     * condition, so "are there three left" and "take three" are one evaluation of one
     * row under one lock, and there is no window between them for anybody else's
     * second place to disappear.
     *
     * <p>{@code claimed_quantity} is in the condition as well as
     * {@code reserved_quantity}, because a place that has been confirmed is as taken
     * as one being held. It is the same expression as V7's
     * {@code reward_tiers_stock_is_within_the_limit}, which is the second line: if
     * this condition were ever wrong the constraint refuses the transaction rather
     * than letting the tier oversell.
     *
     * <p>A null {@code limit_quantity} is unlimited and always matches. The count is
     * still incremented, because §5.3 lets a creator add a limit later and the floor
     * it may be lowered to is the places already taken.
     *
     * <p><strong>{@code version} is deliberately not incremented.</strong> The column
     * is optimistic locking for the creator's fields, and the pledge module cannot
     * touch those — {@code claimed_quantity} and {@code reserved_quantity} are mapped
     * non-insertable and non-updatable, so there is no update here for an editor to
     * lose. Bumping it would make every checkout invalidate whatever edit the creator
     * had open, which on a busy campaign is an editor that cannot save. The rule it
     * might be thought to protect — that a limit is never lowered below what is taken
     * — is held by the check constraint against the row as it really is, not against
     * the copy the editor happens to be holding.
     *
     * <p>Native rather than JPQL, and no {@code clearAutomatically}: nothing reads a
     * {@code RewardTier} entity after this in the same transaction, and clearing the
     * persistence context here would detach whatever the caller was in the middle of
     * saving. The flush before it is kept, so a pending write cannot be ordered after
     * this statement.
     *
     * @param places how many, at least one. For a reward tier it is always one; for
     *     an add-on it is the quantity the backer chose
     * @return 1 when the places were taken, 0 when the tier has too few left or no
     *     longer exists
     */
    @Modifying(flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE reward_tiers
                       SET reserved_quantity = reserved_quantity + :places
                     WHERE id = :id
                       AND (limit_quantity IS NULL
                            OR claimed_quantity + reserved_quantity + :places <= limit_quantity)
                    """,
            nativeQuery = true)
    int reservePlaces(@Param("id") UUID id, @Param("places") int places);

    /**
     * Gives held places back, when a reservation lapses or a draft is abandoned.
     *
     * <p>{@code reserved_quantity >= :places} is a guard against a release running
     * twice, not against the constraint.
     * {@code reward_tiers_reserved_is_not_negative} would refuse a count below zero,
     * but the damage of a double release happens above zero, where it is silent: the
     * tier would offer a place that no reservation ever gave back, and the first
     * person to take it would be the one who found out at fulfilment.
     *
     * <p>All of them or none, like {@link #reservePlaces}. Giving back what the tier
     * happens to be able to spare would turn a caller's invariant violation into a
     * count that quietly disagrees with the pledges, which is the one failure no
     * constraint here can see.
     *
     * @return 1 when the places were given back, 0 when the tier was not counting
     *     that many
     */
    @Modifying(flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE reward_tiers
                       SET reserved_quantity = reserved_quantity - :places
                     WHERE id = :id AND reserved_quantity >= :places
                    """,
            nativeQuery = true)
    int releasePlaces(@Param("id") UUID id, @Param("places") int places);

    /**
     * Turns held places into claimed ones, when a draft is confirmed. #52.
     *
     * <p><strong>One statement, and the reason is that the tier must never be
     * momentarily short.</strong> The obvious alternative is the two statements that
     * already exist here — release one, then claim one — and both orderings are
     * wrong, differently.
     *
     * <ul>
     *   <li><strong>Release first.</strong> Between the two statements
     *       {@code claimed + reserved} is short of the limit, and that is not a
     *       private detail: it is exactly the expression {@link #reservePlaces}
     *       evaluates. A checkout arriving in that window takes the last place of a
     *       tier that has already sold it, and the second person to find out is the
     *       one who does not get a reward. The window is short, which makes it a bug
     *       that reproduces under load and never in a test.
     *   <li><strong>Claim first.</strong> Now {@code claimed + reserved} is
     *       <em>over</em> the limit for the same instant, and V7's
     *       {@code reward_tiers_stock_is_within_the_limit} is a check constraint:
     *       PostgreSQL evaluates it at the end of the statement, so it refuses the
     *       first update outright. A perfectly legitimate confirmation of the last
     *       place would fail on a full tier — always, not occasionally.
     * </ul>
     *
     * <p>So the correct order is no order. Both columns move in one {@code UPDATE},
     * the sum does not change, no other transaction sees an intermediate state
     * because there is not one, and the constraint is evaluated against a row whose
     * total is exactly what it was before. That is also why an add-on's whole
     * quantity is committed by one statement rather than by {@code n} of them (#203):
     * three separate moves would put the tier over or under the limit three times,
     * briefly, for a confirmation that changes nothing at all.
     *
     * <p>{@code reserved_quantity >= :places} is the same guard
     * {@link #releasePlaces} carries and it is doing the same job: a confirmation
     * that ran twice would move a second set of places out of a reservation that no
     * longer exists, inventing a claim against nothing. Here it also serves as the
     * honest answer to "was this pledge really holding these places" — a zero return
     * is the caller's signal that it was not.
     *
     * <p>{@code version} is deliberately not incremented, for the reason
     * {@link #reservePlaces} gives: the column is optimistic locking for the
     * creator's own fields, and bumping it on every confirmation would invalidate
     * whatever edit the creator had open.
     *
     * @return 1 when the held places became claimed ones, 0 when the tier was not
     *     holding that many
     */
    @Modifying(flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE reward_tiers
                       SET reserved_quantity = reserved_quantity - :places,
                           claimed_quantity = claimed_quantity + :places
                     WHERE id = :id AND reserved_quantity >= :places
                    """,
            nativeQuery = true)
    int commitPlaces(@Param("id") UUID id, @Param("places") int places);

    /**
     * Takes places directly as claimed ones. #56.
     *
     * <p><strong>For a pledge that is already {@code CONFIRMED} and changes what it
     * is buying.</strong> The backer is committed, so the places they take on the new
     * tier are committed too: routing them through {@link #reservePlaces} and then
     * {@link #commitPlaces} would be two statements to express one fact, and in
     * between them the tier would hold a reservation belonging to a pledge that is
     * not a draft — which is precisely the row §8.4's sweep looks for and precisely
     * the state {@code ReservationExpiry} refuses to reason about.
     *
     * <p>The condition is {@link #reservePlaces}'s, unchanged and deliberately so:
     * a place is a place whichever column ends up counting it, and V7's
     * {@code reward_tiers_stock_is_within_the_limit} bounds the same sum. A tier with
     * no limit is unlimited and always matches, and the count still moves, for
     * {@link #reservePlaces}'s reason.
     *
     * <p>{@code version} is not incremented, for {@link #reservePlaces}'s reason.
     *
     * @return 1 when the places were claimed, 0 when the tier has too few left or no
     *     longer exists
     */
    @Modifying(flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE reward_tiers
                       SET claimed_quantity = claimed_quantity + :places
                     WHERE id = :id
                       AND (limit_quantity IS NULL
                            OR claimed_quantity + reserved_quantity + :places <= limit_quantity)
                    """,
            nativeQuery = true)
    int claimPlaces(@Param("id") UUID id, @Param("places") int places);

    /**
     * Gives claimed places back, when a confirmed pledge is cancelled or changes what
     * it is buying. #56.
     *
     * <p><strong>The counterpart of {@link #releasePlaces}, and a different
     * statement because it is a different claim.</strong> A {@code DRAFT} holds its
     * places in {@code reserved_quantity} and a {@code CONFIRMED} pledge holds them in
     * {@code claimed_quantity}; releasing the wrong column would leave the tier
     * counting places nobody holds and short of ones somebody does, and the total
     * would still look right. §9.7's "backer changes their mind while live" is a
     * cancellation of a confirmed pledge, so this is the column that moves.
     *
     * <p>{@code claimed_quantity >= :places} is {@link #releasePlaces}'s guard doing
     * {@link #releasePlaces}'s job: the damage of a release that ran twice happens
     * above zero, where the constraint cannot see it and the tier quietly offers a
     * place that no pledge ever gave back.
     *
     * @return 1 when the places were given back, 0 when the tier was not counting
     *     that many
     */
    @Modifying(flushAutomatically = true)
    @Query(
            value =
                    """
                    UPDATE reward_tiers
                       SET claimed_quantity = claimed_quantity - :places
                     WHERE id = :id AND claimed_quantity >= :places
                    """,
            nativeQuery = true)
    int releaseClaimedPlaces(@Param("id") UUID id, @Param("places") int places);

    /**
     * The named tiers, but only the ones that really belong to this campaign.
     *
     * <p>The campaign is part of the query rather than a filter afterwards, for
     * {@code RewardStock#priceOf}'s reason: a pledge naming another campaign's tier
     * is a row V17's composite foreign key refuses, and answering the question this
     * way is what lets the checkout say which selection was wrong instead of handing
     * back a constraint violation.
     *
     * <p>In display order, so that a quote built from this reads in the order the
     * backer saw.
     */
    @Query(
            """
            SELECT tier FROM RewardTier tier
            WHERE tier.projectId = :projectId AND tier.id IN :ids
            ORDER BY tier.sortOrder, tier.createdAt
            """)
    List<RewardTier> findSelected(@Param("projectId") UUID projectId, @Param("ids") Collection<UUID> ids);

    /**
     * What a backer could take instead of a tier that is full. §10.4's
     * {@code meta.availableAlternatives}.
     *
     * <p>Four exclusions, and each of them is the difference between an alternative
     * and a dead link. A secret tier is reachable only through its own link, and
     * listing its identifier in an error body would be the disclosure the secret
     * exists to prevent. A tier outside its availability window cannot be selected
     * today. A tier with no places left is the problem, not the answer to it. And a
     * tier of the other kind is not a substitute: an add-on is bought alongside a
     * reward rather than instead of one, and a reward is not an extra.
     *
     * <p><strong>The kind is matched rather than fixed (#203).</strong> Until add-ons
     * could be refused at all, "not an add-on" was the whole rule and the excluded
     * tier was always a reward. Now that a limited add-on can be sold out, offering
     * the campaign's reward tiers to a backer who asked for one more mug would be a
     * list of things they cannot use — several of which they may already be holding.
     * A subquery rather than a parameter because the caller has the identifier of the
     * tier that was refused and nothing else: making it look up the kind first would
     * be a second read to tell this one something it is already looking at. A tier
     * that has been deleted since it was refused matches nothing and the answer is
     * empty, which is the truth.
     *
     * <p>The stock condition is the same expression {@link #reservePlaces}
     * evaluates and the same one V7's constraint bounds, written once more here
     * because this is a read: the answer may be stale by the time the backer acts on
     * it, and the reservation statement — not this — is what decides whether they
     * get a place. It is deliberately still {@code < limit} rather than "room for as
     * many as they wanted": what is offered is a tier with something left, and how
     * many of it they can have is the next request's answer.
     */
    @Query(
            """
            SELECT tier.id FROM RewardTier tier
            WHERE tier.projectId = :projectId
              AND tier.id <> :excluding
              AND tier.addon = (SELECT refused.addon FROM RewardTier refused WHERE refused.id = :excluding)
              AND tier.secret = false
              AND (tier.availableFrom IS NULL OR tier.availableFrom <= :at)
              AND (tier.availableUntil IS NULL OR tier.availableUntil > :at)
              AND (tier.limitQuantity IS NULL
                   OR tier.claimedQuantity + tier.reservedQuantity < tier.limitQuantity)
            ORDER BY tier.sortOrder, tier.createdAt
            """)
    List<UUID> findAvailableAlternatives(
            @Param("projectId") UUID projectId, @Param("excluding") UUID excluding, @Param("at") Instant at);

    /**
     * Whether anything but this tier still shows the upload: another tier, or a campaign's
     * cover or video. Asked before a released reward image or video is deleted, because one
     * upload may be attached in more than one place by its owner.
     *
     * <p>{@code projects} is read rather than asked about, as {@code pledges} reads this
     * module's tables: it is one existence check, and the project module has no question
     * of its own that covers both of its media columns.
     */
    @Query(
            value =
                    """
                    SELECT EXISTS (
                               SELECT 1 FROM reward_tiers
                                WHERE (image_media_id = :mediaId OR video_media_id = :mediaId)
                                  AND id <> :excluding)
                        OR EXISTS (
                               SELECT 1 FROM projects
                                WHERE cover_media_id = :mediaId OR video_media_id = :mediaId)
                    """,
            nativeQuery = true)
    boolean isMediaShownElsewhere(@Param("mediaId") UUID mediaId, @Param("excluding") UUID excluding);
}
