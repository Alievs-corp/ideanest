package az.ideanest.media.api;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.domain.MediaAsset;
import java.time.Instant;
import java.util.UUID;

/** What the media endpoints answer — the media pipeline design of 2026-08-30. */
public final class MediaResponses {

    private MediaResponses() {}

    /**
     * The address the browser uploads to.
     *
     * <p>{@code maxBytes} is repeated here even though the client sent the size it intends
     * to upload: the ceiling is this platform's and a client that had to guess it would
     * either refuse files this platform accepts or let somebody watch a twenty-megabyte
     * upload finish before being told it was too large.
     *
     * @param mediaId the identifier to complete, poll and eventually attach
     * @param uploadUrl a presigned {@code PUT}. A credential — anybody holding it may write
     *     this one object until it expires
     * @param contentType the {@code Content-Type} the address was signed for. <strong>Send
     *     this exact value on the {@code PUT}.</strong> The server rewrites anything that is
     *     not an image type, so a client that sent its own would have the store refuse the
     *     upload as a signature mismatch
     * @param expiresAt when it stops working
     * @param maxBytes the ceiling, so the form can refuse before uploading
     */
    public record Upload(UUID mediaId, String uploadUrl, String contentType, Instant expiresAt, long maxBytes) {

        static Upload of(MediaLibrary.MediaUpload upload) {
            return new Upload(
                    upload.mediaId(),
                    upload.uploadUrl().toString(),
                    upload.contentType(),
                    upload.expiresAt(),
                    upload.maxBytes());
        }
    }

    /**
     * One upload's state.
     *
     * <p>Everything after {@code status} is null until the image is ready, and
     * {@code failureReason} is null unless it failed. That is the shape the editor polls: a
     * client renders a spinner while there is neither, the image when there is a URL, and a
     * translated message when there is a reason.
     *
     * <p><strong>{@code failureReason} is a code and not a sentence.</strong> The words a
     * creator reads are in the message catalogue with every other string they read — a
     * message assembled here would be one that cannot be translated, on a form that exists
     * in four languages.
     *
     * @param kind {@code IMAGE} or {@code VIDEO}, decided by the type declared when the upload
     *     began — issue #331
     * @param width the measured width. This is the number the whole pipeline was built for:
     *     it used to be whatever the browser said, which {@code SubmissionChecklist} notes a
     *     client could make up
     * @param posterUrl a ready video's still. Null for an image
     * @param durationMs a ready video's length, measured on the transcoded file. Null for an
     *     image
     */
    public record Media(
            UUID id,
            String kind,
            String status,
            String url,
            Integer width,
            Integer height,
            String blurDataUrl,
            String posterUrl,
            Integer durationMs,
            String failureReason) {

        static Media of(MediaAsset asset, String url, String posterUrl) {
            return new Media(
                    asset.getId(),
                    asset.getKind().name(),
                    asset.getStatus().name(),
                    url,
                    asset.getWidth().orElse(null),
                    asset.getHeight().orElse(null),
                    asset.getBlurDataUrl().orElse(null),
                    posterUrl,
                    asset.getDurationMs().orElse(null),
                    asset.getFailureReason().map(Enum::name).orElse(null));
        }
    }
}
