package az.ideanest.media.api;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaKind;
import az.ideanest.media.domain.MediaStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Uploading an image — the media pipeline design of 2026-08-30.
 *
 * <h2>Three calls, and none of them carries the file</h2>
 *
 * <p>Ask for an address, upload to it, say the upload finished. The bytes go from the
 * browser to the object store and never through this service, which is what makes a
 * twenty-megabyte cover cost this process nothing — a multipart endpoint would put that body
 * in a request thread, and there is no {@code spring.servlet.multipart} configuration in this
 * repository to size it with.
 *
 * <h2>Whose upload is never in the request</h2>
 *
 * <p>The access token's subject is the whole of the authorisation, exactly as on
 * {@code VerificationController}. There is no owner in the body and none in the path: an
 * identifier there would be the only field that mattered, and reading somebody else's upload
 * address is the entire attack.
 *
 * <h2>{@code no-store} on all three</h2>
 *
 * <p>The first answer contains a credential. The other two say what somebody's unfinished
 * campaign has in it. Neither is a document a shared cache should hold.
 */
@RestController
@RequestMapping("/v1/media")
@Validated
public class MediaController {

    private final MediaLibrary media;

    public MediaController(MediaLibrary media) {
        this.media = media;
    }

    /**
     * Issues an address for one file.
     *
     * <p>201, because a row now exists that did not before. A client that never uploads to
     * the address leaves it {@code PENDING}, and the sweep removes it — see
     * {@code MediaProcessingJob}.
     */
    @PostMapping("/uploads")
    public ResponseEntity<MediaResponses.Upload> begin(
            @AuthenticationPrincipal Jwt accessToken, @RequestBody BeginUploadBody body) {

        MediaLibrary.MediaUpload upload = media.begin(callerOf(accessToken), body.contentType(), body.byteSize());

        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(MediaResponses.Upload.of(upload));
    }

    /**
     * Says the bytes are there.
     *
     * <p>200 rather than 202 even though the work has not happened yet, and that is not a
     * detail: the response carries the current state, a client polls the read below, and a
     * 202 with an empty body would make the ordinary retry — a browser resending after a
     * dropped response — indistinguishable from the first call.
     */
    @PostMapping("/{mediaId}/complete")
    public ResponseEntity<MediaResponses.Media> complete(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID mediaId) {

        MediaAsset asset = media.complete(callerOf(accessToken), mediaId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(present(asset));
    }

    /** One upload's state, which the editor polls until it is ready or has failed. */
    @GetMapping("/{mediaId}")
    public ResponseEntity<MediaResponses.Media> status(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID mediaId) {

        MediaAsset asset = media.statusOf(callerOf(accessToken), mediaId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(present(asset));
    }

    /**
     * The URL is attached only for a row that is ready.
     *
     * <p>Asked of {@code MediaLibrary} rather than assembled here, because building a public
     * address means knowing where the bucket is served from — which is configuration this
     * layer has no business reading.
     */
    private MediaResponses.Media present(MediaAsset asset) {
        if (asset.getStatus() != MediaStatus.READY) {
            return MediaResponses.Media.of(asset, null, null);
        }
        if (asset.getKind() == MediaKind.VIDEO) {
            return media.videoViewOf(asset.getId())
                    .map(view -> MediaResponses.Media.of(asset, view.url(), view.posterUrl()))
                    .orElseGet(() -> MediaResponses.Media.of(asset, null, null));
        }
        String url = media.viewOf(asset.getId()).map(MediaLibrary.MediaView::url).orElse(null);
        return MediaResponses.Media.of(asset, url, null);
    }

    /** Whoever is signed in. The whole of the authorisation on all three endpoints. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }

    /**
     * What the client says it is about to upload.
     *
     * <p>Both fields are the client's word and are treated as such. The type is signed into
     * the address so a leaked URL cannot be used for something else; the size is checked
     * here so an obviously oversized request is refused before an address is issued. Neither
     * is believed: the bytes are measured when they arrive, because a presigned address does
     * not make a declaration binding.
     *
     * @param contentType what the file picker reported, e.g. {@code image/jpeg}. A
     *     {@code video/*} type begins a campaign video (issue #331), with its own ceiling
     * @param byteSize how large the file is, from the browser's own {@code File}
     */
    public record BeginUploadBody(@NotBlank String contentType, @Positive long byteSize) {}
}
