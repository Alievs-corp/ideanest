package az.ideanest.media;

import az.ideanest.media.domain.MediaKind;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * §13.1's ingestion envelope: where uploads go, what may be uploaded, and how large the
 * result is allowed to be — the media pipeline design of 2026-08-30.
 *
 * <h2>An unconfigured deployment starts, and refuses to accept an upload</h2>
 *
 * <p>The same position {@code VerificationProperties} takes about its keys, for the same
 * reason. There is no default bucket and no default endpoint, because either would be a
 * guess about somebody else's infrastructure — and a service that quietly wrote a
 * creator's photograph to a plausible-looking address would be worse than one that did
 * nothing.
 *
 * <p>So a deployment that configures nothing starts normally, serves every other endpoint,
 * and answers an upload request with a 503 saying that uploads are not configured here.
 * Refusing to start would trade one unavailable endpoint for a hundred.
 *
 * <h2>Why the ceiling is not the limit this work removed</h2>
 *
 * <p>{@code maxUploadBytes} is a denial-of-service control, not a rule about what makes a
 * good cover. Nobody is stopped from making a campaign by it — the design that introduced
 * this class exists to stop creators being blocked on image dimensions — and without it a
 * single request can occupy a processing slot with an arbitrarily large file.
 *
 * @param storage where the objects live. Absent means uploads are unavailable
 * @param maxUploadBytes the ceiling on one upload. §13.1's twenty megabytes
 * @param uploadWindow how long a presigned upload address stays valid. Short, because it is
 *     a credential: anybody holding the URL may write that one object until it expires
 * @param longestEdge what an image is reduced to. §13.1's {@code hero}, and the widest box
 *     in the product at 2× — see the design document on why nothing larger is stored
 * @param jpegQuality the quality of a re-encoded photograph, 1–100
 * @param processing the sweep that turns an uploaded object into a servable one
 * @param video what a campaign video may be, and what it is turned into — issue #331
 */
