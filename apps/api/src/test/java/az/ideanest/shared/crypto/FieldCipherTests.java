package az.ideanest.shared.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.shared.api.ApiExceptionHandler;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

/**
 * The shared field cipher — #393.
 *
 * <p>A plain unit test: none of this needs a database, and every property asserted here is
 * one whose failure is silent until somebody needs the data back — a reused nonce, a
 * ciphertext that opens in the wrong row, a key that quietly falls back to another.
 */
class FieldCipherTests {

    private static final String KEYRING = "ideanest.crypto.test";

    /** Deliberately implausible as a real key, for the reason application-test.yml gives. */
    private static final byte[] OLD_KEY = "test-only-field-key-old-32-bytes".getBytes(StandardCharsets.US_ASCII);

    private static final byte[] NEW_KEY = "test-only-field-key-new-32-bytes".getBytes(StandardCharsets.US_ASCII);

    private static final String TABLE = "payout_destinations";

    private static final byte[] IBAN = "AZ21NABZ00000000137010001944".getBytes(StandardCharsets.US_ASCII);

    @Test
    @DisplayName("a sealed value opens to the same bytes, with and without a row context")
    void roundTrip() {
        FieldCipher cipher = cipher("2026-10", Map.of("2026-10", NEW_KEY));
        String row = FieldCipher.rowContext(TABLE, UUID.randomUUID());

        Sealed sealed = cipher.seal(IBAN, row);

        assertThat(sealed.keyId()).isEqualTo("2026-10");
        assertThat(sealed.nonce()).hasSize(Sealed.NONCE_LENGTH);
        // The ciphertext is the plaintext plus GCM's 16-byte tag, and is not the plaintext.
        assertThat(sealed.ciphertext()).hasSize(IBAN.length + 16);
        assertThat(Arrays.equals(sealed.ciphertext(), 0, IBAN.length, IBAN, 0, IBAN.length)).isFalse();
        assertThat(cipher.open(sealed, row)).isEqualTo(IBAN);

        assertThat(cipher.open(cipher.seal(IBAN, null), null)).isEqualTo(IBAN);
    }

    @Test
    @DisplayName("every seal draws a fresh nonce, including for the same value in the same row")
    void noncesAreNeverReused() {
        // Nonce reuse under one key is the failure that breaks GCM completely, and "the
        // value did not change" is exactly the case a naive implementation would cache.
        FieldCipher cipher = cipher("2026-10", Map.of("2026-10", NEW_KEY));
        String row = FieldCipher.rowContext(TABLE, UUID.randomUUID());
        Set<String> nonces = new HashSet<>();
        Set<String> ciphertexts = new HashSet<>();

        for (int i = 0; i < 1000; i++) {
            Sealed sealed = cipher.seal(IBAN, row);
            nonces.add(Base64.getEncoder().encodeToString(sealed.nonce()));
            ciphertexts.add(Base64.getEncoder().encodeToString(sealed.ciphertext()));
        }

        assertThat(nonces).hasSize(1000);
        assertThat(ciphertexts).hasSize(1000);
    }

    @Test
    @DisplayName("a ciphertext does not open in another row, another table, or with no context")
    void wrongAadIsRefused() {
        FieldCipher cipher = cipher("2026-10", Map.of("2026-10", NEW_KEY));
        UUID id = UUID.randomUUID();
        Sealed sealed = cipher.seal(IBAN, FieldCipher.rowContext(TABLE, id));

        // Copied into somebody else's row: the attack the row context exists for.
        assertThatThrownBy(() -> cipher.open(sealed, FieldCipher.rowContext(TABLE, UUID.randomUUID())))
                .isInstanceOf(FieldUnreadableException.class);
        assertThatThrownBy(() -> cipher.open(sealed, FieldCipher.rowContext("refund_bank_transfers", id)))
                .isInstanceOf(FieldUnreadableException.class);
        assertThatThrownBy(() -> cipher.open(sealed, null)).isInstanceOf(FieldUnreadableException.class);

        // And the other way round: sealed without context does not open with one.
        Sealed bare = cipher.seal(IBAN, null);
        assertThatThrownBy(() -> cipher.open(bare, FieldCipher.rowContext(TABLE, id)))
                .isInstanceOf(FieldUnreadableException.class);
    }

    @Test
    @DisplayName("a row naming a key the keyring does not hold is refused, never tried under the primary")
    void unknownKeyIsRefused() {
        FieldCipher before = cipher("2026-08", Map.of("2026-08", OLD_KEY));
        Sealed sealed = before.seal(IBAN, null);

        // The old key removed from the configuration: the row names a label nobody has.
        FieldCipher after = cipher("2026-10", Map.of("2026-10", NEW_KEY));

        assertThatThrownBy(() -> after.open(sealed, null))
                .isInstanceOf(FieldUnreadableException.class)
                .hasMessageContaining("2026-08")
                .hasMessageContaining(KEYRING)
                .hasMessageNotContaining("AZ21");
        Sealed relabelled = new Sealed(sealed.ciphertext(), sealed.nonce(), "2026-10");
        assertThatThrownBy(() -> after.open(relabelled, null)).isInstanceOf(FieldUnreadableException.class);
    }

