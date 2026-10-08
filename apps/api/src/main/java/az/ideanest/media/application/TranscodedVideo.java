package az.ideanest.media.application;

import java.nio.file.Path;
import java.util.Objects;

/**
 * What a transcode produced — issue #331.
 *
 * @param file the MP4 to store
 * @param contentType always {@code video/mp4} today; carried so the key's extension and the
 *     stored type are decided in one place
 * @param width of the transcoded frame, after rotation — measured on the output
 * @param height likewise
 * @param durationMs measured on the output
 * @param posterFrame one frame, losslessly, for {@link ImageTranscoder} to make a poster of
 */
public record TranscodedVideo(
        Path file, String contentType, int width, int height, int durationMs, Path posterFrame) {

    public TranscodedVideo {
        Objects.requireNonNull(file, "A transcode produces a file");
        Objects.requireNonNull(contentType, "A transcode decides a type");
        Objects.requireNonNull(posterFrame, "A transcode produces a poster frame");
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("A transcoded video has positive dimensions");
        }
        if (durationMs <= 0) {
            throw new IllegalArgumentException("A transcoded video lasts some time");
        }
    }
}
