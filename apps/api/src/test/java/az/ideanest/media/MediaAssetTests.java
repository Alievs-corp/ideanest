package az.ideanest.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.media.domain.MediaAsset;
import az.ideanest.media.domain.MediaFailureReason;
import az.ideanest.media.domain.MediaKind;
import az.ideanest.media.domain.MediaStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;

/**
 * The upload state machine — the media pipeline design of 2026-08-30.
 *
 * <p>No Spring and no database. Every rule here is also a check constraint in V61, and the
 * constraint is the one that cannot be bypassed; this is the half that turns the same rule
 * into a refusal a caller can act on, three frames earlier.
 *
 * <p>CLAUDE.md §3 names state transitions and idempotency as the things that are not
 * optional to test, because they fail silently. Both are here.
 */
class MediaAssetTests {

    private static final UUID OWNER = UUID.fromString("11111111-1111-4111-8111-111111111111");

    private static final Instant NOW = Instant.parse("2026-08-30T12:00:00Z");

    private static final Instant LATER = NOW.plusSeconds(30);

    @Nested
    @DisplayName("a video (#331)")
    class Video {

        @Test
        @DisplayName("becomes ready with its duration and poster")
        void becomesReadyWithItsDurationAndPoster() {
            MediaAsset asset = processingVideo();

            asset.markVideoReady(
                    "media/v.mp4", "video/mp4", 9_000_000L, 1280, 720, 42_000, "media/v-poster.jpg",
                    "data:image/jpeg;base64,AAAA", LATER);

            assertThat(asset.getStatus()).isEqualTo(MediaStatus.READY);
            assertThat(asset.getKind()).isEqualTo(MediaKind.VIDEO);
            assertThat(asset.getDurationMs()).contains(42_000);
            assertThat(asset.getPosterStorageKey()).contains("media/v-poster.jpg");
        }

        @Test
        @DisplayName("cannot become ready as an image, nor an image as a video")
        void kindsDoNotCross() {
            MediaAsset video = processingVideo();
            assertThatThrownBy(() -> video.markReady(
                            "media/v.mp4", "video/mp4", 1L, 1280, 720, "data:image/jpeg;base64,AAAA", LATER))
                    .isInstanceOf(IllegalStateException.class);

            MediaAsset image = MediaAsset.awaitingUpload(OWNER, NOW);
            image.markUploaded(NOW);
            image.claimForProcessing(NOW);
            assertThatThrownBy(() -> image.markVideoReady(
                            "media/i.jpg", "image/jpeg", 1L, 1280, 720, 1, "media/p.jpg", "data:image/jpeg;base64,AAAA",
                            LATER))
                    .isInstanceOf(IllegalStateException.class);
        }

        @Test
        @DisplayName("a claim that has gone stale is taken over, and a fresh one is not")
        void staleClaimsAreTakenOver() {
            MediaAsset asset = processingVideo();

            assertThat(asset.claimForProcessing(NOW.plusSeconds(60), Duration.ofMinutes(10))).isFalse();
            assertThat(asset.claimForProcessing(NOW.plus(Duration.ofMinutes(11)), Duration.ofMinutes(10))).isTrue();
            assertThat(asset.getStatus()).isEqualTo(MediaStatus.PROCESSING);
        }

        @Test
        @DisplayName("the declared type decides the kind")
        void declaredTypeDecidesTheKind() {
            assertThat(MediaKind.ofDeclaredType("video/quicktime")).isEqualTo(MediaKind.VIDEO);
            assertThat(MediaKind.ofDeclaredType(" Video/MP4 ")).isEqualTo(MediaKind.VIDEO);
            assertThat(MediaKind.ofDeclaredType("image/heic")).isEqualTo(MediaKind.IMAGE);
            assertThat(MediaKind.ofDeclaredType(null)).isEqualTo(MediaKind.IMAGE);
        }

