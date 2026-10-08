package az.ideanest.support;

import az.ideanest.media.application.ObjectStore;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.OptionalLong;

/**
 * The object store, as a directory — the media pipeline design of 2026-08-30.
 *
 * <h2>Why the suite has one at all</h2>
 *
 * <p>Without it the whole upload path is untestable: {@code MediaConfiguration} hands an
 * unconfigured deployment a store that refuses everything, which is right in production and
 * makes an integration test of "upload a cover and attach it" impossible to write. The
 * interesting behaviour is not S3 — it is the state machine, the sweep's claim, the
 * ownership check on attachment, and the fact that the dimensions on a campaign came from
 * the server rather than from a browser. All of that is above the store.
 *
 * <p>The presigned address is not a real one. Nothing in the suite performs the {@code PUT};
 * a test writes the bytes with {@link #put} instead, which is what a browser's upload amounts
 * to from this side.
 */
public class LocalObjectStore implements ObjectStore {

    private final Path root;

    public LocalObjectStore() {
        try {
            this.root = Files.createTempDirectory("ideanest-object-store-");
        } catch (IOException problem) {
            throw new UncheckedIOException("Could not make a place to keep test objects", problem);
        }
    }

    /** What a browser's {@code PUT} amounts to, from this side. */
    public void put(String key, byte[] content) {
        try {
            Path target = pathOf(key);
            Files.createDirectories(target.getParent());
            Files.write(target, content);
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    /** Whether an object is there, so a test can assert that the raw upload was removed. */
    /**
     * An object of this size, without writing that many bytes — a sparse file, so a test of
     * the 250 MB video ceiling costs nothing on disk (issue #331).
     */
    public void putSized(String key, long size) {
        try (var file = new java.io.RandomAccessFile(pathOf(key).toFile(), "rw")) {
            file.setLength(size);
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    public boolean has(String key) {
        return Files.exists(pathOf(key));
    }

    /** Forgets everything, so one test's objects are not another's. */
    public void clear() {
        try (var entries = Files.walk(root)) {
            List<Path> deepestFirst = entries.sorted(Comparator.reverseOrder()).toList();
            for (Path path : deepestFirst) {
                if (!path.equals(root)) {
                    Files.deleteIfExists(path);
                }
            }
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    @Override
    public URI presignedPut(String key, String contentType, Duration window) {
        return URI.create("https://storage.test/" + key + "?signed=1&type=" + contentType);
    }

    @Override
    public void download(String key, Path destination) {
        Path source = pathOf(key);
        if (!Files.exists(source)) {
            // Absent rather than an outage, exactly as S3ObjectStore treats NoSuchKey: the
            // caller reads an unwritten destination as an empty upload and refuses the row.
            return;
        }
        try {
            Files.copy(source, destination, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    @Override
    public void upload(String key, Path source, String contentType) {
        try {
            Path target = pathOf(key);
            Files.createDirectories(target.getParent());
            Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    @Override
    public void delete(String key) {
        try {
            Files.deleteIfExists(pathOf(key));
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    @Override
    public String publicUrl(String key) {
        return "https://cdn.test/" + key;
    }

    @Override
    public OptionalLong sizeOf(String key) {
        try {
            Path path = pathOf(key);
            return Files.exists(path) ? OptionalLong.of(Files.size(path)) : OptionalLong.empty();
        } catch (IOException problem) {
            throw new UncheckedIOException(problem);
        }
    }

    @Override
    public boolean isAvailable() {
        return true;
    }

    private Path pathOf(String key) {
        return root.resolve(key.replace('/', '_'));
    }
}
