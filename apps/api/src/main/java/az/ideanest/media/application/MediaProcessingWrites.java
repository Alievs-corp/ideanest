package az.ideanest.media.application;

import az.ideanest.media.MediaProperties;
import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.infrastructure.MediaAssetRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The four short transactions the sweep needs — the media pipeline design of 2026-08-30.
 *
 * <h2>Why this is not four methods on {@code MediaProcessingJob}</h2>
 *
 * <p>Because they would not be transactional. {@code @Transactional} is applied by a proxy,
 * and a call from one method of a bean to another goes straight to the implementation and
 * past the proxy entirely — so a private or protected {@code @Transactional} method invoked
 * from {@code run()} runs with no transaction at all, silently, and looks correct in review.
 *
 * <p>Splitting the writes into a collaborator makes every one of them a real call through a
 * real proxy. It also states what the boundaries are: each of these is deliberately its own
 * short transaction, and none of them spans the download, the subprocess and the upload
 * between them — that would hold a pool connection for seconds per image.
 */
@Component
public class MediaProcessingWrites {

    private final MediaAssetRepository assets;
    private final MediaProperties properties;
    private final Clock clock;

    public MediaProcessingWrites(MediaAssetRepository assets, MediaProperties properties, Clock clock) {
        this.assets = assets;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Takes the row, and commits the claim before anything slow starts.
     *
     * <p>Answers false when the row has already moved on, which is how two passes over an
     * overlapping batch resolve — {@code MediaAsset#claimForProcessing} only succeeds from
     * {@code UPLOADED}, so the loser skips rather than doing the work twice.
     */
    @Transactional
    public boolean claim(UUID mediaId) {
        return assets.findById(mediaId)
                .map(asset -> {
                    boolean claimed = asset.claimForProcessing(clock.instant());
                    if (claimed) {
                        assets.save(asset);
                    }
                    return claimed;
                })
                .orElse(false);
    }

    /**
     * {@link #claim}, for a video — issue #331.
     *
     * <p>Also takes a row that has sat in {@code PROCESSING} for longer than a pass can
     * take. A deploy that restarts the API mid-transcode would otherwise leave that video
     * "processing" for ever; for an image the window is seconds and the case is not worth a
     * rule, for a video it is the length of a deploy.
     */
    @Transactional
    public boolean claimVideo(UUID mediaId, Duration staleAfter) {
        return assets.findById(mediaId)
                .map(asset -> {
                    boolean claimed = asset.claimForProcessing(clock.instant(), staleAfter);
                    if (claimed) {
                        assets.save(asset);
                    }
                    return claimed;
                })
                .orElse(false);
    }

    /** A video and its poster, in one transition — issue #331. */
    @Transactional
    public void succeedVideo(
            UUID mediaId,
            String storageKey,
            TranscodedVideo video,
            long byteSize,
            String posterStorageKey,
            TranscodedImage poster) {

        assets.findById(mediaId).ifPresent(asset -> {
            asset.markVideoReady(
                    storageKey,
                    video.contentType(),
                    byteSize,
                    video.width(),
                    video.height(),
                    video.durationMs(),
                    posterStorageKey,
                    poster.blurDataUrl(),
                    clock.instant());
            assets.save(asset);
        });
    }

    /**
     * Deletes one row and answers the keys of what it had in the store.
     *
     * <p>{@code REQUIRES_NEW} because the caller is an after-commit hook: Spring keeps the
     * finished transaction's resources bound there, and a write that merely joined it would
     * never be committed.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public List<String> remove(UUID mediaId) {
        return assets.findById(mediaId)
                .map(asset -> {
                    List<String> keys = MediaLibrary.storedKeysOf(asset).toList();
                    assets.delete(asset);
                    return keys;
                })
                .orElse(List.of());
    }

    /** Everything a renderer needs, in one transition. */
    @Transactional
    public void succeed(UUID mediaId, String storageKey, TranscodedImage derived, long byteSize) {
        assets.findById(mediaId).ifPresent(asset -> {
            asset.markReady(
                    storageKey,
                    derived.contentType(),
                    byteSize,
                    derived.width(),
                    derived.height(),
                    derived.blurDataUrl(),
                    clock.instant());
            assets.save(asset);
        });
    }

    /** Terminal, with the reason the editor translates. */
    @Transactional
    public void fail(UUID mediaId, MediaFailureReason reason) {
        assets.findById(mediaId).ifPresent(asset -> {
            asset.markFailed(reason, clock.instant());
            assets.save(asset);
        });
    }

    /**
     * Removes uploads that were begun and never arrived.
     *
     * @return how many were removed
     */
    @Transactional
    public int removeAbandoned() {
        Instant before = clock.instant().minus(properties.processing().abandonedAfter());
        return assets.deleteAbandoned(before);
    }
}
