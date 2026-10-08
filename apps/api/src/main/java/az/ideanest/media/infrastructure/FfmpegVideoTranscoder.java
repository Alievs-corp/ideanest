package az.ideanest.media.infrastructure;

import az.ideanest.media.MediaProperties;
import az.ideanest.media.application.MediaFailedException;
import az.ideanest.media.application.TranscodedVideo;
import az.ideanest.media.application.TranscoderUnavailableException;
import az.ideanest.media.application.VideoTranscoder;
import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaFailureReason;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The video transcoder, over ffmpeg — issue #331.
 *
 * <h2>Four processes per clip</h2>
 *
 * <ol>
 *   <li>{@code ffprobe} on the input — is there a video stream, and how long is it. A clip
 *       over the ceiling is refused here, before a second of CPU is spent encoding it
 *   <li>{@code ffmpeg} to the MP4 — see {@code MediaProperties.Video} for every number in it
 *   <li>{@code ffprobe} on the output — the dimensions and the duration that are recorded.
 *       The output's and not the input's, because a phone records portrait as landscape with
 *       a rotation flag, and only the transcoded frame is the shape a player will draw
 *   <li>{@code ffmpeg} for one frame of the output, which becomes the poster
 * </ol>
 *
 * <h2>{@code -map_metadata -1} is a privacy rule, not tidiness</h2>
 *
 * <p>A phone writes the place a video was recorded into its container the way it writes GPS
 * into a photograph's EXIF. §13.1 strips the photograph's; this strips the video's, along
 * with chapters, subtitles and data streams nobody asked to publish.
 *
 * <h2>Why the CPU is capped</h2>
 *
 * <p>The API shares its host. {@code -threads} bounds the encoder, and {@code nice} — where
 * the host has it — tells the scheduler that a checkout request matters more than this.
 */
public class FfmpegVideoTranscoder implements VideoTranscoder {

    private static final Logger log = LoggerFactory.getLogger(FfmpegVideoTranscoder.class);

    /** Probing and grabbing one frame are fast. A wedged one should not hold the sweep. */
    private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(30);

    /**
     * How far past the ceiling a clip may run and still be accepted.
     *
     * <p>A phone asked for sixty seconds records sixty and a few frames, and a container's
     * duration includes the longer of its two streams. Refusing 60.04 seconds as "longer than
     * a minute" would be technically right and useless.
     */
    private static final long DURATION_TOLERANCE_MS = 500;

    /** Where the poster frame is taken from, unless the clip is shorter than this. */
    private static final double POSTER_AT_SECONDS = 1.0;

    private static final Path NICE = Path.of("/usr/bin/nice");

    /**
     * PQ or HLG to BT.709: linearise, convert the primaries, compress the highlights with
     * Hable's curve, re-encode the transfer. The canonical zscale chain; both the runtime
     * image's ffmpeg and CI's are built with zimg.
     */
    private static final String TONE_MAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
            + "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

    /** The transfer characteristics ffprobe reports for HDR. */
    private static final Set<String> HDR_TRANSFERS = Set.of("smpte2084", "arib-std-b67");

    private final MediaProperties.Video settings;
    private final boolean available;

    public FfmpegVideoTranscoder(MediaProperties properties) {
        this.settings = Objects.requireNonNull(properties, "A transcoder needs its settings").video();
        this.available = probe();
    }

    private static boolean probe() {
        try {
            CommandResult ffmpeg = run(List.of("ffmpeg", "-hide_banner", "-version"), null, PROBE_TIMEOUT);
            CommandResult ffprobe = run(List.of("ffprobe", "-hide_banner", "-version"), null, PROBE_TIMEOUT);
            if (ffmpeg.succeeded() && ffprobe.succeeded()) {
                log.info("ffmpeg available: {}", ffmpeg.output().lines().findFirst().orElse("").strip());
                return true;
            }
        } catch (TranscoderUnavailableException absent) {
            log.warn("ffmpeg is not installed; uploaded videos cannot be processed on this host");
            return false;
        }
        log.warn("ffmpeg did not answer -version; uploaded videos cannot be processed on this host");
        return false;
    }

    @Override
    public boolean isAvailable() {
        return available;
    }

