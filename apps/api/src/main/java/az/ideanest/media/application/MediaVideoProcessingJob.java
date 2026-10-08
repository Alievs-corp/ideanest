package az.ideanest.media.application;

import az.ideanest.media.MediaProperties;
import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.infrastructure.MediaAssetRepository;
import az.ideanest.shared.jobs.ScheduledJob;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Component;

/**
 * Turns uploaded clips into the one rendition this platform serves — issue #331.
 *
 * <h2>Its own job, and one video a pass</h2>
 *
 * <p>{@link MediaProcessingJob} does a batch of images in a few seconds. A transcode takes
 * tens of them, and in the same queue a creator's cover would wait behind somebody else's
 * video. Two jobs are two leases and two queues, so neither waits for the other.
 *
 * <p>One a pass is the CPU budget. The API shares a small host; a backlog of videos is
 * worked through one after another at a bounded thread count rather than all at once, and
 * the next tick is five seconds away.
 *
 * <p>{@link #isLongRunning}: a pass is minutes, and on the scheduler thread every other job
 * shares it would stop the outbox and the charges for as long. {@link #lease} outlasts the
 * longest pass, so another replica does not start the same work under it.
 *
 * <h2>A clip that will not finish does not hold the queue</h2>
 *
 * <p>An encode past the timeout is the file's failure ({@code UNREADABLE}), not the host's,
 * and the row is closed. A row left claimed by a pass that died is ignored by the queue
 * until its claim is stale, and then taken over once — see
 * {@code MediaAssetRepository#findVideosToProcess}.
 *
 * <h2>Failures</h2>
 *
 * <p>As in {@link MediaProcessingJob}: a {@link MediaFailedException} is the creator's and
 * is recorded on the row; an unreachable store or a missing ffmpeg is not, and the pass
 * throws so the runner backs off. The raw upload is deleted on a refusal as well as on
 * success — it can be a few hundred megabytes, and nothing will read it again.
 */
@Component
public class MediaVideoProcessingJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(MediaVideoProcessingJob.class);

    private final MediaAssetRepository assets;
    private final MediaProcessingWrites writes;
    private final ObjectStore store;
    private final VideoTranscoder videoTranscoder;
    private final ImageTranscoder imageTranscoder;
    private final MediaProperties properties;
    private final Clock clock;

    public MediaVideoProcessingJob(
            MediaAssetRepository assets,
            MediaProcessingWrites writes,
            ObjectStore store,
            VideoTranscoder videoTranscoder,
            ImageTranscoder imageTranscoder,
            MediaProperties properties,
            Clock clock) {
        this.assets = assets;
        this.writes = writes;
        this.store = store;
        this.videoTranscoder = videoTranscoder;
        this.imageTranscoder = imageTranscoder;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "media-video-processing";
    }

    @Override
    public String schedule() {
        return properties.video().schedule();
    }

    @Override
    public boolean isLongRunning() {
        return true;
    }

    /** Longer than any pass: the transcode's own timeout bounds the encode. */
    @Override
    public Optional<Duration> lease() {
        return Optional.of(staleAfter());
    }

    /**
     * When a claim belongs to a pass that died. Twice the encode timeout plus the transfers
     * around it — a live pass never gets near it, because the encode is killed at the
     * timeout.
     */
    private Duration staleAfter() {
        return properties.video().timeout().multipliedBy(2).plusMinutes(5);
    }

    @Override
    public void run() {
        if (!store.isAvailable()) {
            // See MediaProcessingJob: an unconfigured deployment is a supported state.
            return;
        }

        Duration staleAfter = staleAfter();
        for (MediaAsset asset : assets.findVideosToProcess(clock.instant().minus(staleAfter), Limit.of(1))) {
            UUID mediaId = asset.getId();
            if (writes.claimVideo(mediaId, staleAfter)) {
                process(mediaId);
            }
        }
    }

    /**
     * One clip, end to end, with no transaction across it — the reason
     * {@link MediaProcessingJob#run} gives, and a transcode is longer still.
     */
    private void process(UUID mediaId) {
        Path workspace = null;
        String rawKey = MediaLibrary.rawKeyOf(mediaId);
        try {
            OptionalLong declared = store.sizeOf(rawKey);
            if (declared.isPresent() && declared.getAsLong() > properties.video().maxUploadBytes()) {
                // Refused from the header, before a byte of it reaches this host's disk.
                store.delete(rawKey);
                writes.fail(mediaId, MediaFailureReason.TOO_LARGE);
                return;
            }

            workspace = Files.createTempDirectory("ideanest-video-");
            Path raw = workspace.resolve("source");

            store.download(rawKey, raw);

            if (!Files.exists(raw) || Files.size(raw) == 0L) {
                writes.fail(mediaId, MediaFailureReason.EMPTY);
                return;
            }
            if (Files.size(raw) > properties.video().maxUploadBytes()) {
                store.delete(rawKey);
                writes.fail(mediaId, MediaFailureReason.TOO_LARGE);
                return;
            }

            TranscodedVideo video = videoTranscoder.transcode(raw, workspace);

            Path posterWorkspace = Files.createDirectory(workspace.resolve("poster"));
            TranscodedImage poster = imageTranscoder.transcode(video.posterFrame(), posterWorkspace);

            String videoKey = MediaLibrary.derivedKeyOf(mediaId, video.contentType());
            String posterKey = MediaLibrary.posterKeyOf(mediaId, poster.contentType());
            long byteSize = Files.size(video.file());

            store.upload(videoKey, video.file(), video.contentType());
            store.upload(posterKey, poster.file(), poster.contentType());
            // Only once both derived objects are written, for MediaProcessingJob's reason.
            store.delete(rawKey);

            writes.succeedVideo(mediaId, videoKey, video, byteSize, posterKey, poster);
            log.info(
                    "Video {} transcoded: {}x{}, {} ms, {} bytes",
                    mediaId,
                    video.width(),
                    video.height(),
                    video.durationMs(),
                    byteSize);

        } catch (MediaFailedException refusal) {
            log.info("Video {} refused: {}", mediaId, refusal.reason());
            writes.fail(mediaId, refusal.reason());
            try {
                store.delete(rawKey);
            } catch (RuntimeException problem) {
                log.warn("Could not delete the refused upload of video {}", mediaId, problem);
            }
        } catch (IOException problem) {
            throw new UncheckedIOException("Video " + mediaId + " could not be processed locally", problem);
        } finally {
            MediaProcessingJob.deleteRecursively(workspace);
        }
    }
}
