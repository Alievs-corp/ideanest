package az.ideanest.media.infrastructure;

import az.ideanest.media.MediaProperties;
import az.ideanest.media.application.ObjectStore;
import az.ideanest.media.application.ObjectStoreUnavailableException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Objects;
import java.util.OptionalLong;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.apache5.Apache5HttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/**
 * The object store, over S3 — the media pipeline design of 2026-08-30.
 *
 * <h2>Two clients, and they are not interchangeable</h2>
 *
 * <p>An {@link S3Client} for the reads and writes this service performs, and an
 * {@link S3Presigner} for the addresses it hands to a browser. They are separate objects in
 * the SDK because presigning produces a URL without making a request, and the presigner has
 * to be built against the address the <em>browser</em> will reach — which on a deployment
 * behind a private endpoint is not the one this service uses.
 *
 * <h2>Why every failure here is {@link ObjectStoreUnavailableException}</h2>
 *
 * <p>Because none of them is the creator's. A bucket that refuses a request, a network that
 * drops, a credential that expired: recording any of them against somebody's upload would
 * tell them their photograph was the problem and invite them to send another one, forever.
 * The sweep leaves the row claimed and lets the scheduler back off instead.
 *
 * <p>The single exception is a key that is not there, which is reported as an absent file
 * rather than as an outage — see {@link #download}.
 */
public class S3ObjectStore implements ObjectStore {

    private final S3Client client;
    private final S3Presigner presigner;
    private final MediaProperties.Storage storage;

    public S3ObjectStore(MediaProperties.Storage storage) {
        this.storage = Objects.requireNonNull(storage, "An object store needs to be configured");
        this.client = buildClient(storage);
        this.presigner = buildPresigner(storage);
    }

    private static S3Client buildClient(MediaProperties.Storage storage) {
        S3ClientBuilderSupport support = new S3ClientBuilderSupport(storage);
        var builder = S3Client.builder()
                .region(Region.of(storage.region()))
                .credentialsProvider(support.credentials())
                /*
                 * Named, not discovered -- issue #396. Left unset, the SDK scans the
                 * classpath for an implementation and refuses to start if it finds two,
                 * which is what taking the 2.54 bom did: `s3` began shipping
                 * `apache5-client` beside the `apache-client` this build declared. A
                 * transport that a dependency graph chooses is a transport that a
                 * dependency graph can change, and it changes in the built jar rather
                 * than in a test.
                 */
                .httpClientBuilder(Apache5HttpClient.builder())
                .serviceConfiguration(support.serviceConfiguration());
        if (storage.endpoint() != null) {
            builder = builder.endpointOverride(URI.create(storage.endpoint()));
        }
        return builder.build();
    }

    private static S3Presigner buildPresigner(MediaProperties.Storage storage) {
        S3ClientBuilderSupport support = new S3ClientBuilderSupport(storage);
        var builder = S3Presigner.builder()
                .region(Region.of(storage.region()))
                .credentialsProvider(support.credentials())
                .serviceConfiguration(support.serviceConfiguration());
        if (storage.endpoint() != null) {
            builder = builder.endpointOverride(URI.create(storage.endpoint()));
        }
        return builder.build();
    }

    @Override
    public URI presignedPut(String key, String contentType, Duration window) {
        try {
            PutObjectRequest put = PutObjectRequest.builder()
                    .bucket(storage.bucket())
                    .key(key)
                    /*
                     * Signed into the address, so a leaked URL cannot be used to upload
                     * something of a different type under this key. It is not a claim about
                     * what the bytes are -- the magic-byte check decides that -- it is a
                     * bound on what the address may be used for.
                     */
                    .contentType(contentType)
                    .build();

            PutObjectPresignRequest request = PutObjectPresignRequest.builder()
                    .signatureDuration(window)
                    .putObjectRequest(put)
                    .build();

            return presigner.presignPutObject(request).url().toURI();
        } catch (SdkException | URISyntaxException problem) {
            throw new ObjectStoreUnavailableException("Could not issue an upload address", problem);
        }
    }