    @Override
    public TranscodedVideo transcode(Path source, Path workingDirectory) {
        if (!available) {
            throw new TranscoderUnavailableException("ffmpeg is not installed on this host");
        }

        Probe input = probeOf(source);
        long ceilingMs = settings.maxDuration().toMillis();

        // Before the encode, from the input: what the shorter edge will be once the longer
        // one is fitted to the box. The poster is held to the cover's floor, and finding that
        // out after a minute of encoding would spend the CPU for a refusal.
        double fit = Math.min(1.0, (double) settings.longestEdge() / Math.max(input.width(), input.height()));
        if (Math.min(input.width(), input.height()) * fit < MediaAsset.MINIMUM_EDGE) {
            throw new MediaFailedException(
                    MediaFailureReason.TOO_SMALL,
                    "That video is %dx%d, which is smaller than anything this platform can display."
                            .formatted(input.width(), input.height()));
        }
        if (input.durationMs() > ceilingMs + DURATION_TOLERANCE_MS) {
            throw new MediaFailedException(
                    MediaFailureReason.TOO_LONG,
                    "That video is %d seconds long; a campaign video is at most %d."
                            .formatted(Math.round(input.durationMs() / 1000.0), ceilingMs / 1000));
        }

        Path derived = workingDirectory.resolve("derived.mp4");
        CommandResult encoded;
        try {
            encoded = run(niced(encodeCommand(source, derived, input.isHdr())), workingDirectory, settings.timeout());
        } catch (EncodeTimedOut slow) {
            /*
             * The file's failure, not the host's. A minute of video that will not encode in
             * the timeout will not encode on the next pass either, and leaving the row
             * claimed would retry it for ever while every other clip waited.
             */
            throw new MediaFailedException(
                    MediaFailureReason.UNREADABLE, "That video took too long to convert: " + slow.getMessage());
        }
        if (!encoded.succeeded()) {
            throw new MediaFailedException(
                    MediaFailureReason.UNREADABLE, "That video could not be converted: " + encoded.lastLineOfError());
        }

        Probe output = probeOf(derived);
        Path poster = workingDirectory.resolve("poster.png");
        grabFrame(derived, poster, output.durationMs());

        return new TranscodedVideo(derived, "video/mp4", output.width(), output.height(), output.durationMs(), poster);
    }

    /**
     * The encode, every option of which is a decision in {@code MediaProperties.Video}.
     *
     * <p>The scale box is {@code min(edge, iw)} by {@code min(edge, ih)}, fitted with the
     * aspect ratio kept: a landscape 1080p frame becomes 1280×720, a portrait one 720×1280,
     * and anything already smaller is left alone — upscaling only spends bits on detail that
     * was never recorded. {@code force_divisible_by=2} because H.264 in 4:2:0 refuses an odd
     * edge.
     *
     * <p><strong>HDR is tone-mapped to SDR.</strong> An iPhone records 10-bit HLG or Dolby
     * Vision by default; squeezed into 8-bit with its BT.2020 tags left on, browsers render
     * it washed out and inconsistently. Every output is tagged BT.709, which is what an
     * 8-bit H.264 file is played as anyway.
     *
     * <p>{@code -threads} appears twice, and {@code -filter_threads} once, because each bounds
     * a different stage: before {@code -i} the decoder, after it the encoder. A 4K HEVC decode
     * left at the default would take every core the encoder was kept off.
     */
    private List<String> encodeCommand(Path source, Path derived, boolean hdr) {
        int edge = settings.longestEdge();
        String threads = String.valueOf(settings.threads());
        String toneMap = hdr ? TONE_MAP + "," : "";
        String scale = ("%sscale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease"
                        + ":force_divisible_by=2,format=yuv420p")
                .formatted(toneMap, edge, edge);
        long limitMs = settings.maxDuration().toMillis() + DURATION_TOLERANCE_MS;

        return List.of(
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-threads", threads,
                "-i", source.toString(),
                "-map", "0:v:0", "-map", "0:a:0?",
                "-filter_threads", threads,
                "-vf", scale,
                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
                "-fpsmax", String.valueOf(settings.maxFrameRate()),
                "-c:v", "libx264", "-preset", "veryfast",
                "-crf", String.valueOf(settings.crf()),
                "-maxrate", settings.maxBitrateKbps() + "k",
                "-bufsize", (settings.maxBitrateKbps() * 2) + "k",
                "-profile:v", "high",
                "-c:a", "aac", "-b:a", settings.audioBitrateKbps() + "k", "-ac", "2",
                "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn",
                "-movflags", "+faststart",
                "-threads", threads,
                // A probe and an encoder can disagree about a broken container's length by
                // more than the tolerance. This is the bound that does not depend on either.
                "-t", "%.3f".formatted(limitMs / 1000.0),
                derived.toString());
    }

    /** One frame of the output, as PNG so the only lossy step is the poster's own encode. */
    private void grabFrame(Path video, Path poster, int durationMs) {
        double at = durationMs > (POSTER_AT_SECONDS * 2000) ? POSTER_AT_SECONDS : 0.0;
        CommandResult grabbed = run(
                List.of(
                        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                        "-ss", "%.3f".formatted(at),
                        "-i", video.toString(),
                        "-frames:v", "1",
                        poster.toString()),
                video.getParent(),
                PROBE_TIMEOUT);
        if (!grabbed.succeeded() || !Files.exists(poster)) {
            throw new MediaFailedException(
                    MediaFailureReason.UNREADABLE, "No frame of that video could be read: " + grabbed.lastLineOfError());
        }
    }

