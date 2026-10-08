package az.ideanest.media.infrastructure;

import az.ideanest.media.application.ObjectStore;
import az.ideanest.media.application.UploadsUnavailableException;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.OptionalLong;

/**
 * The object store on a deployment that has not configured one — the media pipeline design
 * of 2026-08-30.
 *
 * <p>A bean rather than a null, so that nothing above it has to ask whether storage exists
 * before calling it. {@code MediaLibrary} asks {@link #isAvailable()} once, at the only
 * point where the answer changes what a caller is told; every other method here is
 * unreachable through that path and throws rather than returning something plausible.
 *
 * <p>Why this exists at all is in {@code MediaProperties}: there is no default bucket,
 * because a default would be a guess about somebody else's infrastructure, and a service
 * that refused to start without one would trade a hundred working endpoints for one.
 */
public class UnconfiguredObjectStore implements ObjectStore {

    private static final String EXPLANATION = "This deployment has no media storage configured.";

    @Override
    public URI presignedPut(String key, String contentType, Duration window) {
        throw new UploadsUnavailableException(EXPLANATION);
    }

    @Override
    public void download(String key, Path destination) {
        throw new UploadsUnavailableException(EXPLANATION);
    }

    @Override
    public void upload(String key, Path source, String contentType) {
        throw new UploadsUnavailableException(EXPLANATION);
    }

    @Override
    public void delete(String key) {
        throw new UploadsUnavailableException(EXPLANATION);
    }

    @Override
    public OptionalLong sizeOf(String key) {
        throw new UploadsUnavailableException(EXPLANATION);
    }

    @Override
    public String publicUrl(String key) {
        throw new UploadsUnavailableException(EXPLANATION);
    }

    @Override
    public boolean isAvailable() {
        return false;
    }
}