    @Override
    public void download(String key, Path destination) {
        try {
            client.getObject(
                    GetObjectRequest.builder().bucket(storage.bucket()).key(key).build(), destination);
        } catch (NoSuchKeyException absent) {
            /*
             * Not an outage. The caller is the sweep, and the realistic cause is a row whose
             * `complete` arrived without the upload ever having happened -- a client that
             * called the endpoint out of order, or one whose PUT failed and was not retried.
             * Leaving `destination` unwritten is how that reaches the caller, which reads it
             * as an empty upload and refuses the row rather than failing the whole pass.
             */
            return;
        } catch (SdkException problem) {
            throw new ObjectStoreUnavailableException("Could not read " + key, problem);
        }
    }

    @Override
    public void upload(String key, Path source, String contentType) {
        try {
            client.putObject(
                    PutObjectRequest.builder()
                            .bucket(storage.bucket())
                            .key(key)
                            .contentType(contentType)
                            /*
                             * A year, and immutable. The key contains the media identifier
                             * and the derived object under it is never rewritten -- a second
                             * upload is a second identifier -- so this is the
                             * content-addressed case `next.config.mjs` says a long cache is
                             * right for and could not use while keys were URLs a creator
                             * typed.
                             */
                            .cacheControl("public, max-age=31536000, immutable")
                            .build(),
                    RequestBody.fromFile(source));
        } catch (SdkException problem) {
            throw new ObjectStoreUnavailableException("Could not write " + key, problem);
        }
    }

    @Override
    public void delete(String key) {
        try {
            client.deleteObject(
                    DeleteObjectRequest.builder().bucket(storage.bucket()).key(key).build());
        } catch (NoSuchKeyException absent) {
            // Deleting what is not there succeeded. See the interface.
        } catch (SdkException problem) {
            throw new ObjectStoreUnavailableException("Could not remove " + key, problem);
        }
    }

    @Override
    public OptionalLong sizeOf(String key) {
        try {
            Long length = client.headObject(HeadObjectRequest.builder().bucket(storage.bucket()).key(key).build())
                    .contentLength();
            return length == null ? OptionalLong.empty() : OptionalLong.of(length);
        } catch (NoSuchKeyException absent) {
            return OptionalLong.empty();
        } catch (S3Exception problem) {
            // A HEAD has no body to carry an error code, so a missing key can surface as a
            // bare 404 rather than as NoSuchKeyException, depending on the store.
            if (problem.statusCode() == 404) {
                return OptionalLong.empty();
            }
            throw new ObjectStoreUnavailableException("Could not inspect " + key, problem);
        } catch (SdkException problem) {
            throw new ObjectStoreUnavailableException("Could not inspect " + key, problem);
        }
    }

    @Override
    public String publicUrl(String key) {
        return storage.publicBaseUrl() + "/" + key;
    }

    @Override
    public boolean isAvailable() {
        return true;
    }

    /** The two builder settings both clients need, so they cannot drift apart. */
    private record S3ClientBuilderSupport(MediaProperties.Storage storage) {

        AwsCredentialsProvider credentials() {
            if (storage.hasStaticCredentials()) {
                return StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(storage.accessKeyId(), storage.secretAccessKey()));
            }
            /*
             * No key configured, so the SDK's chain: an instance role, a mounted web
             * identity token, or the environment. That is the arrangement a deployment
             * should prefer -- a credential nobody had to paste into a variable is a
             * credential nobody can leak from one.
             */
            /*
             * `builder().build()` and not `create()`: 2.54 removed the static factory,
             * and the builder is the form that survives it.
             */
            return DefaultCredentialsProvider.builder().build();
        }

        S3Configuration serviceConfiguration() {
            return S3Configuration.builder()
                    .pathStyleAccessEnabled(storage.pathStyle())
                    .build();
        }
    }
}
