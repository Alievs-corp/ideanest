package az.ideanest.reward;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaProcessingJob;
import az.ideanest.media.application.MediaVideoProcessingJob;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedImageTranscoder;
import az.ideanest.support.ScriptedVideoTranscoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * A reward tier's picture and clip, from the upload to the campaign page.
 *
 * <p>{@code CampaignVideoApiTests}' arrangement: the store is a directory and both
 * transcoders are scripted, so the measured duration is whatever a test asks for. What is
 * covered here is what the reward module does with an upload: which ones it accepts, the
 * five-second limit and its slack, and that a released upload is deleted unless something
 * else still shows it.
 */
class RewardMediaApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final byte[] BYTES = "....ftypisom a clip".getBytes(StandardCharsets.ISO_8859_1);

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private LocalObjectStore store;

    @Autowired
    private ScriptedImageTranscoder images;

    @Autowired
    private ScriptedVideoTranscoder videos;

    @Autowired
    private MediaProcessingJob imageProcessing;

    @Autowired
    private MediaVideoProcessingJob videoProcessing;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void clean() {
        store.clear();
        images.reset();
        videos.reset();
    }

    @AfterEach
    void clearCampaigns() {
        Campaigns.clear(dataSource);
    }

    @Test
    @DisplayName("a reward shows its picture and its clip, to its creator and to a backer")
    void aRewardShowsItsMedia() {
        String creator = signIn();
        UUID projectId = draft(creator);
        images.willProduce(1200, 800);
        UUID image = uploadImage(creator);
        videos.willProduce(720, 1280, 5_000);
        UUID video = uploadVideo(creator);

        Map<String, Object> body = tier("With a picture");
        body.put("imageMediaId", image.toString());
        body.put("videoMediaId", video.toString());
        ResponseEntity<Map<String, Object>> created = create(projectId, creator, body);

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertMedia(created.getBody(), image, video);

        // The list reads its media in one batch rather than per tier; it must say the same.
        List<Map<String, Object>> list = list(projectId, creator);
        assertThat(list).hasSize(1);
        assertMedia(list.get(0), image, video);

        Campaigns.launch(dataSource, projectId);
        ResponseEntity<Map<String, Object>> offered = rest.exchange(
                "/v1/projects/" + projectId + "/rewards/public",
                HttpMethod.GET,
                new HttpEntity<>(new HttpHeaders()),
                OBJECT);
        assertThat(offered.getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rewards = (List<Map<String, Object>>) offered.getBody().get("rewards");
        assertMedia(rewards.get(0), image, video);
    }

    @Test
    @DisplayName("a reward without media says so with two nulls")
    void aRewardWithoutMediaHasNulls() {
        String creator = signIn();
        Map<String, Object> created = create(draft(creator), creator, tier("Plain")).getBody();

        assertThat(created).containsEntry("image", null).containsEntry("video", null);
    }

    @Test
    @DisplayName("a clip of five seconds and the half-second slack is accepted")
    void theSlackIsAccepted() {
        String creator = signIn();
        UUID rewardId = idOf(create(draft(creator), creator, tier("Clip")).getBody());
        videos.willProduce(1280, 720, 5_500);
        UUID video = uploadVideo(creator);

        ResponseEntity<Map<String, Object>> saved = patch(rewardId, creator, Map.of("videoMediaId", video.toString()));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mapOf(saved.getBody(), "video")).containsEntry("durationMs", 5_500);
    }

    @Test
    @DisplayName("a clip over five seconds is refused with both lengths, and the tier is unchanged")
    void aLongClipIsRefused() {
        String creator = signIn();
        UUID projectId = draft(creator);
        videos.willProduce(1280, 720, 6_000);
        UUID video = uploadVideo(creator);

        Map<String, Object> body = tier("Too long");
        body.put("videoMediaId", video.toString());
        ResponseEntity<Map<String, Object>> refusedOnCreate = create(projectId, creator, body);
        assertThat(refusedOnCreate.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(list(projectId, creator)).isEmpty();

        UUID rewardId = idOf(create(projectId, creator, tier("Then attached")).getBody());
        ResponseEntity<Map<String, Object>> refused = patch(rewardId, creator, Map.of("videoMediaId", video.toString()));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat((String) refused.getBody().get("type")).endsWith("/reward-video-too-long");
        assertThat(refused.getBody()).containsEntry("code", "REWARD_VIDEO_TOO_LONG");
        assertThat(refused.getBody().get("meta"))
                .isEqualTo(Map.of("field", "videoMediaId", "durationMs", 6_000, "maxDurationMs", 5_000));
        assertThat(list(projectId, creator).get(0)).containsEntry("video", null);
    }

    @Test
    @DisplayName("somebody else's upload, and an upload in the wrong slot, are refused naming the field")
    void foreignAndMismatchedUploadsAreRefused() {
        String owner = signIn();
        String stranger = signIn();
        UUID rewardId = idOf(create(draft(stranger), stranger, tier("Mine")).getBody());
        UUID ownersImage = uploadImage(owner);
        videos.willProduce(1280, 720, 3_000);
        UUID ownersVideo = uploadVideo(owner);
        UUID strangersImage = uploadImage(stranger);

        ResponseEntity<Map<String, Object>> foreignImage =
                patch(rewardId, stranger, Map.of("imageMediaId", ownersImage.toString()));
        assertThat(foreignImage.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(foreignImage.getBody()).containsEntry("code", "REWARD_FIELD_INVALID");
        assertThat(foreignImage.getBody().get("meta")).isEqualTo(Map.of("field", "imageMediaId"));

        ResponseEntity<Map<String, Object>> foreignVideo =
                patch(rewardId, stranger, Map.of("videoMediaId", ownersVideo.toString()));
        assertThat(foreignVideo.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(foreignVideo.getBody().get("meta")).isEqualTo(Map.of("field", "videoMediaId"));

        ResponseEntity<Map<String, Object>> imageAsVideo =
                patch(rewardId, stranger, Map.of("videoMediaId", strangersImage.toString()));
        assertThat(imageAsVideo.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(imageAsVideo.getBody().get("meta")).isEqualTo(Map.of("field", "videoMediaId"));

        ResponseEntity<Map<String, Object>> unknown =
                patch(rewardId, stranger, Map.of("imageMediaId", UUID.randomUUID().toString()));
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("null removes the picture and the clip, and deletes their files")
    void nullClearsAndDeletes() {
        String creator = signIn();
        UUID image = uploadImage(creator);
        videos.willProduce(1280, 720, 4_000);
        UUID video = uploadVideo(creator);
        Map<String, Object> body = tier("Cleared");
        body.put("imageMediaId", image.toString());
        body.put("videoMediaId", video.toString());
        UUID rewardId = idOf(create(draft(creator), creator, body).getBody());

        // As a JSON string: the test client drops null entries from a map.
        ResponseEntity<Map<String, Object>> cleared =
                patch(rewardId, creator, "{\"imageMediaId\": null, \"videoMediaId\": null}");

        assertThat(cleared.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(cleared.getBody()).containsEntry("image", null).containsEntry("video", null);
        assertThat(store.has("media/" + image + ".jpg")).isFalse();
        assertThat(store.has("media/" + video + ".mp4")).isFalse();
        assertThat(store.has("media/" + video + "-poster.jpg")).isFalse();
    }

    @Test
    @DisplayName("replacing the picture deletes the old one, and on a live campaign keeps it until a moderator approves")
    void replacingDeletesTheOldOneUnlessLive() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID first = uploadImage(creator);
        Map<String, Object> body = tier("Replaced");
        body.put("imageMediaId", first.toString());
        UUID rewardId = idOf(create(projectId, creator, body).getBody());

        UUID second = uploadImage(creator);
        ResponseEntity<Map<String, Object>> saved = patch(rewardId, creator, Map.of("imageMediaId", second.toString()));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mapOf(saved.getBody(), "image")).containsEntry("mediaId", second.toString());
        assertThat(store.has("media/" + first + ".jpg")).isFalse();
        assertThat(store.has("media/" + second + ".jpg")).isTrue();

        // After launch the change waits in the campaign's revision (#559): the editor shows the
        // new picture, and the one the public sees is kept. RewardRevisionApiTests approves it.
        Campaigns.launch(dataSource, projectId);
        UUID third = uploadImage(creator);
        ResponseEntity<Map<String, Object>> held = patch(rewardId, creator, Map.of("imageMediaId", third.toString()));

        assertThat(held.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mapOf(held.getBody(), "image")).containsEntry("mediaId", third.toString());
        assertThat(store.has("media/" + second + ".jpg")).isTrue();
        assertThat(store.has("media/" + third + ".jpg")).isTrue();
    }

    @Test
    @DisplayName("an edit refused for another field keeps the picture it would have replaced")
    void aRefusedEditKeepsTheOldPicture() {
        String creator = signIn();
        UUID first = uploadImage(creator);
        Map<String, Object> body = tier("Secret");
        body.put("imageMediaId", first.toString());
        body.put("isSecret", true);
        UUID rewardId = idOf(create(draft(creator), creator, body).getBody());

        UUID second = uploadImage(creator);
        ResponseEntity<Map<String, Object>> refused =
                patch(rewardId, creator, Map.of("imageMediaId", second.toString(), "isFeatured", true));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "isFeatured"));
        assertThat(store.has("media/" + first + ".jpg")).isTrue();
    }

    @Test
    @DisplayName("an upload something else still shows survives a reward letting go of it")
    void aSharedUploadSurvives() {
        String creator = signIn();
        UUID projectId = draft(creator);
        videos.willProduce(1280, 720, 4_000);
        UUID video = uploadVideo(creator);
        UUID image = uploadImage(creator);

        Map<String, Object> body = tier("One");
        body.put("videoMediaId", video.toString());
        body.put("imageMediaId", image.toString());
        UUID one = idOf(create(projectId, creator, body).getBody());
        Map<String, Object> other = tier("Other");
        other.put("imageMediaId", image.toString());
        create(projectId, creator, other);
        // The same short clip is also the campaign's video.
        patchProject(projectId, creator, Map.of("videoMediaId", video.toString()));

        patch(one, creator, "{\"imageMediaId\": null, \"videoMediaId\": null}");
        assertThat(store.has("media/" + image + ".jpg")).isTrue();
        assertThat(store.has("media/" + video + ".mp4")).isTrue();

        // And the other way: a campaign dropping its video keeps the one a reward shows.
        patch(one, creator, Map.of("videoMediaId", video.toString()));
        patchProject(projectId, creator, "{\"videoMediaId\": null}");
        assertThat(store.has("media/" + video + ".mp4")).isTrue();
        assertThat(mapOf(list(projectId, creator).get(0), "video")).containsEntry("mediaId", video.toString());
    }

    @Test
    @DisplayName("a duplicate starts without the original's media, and the original keeps it")
    void aDuplicateHasNoMedia() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID image = uploadImage(creator);
        Map<String, Object> body = tier("Original");
        body.put("imageMediaId", image.toString());
        UUID original = idOf(create(projectId, creator, body).getBody());

        ResponseEntity<Map<String, Object>> copy = rest.exchange(
                "/v1/rewards/" + original + "/duplicate",
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(creator)),
                OBJECT);

        assertThat(copy.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(copy.getBody()).containsEntry("image", null).containsEntry("video", null);
        assertThat(mapOf(list(projectId, creator).get(0), "image")).containsEntry("mediaId", image.toString());
    }

    @Test
    @DisplayName("deleting a reward deletes the upload it showed")
    void deletingTheRewardDeletesItsMedia() {
        String creator = signIn();
        UUID image = uploadImage(creator);
        Map<String, Object> body = tier("Deleted");
        body.put("imageMediaId", image.toString());
        UUID rewardId = idOf(create(draft(creator), creator, body).getBody());

        ResponseEntity<Void> deleted = rest.exchange(
                "/v1/rewards/" + rewardId, HttpMethod.DELETE, new HttpEntity<>(null, bearer(creator)), Void.class);

        assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(store.has("media/" + image + ".jpg")).isFalse();
    }

    // ------------------------------------------------------------------

    private static void assertMedia(Map<String, Object> reward, UUID image, UUID video) {
        Map<String, Object> picture = mapOf(reward, "image");
        assertThat(picture)
                .containsEntry("mediaId", image.toString())
                .containsEntry("width", 1200)
                .containsEntry("height", 800)
                .containsKey("blurDataUrl");
        assertThat(picture.get("url")).asString().startsWith("https://cdn.test/media/");

        Map<String, Object> clip = mapOf(reward, "video");
        assertThat(clip)
                .containsEntry("mediaId", video.toString())
                .containsEntry("width", 720)
                .containsEntry("height", 1280)
                .containsEntry("durationMs", 5_000)
                .containsKey("blurDataUrl");
        assertThat(clip.get("url")).asString().endsWith(video + ".mp4");
        assertThat(clip.get("posterUrl")).asString().endsWith(video + "-poster.jpg");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapOf(Map<String, Object> body, String field) {
        return (Map<String, Object>) body.get(field);
    }

    private static Map<String, Object> tier(String title) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("price", Map.of("amount", "25.00", "currency", "AZN"));
        return body;
    }

    private static UUID idOf(Map<String, Object> resource) {
        return UUID.fromString((String) resource.get("id"));
    }

    private ResponseEntity<Map<String, Object>> create(UUID projectId, String accessToken, Object body) {
        return rest.exchange(
                "/v1/projects/" + projectId + "/rewards",
                HttpMethod.POST,
                new HttpEntity<>(body, bearer(accessToken)),
                OBJECT);
    }

    private ResponseEntity<Map<String, Object>> patch(UUID rewardId, String accessToken, Object body) {
        return rest.exchange(
                "/v1/rewards/" + rewardId, HttpMethod.PATCH, new HttpEntity<>(body, bearer(accessToken)), OBJECT);
    }

    private void patchProject(UUID projectId, String accessToken, Object body) {
        ResponseEntity<Map<String, Object>> saved = rest.exchange(
                "/v1/projects/" + projectId, HttpMethod.PATCH, new HttpEntity<>(body, bearer(accessToken)), OBJECT);
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private List<Map<String, Object>> list(UUID projectId, String accessToken) {
        return rest.exchange(
                        "/v1/projects/" + projectId + "/rewards",
                        HttpMethod.GET,
                        new HttpEntity<>(null, bearer(accessToken)),
                        new ParameterizedTypeReference<List<Map<String, Object>>>() {})
                .getBody();
    }

    private UUID uploadVideo(String accessToken) {
        UUID mediaId = begin(accessToken, "video/mp4");
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", accessToken);
        videoProcessing.run();
        return mediaId;
    }

    private UUID uploadImage(String accessToken) {
        UUID mediaId = begin(accessToken, "image/jpeg");
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", accessToken);
        imageProcessing.run();
        return mediaId;
    }

    private UUID begin(String accessToken, String contentType) {
        ResponseEntity<Map<String, Object>> issued = rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", contentType, "byteSize", BYTES.length), bearer(accessToken)),
                OBJECT);
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) issued.getBody().get("mediaId"));
    }

    private void post(String path, String accessToken) {
        rest.exchange(path, HttpMethod.POST, new HttpEntity<>(null, bearer(accessToken)), OBJECT);
    }

    private String signIn() {
        EmailAddress email = EmailAddress.of("reward-media-" + SEQUENCE.incrementAndGet() + "@example.com");
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

    private UUID draft(String accessToken) {
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("title", "A campaign with rewards"), bearer(accessToken)),
                OBJECT);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
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
