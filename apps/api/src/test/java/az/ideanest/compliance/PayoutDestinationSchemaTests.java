package az.ideanest.compliance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.compliance.domain.DestinationState;
import az.ideanest.compliance.domain.DestinationVerificationMethod;
import az.ideanest.payment.application.PaymentProviders;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.shared.compliance.DestinationKind;
import az.ideanest.shared.compliance.RejectionReason;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * V72's closed sets and the enums they repeat, checked against each other — part of #432.
 *
 * <p><strong>Three vocabularies are written down twice</strong>, and each of the pairs is one
 * somebody will one day extend on one side only. The provider is the dangerous one: adding a
 * value to {@code ProviderName} without touching the constraint fails at the first insert
 * against the new provider, in production, on a creator's settings screen. This turns that into
 * a test failure.
 *
 * <p>The duplication is deliberate rather than an accident to be refactored away.
 * {@code ProviderName} is {@code payment.domain} and the compliance module may not name it —
 * {@code ModuleBoundaryTests} — so the column is a string with a CHECK on it, and this suite is
 * what makes the string as safe as the enum would have been.
 */
@DisplayName("V72's vocabularies")
class PayoutDestinationSchemaTests extends AbstractIntegrationTest {

    /** Pulls the quoted values out of a {@code CHECK (col IN ('A', 'B'))} clause. */
    private static final Pattern QUOTED = Pattern.compile("'([A-Z_]+)'");

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        Destinations.clear(dataSource);
    }

    @Test
    @DisplayName("the provider constraint lists exactly §9.3's providers")
    void theProviderConstraintMatchesTheEnum() {
        Set<String> constrained = valuesIn("payout_destinations_provider_known");

        Set<String> declared =
                Arrays.stream(ProviderName.values()).map(Enum::name).collect(Collectors.toSet());

        assertThat(constrained)
                .withFailMessage(
                        "V72's provider CHECK and ProviderName have drifted. Constraint: %s. Enum: %s. "
                                + "Adding a provider needs a migration that widens the constraint.",
                        constrained, declared)
                .isEqualTo(declared);
    }

    @Test
    @DisplayName("PaymentProviders publishes the same vocabulary the constraint enforces")
    void theCrossModuleQuestionAgreesWithBoth() {
        // The compliance module never sees ProviderName; what it sees is this method. If the
        // two ever disagreed, a creator could file a destination the database then refused.
        for (ProviderName provider : ProviderName.values()) {
            if (!provider.isAdapter()) {
                continue;
            }
            assertThat(PaymentProviders.canonicalNameOf(provider.name().toLowerCase(Locale.ROOT)))
                    .contains(provider.name());
        }
        // #394: the bank is in the constraint and is not a token's issuer. A bank account is
        // filed with its IBAN, sealed, through its own endpoint.
        assertThat(PaymentProviders.canonicalNameOf("bank_transfer")).isEmpty();
        assertThat(PaymentProviders.canonicalNameOf("stripe")).isEmpty();
        assertThat(PaymentProviders.canonicalNameOf(null)).isEmpty();
    }

    @Test
    @DisplayName("#394: the bank transfer is spelled the same in the enum, the shared contract and the column")
    void theBankTransferIsOneSpelling() {
        // The compliance module writes DestinationKind.BANK_TRANSFER's name into `provider`; the
        // payment module will record transactions as ProviderName.BANK_TRANSFER. One string.
        assertThat(ProviderName.valueOf(DestinationKind.BANK_TRANSFER.name())).isEqualTo(ProviderName.BANK_TRANSFER);
        assertThat(ProviderName.BANK_TRANSFER.isAdapter()).isFalse();
        assertThat(valuesIn("payout_destinations_provider_known")).contains(DestinationKind.BANK_TRANSFER.name());
    }

    @Test
    @DisplayName("#394: a sealed account is present exactly when the destination is a bank transfer")
    void theSealedAccountBelongsOnlyToABankTransfer() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        // A bank transfer with no account: a payout with nowhere to go.
        UUID bankWithoutAccount = Campaigns.creator(dataSource, "schema-bank-empty-" + UUID.randomUUID().toString().substring(0, 8));
        assertThatThrownBy(() -> insert(jdbc, bankWithoutAccount, "BANK_TRANSFER", null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("payout_destinations_account_only_for_bank_transfer");

        // A token with an IBAN still sealed beside it: what a replacement that forgot to clear it
        // would leave behind.
        UUID tokenWithAccount = Campaigns.creator(dataSource, "schema-token-sealed-" + UUID.randomUUID().toString().substring(0, 8));
        assertThatThrownBy(() -> insert(jdbc, tokenWithAccount, "EPOINT", new byte[] {1}, new byte[12], "t1"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("payout_destinations_account_only_for_bank_transfer");

        // Half an envelope, and a nonce GCM would not have produced.
        UUID halfSealed = Campaigns.creator(dataSource, "schema-half-" + UUID.randomUUID().toString().substring(0, 8));
        assertThatThrownBy(() -> insert(jdbc, halfSealed, "BANK_TRANSFER", new byte[] {1}, null, "t1"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("payout_destinations_account_is_whole");
        assertThatThrownBy(() -> insert(jdbc, halfSealed, "BANK_TRANSFER", new byte[] {1}, new byte[8], "t1"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("payout_destinations_account_nonce_length");

        // And the whole shape is accepted.
        UUID sealed = Campaigns.creator(dataSource, "schema-sealed-" + UUID.randomUUID().toString().substring(0, 8));
        insert(jdbc, sealed, "BANK_TRANSFER", new byte[] {1, 2, 3}, new byte[12], "t1");
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM payout_destinations WHERE user_id = ?", Integer.class, sealed))
                .isEqualTo(1);
    }

    private static void insert(
            JdbcTemplate jdbc, UUID userId, String provider, byte[] ciphertext, byte[] nonce, String keyId) {
        jdbc.update(
                """
                INSERT INTO payout_destinations
                    (user_id, provider, reference, holder_name, display_hint, state,
                     account_ciphertext, account_nonce, account_key_id)
                VALUES (?, ?, 't1:fingerprint', 'Aysel Mammadova', 'AZ21…1944', 'AWAITING_VERIFICATION', ?, ?, ?)
                """,
                userId,
                provider,
                ciphertext,
                nonce,
                keyId);
    }

    @Test
    @DisplayName("the state constraint lists exactly the states a row can be in")
    void theStateConstraintMatchesTheEnum() {
        assertThat(valuesIn("payout_destinations_state_known"))
                .isEqualTo(Arrays.stream(DestinationState.values())
                        .map(Enum::name)
                        .collect(Collectors.toSet()));
    }

    @Test
    @DisplayName("the verification-method constraint lists exactly the three mechanisms")
    void theMethodConstraintMatchesTheEnum() {
        // Including the two that nothing writes yet. They are values because the column has to
        // describe what a stored row means, and a row written by the micro-transfer once it
        // exists must not read the same as one a person attested to by eye.
        assertThat(valuesIn("payout_destinations_method_known"))
                .isEqualTo(Arrays.stream(DestinationVerificationMethod.values())
                        .map(Enum::name)
                        .collect(Collectors.toSet()));
    }

    @Test
    @DisplayName("the rejection-reason constraint lists exactly V58's closed set")
    void theRejectionConstraintMatchesTheEnum() {
        assertThat(valuesIn("payout_destinations_rejection_known"))
                .isEqualTo(Arrays.stream(RejectionReason.values())
                        .map(Enum::name)
                        .collect(Collectors.toSet()));
    }

    /** The quoted values inside one named CHECK constraint, as PostgreSQL renders it back. */
    private Set<String> valuesIn(String constraintName) {
        String definition = new JdbcTemplate(dataSource)
                .queryForObject(
                        """
                        SELECT pg_get_constraintdef(oid)
                          FROM pg_constraint
                         WHERE conname = ?
                        """,
                        String.class,
                        constraintName);

        assertThat(definition)
                .withFailMessage("No constraint called %s. V72 renamed or dropped it.", constraintName)
                .isNotNull();

        Matcher matcher = QUOTED.matcher(definition);
        List<String> found = new java.util.ArrayList<>();
        while (matcher.find()) {
            found.add(matcher.group(1));
        }
        return Set.copyOf(found);
    }
}
