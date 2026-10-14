package az.ideanest.community.infrastructure;

import az.ideanest.community.domain.Block;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Blocks, by the questions asked of them.
 *
 * <p>The mirror of {@link FollowRepository}: registration is an {@code ON CONFLICT DO NOTHING}
 * insert because idempotency is the whole promise, unblocking deletes the row, and the list is
 * keyset paged on {@code (created_at, id)}.
 *
 * <p><strong>The comment reads do not come through here.</strong> Hiding a blocked account's
 * comments is a predicate inside {@link CommentRepository}'s own queries, so that a page of
 * conversations is still a page — filtering a page after reading it would serve short pages,
 * and a page that came back empty would look like the end of the tab.
 */
public interface BlockRepository extends JpaRepository<Block, UUID> {

    /**
     * Blocks an account, or does nothing because it is already blocked.
     *
     * @return 1 when this call created the row, 0 when it already existed. Both are success
     */
    @Modifying
    @Query(
            value =
                    """
                    INSERT INTO user_blocks (id, blocker_id, blocked_id)
                    VALUES (:id, :blockerId, :blockedId)
                    ON CONFLICT DO NOTHING
                    """,
            nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("blockerId") UUID blockerId, @Param("blockedId") UUID blockedId);

    /** Unblocks. Idempotent by construction. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("DELETE FROM Block b WHERE b.blockerId = :blockerId AND b.blockedId = :blockedId")
    int delete(@Param("blockerId") UUID blockerId, @Param("blockedId") UUID blockedId);

    /** Whether that account is blocked by this one. Served by {@code user_blocks_one_per_pair}. */
    boolean existsByBlockerIdAndBlockedId(UUID blockerId, UUID blockedId);

    /**
     * Whether this account has blocked anybody at all.
     *
     * <p>What decides whether a comment page is personal to its reader — see
     * {@code PublicCommentController} — and served by the leading column of
     * {@code user_blocks_blocker_idx}.
     */
    boolean existsByBlockerId(UUID blockerId);

    /** The first page of the accounts this account has blocked, newest first. */
    @Query(
            """
            SELECT b FROM Block b
             WHERE b.blockerId = :blockerId
             ORDER BY b.createdAt DESC, b.id DESC
            """)
    List<Block> page(@Param("blockerId") UUID blockerId, Pageable limit);

    /** The page below a cursor. Two methods, for {@link SaveRepository#page}'s reason. */
    @Query(
            """
            SELECT b FROM Block b
             WHERE b.blockerId = :blockerId
               AND (b.createdAt < :before
                    OR (b.createdAt = :before AND b.id < :beforeId))
             ORDER BY b.createdAt DESC, b.id DESC
            """)
    List<Block> pageBefore(
            @Param("blockerId") UUID blockerId,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            Pageable limit);
}
