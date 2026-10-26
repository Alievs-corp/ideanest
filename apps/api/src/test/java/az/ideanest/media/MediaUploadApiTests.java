package az.ideanest.media;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaProcessingJob;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedImageTranscoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
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
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Uploading an image and putting it on a campaign — the media pipeline design of 2026-08-30.
 *
 * <h2>What this covers that the unit tests cannot</h2>
 *
 * <p>{@code MediaAssetTests} owns the state machine and {@code VipsImageTranscoderTests} owns
 * what comes out of a conversion. What is left is everything they are embedded in: that the
 * sweep replaces the raw object and then removes it, that a campaign refuses an upload
 * belonging to somebody else, and — the point of the whole exercise — that the dimensions
 * recorded on a cover are the ones the <em>server</em> measured.
 *
 * <h2>Two doubles, and why each is one</h2>
 *
 * <p>The store is a directory ({@code LocalObjectStore}) because an unconfigured deployment
 * gets a store that refuses everything, which is right in production and would make this file
 * impossible to write. The transcoder is scripted because the conversion is asserted against
 * a real libvips elsewhere, and requiring a native dependency for the suite to start would
 * make it a suite that does not run.
 */
class MediaUploadApiTests extends AbstractIntegrationTest {

    /**
     * Distinct addresses, and a prefix of this file's own.
     *
     * <p>Not {@code creator-N@example.com}: two suites taking the same handle sign in as each
     * other's account, and the victim fails several frames away from anything that names the
     * collision.
     */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    /** A JPEG signature and some filler. The scripted transcoder copies rather than reads. */
    private static final byte[] BYTES = "ÿØÿa photograph".getBytes(StandardCharsets.ISO_8859_1);

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private LocalObjectStore store;

    @Autowired
    private ScriptedImageTranscoder transcoder;

    @Autowired
    private MediaProcessingJob processing;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void clean() {
        store.clear();
        transcoder.reset();
    }

    // ------------------------------------------------------------------
    // The whole path
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an upload becomes a cover whose dimensions the server measured")
    void uploadBecomesACover() {
        String creator = signIn();
        UUID projectId = draft(creator);

        UUID mediaId = upload(creator, 1600, 900);

        Map<String, Object> ready = get("/v1/media/" + mediaId, creator).getBody();
        assertThat(ready).containsEntry("status", "READY");
        assertThat(ready.get("url")).asString().startsWith("https://cdn.test/media/");
        assertThat(ready).containsEntry("width", 1600).containsEntry("height", 900);
        assertThat(ready.get("blurDataUrl")).asString().startsWith("data:image/");

        // The raw upload is gone and the derived object is there. In that order: the other
        // one loses the creator's file if the process dies between the two.
        assertThat(store.has(MediaLibrary.rawKeyOf(mediaId))).isFalse();

        Map<String, Object> saved = patch(projectId, creator, Map.of("coverImage", Map.of("mediaId", mediaId.toString())))
                .getBody();

        @SuppressWarnings("unchecked")
        Map<String, Object> cover = (Map<String, Object>) saved.get("coverImage");

        // THE POINT OF THE WHOLE PIPELINE. The client sent an identifier and nothing else;
        // these three came off the file. Before this, they were whatever the browser said.
        assertThat(cover).containsEntry("mediaId", mediaId.toString());
        assertThat(cover).containsEntry("width", 1600).containsEntry("height", 900);
        assertThat(cover.get("url")).asString().startsWith("https://cdn.test/media/");
    }

