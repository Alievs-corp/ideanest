package az.ideanest.media.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The seconds ffmpeg is given for {@code -t} and {@code -ss}, in any default locale.
 *
 * <p>A plain unit test, so it runs where ffmpeg is not installed: the transcoder's own suite
 * skips there, and that is how a comma in {@code -t 15,000} went unnoticed on every machine that
 * had no ffmpeg. The test JVM runs in {@code az_AZ} (see {@code build.gradle.kts}), and the
 * assertion also states it outright, so it holds even if that setting changes.
 */
class FfmpegSecondsTests {

    @Test
    @DisplayName("seconds are written with a full stop, even where the language uses a comma")
    void secondsUseAFullStop() {
        Locale before = Locale.getDefault();
        try {
            for (Locale locale : new Locale[] {Locale.of("az", "AZ"), Locale.of("tr", "TR"), Locale.of("ru", "RU")}) {
                Locale.setDefault(locale);
                assertThat(FfmpegVideoTranscoder.seconds(15.0)).as(locale.toString()).isEqualTo("15.000");
                assertThat(FfmpegVideoTranscoder.seconds(1.5)).as(locale.toString()).isEqualTo("1.500");
            }
        } finally {
            Locale.setDefault(before);
        }
    }
}
