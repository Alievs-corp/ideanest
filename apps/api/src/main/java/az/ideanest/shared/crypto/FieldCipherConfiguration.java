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
}
