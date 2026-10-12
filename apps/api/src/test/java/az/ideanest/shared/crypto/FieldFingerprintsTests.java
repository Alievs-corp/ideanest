package az.ideanest.shared.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Keyed fingerprints of an encrypted field — #394.
 *
 * <p>A plain unit test. What matters is that equal values compare equal, that nothing
 * without the key can produce the same string, and that a rotation does not lose a match.
 */
@DisplayName("A field fingerprint")
class FieldFingerprintsTests {

    private static final String FIRST = "dGVzdC1vbmx5LWJhbmstZGV0YWlscy1rZXktMzJiISE=";
    private static final String SECOND = "dGVzdC1vbmx5LXNlY29uZC1iYW5rLWtleS0zMmIhISE=";
    private static final String IBAN = "AZ21NABZ00000000137010001944";

    @Test
    @DisplayName("is stable for one value, differs between values, and carries its key's label")
    void isStableAndLabelled() {
        FieldFingerprints fingerprints = fingerprints(new Keyring("b1", Map.of("b1", FIRST)), "iban");

        String fingerprint = fingerprints.of(IBAN);

        assertThat(fingerprint).isEqualTo(fingerprints.of(IBAN)).startsWith("b1:").hasSize(3 + 64);
        assertThat(fingerprint).doesNotContain("NABZ");
        assertThat(fingerprints.of("AZ21NABZ00000000137010001945")).isNotEqualTo(fingerprint);
    }

    @Test
    @DisplayName("depends on the key and on the purpose, so it is useless without the key")
    void dependsOnKeyAndPurpose() {
        String underFirst = fingerprints(new Keyring("b1", Map.of("b1", FIRST)), "iban").of(IBAN);
        String underSecond = fingerprints(new Keyring("b1", Map.of("b1", SECOND)), "iban").of(IBAN);
        String otherPurpose = fingerprints(new Keyring("b1", Map.of("b1", FIRST)), "other").of(IBAN);

        assertThat(underSecond).isNotEqualTo(underFirst);
        assertThat(otherPurpose).isNotEqualTo(underFirst);
    }

    @Test
    @DisplayName("still finds a value fingerprinted before a rotation")
    void survivesRotation() {
        String before = fingerprints(new Keyring("b1", Map.of("b1", FIRST)), "iban").of(IBAN);
        FieldFingerprints rotated = fingerprints(new Keyring("b2", Map.of("b1", FIRST, "b2", SECOND)), "iban");

        assertThat(rotated.of(IBAN)).startsWith("b2:").isNotEqualTo(before);
        assertThat(rotated.candidates(IBAN)).contains(before, rotated.of(IBAN)).hasSize(2);
    }

    @Test
    @DisplayName("refuses to fingerprint without a key, as sealing does, and finds nothing")
    void refusesWhenUnconfigured() {
        FieldFingerprints unconfigured = fingerprints(Keyring.unconfigured(), "iban");

        assertThat(unconfigured.isConfigured()).isFalse();
        assertThatThrownBy(() -> unconfigured.of(IBAN)).isInstanceOf(FieldEncryptionNotConfiguredException.class);
        assertThat(unconfigured.candidates(IBAN)).isEmpty();
    }

    private static FieldFingerprints fingerprints(Keyring keyring, String purpose) {
        return new FieldFingerprints(CryptoProperties.BANK_DETAILS, keyring, purpose);
    }
}
