package az.ideanest.project.api;

import az.ideanest.project.application.ProfileCampaign;

/**
 * A campaign's video on a card: what a grid needs to show the poster and play a preview.
 *
 * <p>Thinner than {@link CampaignVideoBody}, which the campaign page reads whole: a card
 * does not show a duration or a placeholder, and every field here is fetched for every
 * card on the page.
 *
 * @param url the MP4
 * @param posterUrl the still a client shows as the card's cover
 * @param width of the transcoded frame
 * @param height likewise
 */
public record CardVideoBody(String url, String posterUrl, int width, int height) {

    /** Null in, null out: a campaign with no ready video. */
    public static CardVideoBody of(ProfileCampaign.Video video) {
        return video == null ? null : new CardVideoBody(video.url(), video.posterUrl(), video.width(), video.height());
    }
}
