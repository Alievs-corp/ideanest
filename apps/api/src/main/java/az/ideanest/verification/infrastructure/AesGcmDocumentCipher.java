package az.ideanest.verification.infrastructure;

import az.ideanest.shared.crypto.AesGcmFieldCipher;
import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.FieldEncryptionNotConfiguredException;
import az.ideanest.shared.crypto.FieldUnreadableException;
import az.ideanest.shared.crypto.Sealed;
import az.ideanest.verification.VerificationProperties;
import az.ideanest.verification.application.DocumentCipher;
import az.ideanest.verification.application.DocumentUnreadableException;
import az.ideanest.verification.domain.SealedDocument;
import org.springframework.stereotype.Component;

/**
 * {@link DocumentCipher} as AES-256-GCM over the document's bytes — issue #105.
 *
 * <h2>The cipher is the shared one</h2>
 *
 * <p>The AES-GCM parameters live in {@link AesGcmFieldCipher}, which this class delegates
 * to since #419 instead of repeating them: a 128-bit tag, a 12-byte nonce on every seal,
 * and no additional authenticated data. One platform with two encryption schemes is one
 * platform whose second scheme is the one nobody reviews. Same key, same nonce, same tag
 * and still no additional data, so every document sealed before #419 opens exactly as it
 * did. Binding documents to their row with {@link FieldCipher#rowContext} would be a
 * change of format, with old rows to account for, and is not this one.
 *
 * <p>What is <strong>not</strong> shared is the key. A document key and an address key are
 * separate labels in separate configuration blocks, because they protect different things
 * with different lifetimes — an address is held for as long as a pledge needs fulfilling
 * and a passport photograph for seven days after a decision — and one key for both would
 * mean rotating one to rotate the other. The keyring stays under
 * {@code ideanest.verification.documents} and keeps its own validation in
 * {@link VerificationProperties.Documents}, whose label shape is V58's rather than
 * {@code Keyring}'s.
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

    private static final String KEYRING = "ideanest.verification.documents";

    /** Documents were sealed without additional data before #419, and still are. */
    private static final String NO_AAD = null;

    private final FieldCipher cipher;

    public AesGcmDocumentCipher(VerificationProperties properties) {
        VerificationProperties.Documents documents = properties.documents();
        this.cipher = new AesGcmFieldCipher(KEYRING, documents.primaryKeyId(), documents.decodedKeys());
    }

    @Override
    public boolean isConfigured() {
        return cipher.isConfigured();
    }

    @Override
    public SealedDocument seal(byte[] document) {
        try {
            Sealed sealed = cipher.seal(document, NO_AAD);
            return new SealedDocument(sealed.ciphertext(), sealed.nonce(), sealed.keyId());
        } catch (FieldEncryptionNotConfiguredException e) {
            throw new DocumentUnreadableException("This deployment has no document encryption key configured");
        } catch (FieldUnreadableException e) {
            // A misconfigured key rather than a bad document, so it must not be reported to
            // the creator as a validation problem. The message names the label, never the
            // bytes.
            throw new DocumentUnreadableException(e.getMessage(), e);
        }
    }

    @Override
    public byte[] open(SealedDocument sealed) {
        try {
            return cipher.open(new Sealed(sealed.ciphertext(), sealed.nonce(), sealed.keyId()), NO_AAD);
        } catch (FieldUnreadableException e) {
            // A key that is not configured under the row's label, or a row that fails its
            // tag — changed underneath us, or the wrong key under that label. Both are
            // operational, and neither is anything a retry will fix. Never a fallback to
            // the primary key: it would fail the tag anyway and report it as tampering.
            throw new DocumentUnreadableException(e.getMessage(), e);
        }
    }
}
