package az.ideanest.media.application;

import az.ideanest.media.MediaProperties;
import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.domain.MediaKind;
import az.ideanest.media.infrastructure.MediaAssetRepository;
import az.ideanest.shared.jobs.ScheduledJob;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Component;

/**
 * Turns uploaded objects into servable ones — the media pipeline design of 2026-08-30.
 *
 * <h2>A scheduled job rather than a thread pool</h2>
 *
 * <p>The design document proposed a bounded executor inside the API process, triggered by
 * the completion endpoint. This is a {@link ScheduledJob} instead, and the change is worth
 * the note because it is not a smaller version of the same idea — it is the machinery this
 * service already has. A job registered here is claimed on one replica, counted when it
 * fails and stopped when it has failed too often (#134); an executor would have been a
 * second concurrency mechanism with none of that, and one that loses its queue on restart.
 *
 * <p>What it costs is latency: an upload waits for the next tick rather than starting the
 * instant it completes. The schedule is therefore every five seconds rather than the minutes
 * or hours every other job in this service runs at — the person on the other end of this one
 * is watching a spinner.
 *
 * <h2>Why memory is bounded by the batch and not by a pool size</h2>
 *
 * <p>One image is decoded at a time, in a subprocess, by a library that streams. The batch
 * bounds how many files a tick touches; it does not put four bitmaps in this heap, because
 * none of them is ever in this heap. That is most of the argument for the native dependency
 * — see {@link ImageTranscoder}.
 *
 * <h2>Two kinds of failure, kept apart</h2>
 *
 * <p>{@link MediaFailedException} is the creator's to act on and is recorded on the row.
 * {@link ObjectStoreUnavailableException} and {@link TranscoderUnavailableException} are
 * not: the row stays claimed and the pass throws, which is how {@code ScheduledJob} reports
 * a failed run — the runner counts the attempt, releases the lease and backs off. Recording
 * an unreachable bucket against somebody's photograph would tell them to send a different
 * one to fix an outage.
 */
@Component
public class MediaProcessingJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(MediaProcessingJob.class);

    private final MediaAssetRepository assets;
    private final MediaProcessingWrites writes;
    private final ObjectStore store;
    private final ImageTranscoder transcoder;
    private final MediaProperties properties;

    public MediaProcessingJob(
            MediaAssetRepository assets,
            MediaProcessingWrites writes,
            ObjectStore store,
            ImageTranscoder transcoder,
            MediaProperties properties) {
        this.assets = assets;
        this.writes = writes;
        this.store = store;
        this.transcoder = transcoder;
        this.properties = properties;
    }

    @Override
    public String name() {
        return "media-processing";
    }

    @Override
    public String schedule() {
        return properties.processing().schedule();
    }

    @Override
    public void run() {
        if (!store.isAvailable()) {
            /*
             * Nothing was ever uploaded, so nothing is waiting. Returning rather than
             * throwing: an unconfigured deployment is a supported state, and a job that
             * failed every five seconds would exhaust its own attempt budget and be
             * stopped -- which is then something to undo by hand on the day storage is
             * configured, for a deployment that was behaving correctly throughout.
             */
            return;
        }

        int removed = writes.removeAbandoned();
        if (removed > 0) {
            log.info("Removed {} upload(s) that were begun and never completed", removed);
        }

        List<MediaAsset> waiting =
                assets.findAwaitingProcessing(MediaKind.IMAGE, Limit.of(properties.processing().batchSize()));
        for (MediaAsset asset : waiting) {
            UUID mediaId = asset.getId();
            if (writes.claim(mediaId)) {
                process(mediaId);
            }
        }
    }

    /**
     * One image, end to end.
     *
     * <p>No transaction spans this. It downloads, spawns a process and uploads — seconds of
     * work — and holding a pool connection across it would take one out of circulation per
     * image being processed. The only writes are the two terminal transitions, each its own
     * short transaction in {@link MediaProcessingWrites}.
     */
    private void process(UUID mediaId) {
        Path workspace = null;
        try {
            workspace = Files.createTempDirectory("ideanest-media-");
            Path raw = workspace.resolve("source");
            String rawKey = MediaLibrary.rawKeyOf(mediaId);

            store.download(rawKey, raw);

            if (!Files.exists(raw) || Files.size(raw) == 0L) {
                writes.fail(mediaId, MediaFailureReason.EMPTY);
                return;
            }
            if (Files.size(raw) > properties.maxUploadBytes()) {
                /*
                 * The declaration at `begin` was never binding -- a presigned address does
                 * not enforce the size the client said it would send -- and this is where
                 * that is found out. The object goes: it is over the ceiling and nothing
                 * will ever read it.
                 */
                store.delete(rawKey);
                writes.fail(mediaId, MediaFailureReason.TOO_LARGE);
                return;
            }

            TranscodedImage derived = transcoder.transcode(raw, workspace);
            String derivedKey = MediaLibrary.derivedKeyOf(mediaId, derived.contentType());
            long byteSize = Files.size(derived.file());

            store.upload(derivedKey, derived.file(), derived.contentType());
            /*
             * Only once the derived object is safely written. The other order loses the
             * creator's upload if this process dies in between, and there is no second copy
             * of it anywhere.
             */
            store.delete(rawKey);

            writes.succeed(mediaId, derivedKey, derived, byteSize);

        } catch (MediaFailedException refusal) {
            log.info("Media {} refused: {}", mediaId, refusal.reason());
            writes.fail(mediaId, refusal.reason());
            // Nothing will ever read it again, and keeping it would be storage spent on a
            // file the creator was told we refused.
            deleteRawQuietly(mediaId);
        } catch (IOException problem) {
            // A temporary directory that cannot be created or read is this host's problem
            // rather than the creator's, so the row is left claimed and the pass fails.
            throw new UncheckedIOException("Media " + mediaId + " could not be processed locally", problem);
        } finally {
            deleteRecursively(workspace);
        }
    }

    private void deleteRawQuietly(UUID mediaId) {
        try {
            store.delete(MediaLibrary.rawKeyOf(mediaId));
        } catch (RuntimeException problem) {
            log.warn("Could not delete the refused upload of media {}", mediaId, problem);
        }
    }

    static void deleteRecursively(Path directory) {
        if (directory == null) {
            return;
        }
        try (var entries = Files.walk(directory)) {
            List<Path> deepestFirst = entries.sorted(Comparator.reverseOrder()).toList();
            for (Path path : deepestFirst) {
                Files.deleteIfExists(path);
            }
        } catch (IOException problem) {
            // Worth a line and not worth failing the pass: the image was processed, and
            // what is left behind is a directory in the system temporary space.
            log.warn("Could not clean up {}", directory, problem);
        }
    }
}
