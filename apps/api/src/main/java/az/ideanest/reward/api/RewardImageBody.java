package az.ideanest.reward.api;

import az.ideanest.media.application.MediaLibrary;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

/**
 * A reward tier's picture on the wire, in both the creator's and the public response.
 *
 * <p>The reward module's own record rather than the project module's cover body, which
 * {@code ModuleBoundaryTests} would allow but which would tie a reward's wire format to a
 * campaign's.
 *
 * @param mediaId the upload, so the editor can tell which one is attached
 * @param width the measured width, so a page reserves the box before the image loads
 * @param blurDataUrl the placeholder shown while it does
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RewardImageBody(UUID mediaId, String url, int width, int height, String blurDataUrl) {

    static RewardImageBody of(MediaLibrary.MediaView view) {
        return view == null
                ? null
                : new RewardImageBody(view.id(), view.url(), view.width(), view.height(), view.blurDataUrl());
    }
}