    /**
     * {@code ffprobe}, and whether this is a video at all.
     *
     * <p>A still image is a one-frame "video" with no duration to ffprobe, which is why the
     * duration is part of the format check: without it a JPEG uploaded to the video slot
     * would be transcoded into a one-frame MP4.
     */
    private static Probe probeOf(Path file) {
        CommandResult result = run(
                List.of(
                        "ffprobe", "-v", "error",
                        "-select_streams", "v:0",
                        "-show_entries", "stream=codec_type,width,height,color_transfer:format=duration",
                        "-of", "default=noprint_wrappers=1",
                        file.toString()),
                file.getParent(),
                PROBE_TIMEOUT);
        if (!result.succeeded()) {
            throw new MediaFailedException(
                    MediaFailureReason.UNSUPPORTED_FORMAT, "That file is not a video this platform can read.");
        }
        return Probe.parse(result.output());
    }

    /** {@code nice -n 10}, where the host has it. */
    private static List<String> niced(List<String> command) {
        if (!Files.isExecutable(NICE)) {
            return command;
        }
        List<String> niced = new ArrayList<>(command.size() + 3);
        niced.add(NICE.toString());
        niced.add("-n");
        niced.add("10");
        niced.addAll(command);
        return niced;
    }

    /** What {@code ffprobe} said about the first video stream and the container. */
    record Probe(int width, int height, int durationMs, String colorTransfer) {

        boolean isHdr() {
            return HDR_TRANSFERS.contains(colorTransfer);
        }

        static Probe parse(String output) {
            boolean video = false;
            int width = -1;
            int height = -1;
            double seconds = -1;
            String transfer = "";
            for (String line : output.split("\\R")) {
                String trimmed = line.strip();
                int equals = trimmed.indexOf('=');
                if (equals < 0) {
                    continue;
                }
                String key = trimmed.substring(0, equals);
                String value = trimmed.substring(equals + 1);
                switch (key) {
                    case "codec_type" -> video = video || "video".equals(value);
                    case "width" -> width = parseInt(value);
                    case "height" -> height = parseInt(value);
                    case "duration" -> seconds = parseDouble(value);
                    case "color_transfer" -> transfer = value;
                    default -> {
                        // Anything else ffprobe chose to say is not a question this asks.
                    }
                }
            }
            if (!video || seconds <= 0) {
                throw new MediaFailedException(
                        MediaFailureReason.UNSUPPORTED_FORMAT, "That file is not a video this platform can read.");
            }
            if (width <= 0 || height <= 0) {
                throw new MediaFailedException(MediaFailureReason.UNREADABLE, "That video reports no dimensions.");
            }
            return new Probe(width, height, (int) Math.max(1, Math.round(seconds * 1000)), transfer);
        }

        private static int parseInt(String value) {
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException notANumber) {
                return -1;
            }
        }

        private static double parseDouble(String value) {
            try {
                return Double.parseDouble(value);
            } catch (NumberFormatException notANumber) {
                // ffprobe writes "N/A" for a stream with no duration, which is a still image.
                return -1;
            }
        }
    }

    /**
     * Runs one command and waits, bounded — {@code VipsImageTranscoder#run}'s arrangement,
     * for its reasons: output to a file rather than a pipe, so the timeout can fire and the
     * process cannot block on a full pipe.
     */
    private static CommandResult run(List<String> command, Path workingDirectory, Duration timeout) {
        Path directory = workingDirectory == null ? Path.of(System.getProperty("java.io.tmpdir")) : workingDirectory;

        Process process = null;
        Path transcript = null;
        try {
            transcript = Files.createTempFile(directory, "ffmpeg-", ".log");

            process = new ProcessBuilder(command)
                    .directory(directory.toFile())
                    .redirectErrorStream(true)
                    .redirectOutput(transcript.toFile())
                    .start();

            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
                throw new EncodeTimedOut("did not finish within " + timeout);
            }
            return new CommandResult(process.exitValue(), Files.readString(transcript, StandardCharsets.UTF_8));

        } catch (IOException notRunnable) {
            throw new TranscoderUnavailableException("Could not run " + command.get(0), notRunnable);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            if (process != null) {
                process.destroyForcibly();
            }
            throw new TranscoderUnavailableException("Interrupted while converting", interrupted);
        } finally {
            if (transcript != null) {
                try {
                    Files.deleteIfExists(transcript);
                } catch (IOException ignored) {
                    // The working directory is removed wholesale by the caller.
                }
            }
        }
    }

    /**
     * A process that ran past its timeout. Host trouble for a probe — it is caught nowhere
     * and fails the pass like any {@link TranscoderUnavailableException} — and the file's
     * fault for the encode, which {@link #transcode} turns into a refusal.
     */
    private static final class EncodeTimedOut extends TranscoderUnavailableException {

        EncodeTimedOut(String message) {
            super(message);
        }
    }

    private record CommandResult(int exitCode, String output) {

        boolean succeeded() {
            return exitCode == 0;
        }

        /** ffmpeg puts the reason last. Bounded, because it reaches a log line. */
        String lastLineOfError() {
            List<String> lines = output.lines().map(String::strip).filter(line -> !line.isEmpty()).toList();
            String last = lines.isEmpty() ? "no output" : lines.get(lines.size() - 1);
            return last.length() > 200 ? last.substring(0, 200) : last;
        }
    }
}
