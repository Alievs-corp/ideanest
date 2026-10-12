package az.ideanest.shared.crypto;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The keyrings that belong to no single module — §17.4.
 *
 * <p>Shipping addresses keep theirs under {@code ideanest.pledge-manager.addresses},
 * where #75 put it and where every deployment already sets it; moving it would turn a
 * refactor into a configuration change. A keyring whose data more than one module reads
 * lives here.
 *
 * @param bankDetails IBANs: a creator's payout account and a backer's refund account
 *     (epic #392). Its own keys rather than the address keys, so that one leaked key
 *     opens one kind of data
 */
@ConfigurationProperties(prefix = "ideanest.crypto")
public record CryptoProperties(Keyring bankDetails) {

    /** The property prefix {@link #bankDetails()} binds from, which is what its failures name. */
    public static final String BANK_DETAILS = "ideanest.crypto.bank-details";

    public CryptoProperties {
        // Absent is unconfigured, which starts. See Keyring.
        bankDetails = bankDetails == null ? Keyring.unconfigured() : bankDetails;
    }
}
