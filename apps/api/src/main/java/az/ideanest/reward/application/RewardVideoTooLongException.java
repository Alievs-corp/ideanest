package az.ideanest.reward.application;

import java.util.Locale;

/**
 * A reward's clip is longer than {@code ideanest.media.video.reward-max-duration}.
 *
 * <p>Answered as 422 with {@code code: REWARD_VIDEO_TOO_LONG}. Not the 400 of a field the
 * request got wrong: the identifier is a perfectly good upload, and what refuses it is the
 * length the server measured, which the client can show beside the limit.
 */
public class RewardVideoTooLongException extends RuntimeException {

    private final int durationMs;

    private final long maxDurationMs;

    public RewardVideoTooLongException(int durationMs, long maxDurationMs) {
        super(String.format(
                Locale.ROOT,
                "That video is %.1f seconds long; a reward's video is at most %d.",
                durationMs / 1000.0,
                maxDurationMs / 1000));
        this.durationMs = durationMs;
        this.maxDurationMs = maxDurationMs;
    }

    /** What ffprobe measured on the transcoded file. */
    public int durationMs() {
        return durationMs;
    }

    /** The configured limit, without the slack a measurement is allowed. */
    public long maxDurationMs() {
        return maxDurationMs;
    }
}
