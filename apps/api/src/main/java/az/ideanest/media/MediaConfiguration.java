package az.ideanest.media;

import az.ideanest.media.application.ImageTranscoder;
import az.ideanest.media.application.ObjectStore;
import az.ideanest.media.application.VideoTranscoder;
import az.ideanest.media.infrastructure.FfmpegVideoTranscoder;
import az.ideanest.media.infrastructure.S3ObjectStore;
import az.ideanest.media.infrastructure.UnconfiguredObjectStore;
import az.ideanest.media.infrastructure.VipsImageTranscoder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Which object store and which transcoder this deployment got — the media pipeline design
 * of 2026-08-30.
 *
 * <p>Both decisions are made once, here, at start-up, and both are logged. The alternative
 * -- a conditional annotation on each implementation -- puts the decision in two places and
 * makes "why is there no uploader on staging" a question answered by reading Spring's
 * condition evaluation report rather than the first ten lines of the log.
 */
@Configuration(proxyBeanMethods = false)
public class MediaConfiguration {

    private static final Logger log = LoggerFactory.getLogger(MediaConfiguration.class);

    /**
     * S3 when a bucket and a public address are configured, and a bean that refuses
     * otherwise.
     *
     * <p>See {@code UnconfiguredObjectStore} for why the absent case is an object and not a
     * null.
     */
    @Bean
    public ObjectStore objectStore(MediaProperties properties) {
        if (!properties.uploadsAvailable()) {
            log.info("Media uploads are unavailable: no bucket and public base URL configured");
            return new UnconfiguredObjectStore();
        }
        log.info("Media uploads go to bucket {}", properties.storage().bucket());
        return new S3ObjectStore(properties.storage());
    }

    /**
     * The transcoder.
     *
     * <p>Constructed whether or not libvips is installed, because it answers
     * {@code isAvailable()} for itself and says so in the log at start-up -- which is where
     * a runtime image built without the native dependency should become visible, rather
     * than on the first upload.
     */
    @Bean
    public ImageTranscoder imageTranscoder(MediaProperties properties) {
        return new VipsImageTranscoder(properties);
    }

    /** The video transcoder — issue #331. Probes for ffmpeg itself, as the image one does. */
    @Bean
    public VideoTranscoder videoTranscoder(MediaProperties properties) {
        return new FfmpegVideoTranscoder(properties);
    }
}
