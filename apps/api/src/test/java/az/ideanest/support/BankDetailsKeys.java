package az.ideanest.support;

import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.shared.crypto.AesGcmFieldCipher;
import az.ideanest.shared.crypto.CryptoProperties;
import az.ideanest.shared.crypto.FieldCipher;
import az.ideanest.shared.crypto.FieldFingerprints;
import az.ideanest.shared.crypto.Keyring;
import java.util.Map;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * A {@code bank-details} key for the tests that store an IBAN, and only for them — #394.
 *
 * <p>The suite's configuration deliberately has no bank-details key, so that the 503 a
 * deployment without one answers is what the shared context does, and is asserted. A test that
 * files a bank account installs a key on the one service that seals it, for its own duration,
 * and puts the unconfigured cipher back afterwards. Swapping the collaborators rather than
 * adding a property keeps every integration test on one Spring context and one PostgreSQL
 * container — {@code AbstractIntegrationTest} explains why that matters.
 *
 * <p>Thirty-two bytes of base64 that nothing would mistake for a real key, for the address
 * key's reason in {@code application-test.yml}.
 */
public final class BankDetailsKeys {

    /** The label the test key is filed under. */
    public static final String LABEL = "t1";

    /** A keyring with one test key, which is its primary. */
    public static final Keyring KEYRING =
            new Keyring(LABEL, Map.of(LABEL, "dGVzdC1vbmx5LWJhbmstZGV0YWlscy1rZXktMzJiISE="));

    private BankDetailsKeys() {
    }

    /**
     * Gives the service a configured cipher and fingerprints, and returns what puts the
     * originals back. Use it in a {@code try}-with-resources or close it in {@code @AfterEach}.
     */
    public static Installed install(CreatorPayoutDestinations destinations) {
        Object target = AopTestUtils.getUltimateTargetObject(destinations);
        Object cipher = ReflectionTestUtils.getField(target, "bankDetails");
        Object fingerprints = ReflectionTestUtils.getField(target, "fingerprints");
        ReflectionTestUtils.setField(target, "bankDetails", cipher());
        ReflectionTestUtils.setField(target, "fingerprints", fingerprints());
        return () -> {
            ReflectionTestUtils.setField(target, "bankDetails", cipher);
            ReflectionTestUtils.setField(target, "fingerprints", fingerprints);
        };
    }

    /** The test keyring's cipher, for a test that opens what the service sealed. */
    public static FieldCipher cipher() {
        return new AesGcmFieldCipher(CryptoProperties.BANK_DETAILS, KEYRING);
    }

    /** The test keyring's fingerprints, for a test that compares what the service stored. */
    public static FieldFingerprints fingerprints() {
        return new FieldFingerprints(CryptoProperties.BANK_DETAILS, KEYRING, "iban");
    }

    /** Puts the deployment's own, unconfigured, collaborators back. */
    @FunctionalInterface
    public interface Installed extends AutoCloseable {
        @Override
        void close();
    }
}
