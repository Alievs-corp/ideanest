package az.ideanest.support;

import az.ideanest.media.application.MediaFailedException;
import az.ideanest.media.application.TranscodedVideo;
import az.ideanest.media.application.VideoTranscoder;
import az.ideanest.media.domain.MediaFailureReason;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The video transcoder, scripted rather than spawning ffmpeg — issue #331.
 *
 * <p>{@link ScriptedImageTranscoder}'s arrangement: the conversion is asserted against a real
 * installation in {@code FfmpegVideoTranscoderTests}, and the integration suite needs only to
 * know what the sweep does with the answer.
 */
public class ScriptedVideoTranscoder implements VideoTranscoder {

    private int width = 1280;

    private int height = 720;

    private int durationMs = 42_000;

    private boolean available = true;

    private MediaFailureReason refusal;

    private final AtomicInteger calls = new AtomicInteger();

    public void willProduce(int width, int height, int durationMs) {
        this.width = width;
        this.height = height;
        this.durationMs = durationMs;
        this.refusal = null;
    }

    public void willRefuse(MediaFailureReason reason) {
        this.refusal = reason;
    }

    public void unavailable() {
        this.available = false;
    }

    public int calls() {
        return calls.get();
    }

    public void reset() {
        this.width = 1280;
        this.height = 720;
        this.durationMs = 42_000;
        this.available = true;
        this.refusal = null;
        this.calls.set(0);
    }

    @Override
    public TranscodedVideo transcode(Path source, Path workingDirectory) {
        calls.incrementAndGet();
        if (refusal != null) {
            throw new MediaFailedException(refusal, "Scripted refusal");
        }
        Path derived = workingDirectory.resolve("derived.mp4");
        Path poster = workingDirectory.resolve("poster.png");
        try {
            Files.copy(source, derived, StandardCopyOption.REPLACE_EXISTING);
            Files.write(poster, new byte[] {(byte) 0x89, 'P', 'N', 'G'});
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
        return new TranscodedVideo(derived, "video/mp4", width, height, durationMs, poster);
    }

    @Override
    public boolean isAvailable() {
        return available;
    }
}
