package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaVideoProcessingJob;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.Campaigns;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedVideoTranscoder;
import az.ideanest.user.infrastructure.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * A campaign's video on its cards: the discovery feed's and the profile's.
 *
 * <p>A card carries the video's addresses only while it is ready; {@code image} stays the
 * uploaded cover either way, and the clients choose the poster when there is a video.
 */
class CardVideoApiTests extends DiscoveryTestSupport {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final byte[] BYTES = "....ftypisom a video".getBytes(StandardCharsets.ISO_8859_1);

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private LocalObjectStore store;

    @Autowired
    private ScriptedVideoTranscoder videos;

    @Autowired
    private MediaVideoProcessingJob videoProcessing;

    @Autowired
    private UserRepository users;

    @BeforeEach
    void clean() {
        Campaigns.clear(dataSource);
        store.clear();
        videos.reset();
    }

    @Test
    @DisplayName("a campaign with a ready video carries it on its card; one without, or still processing, does not")
    void aCardCarriesTheReadyVideo() {
        EmailAddress email = EmailAddress.of("card-video-" + SEQUENCE.incrementAndGet() + "@example.com");
        String token = signIn(email);
        UUID creator = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();

        videos.willProduce(720, 1280, 30_000);
        UUID ready = uploadVideo(token, true);
        UUID processing = uploadVideo(token, false);

        UUID withVideo = Campaigns.seed(dataSource, creator, "with-video").state("LIVE").insert();
        UUID stillProcessing = Campaigns.seed(dataSource, creator, "still-processing").state("LIVE").insert();
        Campaigns.seed(dataSource, creator, "without-video").state("LIVE").insert();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("UPDATE projects SET video_media_id = ? WHERE id = ?", ready, withVideo);
        jdbc.update("UPDATE projects SET video_media_id = ? WHERE id = ?", processing, stillProcessing);

        Map<String, Map<String, Object>> cards = bySlug(items(feed("")));
        assertThat(cards).containsKeys("with-video", "still-processing", "without-video");

        Map<String, Object> card = cards.get("with-video");
        assertVideo(card, ready);
        // The cover is left as it was: the client decides to show the poster instead.
        assertThat(card.get("image")).isNotNull();
        // Absent rather than null, as every other unset field of a discovery card.
        assertThat(cards.get("still-processing")).doesNotContainKey("video");
        assertThat(cards.get("without-video")).doesNotContainKey("video");

        String creatorSlug = (String) card.get("creatorSlug");
        ResponseEntity<Map<String, Object>> profile = rest.exchange(
                "/v1/users/" + creatorSlug + "/projects", HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), OBJECT);
        assertThat(profile.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Map<String, Object>> profileCards = bySlug(items(profile.getBody(), "projects"));
        assertVideo(profileCards.get("with-video"), ready);
        // The profile card writes its nulls out.
        assertThat(profileCards.get("without-video")).containsEntry("video", null);
        assertThat(profileCards.get("still-processing")).containsEntry("video", null);
    }

    @Test
    @DisplayName("the feed's validator changes when a campaign gains a video")
    void theEtagCoversTheVideo() {
        EmailAddress email = EmailAddress.of("card-video-" + SEQUENCE.incrementAndGet() + "@example.com");
        String token = signIn(email);
        UUID creator = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        UUID projectId = Campaigns.seed(dataSource, creator, "gains-a-video").state("LIVE").insert();

        String before = get("/v1/discover", new HttpHeaders()).getHeaders().getETag();
        new JdbcTemplate(dataSource)
                .update("UPDATE projects SET video_media_id = ? WHERE id = ?", uploadVideo(token, true), projectId);
        String after = get("/v1/discover", new HttpHeaders()).getHeaders().getETag();

        assertThat(before).isNotNull();
        assertThat(after).isNotEqualTo(before);
    }

    // ------------------------------------------------------------------

    @SuppressWarnings("unchecked")
    private static void assertVideo(Map<String, Object> card, UUID mediaId) {
        Map<String, Object> video = (Map<String, Object>) card.get("video");
        assertThat(video).containsOnlyKeys("url", "posterUrl", "width", "height");
        assertThat(video).containsEntry("width", 720).containsEntry("height", 1280);
        assertThat(video.get("url")).isEqualTo("https://cdn.test/media/" + mediaId + ".mp4");
        assertThat(video.get("posterUrl")).isEqualTo("https://cdn.test/media/" + mediaId + "-poster.jpg");
    }

    private static Map<String, Map<String, Object>> bySlug(List<Map<String, Object>> cards) {
        Map<String, Map<String, Object>> bySlug = new LinkedHashMap<>();
        for (Map<String, Object> card : cards) {
            bySlug.put((String) card.get("slug"), card);
        }
        return bySlug;
    }

    /** @param process false leaves it unfinished, which a card must not show */
    private UUID uploadVideo(String accessToken, boolean process) {
        ResponseEntity<Map<String, Object>> issued = rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", "video/mp4", "byteSize", BYTES.length), bearer(accessToken)),
                OBJECT);
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        UUID mediaId = UUID.fromString((String) issued.getBody().get("mediaId"));
        if (!process) {
            // Left awaiting its upload rather than uploaded: an UPLOADED clip would sit at
            // the head of the video sweep's queue for every suite after this one.
            return mediaId;
        }
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        rest.exchange(
                "/v1/media/" + mediaId + "/complete",
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(accessToken)),
                OBJECT);
        videoProcessing.run();
        return mediaId;
    }

    private String signIn(EmailAddress email) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                OBJECT);
        return (String) signedIn.getBody().get("accessToken");
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }
}
