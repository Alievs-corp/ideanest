package az.ideanest.media.application;

import az.ideanest.media.MediaProperties;
import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.domain.MediaKind;
import az.ideanest.media.domain.MediaStatus;
import az.ideanest.media.infrastructure.MediaAssetRepository;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Uploads, from the address being issued to the image being servable — the media pipeline
 * design of 2026-08-30.
 *
 * <h2>This module's whole surface to everything else</h2>
 *
 * <p>{@code ModuleBoundaryTests} lets another module reach an application layer and refuses
 * it a {@code domain} or an {@code infrastructure} package, so {@link #viewsOf} and
 * {@link #claimForOwner} are what the project module sees. Neither hands out a
 * {@link MediaAsset}: the entity is a state machine with transitions on it, and a caller
 * holding one could move it.
 */
@Service
public class MediaLibrary {

    private static final Logger log = LoggerFactory.getLogger(MediaLibrary.class);

    /** Where an upload lands before anything has looked at it. Replaced, then deleted. */
    private static final String RAW_PREFIX = "uploads/";

    /** Where the derived image lives. This is the half a browser fetches. */
    private static final String DERIVED_PREFIX = "media/";

    private final MediaAssetRepository assets;
    private final MediaProcessingWrites writes;
    private final ObjectStore store;
    private final VideoTranscoder videoTranscoder;
    private final MediaProperties properties;
    private final Clock clock;

    public MediaLibrary(
            MediaAssetRepository assets,
            MediaProcessingWrites writes,
            ObjectStore store,
            VideoTranscoder videoTranscoder,
            MediaProperties properties,
            Clock clock) {
        this.assets = assets;
        this.writes = writes;
        this.store = store;
        this.videoTranscoder = videoTranscoder;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Issues an address the browser may upload one file to.
     *
     * <p>The declared type and size are the client's word and are treated as such: they are
     * checked here so that an obviously wrong request is refused before an address is issued,
     * and checked again from the bytes once they arrive, because a presigned address does not
     * make a declaration binding.
     *
     * <p>A declared {@code video/*} type begins a video (issue #331): a larger ceiling, its
     * own sweep, and an address signed for that type. Refused up front when this host cannot
     * transcode one, rather than after the creator has uploaded a few hundred megabytes.
     *
     * @throws UploadsUnavailableException when this deployment has no storage configured, or
     *     a video was declared and this deployment cannot transcode one
     * @throws MediaFailedException when the declared size is over the ceiling
     */
    @Transactional
    public MediaUpload begin(UUID ownerUserId, String declaredContentType, long declaredBytes) {
        if (!store.isAvailable()) {
            throw new UploadsUnavailableException("This deployment has no media storage configured.");
        }
        MediaKind kind = MediaKind.ofDeclaredType(declaredContentType);
        if (kind == MediaKind.VIDEO && !videoTranscoder.isAvailable()) {
            throw new UploadsUnavailableException("This deployment cannot process video.");
        }
        long ceiling = properties.maxUploadBytesFor(kind);
        if (declaredBytes > ceiling) {
            throw new MediaFailedException(
                    MediaFailureReason.TOO_LARGE,
                    "That file is larger than the %d MB this platform accepts.".formatted(ceiling / (1024 * 1024)));
        }
        if (declaredBytes <= 0) {
            throw new MediaFailedException(MediaFailureReason.EMPTY, "That file is empty.");
        }

        Instant now = clock.instant();
        MediaAsset asset = assets.save(MediaAsset.awaitingUpload(ownerUserId, kind, now));

        String signedType = normalisedType(declaredContentType);
        URI address = store.presignedPut(rawKeyOf(asset.getId()), signedType, properties.uploadWindow());

        return new MediaUpload(asset.getId(), address, signedType, now.plus(properties.uploadWindow()), ceiling);
    }

    /**
     * The client says the bytes are there.
     *
     * <p><strong>Idempotent, and a replay is the ordinary case.</strong> A browser whose
     * connection dropped between the upload finishing and this response arriving will send it
     * again; a second enqueue would have the sweep read an object the first pass may already
     * have replaced. {@code MediaAsset#markUploaded} refuses from any state but
     * {@code PENDING} and this simply returns what the row says now.
     */
    @Transactional
    public MediaAsset complete(UUID ownerUserId, UUID mediaId) {
        MediaAsset asset = ownedOrThrow(ownerUserId, mediaId);
        asset.markUploaded(clock.instant());
        return assets.save(asset);
    }

    /** One upload's state, for the editor's poll. Scoped to its owner. */
    @Transactional(readOnly = true)
    public MediaAsset statusOf(UUID ownerUserId, UUID mediaId) {
        return ownedOrThrow(ownerUserId, mediaId);
    }

    /**
     * Confirms that these identifiers are this person's and are servable, for a module about
     * to attach one to something it owns.
     *
     * <p>Answers only the ones that pass. The caller decides what a missing identifier means
     * — the project module refuses the patch — and this deliberately does not throw, because
     * a form saving a cover and eight story images should be told which one is the problem
     * rather than that something was.
     */
    @Transactional(readOnly = true)
    public Set<UUID> claimForOwner(UUID ownerUserId, Collection<UUID> mediaIds) {
        if (mediaIds.isEmpty()) {
            return Set.of();
        }
        return assets.findByIdInAndOwnerUserId(mediaIds, ownerUserId).stream()
                .filter(asset -> asset.getStatus() == MediaStatus.READY)
                .filter(asset -> asset.getKind() == MediaKind.IMAGE)
                .map(MediaAsset::getId)
                .collect(Collectors.toUnmodifiableSet());
    }

    /**
     * {@link #claimForOwner}, for a campaign's video — issue #331.
     *
     * <p>A separate question rather than a parameter, because the two slots must not accept
     * each other's uploads: an MP4 attached as a cover would render as a broken image, and
     * an image attached as a video as a player that never plays.
     */
    @Transactional(readOnly = true)
    public boolean claimVideoForOwner(UUID ownerUserId, UUID mediaId) {
        return assets.findByIdAndOwnerUserId(mediaId, ownerUserId)
                .filter(asset -> asset.getStatus() == MediaStatus.READY)
                .filter(asset -> asset.getKind() == MediaKind.VIDEO)
                .isPresent();
    }

    /**
     * What a player needs, for a video that is ready — issue #331.
     *
     * <p>No owner, for the reason {@link #viewsOf} has none: a live campaign's video is
     * public. Empty for anything that is not a ready video.
     */
    @Transactional(readOnly = true)
    public Optional<VideoView> videoViewOf(UUID mediaId) {
        return assets.findById(mediaId).flatMap(this::playableView);
    }

    /**
     * Deletes an upload nobody uses any more, once the caller's transaction has committed —
     * issue #331.
     *
     * <p>After the commit and not during it: deleting the objects inside a transaction that
     * then rolled back would leave a campaign pointing at a video that no longer exists. The
     * other failure — the commit succeeded and the deletion did not — leaves an orphaned
     * object, which costs storage and nothing else, so it is logged and not retried.
     *
     * <p>The caller decides that nothing refers to it. This module cannot see what does.
     */
    public void discardAfterCommit(UUID mediaId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    discard(mediaId);
                }
            });
            return;
        }
        discard(mediaId);
    }

    private void discard(UUID mediaId) {
        try {
            for (String key : writes.remove(mediaId)) {
                store.delete(key);
            }
        } catch (RuntimeException problem) {
            log.warn("Media {} was released but could not be deleted; its objects may be orphaned", mediaId, problem);
        }
    }

    /**
     * What a renderer needs, for identifiers that are ready.
     *
     * <p>No owner, because a cover on a live campaign is public. Rows that are not
     * {@link MediaStatus#READY} are simply absent from the map: a caller rendering a campaign
     * whose cover is still processing shows what it showed before there was an image, which
     * is the same thing it shows for a campaign that never had one.
     */
    @Transactional(readOnly = true)
    public Map<UUID, MediaView> viewsOf(Collection<UUID> mediaIds) {
        if (mediaIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, MediaView> views = new LinkedHashMap<>();
        for (MediaAsset asset : assets.findByIdIn(mediaIds)) {
            servableView(asset).ifPresent(view -> views.put(asset.getId(), view));
        }
        return Map.copyOf(views);
    }

    /** One, for the same purpose. */
    @Transactional(readOnly = true)
    public Optional<MediaView> viewOf(UUID mediaId) {
        return assets.findById(mediaId).flatMap(this::servableView);
    }

    private Optional<MediaView> servableView(MediaAsset asset) {
        if (asset.getStatus() != MediaStatus.READY || asset.getKind() != MediaKind.IMAGE) {
            return Optional.empty();
        }
        // Every one of these is present on a READY row, which V61's
        // media_ready_is_servable enforces rather than hopes for.
        return asset.getStorageKey()
                .map(key -> new MediaView(
                        asset.getId(),
                        store.publicUrl(key),
                        asset.getWidth().orElseThrow(),
                        asset.getHeight().orElseThrow(),
                        asset.getBlurDataUrl().orElseThrow()));
    }

    private Optional<VideoView> playableView(MediaAsset asset) {
        if (asset.getStatus() != MediaStatus.READY || asset.getKind() != MediaKind.VIDEO) {
            return Optional.empty();
        }
        // V94's media_video_ready_is_playable holds the duration and the poster on a
        // ready video, as V61's constraint holds the rest.
        return asset.getStorageKey()
                .map(key -> new VideoView(
                        asset.getId(),
                        store.publicUrl(key),
                        store.publicUrl(asset.getPosterStorageKey().orElseThrow()),
                        asset.getWidth().orElseThrow(),
                        asset.getHeight().orElseThrow(),
                        asset.getDurationMs().orElseThrow(),
                        asset.getBlurDataUrl().orElseThrow()));
    }

    /** Every object a row has in the store: the derived file and, for a video, its poster. */
    static Stream<String> storedKeysOf(MediaAsset asset) {
        return Stream.concat(asset.getStorageKey().stream(), asset.getPosterStorageKey().stream());
    }

    private MediaAsset ownedOrThrow(UUID ownerUserId, UUID mediaId) {
        return assets.findByIdAndOwnerUserId(mediaId, ownerUserId)
                .orElseThrow(() -> new MediaNotFoundException(mediaId));
    }

    /** The key the browser writes to. */
    public static String rawKeyOf(UUID mediaId) {
        return RAW_PREFIX + mediaId;
    }

    /** The key the derived image is served from, extension included so a CDN guesses right. */
    public static String derivedKeyOf(UUID mediaId, String contentType) {
        if ("video/mp4".equals(contentType)) {
            return DERIVED_PREFIX + mediaId + ".mp4";
        }
        return DERIVED_PREFIX + mediaId + ("image/png".equals(contentType) ? ".png" : ".jpg");
    }

    /** Where a video's poster is served from, beside the video. */
    public static String posterKeyOf(UUID mediaId, String contentType) {
        return DERIVED_PREFIX + mediaId + "-poster" + ("image/png".equals(contentType) ? ".png" : ".jpg");
    }

    /**
     * What the presigned address is signed for.
     *
     * <p>Signing for the type the client declared, and then deciding the real type from the
     * bytes, is not a contradiction: the signature binds what the browser may send so that a
     * leaked address cannot be used to upload something else, and the magic-byte check is what
     * decides whether we keep it. Anything unrecognised is signed as
     * {@code application/octet-stream} rather than refused here, because the honest refusal
     * happens where the content is.
     */
    private static String normalisedType(String declared) {
        if (declared == null || declared.isBlank()) {
            return "application/octet-stream";
        }
        String trimmed = declared.trim();
        if (!trimmed.startsWith("image/") && !trimmed.startsWith("video/")) {
            return "application/octet-stream";
        }
        return trimmed;
    }

    /**
     * What {@link #begin} tells the browser.
     *
     * @param contentType <strong>the type the address was signed for</strong>, which the
     *     client must send verbatim on the {@code PUT}. Returned rather than left for the
     *     client to reproduce because {@link #normalisedType} rewrites anything that is not
     *     an image type, and a client that sent its own value instead would have every
     *     upload refused by the store as a signature mismatch — a failure that looks like a
     *     credentials problem and is not
     */
    public record MediaUpload(UUID mediaId, URI uploadUrl, String contentType, Instant expiresAt, long maxBytes) {}

    /**
     * A servable image, as everything outside this module sees it.
     *
     * @param id the media identifier, so a caller can re-read the state later
     * @param url what a browser fetches
     * @param width the measured width. The number this whole table exists to make honest
     * @param height likewise
     * @param blurDataUrl §13.1's placeholder, in the same response as the image
     */
    public record MediaView(UUID id, String url, int width, int height, String blurDataUrl) {}

    /**
     * A playable video, as everything outside this module sees it — issue #331.
     *
     * @param url the MP4. Range requests are the store's, so a player seeks without this
     *     process in the path
     * @param posterUrl the still shown before it plays
     * @param width of the transcoded frame, so a page reserves the right box
     * @param height likewise
     * @param durationMs measured on the transcoded file
     * @param blurDataUrl the poster's placeholder
     */
    public record VideoView(
            UUID id, String url, String posterUrl, int width, int height, int durationMs, String blurDataUrl) {}
}
