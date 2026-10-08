package az.ideanest.media.application;

import java.nio.file.Path;

/**
 * Turns an uploaded clip into the one rendition this platform serves — issue #331.
 *
 * <p>The video counterpart of {@link ImageTranscoder}, and behind an interface for the same
 * reason: the integration suite scripts it rather than requiring ffmpeg to start, and the
 * conversion itself is asserted against a real installation in
 * {@code FfmpegVideoTranscoderTests}.
 *
 * <p>The poster is returned as a raw frame and not as a finished image. Making it one is
 * {@link ImageTranscoder}'s job — the EXIF strip, the 320-pixel floor and the blur
 * placeholder are already there, and a second implementation of any of them would be one
 * that can disagree.
 */
public interface VideoTranscoder {

    /**
     * Probes, refuses or transcodes one clip.
     *
     * @param source the raw upload, on local disk
     * @param workingDirectory where the outputs go. The caller deletes it
     * @throws MediaFailedException when the clip is the creator's to fix: not a video, too
     *     long, unreadable
     * @throws TranscoderUnavailableException when ffmpeg is not installed, or wedged
     */
    TranscodedVideo transcode(Path source, Path workingDirectory);

    /** Whether ffmpeg is installed here. */
    boolean isAvailable();
}
