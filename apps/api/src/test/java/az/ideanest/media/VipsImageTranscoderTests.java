package az.ideanest.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.media.application.MediaFailedException;
import az.ideanest.media.application.TranscodedImage;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.infrastructure.VipsImageTranscoder;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.api.io.TempDir;

/**
 * What actually comes out of the transcoder — the media pipeline design of 2026-08-30.
 *
 * <h2>Guarded on libvips being installed, and installed in CI on purpose</h2>
 *
 * <p>The guard is so that somebody can work on this repository without a native dependency.
 * It is paired with an {@code Install libvips} step in {@code ci.yml}, because a test that
 * skips everywhere is not a test — and the EXIF assertion below is a privacy claim, which is
 * exactly the kind that has to be made against real output rather than reasoned about in a
 * comment.
 */
class VipsImageTranscoderTests {

    /** §13.1's 1440 and 82, as the tests use them. */
    private static final MediaProperties PROPERTIES =
            new MediaProperties(null, 20L * 1024 * 1024, Duration.ofMinutes(10), 1440, 82, null, null);

    /**
     * A string long enough to be unmistakable and short enough to fit an ASCII EXIF tag.
     *
     * <p>Twenty bytes including the terminator, which is what {@link #withExifProbe} writes
     * into the tag's count field.
     */
    private static final String PROBE = "IDEANEST-GPS-PROBE";

