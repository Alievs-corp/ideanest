package az.ideanest.media.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * One uploaded image, and where it has got to — the media pipeline design of 2026-08-30.
 *
 * <h2>The state machine is here, not in the service</h2>
 *
 * <p>Every transition is a method on this class and every one of them refuses to be called
 * out of order. The alternative — a setter for {@code status} and a service that calls them
 * in the right sequence — puts the rule in the caller, and there are three callers: the
 * upload endpoint, the completion endpoint, and the sweep. The third of those runs on a
 * lease after a restart, which is exactly the situation in which "the right sequence" stops
 * being obvious.
 *
 * <p>V61 holds the same promises as check constraints. That is deliberate duplication:
 * this class is one writer and a backfill is another, and a constraint is the one that
 * cannot be bypassed.
 *
 * <h2>What is not on this entity</h2>
 *
 * <p>No bytes, and no key for the raw upload. The raw object exists between the browser
 * writing it and the sweep replacing it, and its key is derived from the identifier rather
 * than stored — a column that is read inside one method and is wrong for the rest of the
 * row's life is a column that will eventually be read by something else.
 *
 * <p>No campaign either. A media row is created before anybody has said where the image
 * will be used, because the upload has to start before the creator has finished the form.
 * Attachment points the other way: {@code projects.cover_media_id} refers here.
 */
@Entity
@Table(name = "media")
public class MediaAsset {

