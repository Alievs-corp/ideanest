package az.ideanest.shared.crypto;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * One {@link FieldCipher} bean per shared keyring, each under its own name.
 *
 * <p>Injected by qualifier — {@code @Qualifier(FieldCipherConfiguration.BANK_DETAILS)} —
 * rather than by type alone, because the second keyring would otherwise turn every
 * injection point into an ambiguity, and the fix somebody reaches for under pressure is
 * {@code @Primary}, which seals everything under whichever keyring won.
 */
@Configuration(proxyBeanMethods = false)
public class FieldCipherConfiguration {

    /** The bean that seals IBANs under {@link CryptoProperties#BANK_DETAILS}. */
    public static final String BANK_DETAILS = "bankDetailsCipher";

    @Bean(BANK_DETAILS)
    public FieldCipher bankDetailsCipher(CryptoProperties properties) {
        return new AesGcmFieldCipher(CryptoProperties.BANK_DETAILS, properties.bankDetails());
    }

    /**
     * The bean that fingerprints IBANs, under keys derived from the same keyring (#394).
     *
     * <p>Derived rather than configured separately: one secret to provision, one rotation,
     * and a deployment cannot have the cipher without the fingerprint or the other way round.
     */
    public static final String BANK_DETAILS_FINGERPRINTS = "bankDetailsFingerprints";

    @Bean(BANK_DETAILS_FINGERPRINTS)
    public FieldFingerprints bankDetailsFingerprints(CryptoProperties properties) {
        return new FieldFingerprints(CryptoProperties.BANK_DETAILS, properties.bankDetails(), "iban");
    }
}
