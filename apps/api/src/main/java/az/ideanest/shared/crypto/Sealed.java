package az.ideanest.shared.crypto;

/**
 * A field encrypted by a {@link FieldCipher}, and everything needed to read it back.
 *
 * <p>Three parts because AES-GCM needs three: the ciphertext with its authentication tag,
 * the nonce it was produced under, and the label of the key that produced it. The
 * arguments for each are {@code SealedAddress}'s, which this generalises: the nonce sits
 * beside the ciphertext rather than prefixed to it so that a schema reader can see it
 * exists, and {@code keyId} is the whole of key rotation.
 *
 * <p>The additional authenticated data is <strong>not</strong> carried here. It is
 * recomputed by the caller from where the row lives, which is the point of it: a
 * ciphertext that carried its own context would authenticate whatever context it was
 * moved with.
 */
public record Sealed(byte[] ciphertext, byte[] nonce, String keyId) {

    /** GCM's specified nonce length. Any other forces an extra hash inside the cipher and buys nothing. */
    public static final int NONCE_LENGTH = 12;

    @Override
    public String toString() {
        // Lengths and the key label, never the bytes. A ciphertext in a log is not a
        // disclosure today and is one the moment a key leaks.
        return "Sealed[" + ciphertext.length + " bytes, key=" + keyId + "]";
    }
}
