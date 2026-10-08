package az.ideanest.project.application;

import az.ideanest.media.application.MediaLibrary;
import java.util.UUID;

/**
 * A campaign's video, as the pages that show it need it — issue #331.
 *
 * <p>This module's copy of {@link MediaLibrary.VideoView} rather than that record passed
 * through, so the responses built from it depend on the project module's types and the
 * media module stays free to change its own.
 *
 * @param mediaId the upload, which the editor sends back to keep or replace it
 * @param url the MP4, served by the bucket
 * @param posterUrl the still shown before it plays
 * @param width of the frame, so a page reserves the box before anything loads
 * @param height likewise
 * @param durationMs measured on the transcoded file
 * @param blurDataUrl the poster's placeholder
 */
public record CampaignVideo(
        UUID mediaId, String url, String posterUrl, int width, int height, int durationMs, String blurDataUrl) {

    public static CampaignVideo of(MediaLibrary.VideoView view) {
        return new CampaignVideo(
                view.id(),
                view.url(),
                view.posterUrl(),
                view.width(),
                view.height(),
                view.durationMs(),
                view.blurDataUrl());
    }
}
