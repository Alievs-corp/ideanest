package az.ideanest.media.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.media.MediaProperties;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What a presigned upload address binds, read off the address the SDK actually produces (#587).
 *
 * <p>No store is contacted: presigning is arithmetic over the credentials, which is also why a
 * dummy key pair is enough. What is asserted is the list of headers the signature covers,
 * because a header that is set but not signed is a header the browser may send any value of.
 */
class S3ObjectStoreTests {

    @Test
    @DisplayName("an upload address signs its content type and its exact length")
    void theLengthAndTheTypeAreSigned() {
        S3ObjectStore store = new S3ObjectStore(new MediaProperties.Storage(
                "https://storage.example.test",
                "eu-central",
                "uploads-bucket",
                "AKIAEXAMPLEEXAMPLE00",
                "example-secret-example-secret-example-00",
                "https://media.example.test",
                true));

        URI address = store.presignedPut("uploads/abc", "application/octet-stream", 1234, Duration.ofMinutes(10));

        String query = URLDecoder.decode(address.getRawQuery(), StandardCharsets.UTF_8);
        // Without content-length here the store would accept a body of any size at an address
        // issued for a kilobyte, and the sweep would only find out after storing it.
        assertThat(query).containsPattern("X-Amz-SignedHeaders=[^&]*content-length");
        assertThat(query).containsPattern("X-Amz-SignedHeaders=[^&]*content-type");
    }
}
