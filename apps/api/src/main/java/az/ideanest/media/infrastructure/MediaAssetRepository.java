package az.ideanest.media.infrastructure;

import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaKind;
import az.ideanest.media.domain.MediaStatus;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Media rows, by the four questions asked of them — the media pipeline design of 2026-08-30. */
public interface MediaAssetRepository extends JpaRepository<MediaAsset, UUID> {

    /**
     * One row, scoped to its owner.
     *
     * <p>There is no {@code findById} in use anywhere above this interface. A read that took
     * only an identifier would be one where forgetting the ownership check is a diff nobody
     * notices — and what it would expose is an address to somebody else's uploaded file.
     */
    Optional<MediaAsset> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);

    /** Several at once, scoped the same way. Used when a form saves a cover and a story together. */
    List<MediaAsset> findByIdInAndOwnerUserId(Collection<UUID> ids, UUID ownerUserId);

    /** Several at once, for rendering. No owner: a published cover is public. */
    List<MediaAsset> findByIdIn(Collection<UUID> ids);

    /**
     * The sweep's queue, oldest first.
     *
     * <p>{@link MediaStatus#PROCESSING} is in the set as well as {@link MediaStatus#UPLOADED},
     * and that is not an oversight. A pass that dies between claiming a row and finishing it
     * — a restart, a killed process, a storage timeout — leaves the row claimed, and a query
     * that only looked for {@code UPLOADED} would never look at it again.
     *
     * <p>The cost of that choice is that a row being worked on right now is also returned.
     * {@code MediaAsset#claimForProcessing} is what resolves it: the claim only succeeds
     * from {@code UPLOADED}, so the second pass skips.
     *
     * <p>By kind, because images and videos are two sweeps (issue #331): a minute-long
     * transcode must not make a cover image wait behind it.
     */
    @Query(
            """
            select asset from MediaAsset asset
            where asset.status in (az.ideanest.media.domain.MediaStatus.UPLOADED,
                                   az.ideanest.media.domain.MediaStatus.PROCESSING)
              and asset.kind = :kind
            order by asset.createdAt asc
            """)
    List<MediaAsset> findAwaitingProcessing(@Param("kind") MediaKind kind, Limit limit);

    /**
     * The video sweep's queue — issue #331.
     *
     * <p>Unlike {@link #findAwaitingProcessing}, a row being processed is <em>not</em>
     * returned until its claim has gone stale. With one video a pass, returning the oldest
     * claimed row would make every pass a no-op behind it: one clip that wedged a transcode
     * would stop every video on the platform for as long as it stayed claimed.
     */
    @Query(
            """
            select asset from MediaAsset asset
            where asset.kind = az.ideanest.media.domain.MediaKind.VIDEO
              and (asset.status = az.ideanest.media.domain.MediaStatus.UPLOADED
                   or (asset.status = az.ideanest.media.domain.MediaStatus.PROCESSING
                       and asset.updatedAt < :staleBefore))
            order by asset.createdAt asc
            """)
    List<MediaAsset> findVideosToProcess(@Param("staleBefore") Instant staleBefore, Limit limit);

    /**
     * Uploads that were begun and never arrived.
     *
     * <p>A {@code PENDING} row is somebody who closed the tab. Deleting rather than flagging,
     * because there is nothing to keep: no object was ever written under the key, and the row
     * records only that an address was once issued.
     *
     * @return how many were removed
     */
    @Modifying
    @Query(
            """
            delete from MediaAsset asset
            where asset.status = az.ideanest.media.domain.MediaStatus.PENDING
              and asset.createdAt < :before
            """)
    int deleteAbandoned(@Param("before") Instant before);
}
