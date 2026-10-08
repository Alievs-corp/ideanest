package az.ideanest.media;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaProcessingJob;
import az.ideanest.media.application.MediaProcessingWrites;
import az.ideanest.media.application.MediaVideoProcessingJob;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.project.application.PublicProjectPage;
import az.ideanest.project.infrastructure.PublicProjectPages;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedImageTranscoder;
import az.ideanest.support.ScriptedVideoTranscoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
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
 * A campaign video, from the upload to the page — issue #331.
 *
 * <p>{@code MediaUploadApiTests}' arrangement and doubles: the store is a directory and both
 * transcoders are scripted, the real ffmpeg being asserted in {@code FfmpegVideoTranscoderTests}.
 * What is covered here is what the sweep and the campaign do with the answer — that the raw
 * upload goes, that the two slots refuse each other's uploads, and that a replaced video is
 * deleted rather than left in the bucket.
 */
class CampaignVideoApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final byte[] BYTES = "....ftypisom a video".getBytes(StandardCharsets.ISO_8859_1);

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
    private PublicProjectPages pages;

    @Autowired
    private MediaProcessingWrites writes;

    @BeforeEach
    void clean() {
        store.clear();
        images.reset();
        videos.reset();
    }

    @Test
    @DisplayName("a video becomes the campaign's, with what the server measured")
    void uploadBecomesTheCampaignsVideo() {
        String creator = signIn();
        UUID projectId = draft(creator);

        videos.willProduce(720, 1280, 58_400);
        UUID mediaId = uploadVideo(creator);

        Map<String, Object> ready = get("/v1/media/" + mediaId, creator).getBody();
        assertThat(ready)
                .containsEntry("kind", "VIDEO")
                .containsEntry("status", "READY")
                .containsEntry("width", 720)
                .containsEntry("height", 1280)
                .containsEntry("durationMs", 58_400);
        assertThat(ready.get("url")).asString().endsWith(mediaId + ".mp4");
        assertThat(ready.get("posterUrl")).asString().endsWith(mediaId + "-poster.jpg");

        // The raw upload is gone once both derived objects are written.
        assertThat(store.has(MediaLibrary.rawKeyOf(mediaId))).isFalse();
        assertThat(store.has("media/" + mediaId + ".mp4")).isTrue();
        assertThat(store.has("media/" + mediaId + "-poster.jpg")).isTrue();

        Map<String, Object> saved = patch(projectId, creator, Map.of("videoMediaId", mediaId.toString())).getBody();

        @SuppressWarnings("unchecked")
        Map<String, Object> video = (Map<String, Object>) saved.get("video");
        assertThat(video)
                .containsEntry("mediaId", mediaId.toString())
                .containsEntry("width", 720)
                .containsEntry("height", 1280)
                .containsEntry("durationMs", 58_400);
        assertThat(video.get("url")).asString().startsWith("https://cdn.test/media/");
        assertThat(video.get("posterUrl")).asString().startsWith("https://cdn.test/media/");

        PublicProjectPage page = pages.find(projectId, "az").orElseThrow();
        assertThat(page.video()).isNotNull();
        assertThat(page.video().mediaId()).isEqualTo(mediaId);
        assertThat(page.video().durationMs()).isEqualTo(58_400);
    }

    @Test
    @DisplayName("removing the video clears it and deletes its files")
    void removingTheVideoDeletesIt() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID mediaId = uploadVideo(creator);
        patch(projectId, creator, Map.of("videoMediaId", mediaId.toString()));

        // As a JSON string: the test client drops null entries from a map, and a null is
        // the whole of this request.
        ResponseEntity<Map<String, Object>> cleared = patch(projectId, creator, "{\"videoMediaId\": null}");

        assertThat(cleared.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(cleared.getBody().get("video")).isNull();
        assertThat(store.has("media/" + mediaId + ".mp4")).isFalse();
        assertThat(store.has("media/" + mediaId + "-poster.jpg")).isFalse();
        assertThat(get("/v1/media/" + mediaId, creator).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("replacing the video deletes the one it replaced and keeps the new one")
    void replacingTheVideoDeletesTheOldOne() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID first = uploadVideo(creator);
        patch(projectId, creator, Map.of("videoMediaId", first.toString()));

        UUID second = uploadVideo(creator);
        Map<String, Object> saved = patch(projectId, creator, Map.of("videoMediaId", second.toString())).getBody();

        @SuppressWarnings("unchecked")
        Map<String, Object> video = (Map<String, Object>) saved.get("video");
        assertThat(video).containsEntry("mediaId", second.toString());
        assertThat(store.has("media/" + first + ".mp4")).isFalse();
        assertThat(store.has("media/" + second + ".mp4")).isTrue();
    }

    @Test
    @DisplayName("a video another campaign still shows is not deleted when one campaign drops it")
    void aSharedVideoSurvives() {
        String creator = signIn();
        UUID one = draft(creator);
        UUID other = draft(creator);
        UUID mediaId = uploadVideo(creator);
        patch(one, creator, Map.of("videoMediaId", mediaId.toString()));
        patch(other, creator, Map.of("videoMediaId", mediaId.toString()));

        patch(one, creator, "{\"videoMediaId\": null}");

        assertThat(store.has("media/" + mediaId + ".mp4")).isTrue();
        assertThat(get("/v1/media/" + mediaId, creator).getBody()).containsEntry("status", "READY");
    }

    @Test
    @DisplayName("the two slots refuse each other's uploads")
    void slotsRefuseEachOthersUploads() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID video = uploadVideo(creator);
        UUID image = uploadImage(creator);

        ResponseEntity<Map<String, Object>> videoAsCover =
                patch(projectId, creator, Map.of("coverImage", Map.of("mediaId", video.toString())));
        assertThat(videoAsCover.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(videoAsCover.getBody().get("meta")).isEqualTo(Map.of("field", "coverImage"));

        ResponseEntity<Map<String, Object>> imageAsVideo =
                patch(projectId, creator, Map.of("videoMediaId", image.toString()));
        assertThat(imageAsVideo.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(imageAsVideo.getBody().get("meta")).isEqualTo(Map.of("field", "videoMediaId"));
    }

    @Test
    @DisplayName("somebody else's video cannot be put on a campaign")
    void anotherAccountsVideoIsRefused() {
        String owner = signIn();
        String stranger = signIn();
        UUID projectId = draft(stranger);
        UUID mediaId = uploadVideo(owner);

        ResponseEntity<Map<String, Object>> refused =
                patch(projectId, stranger, Map.of("videoMediaId", mediaId.toString()));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_FIELD_INVALID");
    }

    @Test
    @DisplayName("a clip over a minute is refused with its reason, and its upload deleted")
    void aLongClipIsRefused() {
        String creator = signIn();
        videos.willRefuse(MediaFailureReason.TOO_LONG);

        UUID mediaId = uploadVideo(creator);

        assertThat(get("/v1/media/" + mediaId, creator).getBody())
                .containsEntry("status", "FAILED")
                .containsEntry("failureReason", "TOO_LONG");
        assertThat(store.has(MediaLibrary.rawKeyOf(mediaId))).isFalse();
    }

    @Test
    @DisplayName("the image sweep leaves videos alone, and the video sweep images")
    void sweepsDoNotCross() {
        String creator = signIn();

        UUID video = begin(creator, "video/mp4", BYTES.length);
        store.put(MediaLibrary.rawKeyOf(video), BYTES);
        post("/v1/media/" + video + "/complete", creator);

        imageProcessing.run();
        assertThat(get("/v1/media/" + video, creator).getBody()).containsEntry("status", "UPLOADED");

        UUID image = begin(creator, "image/jpeg", BYTES.length);
        store.put(MediaLibrary.rawKeyOf(image), BYTES);
        post("/v1/media/" + image + "/complete", creator);

        videoProcessing.run();
        assertThat(get("/v1/media/" + video, creator).getBody()).containsEntry("status", "READY");
        assertThat(get("/v1/media/" + image, creator).getBody()).containsEntry("status", "UPLOADED");
        assertThat(videos.calls()).isEqualTo(1);
    }

    @Test
    @DisplayName("a clip still claimed by another pass does not hold up the clip behind it")
    void aClaimedClipDoesNotBlockTheQueue() {
        String creator = signIn();

        UUID stuck = begin(creator, "video/mp4", BYTES.length);
        store.put(MediaLibrary.rawKeyOf(stuck), BYTES);
        post("/v1/media/" + stuck + "/complete", creator);
        // As a pass that died mid-transcode leaves it: claimed, and nothing more.
        assertThat(writes.claimVideo(stuck, Duration.ofHours(1))).isTrue();

        UUID next = uploadVideo(creator);

        assertThat(get("/v1/media/" + next, creator).getBody()).containsEntry("status", "READY");
        assertThat(get("/v1/media/" + stuck, creator).getBody()).containsEntry("status", "PROCESSING");
    }

    @Test
    @DisplayName("an object over the ceiling is refused from its size, without being transcoded")
    void anOversizedObjectIsRefusedFromItsSize() {
        String creator = signIn();

        UUID mediaId = begin(creator, "video/mp4", BYTES.length);
        // The address does not bind the declared size; this is what arrives instead.
        store.put(MediaLibrary.rawKeyOf(mediaId), new byte[0]);
        store.putSized(MediaLibrary.rawKeyOf(mediaId), 250L * 1024 * 1024 + 1);
        post("/v1/media/" + mediaId + "/complete", creator);
        videoProcessing.run();

        assertThat(get("/v1/media/" + mediaId, creator).getBody())
                .containsEntry("status", "FAILED")
                .containsEntry("failureReason", "TOO_LARGE");
        assertThat(store.has(MediaLibrary.rawKeyOf(mediaId))).isFalse();
        assertThat(videos.calls()).isZero();
    }

    @Test
    @DisplayName("a video has its own ceiling, larger than an image's and still bounded")
    void videosHaveTheirOwnCeiling() {
        String creator = signIn();

        ResponseEntity<Map<String, Object>> accepted = beginRaw(creator, "video/mp4", 120L * 1024 * 1024);
        assertThat(accepted.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(accepted.getBody()).containsEntry("contentType", "video/mp4");
        assertThat(((Number) accepted.getBody().get("maxBytes")).longValue()).isEqualTo(250L * 1024 * 1024);

        ResponseEntity<Map<String, Object>> refused = beginRaw(creator, "video/mp4", 300L * 1024 * 1024);
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "TOO_LARGE");
    }

    @Test
    @DisplayName("a host that cannot transcode refuses a video before anything is uploaded")
    void noTranscoderMeansNoVideoUpload() {
        String creator = signIn();
        videos.unavailable();

        ResponseEntity<Map<String, Object>> refused = beginRaw(creator, "video/mp4", 1024);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    // ------------------------------------------------------------------

    private UUID uploadVideo(String accessToken) {
        UUID mediaId = begin(accessToken, "video/mp4", BYTES.length);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", accessToken);
        videoProcessing.run();
        return mediaId;
    }

    private UUID uploadImage(String accessToken) {
        UUID mediaId = begin(accessToken, "image/jpeg", BYTES.length);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", accessToken);
        imageProcessing.run();
        return mediaId;
    }

    private UUID begin(String accessToken, String contentType, long byteSize) {
        ResponseEntity<Map<String, Object>> issued = beginRaw(accessToken, contentType, byteSize);
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) issued.getBody().get("mediaId"));
    }

    private ResponseEntity<Map<String, Object>> beginRaw(String accessToken, String contentType, long byteSize) {
        return rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", contentType, "byteSize", byteSize), bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private String signIn() {
        EmailAddress email = EmailAddress.of("campaign-video-" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        return (String) signedIn.getBody().get("accessToken");
    }

    private UUID draft(String accessToken) {
        ResponseEntity<Map<String, Object>> created = rest.exchange(
                "/v1/projects",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("title", "A campaign with a video"), bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private ResponseEntity<Map<String, Object>> patch(UUID projectId, String accessToken, Object body) {
        return rest.exchange(
                "/v1/projects/" + projectId,
                HttpMethod.PATCH,
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(null, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(null, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
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