        private MediaAsset processingVideo() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, MediaKind.VIDEO, NOW);
            asset.markUploaded(NOW);
            asset.claimForProcessing(NOW);
            return asset;
        }
    }

    @Nested
    @DisplayName("the ordinary path")
    class HappyPath {

        @Test
        @DisplayName("a new upload is waiting for bytes and knows nothing else")
        void beginsPending() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);

            assertThat(asset.getStatus()).isEqualTo(MediaStatus.PENDING);
            assertThat(asset.getOwnerUserId()).isEqualTo(OWNER);
            assertThat(asset.getStorageKey()).isEmpty();
            assertThat(asset.getWidth()).isEmpty();
            assertThat(asset.getBlurDataUrl()).isEmpty();
            assertThat(asset.getFailureReason()).isEmpty();
        }

        @Test
        @DisplayName("pending, uploaded, processing, ready")
        void runsThroughToReady() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);

            assertThat(asset.markUploaded(NOW)).isTrue();
            assertThat(asset.getStatus()).isEqualTo(MediaStatus.UPLOADED);

            assertThat(asset.claimForProcessing(NOW)).isTrue();
            assertThat(asset.getStatus()).isEqualTo(MediaStatus.PROCESSING);

            asset.markReady("media/x.jpg", "image/jpeg", 1234L, 1440, 810, "data:image/jpeg;base64,AAA", LATER);

            assertThat(asset.getStatus()).isEqualTo(MediaStatus.READY);
            assertThat(asset.getStorageKey()).contains("media/x.jpg");
            assertThat(asset.getWidth()).contains(1440);
            assertThat(asset.getHeight()).contains(810);
            assertThat(asset.getByteSize()).contains(1234L);
            assertThat(asset.getUpdatedAt()).isEqualTo(LATER);
        }
    }

    @Nested
    @DisplayName("completion is idempotent, because a retry is the ordinary case")
    class Idempotency {

        /**
         * A browser whose connection drops between the upload finishing and the response
         * arriving will send this again. The second call must not enqueue a second pass over
         * an object the first pass may already have replaced.
         */
        @Test
        @DisplayName("the second call to markUploaded changes nothing and says so")
        void secondCompleteIsANoop() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);

            assertThat(asset.markUploaded(NOW)).isTrue();
            assertThat(asset.markUploaded(LATER)).isFalse();

            assertThat(asset.getStatus()).isEqualTo(MediaStatus.UPLOADED);
            // Not touched by the call that did nothing: the row is unchanged, and a
            // timestamp that moved would say otherwise to anything reading it.
            assertThat(asset.getUpdatedAt()).isEqualTo(NOW);
        }

        @Test
        @DisplayName("completing an upload that is already being processed does not send it back")
        void completeDoesNotRewind() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);
            asset.markUploaded(NOW);
            asset.claimForProcessing(NOW);

            assertThat(asset.markUploaded(LATER)).isFalse();
            assertThat(asset.getStatus()).isEqualTo(MediaStatus.PROCESSING);
        }
    }

    @Nested
    @DisplayName("two passes over an overlapping batch")
    class Claiming {

        /**
         * The sweep's query returns {@code PROCESSING} rows as well as {@code UPLOADED} ones,
         * so that a pass which died mid-item is picked up again. The cost of that choice is
         * that a row being worked on right now is also returned, and this is what resolves it.
         */
        @Test
        @DisplayName("only the first claim succeeds")
        void secondClaimLoses() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);
            asset.markUploaded(NOW);

            assertThat(asset.claimForProcessing(NOW)).isTrue();
            assertThat(asset.claimForProcessing(LATER)).isFalse();
        }

        @Test
        @DisplayName("an upload nobody has completed cannot be claimed")
        void pendingIsNotWork() {
            assertThat(MediaAsset.awaitingUpload(OWNER, NOW).claimForProcessing(NOW)).isFalse();
        }
    }

    @Nested
    @DisplayName("READY means servable, and the transitions into it are guarded")
    class Readiness {

        @Test
        @DisplayName("an upload cannot become ready without being claimed first")
        void readyOnlyFromProcessing() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);
            asset.markUploaded(NOW);

            assertThatThrownBy(() -> asset.markReady(
                            "media/x.jpg", "image/jpeg", 1L, 10, 10, "data:image/jpeg;base64,AAA", NOW))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("UPLOADED");
        }

        @Test
        @DisplayName("a ready row carries everything a renderer needs")
        void readyRequiresItsParts() {
            MediaAsset asset = processing();

            assertThatThrownBy(() ->
                            asset.markReady(null, "image/jpeg", 1L, 10, 10, "data:image/jpeg;base64,AAA", NOW))
                    .isInstanceOf(NullPointerException.class);
            assertThatThrownBy(() -> asset.markReady("media/x.jpg", "image/jpeg", 1L, 10, 10, null, NOW))
                    .isInstanceOf(NullPointerException.class);
        }
    }

    @Nested
    @DisplayName("failure")
    class Failing {

        @Test
        @DisplayName("a failure carries its reason and is terminal")
        void failureIsTerminal() {
            MediaAsset asset = processing();
            asset.markFailed(MediaFailureReason.UNSUPPORTED_FORMAT, LATER);

            assertThat(asset.getStatus()).isEqualTo(MediaStatus.FAILED);
            assertThat(asset.getFailureReason()).contains(MediaFailureReason.UNSUPPORTED_FORMAT);

            assertThatThrownBy(() -> asset.markFailed(MediaFailureReason.EMPTY, LATER))
                    .isInstanceOf(IllegalStateException.class);
        }

        /**
         * The size ceiling is found after the bytes arrive and before anything is claimed —
         * a presigned address does not make the client's declared size binding.
         */
        @Test
        @DisplayName("an upload can fail before it is claimed")
        void failsFromUploaded() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);
            asset.markUploaded(NOW);

            asset.markFailed(MediaFailureReason.TOO_LARGE, LATER);

            assertThat(asset.getStatus()).isEqualTo(MediaStatus.FAILED);
        }

        @Test
        @DisplayName("a ready image does not fail afterwards")
        void readyDoesNotFail() {
            MediaAsset asset = processing();
            asset.markReady("media/x.jpg", "image/jpeg", 1L, 10, 10, "data:image/jpeg;base64,AAA", NOW);

            assertThatThrownBy(() -> asset.markFailed(MediaFailureReason.UNREADABLE, LATER))
                    .isInstanceOf(IllegalStateException.class);
        }

        /**
         * A reason left behind on a row that recovered would keep telling the creator their
         * image is broken. V61 refuses the same combination.
         */
        @Test
        @DisplayName("becoming ready clears a reason that was recorded earlier")
        void readyClearsTheReason() {
            MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);
            asset.markUploaded(NOW);
            asset.claimForProcessing(NOW);
            asset.markReady("media/x.jpg", "image/jpeg", 1L, 10, 10, "data:image/jpeg;base64,AAA", NOW);

            assertThat(asset.getFailureReason()).isEmpty();
        }
    }

    @Test
    @DisplayName("the two terminal states are the ones nothing happens to on its own")
    void terminality() {
        assertThat(MediaStatus.READY.isTerminal()).isTrue();
        assertThat(MediaStatus.FAILED.isTerminal()).isTrue();
        assertThat(MediaStatus.PENDING.isTerminal()).isFalse();
        assertThat(MediaStatus.UPLOADED.isTerminal()).isFalse();
        assertThat(MediaStatus.PROCESSING.isTerminal()).isFalse();

        // What the sweep's query looks for, and PROCESSING is in it deliberately: a pass
        // that died mid-item would otherwise never be looked at again.
        assertThat(MediaStatus.UPLOADED.awaitsProcessing()).isTrue();
        assertThat(MediaStatus.PROCESSING.awaitsProcessing()).isTrue();
        assertThat(MediaStatus.PENDING.awaitsProcessing()).isFalse();
    }

    private static MediaAsset processing() {
        MediaAsset asset = MediaAsset.awaitingUpload(OWNER, NOW);
        asset.markUploaded(NOW);
        asset.claimForProcessing(NOW);
        return asset;
    }
}