@ConfigurationProperties(prefix = "ideanest.media")
public record MediaProperties(
        Storage storage,
        long maxUploadBytes,
        Duration uploadWindow,
        int longestEdge,
        int jpegQuality,
        Processing processing,
        Video video) {

    /** §13.1's "20MB images". */
    private static final long DEFAULT_MAX_UPLOAD_BYTES = 20L * 1024 * 1024;

    private static final Duration DEFAULT_UPLOAD_WINDOW = Duration.ofMinutes(10);

    /**
     * §13.1's {@code hero}, and the same 1440 {@code next.config.mjs} stops its
     * {@code deviceSizes} at. The widest box in the product is 720 CSS px.
     */
    private static final int DEFAULT_LONGEST_EDGE = 1440;

    /**
     * Eighty-two. High enough that the artefacts are not visible on a photograph at the size
     * it is displayed, low enough that the file is a fraction of a lossless one — and the
     * stored object is an input to {@code next/image}, which re-encodes to AVIF or WebP
     * before a browser ever sees it, so this number decides storage rather than what is
     * delivered.
     */
    private static final int DEFAULT_JPEG_QUALITY = 82;

    public MediaProperties {
        maxUploadBytes = maxUploadBytes == 0 ? DEFAULT_MAX_UPLOAD_BYTES : maxUploadBytes;
        uploadWindow = uploadWindow == null ? DEFAULT_UPLOAD_WINDOW : uploadWindow;
        longestEdge = longestEdge == 0 ? DEFAULT_LONGEST_EDGE : longestEdge;
        jpegQuality = jpegQuality == 0 ? DEFAULT_JPEG_QUALITY : jpegQuality;
        processing = processing == null ? Processing.defaults() : processing;
        video = video == null ? Video.defaults() : video;

        if (maxUploadBytes <= 0) {
            throw new IllegalArgumentException("An upload ceiling is a positive number of bytes");
        }
        if (!uploadWindow.isPositive()) {
            throw new IllegalArgumentException("An upload address is valid for some length of time");
        }
        if (longestEdge < 16) {
            throw new IllegalArgumentException("An image is reduced to something larger than its own placeholder");
        }
        if (jpegQuality < 1 || jpegQuality > 100) {
            throw new IllegalArgumentException("JPEG quality is between 1 and 100");
        }
    }

    /** The ceiling on one upload of this kind. */
    public long maxUploadBytesFor(MediaKind kind) {
        return kind == MediaKind.VIDEO ? video.maxUploadBytes() : maxUploadBytes;
    }

    /** Whether this deployment can accept an upload at all. */
    public boolean uploadsAvailable() {
        return storage != null && storage.isConfigured();
    }

    /**
     * The object store.
     *
     * <p>S3-compatible rather than one vendor's SDK. R2, MinIO and S3 itself all speak it,
     * and the choice of which is a deployment's rather than this repository's — which
     * matters here more than usual, because {@code deploy.yml} rolls out a digest through a
     * hook and this repository owns no infrastructure to make the choice on.
     *
     * @param endpoint the service address. Absent for AWS itself, where the region decides it
     * @param region the region name. Required by the SDK's signer even where it means nothing
     * @param bucket the bucket. Absent means uploads are unavailable
     * @param accessKeyId credential half. Absent falls back to the SDK's default provider
     *     chain, which is how an instance role or a mounted token is used instead
     * @param secretAccessKey the other half
     * @param publicBaseUrl what a stored key is served from — the CDN or bucket origin a
     *     browser fetches. Separate from {@code endpoint} because the address the service
     *     writes to and the address the world reads from are routinely not the same one, and
     *     conflating them is how a private endpoint ends up in a page
     * @param pathStyle whether keys go in the path rather than the host. MinIO needs it;
     *     most hosted services do not
     */
    public record Storage(
            String endpoint,
            String region,
            String bucket,
            String accessKeyId,
            String secretAccessKey,
            String publicBaseUrl,
            boolean pathStyle) {

        private static final String DEFAULT_REGION = "auto";

        public Storage {
            region = isBlank(region) ? DEFAULT_REGION : region;
            endpoint = blankAsNull(endpoint);
            bucket = blankAsNull(bucket);
            accessKeyId = blankAsNull(accessKeyId);
            secretAccessKey = blankAsNull(secretAccessKey);
            publicBaseUrl = trimTrailingSlash(blankAsNull(publicBaseUrl));
        }

        /**
         * A bucket and somewhere to serve it from.
         *
         * <p>Credentials are deliberately not required: the SDK's default provider chain
         * covers an instance role, which is the arrangement a deployment should prefer to
         * a key in an environment variable.
         */
        public boolean isConfigured() {
            return bucket != null && publicBaseUrl != null;
        }

        /** Whether a key and secret were given, as opposed to left to the provider chain. */
        public boolean hasStaticCredentials() {
            return accessKeyId != null && secretAccessKey != null;
        }

        private static String blankAsNull(String value) {
            return isBlank(value) ? null : value.trim();
        }

        private static boolean isBlank(String value) {
            return value == null || value.isBlank();
        }

        private static String trimTrailingSlash(String value) {
            if (value == null) {
                return null;
            }
            return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
        }
    }

    /**
     * A campaign video, and the one rendition it is turned into — issue #331.
     *
     * <p>The owner's brief was "a format that does not tire the server and does not take much
     * storage". So there is one output and it is the cheapest one that plays everywhere
     * without a player library: H.264 and AAC in an MP4, at most 720p and 30 frames a second,
     * with the index at the front so a browser starts playing from a range request. A minute
     * of it is roughly ten megabytes, served by the bucket rather than by this process.
     *
     * <p>§13.2's adaptive ladder is deliberately not built. For a sixty-second clip one
     * rendition costs less to store than four, and the contract — one URL — survives adding
     * the ladder later.
     *
     * @param maxUploadBytes the ceiling on the <em>raw</em> upload. A minute of 4K from a
     *     phone is several hundred megabytes; 250 admits a minute of 1080p from any phone and
     *     a phone that shoots larger can trim or lower its quality. The raw object is deleted
     *     the moment the transcode is written, so this is transfer, not storage
     * @param maxDuration the longest clip accepted, measured from the file
     * @param longestEdge what the frame is reduced to. Never enlarged
     * @param maxFrameRate frames a second. Sixty doubles the bits of a talking head
     * @param crf x264's constant rate factor: lower is larger and sharper
     * @param maxBitrateKbps the cap on a scene CRF alone would spend too much on
     * @param audioBitrateKbps AAC, stereo
     * @param threads how many cores one transcode may use. The API shares its host, and a
     *     transcode that took every core would be a slow checkout for somebody else
     * @param timeout how long one transcode may take before it is abandoned as wedged
     * @param schedule when the video sweep fires. Its own job, so a transcode never makes a
     *     cover image wait behind it
     */
    public record Video(
            long maxUploadBytes,
            Duration maxDuration,
            int longestEdge,
            int maxFrameRate,
            int crf,
            int maxBitrateKbps,
            int audioBitrateKbps,
            int threads,
            Duration timeout,
            String schedule) {

        private static final long DEFAULT_MAX_UPLOAD_BYTES = 250L * 1024 * 1024;
        private static final Duration DEFAULT_MAX_DURATION = Duration.ofSeconds(60);
        private static final int DEFAULT_LONGEST_EDGE = 1280;
        private static final int DEFAULT_MAX_FRAME_RATE = 30;
        private static final int DEFAULT_CRF = 26;
        private static final int DEFAULT_MAX_BITRATE_KBPS = 2500;
        private static final int DEFAULT_AUDIO_BITRATE_KBPS = 96;
        private static final int DEFAULT_THREADS = 2;
        private static final Duration DEFAULT_TIMEOUT = Duration.ofMinutes(5);
        private static final String DEFAULT_SCHEDULE = "*/5 * * * * *";

        static Video defaults() {
            return new Video(0, null, 0, 0, 0, 0, 0, 0, null, null);
        }

        public Video {
            maxUploadBytes = maxUploadBytes == 0 ? DEFAULT_MAX_UPLOAD_BYTES : maxUploadBytes;
            maxDuration = maxDuration == null ? DEFAULT_MAX_DURATION : maxDuration;
            longestEdge = longestEdge == 0 ? DEFAULT_LONGEST_EDGE : longestEdge;
            maxFrameRate = maxFrameRate == 0 ? DEFAULT_MAX_FRAME_RATE : maxFrameRate;
            crf = crf == 0 ? DEFAULT_CRF : crf;
            maxBitrateKbps = maxBitrateKbps == 0 ? DEFAULT_MAX_BITRATE_KBPS : maxBitrateKbps;
            audioBitrateKbps = audioBitrateKbps == 0 ? DEFAULT_AUDIO_BITRATE_KBPS : audioBitrateKbps;
            threads = threads == 0 ? DEFAULT_THREADS : threads;
            timeout = timeout == null ? DEFAULT_TIMEOUT : timeout;
            schedule = schedule == null || schedule.isBlank() ? DEFAULT_SCHEDULE : schedule.trim();

            if (maxUploadBytes <= 0) {
                throw new IllegalArgumentException("A video upload ceiling is a positive number of bytes");
            }
            if (!maxDuration.isPositive()) {
                throw new IllegalArgumentException("A video may last some time");
            }
            if (longestEdge < 16 || longestEdge % 2 != 0) {
                throw new IllegalArgumentException("H.264 needs an even frame edge of a usable size");
            }
            if (maxFrameRate < 1 || crf < 0 || crf > 51 || maxBitrateKbps < 1 || audioBitrateKbps < 1) {
                throw new IllegalArgumentException("Video encoding settings are out of range");
            }
            if (threads < 1 || !timeout.isPositive()) {
                throw new IllegalArgumentException("A transcode uses at least one thread for some time");
            }
        }
    }

    /**
     * The sweep.
     *
     * @param schedule when it fires, as {@code ScheduledJob} reads it. Every few seconds:
     *     a creator is watching a spinner, and this is the whole of the latency between
     *     their upload finishing and the image appearing
     * @param batchSize how many objects one pass processes. Bounded so that a backlog does
     *     not become one pass that overlaps its own next tick, and small because each item
     *     spawns a process
     * @param abandonedAfter how long an upload that never completed is kept before it is
     *     given up on. A {@code PENDING} row is somebody who closed the tab
     */
    public record Processing(String schedule, int batchSize, Duration abandonedAfter) {

        /**
         * Every five seconds.
         *
         * <p>Unlike every other schedule in this service, this one is not a sweep over rows
         * that can wait — it is a person watching a spinner. The lease still means one
         * replica does the work, and {@code batchSize} still bounds what a tick may take on.
         */
        private static final String DEFAULT_SCHEDULE = "*/5 * * * * *";

        private static final int DEFAULT_BATCH_SIZE = 4;

        private static final Duration DEFAULT_ABANDONED_AFTER = Duration.ofHours(6);

        static Processing defaults() {
            return new Processing(DEFAULT_SCHEDULE, DEFAULT_BATCH_SIZE, DEFAULT_ABANDONED_AFTER);
        }

        public Processing {
            schedule = schedule == null || schedule.isBlank() ? DEFAULT_SCHEDULE : schedule.trim();
            batchSize = batchSize == 0 ? DEFAULT_BATCH_SIZE : batchSize;
            abandonedAfter = abandonedAfter == null ? DEFAULT_ABANDONED_AFTER : abandonedAfter;

            if (batchSize < 1) {
                throw new IllegalArgumentException("A pass processes at least one object");
            }
            if (!abandonedAfter.isPositive()) {
                throw new IllegalArgumentException("An abandoned upload is given up on after some time");
            }
        }
    }
}
