package az.ideanest.verification.infrastructure;

import az.ideanest.verification.VerificationProperties;
import az.ideanest.verification.application.DocumentCipher;
import az.ideanest.verification.application.DocumentUnreadableException;
import az.ideanest.verification.domain.SealedDocument;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * {@link DocumentCipher} as AES-256-GCM over the document's bytes — issue #105.
 *
 * <h2>The same envelope as a shipping address, deliberately</h2>
 *
 * <p>{@code AesGcmAddressCipher} made every one of the arguments below, and since #393
 * {@code shared.crypto.AesGcmFieldCipher} holds them; this class still repeats the
 * parameters rather than inventing its own: AES-256-GCM, a 12-byte nonce from
 * {@link SecureRandom} on every seal, a 128-bit tag, no additional authenticated data. One
 * platform with two encryption schemes is one platform whose second scheme is the one
 * nobody reviews.
 *
 * <p>What is <strong>not</strong> shared is the key. A document key and an address key are
 * separate labels in separate configuration blocks, because they protect different things
 * with different lifetimes — an address is held for as long as a pledge needs fulfilling
 * and a passport photograph for seven days after a decision — and one key for both would
 * mean rotating one to rotate the other.
 *
 * <h2>Why the plaintext is not JSON here</h2>
 *
 * <p>An address is eight fields and is sealed as a JSON document so that a ninth reads back
 * as null on old rows. A document is a photograph: there is nothing to add a field to, and
 * wrapping bytes in base64 inside JSON would grow every row by a third for nothing.
 *
 * <h2>Unconfigured</h2>
 *
 * <p>{@link #isConfigured()} answers false and {@link #seal} refuses. The caller turns that
 * into a 503 rather than a 500: a deployment with no key cannot take documents, and telling
 * a creator their photograph failed to upload would send them to try again for ever.
 */
@Component
public class AesGcmDocumentCipher implements DocumentCipher {

    /** GCM's authentication tag, in bits. 128 is the maximum and the only one worth choosing. */
    private static final int TAG_BITS = 128;

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private static final String ALGORITHM = "AES";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final String primaryKeyId;
    private final Map<String, byte[]> keys;

    public AesGcmDocumentCipher(VerificationProperties properties) {
        VerificationProperties.Documents documents = properties.documents();
        this.primaryKeyId = documents.primaryKeyId();
        this.keys = documents.decodedKeys();
    }

    @Override
    public boolean isConfigured() {
        return primaryKeyId != null;
    }

    @Override
    public SealedDocument seal(byte[] document) {
        if (!isConfigured()) {
            throw new DocumentUnreadableException("This deployment has no document encryption key configured");
        }

        byte[] nonce = new byte[SealedDocument.NONCE_LENGTH];
        RANDOM.nextBytes(nonce);

        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(keyNamed(primaryKeyId), ALGORITHM),
                    new GCMParameterSpec(TAG_BITS, nonce));
            return new SealedDocument(cipher.doFinal(document), nonce, primaryKeyId);
        } catch (GeneralSecurityException failure) {
            // A misconfigured key rather than a bad document, so it must not be reported to
            // the creator as a validation problem. The message names the label, never the
            // bytes.
            throw new DocumentUnreadableException("Could not encrypt a document under key " + primaryKeyId, failure);
        }
    }

    @Override
    public byte[] open(SealedDocument sealed) {
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(keyNamed(sealed.keyId()), ALGORITHM),
                    new GCMParameterSpec(TAG_BITS, sealed.nonce()));
            return cipher.doFinal(sealed.ciphertext());
        } catch (GeneralSecurityException failure) {
            // An authentication failure means the row was changed underneath us or the
            // wrong key is configured under that label. Both are operational, and neither
            // is anything a retry will fix.
            throw new DocumentUnreadableException(
                    "A stored document failed to decrypt under key " + sealed.keyId(), failure);
        }
    }

    /**
     * The key material behind a label.
     *
     * @throws DocumentUnreadableException when the deployment has no such key. A row sealed
     *     under a key that has been removed from the configuration is unreadable, and
     *     saying so is the only honest answer — falling back to the primary key would fail
     *     the authentication tag anyway and would report it as tampering
     */
    private byte[] keyNamed(String keyId) {
        byte[] key = keys.get(keyId);
        if (key == null) {
            throw new DocumentUnreadableException(
                    "No document encryption key is configured under the label " + keyId);
        }
        return key;
    }
}