    /** The floor below which nothing is worth displaying. See {@link MediaFailureReason#TOO_SMALL}. */
    public static final int MINIMUM_EDGE = 320;

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private MediaStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, updatable = false)
    private MediaKind kind;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @Column(name = "poster_storage_key")
    private String posterStorageKey;

    @Column(name = "storage_key")
    private String storageKey;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "byte_size")
    private Long byteSize;

    @Column(name = "width")
    private Integer width;

    @Column(name = "height")
    private Integer height;

    @Column(name = "blur_data_url")
    private String blurDataUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason")
    private MediaFailureReason failureReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected MediaAsset() {
        // JPA.
    }

    private MediaAsset(UUID ownerUserId, MediaKind kind, Instant now) {
        this.id = Identifiers.newIdentifier();
        this.ownerUserId = Objects.requireNonNull(ownerUserId, "An upload belongs to whoever made it");
        this.kind = Objects.requireNonNull(kind, "An upload is an image or a video");
        this.status = MediaStatus.PENDING;
        this.createdAt = now.truncatedTo(ChronoUnit.MICROS);
        this.updatedAt = this.createdAt;
    }

    /** A row for an upload that is about to start. */
    public static MediaAsset awaitingUpload(UUID ownerUserId, Instant now) {
        return new MediaAsset(ownerUserId, MediaKind.IMAGE, now);
    }

    /** The same, for an upload whose kind the declared type decided. */
    public static MediaAsset awaitingUpload(UUID ownerUserId, MediaKind kind, Instant now) {
        return new MediaAsset(ownerUserId, kind, now);
    }

    /**
     * The client says the bytes are there.
     *
     * <p><strong>Idempotent, and that is the point of the return value.</strong> A browser
     * that retries after a dropped response is the ordinary case, not an edge one, and a
     * second call must not enqueue a second pass over an object the first pass may already
     * have replaced. Answers whether this call was the one that moved the row.
     */
    public boolean markUploaded(Instant now) {
        if (status != MediaStatus.PENDING) {
            return false;
        }
        this.status = MediaStatus.UPLOADED;
        touch(now);
        return true;
    }

    /**
     * Claimed by a pass of the sweep.
     *
     * <p>Answers false when somebody else already holds it, which is how two passes over an
     * overlapping batch resolve — the claim is a conditional update, and the loser skips.
     */
    public boolean claimForProcessing(Instant now) {
        if (status != MediaStatus.UPLOADED) {
            return false;
        }
        this.status = MediaStatus.PROCESSING;
        touch(now);
        return true;
    }

    /**
     * {@link #claimForProcessing(Instant)}, or a row whose previous claim has gone stale.
     *
     * <p>A claim older than {@code staleAfter} belongs to a pass that is no longer running —
     * the process was restarted under it — and is taken over rather than left processing
     * for ever. {@code staleAfter} must be longer than the work can take, or a slow pass
     * and its successor do the same work twice.
     */
    public boolean claimForProcessing(Instant now, Duration staleAfter) {
        if (status == MediaStatus.PROCESSING && updatedAt.isBefore(now.minus(staleAfter))) {
            touch(now);
            return true;
        }
        return claimForProcessing(now);
    }

    /**
     * Processing finished and the derived object is written.
     *
     * <p>Everything a renderer needs arrives in one call, because the row must never be
     * observable in a state where it claims to be servable and is not — which V61's
     * {@code media_ready_is_servable} would refuse anyway, three frames further down.
     */
    public void markReady(
            String storageKey, String contentType, long byteSize, int width, int height, String blurDataUrl, Instant now) {

        if (kind != MediaKind.IMAGE) {
            throw new IllegalStateException("A video becomes ready with its duration and poster");
        }
        becomeReady(storageKey, contentType, byteSize, width, height, blurDataUrl, now);
    }

    /**
     * A video finished transcoding — issue #331.
     *
     * <p>The image transition plus the two facts only a video has. V94's
     * {@code media_video_ready_is_playable} refuses a ready video without either.
     */
    public void markVideoReady(
            String storageKey,
            String contentType,
            long byteSize,
            int width,
            int height,
            int durationMs,
            String posterStorageKey,
            String blurDataUrl,
            Instant now) {

        if (kind != MediaKind.VIDEO) {
            throw new IllegalStateException("An image has no duration or poster");
        }
        if (durationMs <= 0) {
            throw new IllegalArgumentException("A ready video lasts some time");
        }
        this.durationMs = durationMs;
        this.posterStorageKey = Objects.requireNonNull(posterStorageKey, "A ready video has a poster");
        becomeReady(storageKey, contentType, byteSize, width, height, blurDataUrl, now);
    }

    private void becomeReady(
            String storageKey, String contentType, long byteSize, int width, int height, String blurDataUrl, Instant now) {

        if (status != MediaStatus.PROCESSING) {
            throw new IllegalStateException("An upload becomes ready from processing, not from " + status);
        }
        this.storageKey = Objects.requireNonNull(storageKey, "A ready image is somewhere");
        this.contentType = Objects.requireNonNull(contentType, "A ready image is of some type");
        this.byteSize = byteSize;
        this.width = width;
        this.height = height;
        this.blurDataUrl = Objects.requireNonNull(blurDataUrl, "A ready image carries its placeholder");
        this.failureReason = null;
        this.status = MediaStatus.READY;
        touch(now);
    }

    /**
     * Given up on, with a reason the editor translates.
     *
     * <p>Callable from either working state. From {@link MediaStatus#UPLOADED} because the
     * size ceiling is checked before anything is claimed; from {@link MediaStatus#PROCESSING}
     * because everything else is found while decoding.
     */
    public void markFailed(MediaFailureReason reason, Instant now) {
        if (status.isTerminal()) {
            throw new IllegalStateException("An upload that is already " + status + " does not fail again");
        }
        this.failureReason = Objects.requireNonNull(reason, "A failure has a reason");
        this.status = MediaStatus.FAILED;
        touch(now);
    }

    private void touch(Instant now) {
        this.updatedAt = now.truncatedTo(ChronoUnit.MICROS);
    }

    public UUID getId() {
        return id;
    }

    public UUID getOwnerUserId() {
        return ownerUserId;
    }

    public MediaKind getKind() {
        return kind;
    }

    public Optional<Integer> getDurationMs() {
        return Optional.ofNullable(durationMs);
    }

    public Optional<String> getPosterStorageKey() {
        return Optional.ofNullable(posterStorageKey);
    }

    public MediaStatus getStatus() {
        return status;
    }

    public Optional<String> getStorageKey() {
        return Optional.ofNullable(storageKey);
    }

    public Optional<String> getContentType() {
        return Optional.ofNullable(contentType);
    }

    public Optional<Long> getByteSize() {
        return Optional.ofNullable(byteSize);
    }

    public Optional<Integer> getWidth() {
        return Optional.ofNullable(width);
    }

    public Optional<Integer> getHeight() {
        return Optional.ofNullable(height);
    }

    public Optional<String> getBlurDataUrl() {
        return Optional.ofNullable(blurDataUrl);
    }

    public Optional<MediaFailureReason> getFailureReason() {
        return Optional.ofNullable(failureReason);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
