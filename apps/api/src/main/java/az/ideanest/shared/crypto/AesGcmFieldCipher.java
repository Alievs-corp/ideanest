package az.ideanest.shared.crypto;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Map;
import java.util.Objects;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * {@link FieldCipher} as AES-256-GCM, over one {@link Keyring}.
 *
 * <p>The parameters are the ones {@code AesGcmAddressCipher} chose for #75, moved here so
 * that a second encrypted field cannot choose differently: a 128-bit tag, a 12-byte nonce
 * from {@link SecureRandom} on every seal, and the key's label stored beside the
 * ciphertext. Addresses and identity documents go through this class too, without
 * additional data, so every address and document sealed before it existed opens exactly
 * as it did.
 *
 * <h2>Why the key is the application's and not PostgreSQL's</h2>
 *
 * <p>Disk encryption does not answer §17.4: a backup, a read replica, a {@code SELECT *}
 * in a support console and an SQL injection all see plaintext through it.
 * {@code pgcrypto} puts its passphrase in the query text, which lands in
 * {@code pg_stat_statements} and in every statement log. The key never reaching the
 * database is the property, and it is only a property if nothing sends it there.
 *
 * <p>Not a Spring component: one instance per keyring, constructed by whoever owns the
 * keyring's configuration — {@link FieldCipherConfiguration} for the shared ones, the
 * address and document ciphers for their own.
 */
public final class AesGcmFieldCipher implements FieldCipher {

    /** GCM's authentication tag, in bits. 128 is the maximum and the only one worth choosing. */
    private static final int TAG_BITS = 128;

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private static final String ALGORITHM = "AES";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final String name;
    private final String primaryKeyId;
    private final Map<String, byte[]> keys;

    /**
     * @param name the keyring's property prefix, such as {@code ideanest.crypto.bank-details}.
     *     It is what every failure names, so that an operator reading the log knows which
     *     setting to look at
     */
    public AesGcmFieldCipher(String name, Keyring keyring) {
        this(name, keyring.primaryKeyId(), keyring.decodedKeys());
    }

    /**
     * Over keys validated somewhere other than {@link Keyring}, for the one keyring that
     * has to be: identity documents. Their labels are held to V58's shape, which allows a
     * leading dot, dash or underscore and a 64th character that {@link Keyring#KEY_ID}
     * does not, and narrowing it would refuse to start a deployment whose document key is
     * named that way. Nothing new uses this; a new keyring is a {@link Keyring}.
     *
     * @param primaryKeyId the label new values are sealed under, or {@code null} for none
     * @param keys label to raw key material, already checked for length by the caller
     */
    public AesGcmFieldCipher(String name, String primaryKeyId, Map<String, byte[]> keys) {
        this.name = Objects.requireNonNull(name, "name");
        this.primaryKeyId = primaryKeyId;
        this.keys = Map.copyOf(keys);
    }

    @Override
    public boolean isConfigured() {
        return primaryKeyId != null;
    }

    @Override
    public Sealed seal(byte[] plaintext, String aad) {
        if (primaryKeyId == null) {
            throw new FieldEncryptionNotConfiguredException(name);
        }
        byte[] nonce = new byte[Sealed.NONCE_LENGTH];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(keyNamed(primaryKeyId), ALGORITHM),
                    new GCMParameterSpec(TAG_BITS, nonce));
            authenticate(cipher, aad);
            return new Sealed(cipher.doFinal(plaintext), nonce, primaryKeyId);
        } catch (GeneralSecurityException e) {
            // A misconfigured key rather than a bad value, so it must not be reported to
            // the caller as a validation problem. The key label, never the value.
            throw new FieldUnreadableException("Could not encrypt under " + name + " key " + primaryKeyId, e);
        }
    }

    @Override
    public byte[] open(Sealed sealed, String aad) {
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(keyNamed(sealed.keyId()), ALGORITHM),
                    new GCMParameterSpec(TAG_BITS, sealed.nonce()));
            authenticate(cipher, aad);
            return cipher.doFinal(sealed.ciphertext());
        } catch (GeneralSecurityException e) {
            // The row was changed underneath us, was moved from another row, or the wrong
            // key is configured under that label. All operational; no retry fixes them.
            throw new FieldUnreadableException(
                    "A value failed to decrypt under " + name + " key " + sealed.keyId(), e);
        }
    }

    /**
     * No call at all for {@code null}, rather than an empty array. GCM treats the two
     * identically, so this is not a compatibility measure — it is so that "no additional
     * data" reads as a decision in the code rather than as an empty string.
     */
    private static void authenticate(Cipher cipher, String aad) {
        if (aad != null) {
            cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        }
    }

    /**
     * The key material behind a label.
     *
     * @throws FieldUnreadableException when the keyring has no such key. A row sealed
     *     under a key that has been removed from the configuration is unreadable, and
     *     saying so is the only honest answer — falling back to the primary key would fail
     *     the tag anyway and would report it as tampering
     */
    private byte[] keyNamed(String keyId) {
        byte[] key = keyId == null ? null : keys.get(keyId);
        if (key == null) {
            throw new FieldUnreadableException("No key is configured in " + name + " under the label " + keyId);
        }
        return key;
    }
}
