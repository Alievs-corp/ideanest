package az.ideanest.shared.crypto;

/**
 * A keyring with no primary key was asked to seal something.
 *
 * <p>{@link Keyring} explains why there is deliberately no default key. The deployment
 * starts without one and refuses the first write instead — never stores the value in the
 * clear, which would satisfy the request and quietly break the only promise the column
 * makes.
 *
 * <p>503, as an unconfigured address keyring has been since #75: the caller did nothing
 * wrong, and the fix is an operator's. The message names the property and nothing else.
 */
public class FieldEncryptionNotConfiguredException extends RuntimeException {

    private final String keyring;

    public FieldEncryptionNotConfiguredException(String keyring) {
        super("No encryption key is configured: set " + keyring + ".primary-key-id and " + keyring + ".keys");
        this.keyring = keyring;
    }

    /** The property prefix an operator has to set, such as {@code ideanest.crypto.bank-details}. */
    public String keyring() {
        return keyring;
    }
}