    static boolean vipsIsInstalled() {
        try {
            Process process = new ProcessBuilder("vips", "--version")
                    .redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .start();
            return process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (IOException | InterruptedException absent) {
            if (absent instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        }
    }

    // ------------------------------------------------------------------
    // The privacy claim
    // ------------------------------------------------------------------

    /**
     * §13.1: "EXIF stripped — GPS coordinates in an uploaded photo are a privacy leak."
     *
     * <p>Asserted on the bytes rather than on a header field, because what matters is that
     * the data is not in the file anybody can download — not that one reader does not report
     * it.
     */
    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("metadata in the upload is not in what is stored")
    void stripsExif(@TempDir Path workspace) throws IOException {
        Path source = withExifProbe(photograph(workspace, "source.jpg", 2000, 1500), workspace);

        // The probe is in the input, or this test proves nothing.
        assertThat(new String(Files.readAllBytes(source), StandardCharsets.ISO_8859_1)).contains(PROBE);

        TranscodedImage derived = new VipsImageTranscoder(PROPERTIES).transcode(source, workspace);

        assertThat(new String(Files.readAllBytes(derived.file()), StandardCharsets.ISO_8859_1))
                .doesNotContain(PROBE);
    }

    // ------------------------------------------------------------------
    // What the pipeline stores
    // ------------------------------------------------------------------

    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("a photograph is reduced to the long edge and re-encoded as JPEG")
    void shrinksToTheLongEdge(@TempDir Path workspace) throws IOException {
        TranscodedImage derived =
                new VipsImageTranscoder(PROPERTIES).transcode(photograph(workspace, "big.jpg", 4000, 3000), workspace);

        assertThat(derived.contentType()).isEqualTo("image/jpeg");
        assertThat(derived.width()).isEqualTo(1440);
        // 4000x3000 is 4:3, so the box bounds the width and the height follows.
        assertThat(derived.height()).isEqualTo(1080);
        assertThat(Files.size(derived.file())).isPositive();
    }

    /**
     * The half of {@code --size down} that matters: an image smaller than the box is stored
     * at the size it arrived. Upscaling invents detail, and this pipeline exists so that
     * small images stop being refused — not so that they can be pretended larger.
     */
    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("an image smaller than the box is not enlarged")
    void doesNotUpscale(@TempDir Path workspace) throws IOException {
        TranscodedImage derived = new VipsImageTranscoder(PROPERTIES)
                .transcode(photograph(workspace, "small.jpg", 800, 600), workspace);

        assertThat(derived.width()).isEqualTo(800);
        assertThat(derived.height()).isEqualTo(600);
    }

    /**
     * A portrait photograph bounds on its height. Both a width and a height are passed to
     * {@code vips thumbnail} for exactly this — one number would bound the width of a
     * portrait and leave it 1440 tall by 1920.
     */
    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("a portrait image is bounded on its long edge too")
    void boundsPortraitOnHeight(@TempDir Path workspace) throws IOException {
        TranscodedImage derived = new VipsImageTranscoder(PROPERTIES)
                .transcode(photograph(workspace, "tall.jpg", 1500, 3000), workspace);

        assertThat(derived.height()).isEqualTo(1440);
        assertThat(derived.width()).isEqualTo(720);
    }

    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("an image with transparency is kept as PNG")
    void keepsAlphaAsPng(@TempDir Path workspace) throws IOException {
        // JPEG has no alpha channel and would composite the transparency onto black. A
        // screenshot with a transparent corner is not a rare upload.
        TranscodedImage derived = new VipsImageTranscoder(PROPERTIES)
                .transcode(transparentImage(workspace, "logo.png", 900, 900), workspace);

        assertThat(derived.contentType()).isEqualTo("image/png");
        assertThat(derived.file().getFileName().toString()).endsWith(".png");
    }

    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("the placeholder is a sixteen-pixel data URL")
    void producesAPlaceholder(@TempDir Path workspace) throws IOException {
        TranscodedImage derived = new VipsImageTranscoder(PROPERTIES)
                .transcode(photograph(workspace, "cover.jpg", 2000, 1125), workspace);

        // The shape V61's media_blur_data_url_shape holds the column to.
        assertThat(derived.blurDataUrl()).startsWith("data:image/jpeg;base64,");
        // Sixteen pixels of anything is small. A kilobyte is a generous ceiling and the
        // point of the assertion: this string is carried in every response the image
        // appears in.
        assertThat(derived.blurDataUrl().length()).isLessThan(2048);
    }

    // ------------------------------------------------------------------
    // What it refuses, and whose fault each one is
    // ------------------------------------------------------------------

    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("a file that is not an image is refused as an unsupported format")
    void refusesNonImages(@TempDir Path workspace) throws IOException {
        Path notAnImage = workspace.resolve("invoice.jpg");
        // Named .jpg and containing a PDF, which is the case the magic-byte rule is for:
        // a browser guesses the type from the extension, so an honest client sends this.
        Files.write(notAnImage, "%PDF-1.7\nnot an image at all\n".getBytes(StandardCharsets.US_ASCII));

        assertThatThrownBy(() -> new VipsImageTranscoder(PROPERTIES).transcode(notAnImage, workspace))
                .isInstanceOf(MediaFailedException.class)
                .extracting(problem -> ((MediaFailedException) problem).reason())
                .isEqualTo(MediaFailureReason.UNSUPPORTED_FORMAT);
    }

    /**
     * The floor, and it is not the cover minimum. 1024×576 became advice when this pipeline
     * landed; this is the much lower number that answers a different question — whether the
     * image can be displayed at all.
     */
    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("an image too small to display is refused")
    void refusesTinyImages(@TempDir Path workspace) throws IOException {
        assertThatThrownBy(() -> new VipsImageTranscoder(PROPERTIES)
                        .transcode(photograph(workspace, "avatar.jpg", 128, 128), workspace))
                .isInstanceOf(MediaFailedException.class)
                .extracting(problem -> ((MediaFailedException) problem).reason())
                .isEqualTo(MediaFailureReason.TOO_SMALL);
    }

    /**
     * 800×600 is the case this whole change exists for: a phone photograph that used to be
     * refused at the first screen of the editor. It goes through.
     */
    @Test
    @EnabledIf("vipsIsInstalled")
    @DisplayName("the photograph that used to be refused is accepted")
    void acceptsWhatUsedToBeBlocked(@TempDir Path workspace) throws IOException {
        TranscodedImage derived = new VipsImageTranscoder(PROPERTIES)
                .transcode(photograph(workspace, "phone.jpg", 800, 600), workspace);

        assertThat(derived.width()).isEqualTo(800);
        assertThat(derived.contentType()).isEqualTo("image/jpeg");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A JPEG of the requested size, made by libvips itself so the test needs nothing else. */
    private static Path photograph(Path workspace, String name, int width, int height) throws IOException {
        Path file = workspace.resolve(name);
        // Gaussian noise rather than `black`: a uniform image compresses to almost nothing
        // and would make the size assertions meaningless.
        vips(List.of("vips", "gaussnoise", file.toString(), String.valueOf(width), String.valueOf(height)));
        return file;
    }

    /** A four-band PNG, so the alpha branch is exercised on a real alpha channel. */
    private static Path transparentImage(Path workspace, String name, int width, int height) throws IOException {
        Path file = workspace.resolve(name);
        vips(List.of(
                "vips",
                "black",
                file.toString(),
                String.valueOf(width),
                String.valueOf(height),
                "--bands",
                "4"));
        return file;
    }

    /**
     * Splices a valid Exif APP1 segment carrying {@link #PROBE} into a JPEG.
     *
     * <p>Written by hand rather than taken from a fixture file, so that what the test asserts
     * on is visible in the test. The layout is an APP1 marker, the {@code Exif\0\0}
     * identifier, and a little-endian TIFF block with one ASCII tag in IFD0.
     */
    private static Path withExifProbe(Path jpeg, Path workspace) throws IOException {
        byte[] payload = (PROBE + "\0").getBytes(StandardCharsets.US_ASCII);

        // TIFF: header (8) + entry count (2) + one entry (12) + next-IFD offset (4) = 26,
        // then the tag's value.
        int valueOffset = 26;
        byte[] tiff = new byte[valueOffset + payload.length];
        tiff[0] = 'I';
        tiff[1] = 'I';
        writeShort(tiff, 2, 42);
        writeInt(tiff, 4, 8);
        writeShort(tiff, 8, 1);
        writeShort(tiff, 10, 0x010E); // ImageDescription
        writeShort(tiff, 12, 2); // ASCII
        writeInt(tiff, 14, payload.length);
        writeInt(tiff, 18, valueOffset);
        writeInt(tiff, 22, 0); // no next IFD
        System.arraycopy(payload, 0, tiff, valueOffset, payload.length);

        byte[] identifier = "Exif\0\0".getBytes(StandardCharsets.US_ASCII);
        int segmentLength = 2 + identifier.length + tiff.length;

        byte[] original = Files.readAllBytes(jpeg);
        byte[] spliced = new byte[original.length + 2 + segmentLength];
        int at = 0;
        spliced[at++] = original[0]; // 0xFF
        spliced[at++] = original[1]; // 0xD8, start of image
        spliced[at++] = (byte) 0xFF;
        spliced[at++] = (byte) 0xE1;
        spliced[at++] = (byte) ((segmentLength >> 8) & 0xFF);
        spliced[at++] = (byte) (segmentLength & 0xFF);
        System.arraycopy(identifier, 0, spliced, at, identifier.length);
        at += identifier.length;
        System.arraycopy(tiff, 0, spliced, at, tiff.length);
        at += tiff.length;
        System.arraycopy(original, 2, spliced, at, original.length - 2);

        Path probed = workspace.resolve("with-exif.jpg");
        Files.write(probed, spliced);
        return probed;
    }

    private static void writeShort(byte[] target, int at, int value) {
        target[at] = (byte) (value & 0xFF);
        target[at + 1] = (byte) ((value >> 8) & 0xFF);
    }

    private static void writeInt(byte[] target, int at, int value) {
        target[at] = (byte) (value & 0xFF);
        target[at + 1] = (byte) ((value >> 8) & 0xFF);
        target[at + 2] = (byte) ((value >> 16) & 0xFF);
        target[at + 3] = (byte) ((value >> 24) & 0xFF);
    }

    private static void vips(List<String> command) {
        try {
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (!process.waitFor(30, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IllegalStateException("Could not build the fixture: " + output);
            }
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted building a fixture", interrupted);
        }
    }
}