    @Test
    @DisplayName("rotation: a new primary seals under the new key and the old rows still open")
    void rotationKeepsOldRowsReadable() {
        Sealed old = cipher("2026-08", Map.of("2026-08", OLD_KEY)).seal(IBAN, "t:1");

        FieldCipher rotated = cipher("2026-10", Map.of("2026-08", OLD_KEY, "2026-10", NEW_KEY));

        assertThat(rotated.open(old, "t:1")).isEqualTo(IBAN);
        assertThat(rotated.seal(IBAN, "t:1").keyId()).isEqualTo("2026-10");
    }

    @Test
    @DisplayName("a changed byte fails the tag rather than opening as a different value")
    void tamperingIsRefused() {
        FieldCipher cipher = cipher("2026-10", Map.of("2026-10", NEW_KEY));
        Sealed sealed = cipher.seal(IBAN, "t:1");
        byte[] edited = sealed.ciphertext().clone();
        edited[0] ^= 1;

        assertThatThrownBy(() -> cipher.open(new Sealed(edited, sealed.nonce(), sealed.keyId()), "t:1"))
                .isInstanceOf(FieldUnreadableException.class);
    }

    @Test
    @DisplayName("an address sealed by #75's cipher, without additional data, still opens")
    void ciphertextWithoutAadFromBeforeTheRefactorOpens() throws Exception {
        // What AesGcmAddressCipher did before #393, spelled out with the JCE directly so
        // that this test does not depend on the class it is checking against.
        byte[] nonce = new byte[Sealed.NONCE_LENGTH];
        new SecureRandom().nextBytes(nonce);
        Cipher legacy = Cipher.getInstance("AES/GCM/NoPadding");
        legacy.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(OLD_KEY, "AES"), new GCMParameterSpec(128, nonce));
        byte[] stored = legacy.doFinal(IBAN);

        FieldCipher cipher = cipher("2026-08", Map.of("2026-08", OLD_KEY));

        assertThat(cipher.open(new Sealed(stored, nonce, "2026-08"), null)).isEqualTo(IBAN);
    }

    @Test
    @DisplayName("an unconfigured keyring starts, and refuses the first write with a 503 naming the property")
    void unconfiguredKeyringRefusesWrites() {
        // What binding produces for a deployment that sets nothing under ideanest.crypto.
        CryptoProperties properties = new CryptoProperties(null);
        FieldCipher cipher = new FieldCipherConfiguration().bankDetailsCipher(properties);

        assertThat(properties.bankDetails().isConfigured()).isFalse();
        assertThat(cipher.isConfigured()).isFalse();
        assertThatThrownBy(() -> cipher.seal(IBAN, "t:1"))
                .isInstanceOfSatisfying(
                        FieldEncryptionNotConfiguredException.class,
                        e -> assertThat(e.keyring()).isEqualTo("ideanest.crypto.bank-details"));

        // Blank placeholders are an absence too, not a label.
        assertThat(new CryptoProperties(new Keyring("  ", null)).bankDetails().isConfigured()).isFalse();

        ProblemDetail problem = new ApiExceptionHandler()
                .handleEncryptionNotConfigured(new FieldEncryptionNotConfiguredException(CryptoProperties.BANK_DETAILS));
        assertThat(problem.getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE.value());
        assertThat(problem.getProperties()).containsEntry("code", "ENCRYPTED_STORAGE_UNAVAILABLE");
        assertThat(problem.getDetail()).doesNotContain("ideanest.crypto");
    }

    @Test
    @DisplayName("a keyring that names a primary it does not hold, or a short key, is refused at start-up")
    void misconfiguredKeyringsAreRefused() {
        String key = Base64.getEncoder().encodeToString(NEW_KEY);

        assertThatThrownBy(() -> new Keyring("2026-10", Map.of("2026-08", key)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Keyring("2026-10", Map.of("2026-10", "c2hvcnQ=")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Keyring("2026-10", Map.of("2026-10", "not base64!")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageNotContaining("not base64!");
        assertThatThrownBy(() -> new Keyring("Has Spaces", Map.of("Has Spaces", key)))
                .isInstanceOf(IllegalArgumentException.class);

        // And the material never reaches a log line through the record's rendering.
        assertThat(new Keyring("2026-10", Map.of("2026-10", key)).toString()).doesNotContain(key);
    }

    private static FieldCipher cipher(String primary, Map<String, byte[]> keys) {
        Map<String, String> encoded = new HashMap<>();
        keys.forEach((label, material) -> encoded.put(label, Base64.getEncoder().encodeToString(material)));
        return new AesGcmFieldCipher(KEYRING, new Keyring(primary, encoded));
    }
}
