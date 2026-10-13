package az.ideanest.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.verification.application.DocumentUnreadableException;
import az.ideanest.verification.domain.SealedDocument;
import az.ideanest.verification.infrastructure.AesGcmDocumentCipher;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The document cipher after #419 moved its parameters into the shared field cipher.
 *
 * <p>The one thing that refactor must not change is whether a row already in
 * {@code identity_documents} opens. {@code IdentityVerificationTests} proves the feature
 * round-trips through the new code; this proves a ciphertext the #105 cipher produced still
 * opens, byte for byte.
 */
class DocumentCipherCompatibilityTests {

    private static final byte[] KEY = "test-only-document-key-32-bytes!".getBytes(StandardCharsets.US_ASCII);

    private static final byte[] DOCUMENT = "%PDF-1.4 passport scan, page 1".getBytes(StandardCharsets.US_ASCII);

    /**
     * Sealed by {@code AesGcmDocumentCipher.seal} as it stood before #419, under {@link #KEY}
     * labelled {@code d1}, and pasted here. A fixed vector rather than one produced in the
     * test, because one produced in the test by the bare JCE only proves this test agrees
     * with itself about the parameters.
     */
    private static final byte[] LEGACY_NONCE = HexFormat.of().parseHex("5f34490b66ceeb125b78dffd");

    private static final byte[] LEGACY_CIPHERTEXT = HexFormat.of()
            .parseHex("33dc442a50c8337284ca5c971bf6575d7dc52050f459ac8b9984cf585a20f3f989cb5916f77031d19ec48244560a");

    @Test
    @DisplayName("a document sealed before #419 opens unchanged")
    void rowsSealedBeforeTheRefactorOpen() {
        AesGcmDocumentCipher cipher = cipher("d1", Map.of("d1", encoded(KEY)));

        assertThat(cipher.open(new SealedDocument(LEGACY_CIPHERTEXT, LEGACY_NONCE, "d1")))
                .isEqualTo(DOCUMENT);
    }

    @Test
    @DisplayName("a document sealed now is still sealed without additional data")
    void newRowsAreSealedTheSameWay() throws Exception {
        SealedDocument sealed = cipher("d1", Map.of("d1", encoded(KEY))).seal(DOCUMENT);

        // Opened by the bare JCE with no AAD: a version of this code that started binding
        // documents to their row would fail here, before it made a restore impossible.
        Cipher plain = Cipher.getInstance("AES/GCM/NoPadding");
        plain.init(Cipher.DECRYPT_MODE, new SecretKeySpec(KEY, "AES"), new GCMParameterSpec(128, sealed.nonce()));

        assertThat(sealed.keyId()).isEqualTo("d1");
        assertThat(sealed.nonce()).hasSize(12);
        assertThat(plain.doFinal(sealed.ciphertext())).isEqualTo(DOCUMENT);
    }

    @Test
    @DisplayName("a label V58 allows and Keyring does not still configures the document keyring")
    void documentLabelsKeepTheirOwnShape() {
        // A leading underscore: inside identity_documents' key_id constraint, outside the
        // shape Keyring holds every other keyring to. Moving documents onto Keyring would
        // have refused to start a deployment configured this way.
        AesGcmDocumentCipher cipher = cipher("_legacy", Map.of("_legacy", encoded(KEY)));

        assertThat(cipher.isConfigured()).isTrue();
        SealedDocument sealed = cipher.seal(DOCUMENT);
        assertThat(sealed.keyId()).isEqualTo("_legacy");
        assertThat(cipher.open(sealed)).isEqualTo(DOCUMENT);
    }

    @Test
    @DisplayName("the document exception is unchanged: unconfigured, unknown key and tampered rows")
    void failuresKeepTheirDocumentException() {
        AesGcmDocumentCipher unconfigured = cipher(null, Map.of());
        assertThat(unconfigured.isConfigured()).isFalse();
        assertThatThrownBy(() -> unconfigured.seal(DOCUMENT))
                .isInstanceOf(DocumentUnreadableException.class)
                .hasMessage("This deployment has no document encryption key configured");

        AesGcmDocumentCipher configured = cipher("d1", Map.of("d1", encoded(KEY)));
        assertThatThrownBy(() -> configured.open(new SealedDocument(LEGACY_CIPHERTEXT, LEGACY_NONCE, "gone")))
                .isInstanceOf(DocumentUnreadableException.class)
                .hasMessageContaining("gone");

        byte[] tampered = LEGACY_CIPHERTEXT.clone();
        tampered[0] ^= 1;
        assertThatThrownBy(() -> configured.open(new SealedDocument(tampered, LEGACY_NONCE, "d1")))
                .isInstanceOf(DocumentUnreadableException.class)
                .hasMessageContaining("d1");
    }

    private static String encoded(byte[] key) {
        return Base64.getEncoder().encodeToString(key);
    }

    private static AesGcmDocumentCipher cipher(String primaryKeyId, Map<String, String> keys) {
        VerificationProperties.Documents documents =
                new VerificationProperties.Documents(0, 0, null, null, primaryKeyId, keys);
        return new AesGcmDocumentCipher(new VerificationProperties(false, null, documents));
    }
}
