package az.ideanest.shared.crypto;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * A keyed fingerprint of an encrypted field: equal values give equal fingerprints, and
 * nobody without the key can compute one — epic #392.
 *
 * <p>Why a fingerprint at all: an encrypted column cannot be compared, because every seal
 * draws a fresh nonce, and "has this IBAN been filed by another account" is a question the
 * platform has to be able to ask. A plain hash would answer it and would also answer it for
 * anybody holding a copy of the table: an IBAN is a short, structured, mostly guessable
 * string, and an unkeyed hash of one is a lookup table away from the account number. HMAC
 * under a key the database never sees is the property {@link AesGcmFieldCipher} has, made
 * comparable.
 *
 * <h2>The key is the field's own keyring, derived and not reused</h2>
 *
 * <p>No separate secret to provision: each key in the keyring yields a fingerprint key by
 * HMAC over a fixed label and a purpose ({@code HKDF-Expand} with a single block), so the
 * AES key itself is never used as an HMAC key and two purposes under one keyring produce
 * unrelated fingerprints. The fingerprint carries the label of the key it was made under —
 * {@code <keyId>:<64 hex>} — which is what survives rotation: {@link #candidates} computes
 * the value under every key still configured, so a row fingerprinted before a rotation is
 * still found after it, and is re-fingerprinted under the new primary when it is next written.
 *
 * <p>Not a Spring component, for {@link AesGcmFieldCipher}'s reason: one instance per keyring
 * and purpose, built by {@link FieldCipherConfiguration}.
 */
public final class FieldFingerprints {

    private static final String ALGORITHM = "HmacSHA256";

    /** Domain separation from every other use of the keyring's keys. Never changed. */
    private static final String DERIVATION_LABEL = "ideanest/field-fingerprint/v1/";

    private final String name;
    private final String primaryKeyId;
    private final Map<String, byte[]> keys;

    /**
     * @param name the keyring's property prefix, which every failure names
     * @param purpose what is being fingerprinted, such as {@code iban}. Part of the derived key,
     *     so a fingerprint made for one purpose matches nothing made for another
     */
    public FieldFingerprints(String name, Keyring keyring, String purpose) {
        this.name = Objects.requireNonNull(name, "name");
        Objects.requireNonNull(purpose, "purpose");
        this.primaryKeyId = keyring.primaryKeyId();
        Map<String, byte[]> derived = new LinkedHashMap<>();
        keyring.decodedKeys().forEach((label, material) -> derived.put(label, derive(material, purpose)));
        this.keys = Map.copyOf(derived);
    }

    /** Whether a fingerprint can be made, which is whether the keyring has a primary key. */
    public boolean isConfigured() {
        return primaryKeyId != null;
    }

    /**
     * The fingerprint to store, under the primary key.
     *
     * @throws FieldEncryptionNotConfiguredException when the keyring has no primary key —
     *     the same 503 as sealing, because the two are written together
     */
    public String of(String value) {
        if (primaryKeyId == null) {
            throw new FieldEncryptionNotConfiguredException(name);
        }
        return under(primaryKeyId, value);
    }

    /**
     * The value's fingerprint under every configured key: what a lookup compares against.
     *
     * <p>Empty for an unconfigured keyring, which finds nothing rather than refusing — a read
     * that cannot match is a read with no matches.
     */
    public Set<String> candidates(String value) {
        Set<String> all = new LinkedHashSet<>();
        for (String keyId : keys.keySet()) {
            all.add(under(keyId, value));
        }
        return Set.copyOf(all);
    }

    private String under(String keyId, String value) {
        Objects.requireNonNull(value, "value");
        return keyId + ":" + HexFormat.of().formatHex(mac(keys.get(keyId), value.getBytes(StandardCharsets.UTF_8)));
    }

    private static byte[] derive(byte[] material, String purpose) {
        byte[] info = (DERIVATION_LABEL + purpose).getBytes(StandardCharsets.UTF_8);
        byte[] block = new byte[info.length + 1];
        System.arraycopy(info, 0, block, 0, info.length);
        // HKDF-Expand's counter for its first and only block.
        block[info.length] = 1;
        return mac(material, block);
    }

    private static byte[] mac(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(key, ALGORITHM));
            return mac.doFinal(data);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            // Every JDK ships HMAC-SHA256 and every configured key is 32 bytes (Keyring), so
            // this is a broken runtime rather than a bad value. The label, never the key.
            throw new IllegalStateException("HMAC-SHA256 is unavailable", e);
        }
    }

    @Override
    public String toString() {
        return "FieldFingerprints[" + name + ", primary=" + primaryKeyId + ", keys=" + keys.keySet() + "]";
    }
}
