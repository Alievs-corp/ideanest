package az.ideanest.media.application;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.OptionalLong;

/**
 * Where uploaded objects live — the media pipeline design of 2026-08-30.
 *
 * <h2>A port, so that the suite does not need a bucket</h2>
 *
 * <p>The implementation talks S3. This interface exists so that the tests for everything
 * above it — the state machine, the sweep, the idempotency of completion — run against a
 * directory on disk instead. A suite that needed object storage to assert that a row cannot
 * go {@code READY} without a key would be a suite nobody runs.
 *
 * <h2>Files rather than byte arrays, throughout</h2>
 *
 * <p>Every method that moves content moves it through a {@link Path}. A twenty-megabyte
 * upload as a {@code byte[]} is twenty megabytes of heap per concurrent request, and the
 * transcoder needs a file on disk anyway — libvips is a process, and a process is handed a
 * path.
 */
public interface ObjectStore {

    /**
     * An address the browser may write one object to, for a while.
     *
     * <p>Presigned rather than an endpoint of ours, so the bytes never pass through this
     * service. A multipart endpoint would put a twenty-megabyte body in a request thread —
     * and there is no {@code spring.servlet.multipart} configuration in this repository to
     * size it with, a gap only the verification endpoint is exposed to today and one this
     * pipeline should not widen.
     *
     * <p>The URL is a credential: anybody holding it may write that key until it expires.
     * That is why the window is short and why the key is unguessable.
     */
    URI presignedPut(String key, String contentType, Duration window);

    /**
     * Fetches an object to a local file.
     *
     * @throws ObjectStoreUnavailableException when the store cannot be reached, which is
     *     transient and must not be recorded against the upload as its failure
     */
    void download(String key, Path destination);

    /** Writes a local file to a key, replacing whatever was there. */
    void upload(String key, Path source, String contentType);

    /**
     * Removes an object, and says nothing when there was none.
     *
     * <p>Deleting an absent key is a success. The caller is the sweep replacing a raw upload
     * with its derived version, and a retry after a crash between the two would otherwise
     * fail on the second pass for having succeeded on the first.
     */
    void delete(String key);

    /**
     * How large an object is, without fetching it — issue #331.
     *
     * <p>A presigned {@code PUT} does not bind the size the client declared, so the sweep
     * asks before it downloads: a video slot is a 250 MB ceiling, and a file several times
     * that should be refused from its header rather than written to the shared host's
     * temporary space first. Empty when there is no such object.
     */
    OptionalLong sizeOf(String key);

    /**
     * What a browser fetches this key from.
     *
     * <p>Built from {@code publicBaseUrl} rather than from the endpoint the service writes
     * to. The two are routinely different — a CDN in front of a bucket — and conflating them
     * is how a private address ends up rendered into a page.
     */
    String publicUrl(String key);

    /** Whether this deployment can accept an upload at all. */
    boolean isAvailable();
}
