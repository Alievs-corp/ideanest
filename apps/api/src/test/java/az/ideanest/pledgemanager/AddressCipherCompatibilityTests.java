package az.ideanest.pledgemanager;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.pledgemanager.application.AddressStorageNotConfiguredException;
import az.ideanest.pledgemanager.application.AddressUnreadableException;
import az.ideanest.pledgemanager.domain.PostalAddress;
import az.ideanest.pledgemanager.domain.SealedAddress;
import az.ideanest.pledgemanager.infrastructure.AesGcmAddressCipher;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The address cipher after #393 moved its parameters into the shared field cipher.
 *
 * <p>The one thing that refactor must not change is whether a row already in
 * {@code shipping_addresses} opens. {@code ShippingAddressApiTests} proves the feature
 * round-trips through the new code; this proves a ciphertext produced the way #75
 * produced it — AES-256-GCM, 128-bit tag, 12-byte nonce, no additional data — still opens.
 */
class AddressCipherCompatibilityTests {

    private static final byte[] KEY = "test-only-address-key-32-bytes!!".getBytes(StandardCharsets.US_ASCII);

    private static final ObjectMapper JSON = JsonMapper.builder().build();

    private static final PostalAddress ADDRESS =
            new PostalAddress("Aysel Məmmədova", "Nizami küçəsi 10", null, "Bakı", null, "AZ1000", "AZ", null);

    @Test
    @DisplayName("an address sealed before #393 opens unchanged")
    void rowsSealedBeforeTheRefactorOpen() throws Exception {
        byte[] nonce = new byte[12];
        new SecureRandom().nextBytes(nonce);
        Cipher legacy = Cipher.getInstance("AES/GCM/NoPadding");
        legacy.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(KEY, "AES"), new GCMParameterSpec(128, nonce));
        byte[] stored = legacy.doFinal(JSON.writeValueAsBytes(ADDRESS));

        AesGcmAddressCipher cipher = cipher(new PledgeManagerProperties.Addresses("2026-08", keys()));

        assertThat(cipher.open(new SealedAddress(stored, nonce, "2026-08"))).isEqualTo(ADDRESS);
    }

    @Test
    @DisplayName("an address sealed now is still sealed without additional data")
    void newRowsAreSealedTheSameWay() throws Exception {
        AesGcmAddressCipher cipher = cipher(new PledgeManagerProperties.Addresses("2026-08", keys()));
        SealedAddress sealed = cipher.seal(ADDRESS);

        // Opened by the bare JCE with no AAD: a version of this code that started binding
        // addresses to their row would fail here, before it made a restore impossible.
        Cipher plain = Cipher.getInstance("AES/GCM/NoPadding");
        plain.init(Cipher.DECRYPT_MODE, new SecretKeySpec(KEY, "AES"), new GCMParameterSpec(128, sealed.nonce()));

        assertThat(sealed.keyId()).isEqualTo("2026-08");
        assertThat(JSON.readValue(plain.doFinal(sealed.ciphertext()), PostalAddress.class)).isEqualTo(ADDRESS);
    }

    @Test
    @DisplayName("the address exceptions are unchanged: 503's when unconfigured, 500's when unreadable")
    void failuresKeepTheirAddressExceptions() {
        AesGcmAddressCipher unconfigured = cipher(PledgeManagerProperties.Addresses.unconfigured());
        assertThatThrownBy(() -> unconfigured.seal(ADDRESS)).isInstanceOf(AddressStorageNotConfiguredException.class);

        AesGcmAddressCipher configured = cipher(new PledgeManagerProperties.Addresses("2026-08", keys()));
        SealedAddress sealed = configured.seal(ADDRESS);
        assertThatThrownBy(() -> configured.open(new SealedAddress(sealed.ciphertext(), sealed.nonce(), "gone")))
                .isInstanceOf(AddressUnreadableException.class)
                .hasMessageContaining("gone");
    }

    private static Map<String, String> keys() {
        return Map.of("2026-08", Base64.getEncoder().encodeToString(KEY));
    }

    private static AesGcmAddressCipher cipher(PledgeManagerProperties.Addresses addresses) {
        return new AesGcmAddressCipher(JSON, new PledgeManagerProperties(null, addresses, null));
    }
}
