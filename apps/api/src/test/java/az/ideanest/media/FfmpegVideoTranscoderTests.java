package az.ideanest.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.media.application.MediaFailedException;
import az.ideanest.media.application.TranscodedVideo;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.infrastructure.FfmpegVideoTranscoder;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.api.io.TempDir;

/**
 * What the transcoder actually writes — issue #331.
 *
 * <p>Against a real ffmpeg, for {@code VipsImageTranscoderTests}' reason: the metadata strip
 * is a privacy claim and the duration refusal is a product rule, and both have to be made
 * against real output. Guarded on the binary so the suite runs without it locally; CI
 * installs it, so the guard does not skip them there.
 *
 * <p>The inputs are made by ffmpeg itself from its test sources, so nothing binary is
 * committed and every case states the property of its input in the line that makes it.
 */
class FfmpegVideoTranscoderTests {

    private static final MediaProperties PROPERTIES =
            new MediaProperties(null, 20L * 1024 * 1024, Duration.ofMinutes(10), 1440, 82, null, null);

    /** Where a phone puts the place a clip was recorded. */
    private static final String LOCATION = "+40.4093+049.8671/";

    @TempDir
    Path directory;

    static boolean ffmpegIsInstalled() {
        try {
            Process process = new ProcessBuilder("ffmpeg", "-version").redirectErrorStream(true).start();
            process.getInputStream().readAllBytes();
            return process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (IOException | InterruptedException absent) {
            return false;
        }
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("a 1080p clip becomes 720p H.264 in an MP4, with the index at the front")
    void landscapeBecomes720p() throws IOException {
        Path source = clip("landscape.mov", 1920, 1080, 30, 3, true);

        TranscodedVideo video = transcoder().transcode(source, work());

        assertThat(video.contentType()).isEqualTo("video/mp4");
        assertThat(video.width()).isEqualTo(1280);
        assertThat(video.height()).isEqualTo(720);
        assertThat(video.durationMs()).isBetween(2_900, 3_200);
        assertThat(probe(video.file(), "stream=codec_name")).contains("h264").contains("aac");
        assertThat(Files.exists(video.posterFrame())).isTrue();

        // `+faststart`: the moov atom precedes the media data, so playback starts from the
        // first range request instead of after the whole file has downloaded.
        String bytes = new String(Files.readAllBytes(video.file()), StandardCharsets.ISO_8859_1);
        assertThat(bytes.indexOf("moov")).isNotNegative().isLessThan(bytes.indexOf("mdat"));
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("the place a clip was recorded does not survive the transcode")
    void locationIsStripped() throws IOException {
        Path source = clip("located.mp4", 640, 360, 25, 2, false);
        assertThat(probe(source, "format_tags")).contains(LOCATION);

        TranscodedVideo video = transcoder().transcode(source, work());

        assertThat(probe(video.file(), "format_tags")).doesNotContain(LOCATION).doesNotContain("location");
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("a portrait clip stays portrait, at 720 by 1280")
    void portraitStaysPortrait() throws IOException {
        Path source = clip("portrait.mp4", 1080, 1920, 30, 2, false);

        TranscodedVideo video = transcoder().transcode(source, work());

        assertThat(video.width()).isEqualTo(720);
        assertThat(video.height()).isEqualTo(1280);
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("a small clip is not enlarged, and sixty frames a second become thirty")
    void smallIsKeptAndFrameRateIsCapped() throws IOException {
        Path source = clip("small.mp4", 640, 360, 60, 2, false);

        TranscodedVideo video = transcoder().transcode(source, work());

        assertThat(video.width()).isEqualTo(640);
        assertThat(video.height()).isEqualTo(360);
        assertThat(probe(video.file(), "stream=avg_frame_rate")).contains("30/1");
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("a clip over a minute is refused before it is encoded")
    void overAMinuteIsRefused() throws IOException {
        Path source = clip("long.mp4", 160, 120, 5, 62, false);

        assertThatThrownBy(() -> transcoder().transcode(source, work()))
                .isInstanceOf(MediaFailedException.class)
                .extracting(problem -> ((MediaFailedException) problem).reason())
                .isEqualTo(MediaFailureReason.TOO_LONG);
        assertThat(Files.exists(directory.resolve("work").resolve("derived.mp4"))).isFalse();
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("a still image in the video slot is refused as the wrong format")
    void aStillIsNotAVideo() throws IOException {
        Path still = directory.resolve("still.jpg");
        ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", still.toString());

        assertThatThrownBy(() -> transcoder().transcode(still, work()))
                .isInstanceOf(MediaFailedException.class)
                .extracting(problem -> ((MediaFailedException) problem).reason())
                .isEqualTo(MediaFailureReason.UNSUPPORTED_FORMAT);
    }

    @Test
    @EnabledIf("ffmpegIsInstalled")
    @DisplayName("bytes that are not a video at all are refused as the wrong format")
    void garbageIsNotAVideo() throws IOException {
        Path garbage = directory.resolve("garbage.mp4");
        Files.writeString(garbage, "this is not a video, whatever its name says");

        assertThatThrownBy(() -> transcoder().transcode(garbage, work()))
                .isInstanceOf(MediaFailedException.class)
                .extracting(problem -> ((MediaFailedException) problem).reason())
                .isEqualTo(MediaFailureReason.UNSUPPORTED_FORMAT);
    }

    // ------------------------------------------------------------------

    private static FfmpegVideoTranscoder transcoder() {
        return new FfmpegVideoTranscoder(PROPERTIES);
    }

    private Path work() throws IOException {
        return Files.createDirectories(directory.resolve("work"));
    }

    /** A test pattern of this size, rate and length, recorded "at" {@link #LOCATION}. */
    private Path clip(String name, int width, int height, int fps, int seconds, boolean audio) throws IOException {
        Path file = directory.resolve(name);
        List<String> arguments = new ArrayList<>(List.of(
                "-f", "lavfi", "-i", "testsrc=size=%dx%d:rate=%d:duration=%d".formatted(width, height, fps, seconds)));
        if (audio) {
            arguments.addAll(List.of("-f", "lavfi", "-i", "sine=frequency=440:duration=" + seconds));
        }
        arguments.addAll(List.of(
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                "-metadata", "location=" + LOCATION,
                "-movflags", "+use_metadata_tags"));
        if (audio) {
            arguments.addAll(List.of("-c:a", "aac", "-shortest"));
        }
        arguments.add(file.toString());
        ffmpeg(arguments.toArray(String[]::new));
        return file;
    }

    private static void ffmpeg(String... arguments) throws IOException {
        List<String> command = new ArrayList<>(List.of("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"));
        command.addAll(List.of(arguments));
        run(command);
    }

    private static String probe(Path file, String entries) throws IOException {
        return run(List.of(
                "ffprobe", "-v", "error", "-show_entries", entries, "-of", "default=noprint_wrappers=1", file.toString()));
    }

    private static String run(List<String> command) throws IOException {
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        try {
            if (!process.waitFor(2, TimeUnit.MINUTES) || process.exitValue() != 0) {
                throw new IOException(String.join(" ", command) + " failed: " + output);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException(interrupted);
        }
        return output;
    }
}
