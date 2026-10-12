package az.ideanest.shared.crypto;

import java.util.Objects;
import java.util.UUID;

/**
 * The only route between a readable field and a stored one — §17.4.
 *
 * <p>One interface for every column the platform encrypts in the application, so that
 * there is one set of cipher parameters. A second call site with its own
 * {@code Cipher.getInstance} would be free to pick a different mode, and the first sign
 * would be rows that cannot be decrypted. What differs between fields is the
 * <em>keyring</em>: each kind of data has its own keys, so a leaked address key opens
 * no bank account, and one {@link AesGcmFieldCipher} exists per keyring.
 *
 * <h2>Additional authenticated data</h2>
 *
 * <p>New fields bind their ciphertext to the row that holds it, with
 * {@link #rowContext(String, UUID)}: a ciphertext copied into another row — another
 * creator's payout destination, say — then fails its tag instead of opening as the
 * other person's data. The context is recomputed from where the row lives on every
 * read and is never stored.
 *
 * <p>{@code null} means no additional data, and it exists for one caller: shipping
 * addresses, which were sealed without any before this interface existed and must stay
 * readable. Nothing new passes {@code null}.
 */
public interface FieldCipher {

    /** Whether this keyring has a primary key, and so whether anything can be sealed under it. */
    boolean isConfigured();

    /**
     * Encrypts under the keyring's primary key.
     *
     * <p>A fresh nonce every time, including when the same value is stored twice. Reusing
     * one under the same key is the failure that breaks GCM completely rather than
     * gradually. The caller's array is neither kept nor cleared; it is the caller's.
     *
     * @param aad the row this ciphertext belongs to, or {@code null} for none
     * @throws FieldEncryptionNotConfiguredException when the keyring has no primary key
     */
    Sealed seal(byte[] plaintext, String aad);

    /**
     * Decrypts, whichever key in the keyring sealed it.
     *
     * @param aad exactly what was passed to {@link #seal}, or the ciphertext does not open
     * @throws FieldUnreadableException when the key named on the row is not configured,
     *     or the ciphertext fails its authentication tag — a tampered row, a row moved
     *     from elsewhere, or the wrong key configured under that label
     */
    byte[] open(Sealed sealed, String aad);

    /**
     * The additional data that binds a ciphertext to one row: the table and the row's id.
     *
     * <p>A function rather than a convention, so that the writer and every reader of a
     * table produce the same bytes. A difference of one character between them is a
     * column nobody can read.
     */
    static String rowContext(String table, UUID id) {
        Objects.requireNonNull(table, "table");
        Objects.requireNonNull(id, "id");
        return table + ":" + id;
    }
}