    /**
     * The case the checklist change was made for: a photograph that used to be refused.
     *
     * <p>It is stored, it is attached, and the campaign is submittable with it — the size
     * rule is advice now. See {@code ChecklistRequirement.COVER_IMAGE_SIZE}.
     */
    @Test
    @DisplayName("a cover below the recommended size is accepted")
    void smallCoversAreAccepted() {
        String creator = signIn();
        UUID projectId = draft(creator);

        UUID mediaId = upload(creator, 800, 600);

        ResponseEntity<Map<String, Object>> saved =
                patch(projectId, creator, Map.of("coverImage", Map.of("mediaId", mediaId.toString())));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // Whose upload it is
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an upload belonging to somebody else cannot be put on a campaign")
    void anotherAccountsUploadIsRefused() {
        String owner = signIn();
        String stranger = signIn();
        UUID projectId = draft(stranger);

        UUID mediaId = upload(owner, 1600, 900);

        ResponseEntity<Map<String, Object>> refused =
                patch(projectId, stranger, Map.of("coverImage", Map.of("mediaId", mediaId.toString())));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_FIELD_INVALID");
        // Named, so a client points at the control rather than showing a banner. Nested
        // under `meta`, which is where this service's problem details carry their extras.
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "coverImage"));
    }

    @Test
    @DisplayName("reading somebody else's upload answers 404 rather than 403")
    void anotherAccountsUploadIsNotEvenVisible() {
        String owner = signIn();
        String stranger = signIn();

        UUID mediaId = upload(owner, 1600, 900);

        // Not 403: whether an identifier exists is a fact about somebody else's unfinished
        // campaign, so the two answers have to be the same one.
        assertThat(get("/v1/media/" + mediaId, stranger).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("an upload that has not finished processing cannot be attached")
    void unprocessedUploadIsRefused() {
        String creator = signIn();
        UUID projectId = draft(creator);

        // Begun and completed, and the sweep deliberately not run.
        UUID mediaId = begin(creator);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", creator);

        ResponseEntity<Map<String, Object>> refused =
                patch(projectId, creator, Map.of("coverImage", Map.of("mediaId", mediaId.toString())));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // ------------------------------------------------------------------
    // Completion, and the retry that is the ordinary case
    // ------------------------------------------------------------------

    @Test
    @DisplayName("completing twice does not process twice")
    void completeIsIdempotent() {
        String creator = signIn();

        UUID mediaId = begin(creator);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);

        assertThat(post("/v1/media/" + mediaId + "/complete", creator).getStatusCode()).isEqualTo(HttpStatus.OK);
        // A browser that lost the first response sends this again. It must not queue a
        // second pass over an object the first pass may already have replaced.
        ResponseEntity<Map<String, Object>> replay = post("/v1/media/" + mediaId + "/complete", creator);

        assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replay.getBody()).containsEntry("status", "UPLOADED");

        processing.run();
        assertThat(get("/v1/media/" + mediaId, creator).getBody()).containsEntry("status", "READY");
    }

    // ------------------------------------------------------------------
    // Refusals
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a file the transcoder cannot read is recorded as failed, with the reason")
    void anUnreadableFileFails() {
        String creator = signIn();
        transcoder.willRefuse(MediaFailureReason.UNSUPPORTED_FORMAT);

        UUID mediaId = begin(creator);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", creator);
        processing.run();

        Map<String, Object> failed = get("/v1/media/" + mediaId, creator).getBody();
        assertThat(failed).containsEntry("status", "FAILED");
        // A code and not a sentence: the words a creator reads live where every other string
        // they read lives, and this form exists in four languages.
        assertThat(failed).containsEntry("failureReason", "UNSUPPORTED_FORMAT");
    }

    @Test
    @DisplayName("an upload nothing was written to is refused as empty rather than failing the pass")
    void anUploadThatNeverArrivedIsEmpty() {
        String creator = signIn();

        UUID mediaId = begin(creator);
        // No `store.put`: the client called complete without ever performing the PUT.
        post("/v1/media/" + mediaId + "/complete", creator);
        processing.run();

        assertThat(get("/v1/media/" + mediaId, creator).getBody())
                .containsEntry("status", "FAILED")
                .containsEntry("failureReason", "EMPTY");
    }

    @Test
    @DisplayName("every address is signed as a byte stream and for the declared length, whatever was declared")
    void anAddressIsSignedAsBytesOfTheDeclaredLength() {
        String creator = signIn();

        ResponseEntity<Map<String, Object>> issued = rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", "image/svg+xml", "byteSize", 1234), bearer(creator)),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        // #587: the raw object sits under the public base URL until the sweep replaces it, and
        // stored as image/svg+xml it was a document a browser runs scripts in. As a byte stream
        // it is a download. The length is signed so the store refuses any other size.
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(issued.getBody()).containsEntry("contentType", "application/octet-stream");
        assertThat((String) issued.getBody().get("uploadUrl"))
                .contains("type=application/octet-stream")
                .contains("length=1234");
    }

    @Test
    @DisplayName("an account holding ten live, unannounced addresses is refused an eleventh")
    void outstandingAddressesAreBounded() {
        String creator = signIn();
        for (int issued = 0; issued < 10; issued++) {
            begin(creator);
        }

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", "image/jpeg", "byteSize", BYTES.length), bearer(creator)),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        // #587: each address is a live write credential to the bucket and a row until the
        // sweep, and nothing bounded how many one account could hold.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(refused.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isNotBlank();
    }

    @Test
    @DisplayName("an upload written and never announced is removed with its object")
    void anAbandonedUploadTakesItsObjectWithIt() {
        String creator = signIn();
        UUID mediaId = begin(creator);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        new JdbcTemplate(dataSource)
                .update("UPDATE media SET created_at = now() - interval '7 days' WHERE id = ?", mediaId);

        processing.run();

        // #587: the sweep assumed nothing was ever written to an abandoned address, so bytes
        // uploaded without the completing call stayed in the bucket for good.
        assertThat(get("/v1/media/" + mediaId, creator).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(store.has(MediaLibrary.rawKeyOf(mediaId))).isFalse();
    }

    @Test
    @DisplayName("a file over the ceiling is refused before an address is issued")
    void anOversizedFileIsRefusedUpFront() {
        String creator = signIn();

        ResponseEntity<Map<String, Object>> refused = rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", "image/jpeg", "byteSize", 40L * 1024 * 1024), bearer(creator)),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "TOO_LARGE");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** Begins, uploads, completes and sweeps. What a browser does, in one call. */
    private UUID upload(String accessToken, int width, int height) {
        transcoder.willProduce(width, height);
        UUID mediaId = begin(accessToken);
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", accessToken);
        processing.run();
        return mediaId;
    }

    private UUID begin(String accessToken) {
        ResponseEntity<Map<String, Object>> issued = rest.exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("contentType", "image/jpeg", "byteSize", BYTES.length), bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        // The type the address was signed for comes back, because a client that reproduced
        // it would have every upload refused by the store as a signature mismatch.
        assertThat(issued.getBody()).containsEntry("contentType", "application/octet-stream");
        return UUID.fromString((String) issued.getBody().get("mediaId"));
    }

    private String signIn() {
        EmailAddress email = EmailAddress.of("media-upload-" + SEQUENCE.incrementAndGet() + "@example.com");
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
                new HttpEntity<>(Map.of("title", "A campaign with a cover"), bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private ResponseEntity<Map<String, Object>> patch(UUID projectId, String accessToken, Map<String, Object> body) {
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
