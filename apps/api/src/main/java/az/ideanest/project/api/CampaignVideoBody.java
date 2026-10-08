package az.ideanest.project.api;

import az.ideanest.project.application.CampaignVideo;
import java.util.UUID;

/**
 * A campaign's video, in a response — issue #331.
 *
 * <p>Response only. A request names a video by {@code videoMediaId} and nothing else: every
 * other field here is a fact the server measured, and a client that sent them would be
 * sending numbers to be disbelieved — the argument {@code CoverImageBody} makes about an
 * uploaded cover.
 *
 * @param mediaId the upload behind it
 * @param url an H.264 MP4 of at most 720p, playable by a plain {@code <video>} element
 * @param posterUrl the still to show before it plays
 * @param width in pixels, of the transcoded frame
 * @param height likewise
 * @param durationMs how long it is
 * @param blurDataUrl the poster's placeholder, as a data URL
 */
public record CampaignVideoBody(
        UUID mediaId, String url, String posterUrl, int width, int height, int durationMs, String blurDataUrl) {

    /** Null in, null out: a campaign with no video. */
    public static CampaignVideoBody of(CampaignVideo video) {
        return video == null
                ? null
                : new CampaignVideoBody(
                        video.mediaId(),
                        video.url(),
                        video.posterUrl(),
                        video.width(),
                        video.height(),
                        video.durationMs(),
                        video.blurDataUrl());
    }
}
