package az.ideanest.shared.crypto;

/**
 * A field that could not be sealed or opened.
 *
 * <p>Every cause is operational: the key a row names is not configured, the ciphertext
 * failed its authentication tag, or the cipher itself refused the key. None of them is
 * anything the person making the request can fix, so it answers 500.
 *
 * <p><strong>Never swallowed into an empty value.</strong> An unreadable bank account
 * shown as "none on file" invites somebody to enter it again, and the write replaces a row
 * that was merely unreadable — an incident becomes data loss. The message names the key
 * label and the keyring, never the value.
 */
public class FieldUnreadableException extends RuntimeException {

    public FieldUnreadableException(String message, Throwable cause) {
        super(message, cause);
    }

    public FieldUnreadableException(String message) {
        super(message);
    }
}
