package az.ideanest.signature;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import az.ideanest.signature.SignatureProperties.SimaEnvironment;
import az.ideanest.signature.domain.SignatureOutcome;
import az.ideanest.signature.domain.SignatureProviderName;
import az.ideanest.signature.domain.SignatureProviderUnavailableException;
import az.ideanest.signature.domain.SignatureRequest;
import az.ideanest.signature.domain.SignatureResult;
import az.ideanest.signature.domain.SignatureSession;
import az.ideanest.signature.domain.StoredSignature;
import az.ideanest.signature.domain.Verification;
import az.ideanest.signature.infrastructure.SimaImzaSignatureProvider;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * The SİMA İmza adapter — issue #428.
 *
 * <p>A unit test against canned answers, which is where a translator belongs. The suite never
 * reaches SİMA: a test that called somebody else's sandbox would fail for reasons that are not
 * ours, on their schedule, and it could not produce the cases that matter — a citizen who
 * cancels, a session that runs out, a service that is down, and a signature filed against the
 * wrong document.
 *
 * <p><strong>Those four are #428's definition of done, and they are here one test each</strong>,
 * alongside the successful signature. The distinction they exist to pin down is §9.4's: a
 * cancellation is a value and an unreachable provider is a throw, and a submission that failed
 * for an unexplained reason is what collapsing them produces.
 */
class SimaImzaSignatureProviderTests {

