package az.ideanest.pledgemanager.infrastructure;

import az.ideanest.pledgemanager.PledgeManagerProperties;
import az.ideanest.pledgemanager.application.AddressCipher;
import az.ideanest.pledgemanager.application.AddressStorageNotConfiguredException;
import az.ideanest.pledgemanager.application.AddressUnreadableException;
import az.ideanest.pledgemanager.domain.PostalAddress;
import az.ideanest.pledgemanager.domain.SealedAddress;
import az.ideanest.shared.crypto.AesGcmFieldCipher;
import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.FieldEncryptionNotConfiguredException;
import az.ideanest.shared.crypto.FieldUnreadableException;
import az.ideanest.shared.crypto.Sealed;
import java.util.Arrays;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * {@link AddressCipher} as AES-256-GCM over a JSON rendering of the address.
 *
 * <h2>The cipher is the shared one</h2>
 *
 * <p>The AES-GCM parameters — and the argument for keeping the key out of PostgreSQL that
 * §17.2 named {@code shipping_addresses} for — live in {@link AesGcmFieldCipher} since
 * #393, so that the next encrypted field cannot choose differently. This class owns what
 * is particular to an address: its keyring under {@code ideanest.pledge-manager.addresses},
 * the JSON inside the envelope, and the exceptions the shipping-address endpoints already
 * answer with. Same keyring, same nonce, same tag, and no additional data, so every row
 * sealed before #393 opens exactly as it did.
 *
 * <h2>What is deliberately not authenticated</h2>
 *
 * <p>No additional authenticated data — not the pledge identifier, not the campaign. It
 * was considered: binding the ciphertext to its row would mean an address moved between
 * rows fails to open. It is not done because the platform has no operation that moves
 * one, AAD that nothing varies is a parameter to get wrong during a restore, and adding
 * it now would make every existing row unreadable. The row's own foreign keys are what
 * tie an address to a pledge. New encrypted fields do bind to their row — see
 * {@link FieldCipher#rowContext}.
 *
 * <h2>JSON inside the envelope</h2>
 *
 * <p>The eight fields are serialised as JSON and the whole document is sealed. A
 * field-delimited format would be smaller and would break the day an address line
 * legitimately contains the delimiter; JSON is what the rest of the service already
 * uses, and a field added to {@link PostalAddress} reads back as null on rows sealed
 * before it existed, which is the correct answer for an optional one.
 */
@Component
public class AesGcmAddressCipher implements AddressCipher {

    private static final String KEYRING = "ideanest.pledge-manager.addresses";

    /** Addresses were sealed without additional data before #393, and still are. */
    private static final String NO_AAD = null;

    private final ObjectMapper json;
    private final FieldCipher cipher;

    public AesGcmAddressCipher(ObjectMapper json, PledgeManagerProperties properties) {
        this.json = json;
        this.cipher = new AesGcmFieldCipher(KEYRING, properties.addresses().keyring());
    }

    @Override
    public SealedAddress seal(PostalAddress address) {
        byte[] plaintext = json.writeValueAsBytes(address).clone();
        try {
            Sealed sealed = cipher.seal(plaintext, NO_AAD);
            return new SealedAddress(sealed.ciphertext(), sealed.nonce(), sealed.keyId());
        } catch (FieldEncryptionNotConfiguredException e) {
            throw new AddressStorageNotConfiguredException();
        } catch (FieldUnreadableException e) {
            // A failure here is a misconfigured key rather than a bad address, so it
            // must not be reported to the backer as a validation problem.
            throw new AddressUnreadableException(e.getMessage(), e);
        } finally {
            // The plaintext copy this method made, gone before the method returns.
            // The record itself and whatever Jackson allocated internally are not
            // reachable from here; this is the one buffer that is, and clearing it is
            // cheap.
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    @Override
    public PostalAddress open(SealedAddress sealed) {
        byte[] plaintext;
        try {
            plaintext = cipher.open(new Sealed(sealed.ciphertext(), sealed.nonce(), sealed.keyId()), NO_AAD);
        } catch (FieldUnreadableException e) {
            // A key that is not configured, or a row that fails its tag. Both are
            // operational, and neither is anything a retry will fix.
            throw new AddressUnreadableException(e.getMessage(), e);
        }

        try {
            return json.readValue(plaintext, PostalAddress.class);
        } catch (JacksonException e) {
            throw new AddressUnreadableException("A decrypted address is not the document this service writes", e);
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }
}
