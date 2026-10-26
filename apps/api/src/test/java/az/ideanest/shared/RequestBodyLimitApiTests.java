package az.ideanest.shared;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/**
 * The ceiling on a request body (#587), over real HTTP.
 *
 * <p>{@code POST /v1/auth/logout} is the probe for the general ceiling because it is the one
 * public endpoint that reads a JSON body and accepts anything in it: signing out with a token
 * nobody issued is still a 204. A body it refuses is therefore refused for its size and for
 * nothing else — and before #587 a three-megabyte one was read whole and answered 204.
 */
class RequestBodyLimitApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    private static final int THREE_MEGABYTES = 3 * 1024 * 1024;

    @Autowired
    private TestRestTemplate rest;

    @LocalServerPort
    private int port;

    private static String signOutBodyOf(int bytes) {
        char[] token = new char[bytes];
        Arrays.fill(token, 'a');
        return "{\"refreshToken\":\"" + new String(token) + "\"}";
    }

    private static HttpHeaders json() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    /** What came back for a request whose body was declared and never sent. */
    private record Answer(int status, String text) {
    }

    /**
     * Declares a body of {@code length} bytes, sends none of it, and reads the answer.
     *
     * <p>A raw socket rather than an HTTP client, because the claim is that the refusal
     * comes before a byte of the body is read — and the only way to show that is to
     * withhold the body. An HTTP client would also be writing megabytes while the 413
     * arrived, and Tomcat closes a connection whose unread body is larger than it will
     * swallow, which a client in mid-write sees as a reset rather than an answer.
     */
    private Answer declared(String path, String contentType, long length) throws IOException {
        try (Socket socket = new Socket("localhost", port)) {
            socket.setSoTimeout(15_000);
            OutputStream out = socket.getOutputStream();
            out.write(("POST " + path + " HTTP/1.1\r\n"
                            + "Host: localhost\r\n"
                            + "Content-Type: " + contentType + "\r\n"
                            + "Content-Length: " + length + "\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII));
            out.flush();

            String text = answerFrom(socket.getInputStream());
            int status = Integer.parseInt(text.substring("HTTP/1.1 ".length(), "HTTP/1.1 ".length() + 3));
            return new Answer(status, text);
        }
    }

    /**
     * Reads one response: its head, and as much body as its {@code Content-Length} says.
     *
     * <p>Not to the end of the stream, which only comes when Tomcat gives up on a body
     * that was declared and never sent.
     */
    private static String answerFrom(InputStream in) throws IOException {
        ByteArrayOutputStream received = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        while (true) {
            String sofar = received.toString(StandardCharsets.UTF_8);
            int headEnd = sofar.indexOf("\r\n\r\n");
            if (headEnd >= 0) {
                Matcher length = Pattern.compile("(?im)^content-length:\\s*(\\d+)").matcher(sofar);
                int expected = length.find() ? Integer.parseInt(length.group(1)) : 0;
                if (received.size() >= headEnd + 4 + expected) {
                    return sofar;
                }
            }
            int read = in.read(buffer);
            if (read < 0) {
                return received.toString(StandardCharsets.UTF_8);
            }
            received.write(buffer, 0, read);
        }
    }

    @Test
    @DisplayName("a declared body over two megabytes is refused with 413 before it is read")
    void aDeclaredBodyOverTheCeilingIsRefused() throws IOException {
        Answer refused = declared("/v1/auth/logout", MediaType.APPLICATION_JSON_VALUE, THREE_MEGABYTES);

        assertThat(refused.status()).isEqualTo(HttpStatus.CONTENT_TOO_LARGE.value());
        assertThat(refused.text())
                .containsIgnoringCase("Content-Type: " + MediaType.APPLICATION_PROBLEM_JSON_VALUE)
                .contains("https://ideanest.az/problems/request-too-large");
    }

    @Test
    @DisplayName("a body under the ceiling is read as before")
    void aBodyUnderTheCeilingPasses() {
        ResponseEntity<String> signedOut = rest.exchange(
                "/v1/auth/logout", HttpMethod.POST, new HttpEntity<>(signOutBodyOf(64 * 1024), json()), String.class);

        assertThat(signedOut.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
    }

    @Test
    @DisplayName("an undeclared, chunked body stops being read at the ceiling")
    void aChunkedBodyIsCutOffAtTheCeiling() throws Exception {
        byte[] body = signOutBodyOf(THREE_MEGABYTES).getBytes(StandardCharsets.UTF_8);
        // ofInputStream has no length, so the client sends it chunked and the filter has
        // no Content-Length to judge by: what bounds it is the counting stream.
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v1/auth/logout"))
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(body)))
                .build();

        HttpResponse<String> response;
        try (HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()) {
            response = client.send(request, HttpResponse.BodyHandlers.ofString());
        }

        // An unreadable body rather than a 413: the size is only known once the read has
        // gone past it. Not a 204, which is what reading all three megabytes produced.
        assertThat(response.statusCode()).isEqualTo(HttpStatus.BAD_REQUEST.value());
    }

    @Test
    @DisplayName("the tracking-file import has a ceiling of its own, and a three-megabyte file is under it")
    void theImportTakesALargerFile() throws IOException {
        String path = "/v1/projects/" + UUID.randomUUID() + "/fulfilments/import";

        // Signed in, so the file is read to the end and the handler answers for the
        // campaign that does not exist: anything but a 413 is the filter letting it by.
        HttpHeaders csv = new HttpHeaders();
        csv.setContentType(MediaType.parseMediaType("text/csv"));
        csv.setBearerAuth(signedIn());
        ResponseEntity<String> underCeiling =
                rest.exchange(path, HttpMethod.POST, new HttpEntity<>("x".repeat(THREE_MEGABYTES), csv), String.class);
        assertThat(underCeiling.getStatusCode()).isNotEqualTo(HttpStatus.CONTENT_TOO_LARGE);
        assertThat(underCeiling.getStatusCode().is4xxClientError()).isTrue();

        assertThat(declared(path, "text/csv", 11L * 1024 * 1024).status())
                .isEqualTo(HttpStatus.CONTENT_TOO_LARGE.value());
    }

    @Test
    @DisplayName("an identity document of three megabytes is accepted, as the five-megabyte rule promises")
    void aRealisticIdentityDocumentFits() {
        String accessToken = signedIn();

        // A JPEG signature and then three megabytes: what a phone photograph of a passport
        // weighs. Spring's own multipart default refused anything over one megabyte.
        byte[] photograph = new byte[THREE_MEGABYTES];
        photograph[0] = (byte) 0xFF;
        photograph[1] = (byte) 0xD8;
        photograph[2] = (byte) 0xFF;

        MultiValueMap<String, Object> parts = new LinkedMultiValueMap<>();
        parts.add("kind", "PASSPORT");
        parts.add("file", new ByteArrayResource(photograph) {
            @Override
            public String getFilename() {
                return "passport.jpg";
            }
        });
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        headers.setBearerAuth(accessToken);

        ResponseEntity<String> submitted =
                rest.exchange("/v1/me/verification", HttpMethod.POST, new HttpEntity<>(parts, headers), String.class);

        assertThat(submitted.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private String signedIn() {
        String email = "body-limit" + SEQUENCE.incrementAndGet() + "@example.com";
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email, "password", PASSWORD, "name", "Test Person"),
                String.class);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), json()),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        return (String) signedIn.getBody().get("accessToken");
    }
}