    private static final Instant NOW = Instant.parse("2026-09-05T10:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private static final String BASE = "https://sima.test.invalid";
    private static final String SESSIONS = BASE + "/sign/sessions";
    private static final String SESSION = SESSIONS + "/sess-1";
    private static final String VERIFICATIONS = BASE + "/sign/verifications";

    /** A real-shaped SHA-256, so the domain types' own constraints are exercised too. */
    private static final String DOCUMENT_HASH = "a".repeat(64);

    private static final String OTHER_HASH = "b".repeat(64);

    private static SignatureProperties properties() {
        return new SignatureProperties(
                new SignatureProperties.Provider("SIMA_IMZA"),
                new SignatureProperties.Sima(
                        SimaEnvironment.SANDBOX,
                        BASE,
                        "client",
                        "secret",
                        Duration.ofMinutes(5),
                        Duration.ofSeconds(10)));
    }

    /**
     * The adapter, with one canned answer behind it.
     *
     * <p>{@code MockRestServiceServer} rather than a stub HTTP server, following
     * {@code CentralBankRatesTests}: what is under test is the mapping and the URL, both of
     * which are properties of this class, and a second server in the test JVM would only add a
     * port.
     */
    private static SimaImzaSignatureProvider answering(String url, String body) {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer.bindTo(builder)
                .build()
                .expect(requestTo(url))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
        return new SimaImzaSignatureProvider(builder, properties(), CLOCK);
    }

    private static SimaImzaSignatureProvider failing(String url) {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer.bindTo(builder).build().expect(requestTo(url)).andRespond(withServerError());
        return new SimaImzaSignatureProvider(builder, properties(), CLOCK);
    }

    private static SignatureRequest request() {
        return new SignatureRequest(DOCUMENT_HASH, "1A2B3C4", "+994501234567", "IdeyaNest creator agreement, v3");
    }

    private static String signedBody(String hash) {
        return """
                {
                  "status": "SIGNED",
                  "signature": "MIIEpAIBAAKCAQ==",
                  "hash": "%s",
                  "certificateSubject": "CN=Aysel Məmmədova, SERIALNUMBER=1A2B3C4, C=AZ",
                  "subjectName": "Aysel Məmmədova",
                  "subjectFin": "1A2B3C4",
                  "signedAt": "2026-09-05T10:01:30Z",
                  "certificateChain": ["MIIC...", "MIIB..."]
                }
                """
                .formatted(hash);
    }

    @Test
    @DisplayName("a session begun carries the identifier a resolve is asked with")
    void beginReturnsASession() {
        SimaImzaSignatureProvider sima = answering(
                SESSIONS,
                """
                {"sessionId": "sess-1", "verificationCode": "4417", "expiresAt": "2026-09-05T10:05:00Z"}
                """);

        SignatureSession session = sima.begin(request());

        assertThat(session.sessionId()).isEqualTo("sess-1");
        assertThat(session.verificationCode()).isEqualTo("4417");
        assertThat(session.expiresAt()).isEqualTo(Instant.parse("2026-09-05T10:05:00Z"));
    }

    @Test
    @DisplayName("a successful signature carries the certificate subject and nothing of the certificate")
    void aSuccessfulSignature() {
        SimaImzaSignatureProvider sima = answering(SESSION, signedBody(DOCUMENT_HASH));

        SignatureResult result = sima.resolve("sess-1");

        assertThat(result.outcome()).isEqualTo(SignatureOutcome.SIGNED);
        StoredSignature signature = result.signatureIfSigned().orElseThrow();
        assertThat(signature.provider()).isEqualTo(SignatureProviderName.SIMA_IMZA);
        assertThat(signature.providerSessionId()).isEqualTo("sess-1");
        assertThat(signature.documentHash()).isEqualTo(DOCUMENT_HASH);
        assertThat(signature.signedAt()).isEqualTo(Instant.parse("2026-09-05T10:01:30Z"));
        assertThat(signature.subject().name()).isEqualTo("Aysel Məmmədova");
        assertThat(signature.subject().fin()).isEqualTo("1A2B3C4");

        // The chain was in the answer and is in nothing this returns. #428: no copy of the
        // citizen's certificate material is kept, and the type is what makes that true rather
        // than a rule somebody has to remember at the insert.
        assertThat(signature.toString()).doesNotContain("MIIC");
    }

    @Test
    @DisplayName("a citizen who cancels is an outcome, not an exception")
    void aCancelledSignature() {
        SimaImzaSignatureProvider sima =
                answering(SESSION, """
                {"status": "USER_CANCELLED", "detail": "declined in app"}
                """);

        SignatureResult result = sima.resolve("sess-1");

        assertThat(result.outcome()).isEqualTo(SignatureOutcome.CANCELLED);
        assertThat(result.signatureIfSigned()).isEmpty();
        assertThat(result.isPending()).isFalse();
    }

    @Test
    @DisplayName("an expired session is its own outcome, because the platform says something different about it")
    void anExpiredSession() {
        SimaImzaSignatureProvider sima =
                answering(SESSION, """
                {"status": "EXPIRED", "detail": "no answer in 300s"}
                """);

        SignatureResult result = sima.resolve("sess-1");

        // Not CANCELLED. A cancellation is a decision to respect and an expiry is a prompt to
        // offer again, and a screen that cannot tell them apart offers the wrong one.
        assertThat(result.outcome()).isEqualTo(SignatureOutcome.EXPIRED);
        assertThat(result.signatureIfSigned()).isEmpty();
    }

    @Test
    @DisplayName("an unreachable provider is a throw, because the platform does not know what the citizen did")
    void anUnreachableProvider() {
        SimaImzaSignatureProvider sima = failing(SESSION);

        assertThatThrownBy(() -> sima.resolve("sess-1"))
                .isInstanceOf(SignatureProviderUnavailableException.class)
                .extracting(thrown -> ((SignatureProviderUnavailableException) thrown).provider())
                .isEqualTo(SignatureProviderName.SIMA_IMZA);
    }

    @Test
    @DisplayName("a status this adapter has never seen is a throw and not a guess")
    void anUnknownStatus() {
        SimaImzaSignatureProvider sima = answering(SESSION, """
                {"status": "SOMETHING_NEW"}
                """);

        // Guessing which of four outcomes an unknown status resembles is how a cancellation
        // becomes a signature. Refusing is the only answer that cannot be wrong in that
        // direction.
        assertThatThrownBy(() -> sima.resolve("sess-1")).isInstanceOf(SignatureProviderUnavailableException.class);
    }

    @Test
    @DisplayName("a signature verifies against its own document")
    void verifyAgainstTheRightDocument() {
        SimaImzaSignatureProvider sima = answering(
                VERIFICATIONS, """
                {"valid": true, "certificateValidAtSigningTime": true, "detail": "ok"}
                """);

        Verification verification = sima.verify(signature(DOCUMENT_HASH), DOCUMENT_HASH);

        assertThat(verification.isValid()).isTrue();
        assertThat(verification.hashMatches()).isTrue();
    }

    @Test
    @DisplayName("a sound signature over the wrong bytes is invalid, and says which of the three failed")
    void verifyAgainstTheWrongDocument() {
        SimaImzaSignatureProvider sima = answering(
                VERIFICATIONS, """
                {"valid": true, "certificateValidAtSigningTime": true, "detail": "ok"}
                """);

        Verification verification = sima.verify(signature(DOCUMENT_HASH), OTHER_HASH);

        // The interesting failure, and the reason Verification is three booleans. This is not a
        // forgery -- the cryptography is sound and the certificate was in force -- it is a
        // signature filed against a document it does not sign, which is a different problem
        // with a different answer.
        assertThat(verification.isValid()).isFalse();
        assertThat(verification.signatureIsSound()).isTrue();
        assertThat(verification.certificateWasValid()).isTrue();
        assertThat(verification.hashMatches()).isFalse();
    }

    @Test
    @DisplayName("an adapter refuses to be built without its credentials")
    void incompleteConfigurationIsAStartUpFailure() {
        SignatureProperties incomplete = new SignatureProperties(
                new SignatureProperties.Provider("SIMA_IMZA"),
                new SignatureProperties.Sima(SimaEnvironment.SANDBOX, BASE, "", "", null, null));

        assertThatThrownBy(() -> new SimaImzaSignatureProvider(RestClient.builder(), incomplete, CLOCK))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("client id");
    }

    private static StoredSignature signature(String hash) {
        return new StoredSignature(
                SignatureProviderName.SIMA_IMZA,
                "sess-1",
                hash,
                "MIIEpAIBAAKCAQ==",
                new az.ideanest.signature.domain.CertificateSubject(
                        "CN=Aysel Məmmədova, SERIALNUMBER=1A2B3C4, C=AZ", "Aysel Məmmədova", "1A2B3C4"),
                Instant.parse("2026-09-05T10:01:30Z"));
    }
}
