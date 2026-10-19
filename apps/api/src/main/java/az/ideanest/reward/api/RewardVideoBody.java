package az.ideanest.reward.api;

import az.ideanest.media.application.MediaLibrary;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

/**
 * A reward tier's clip on the wire: at most {@code reward-max-duration}, played muted on a
 * campaign page.
 *
 * @param url the MP4
 * @param posterUrl the still shown before it plays
 * @param durationMs measured on the transcoded file
 * @param blurDataUrl the poster's placeholder
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RewardVideoBody(
        UUID mediaId, String url, String posterUrl, int width, int height, int durationMs, String blurDataUrl) {

    static RewardVideoBody of(MediaLibrary.VideoView view) {
        return view == null
                ? null
                : new RewardVideoBody(
                        view.id(),
                        view.url(),
                        view.posterUrl(),
                        view.width(),
                        view.height(),
                        view.durationMs(),
                        view.blurDataUrl());
    }
}
