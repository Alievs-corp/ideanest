package az.ideanest.compliance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.compliance.application.CreatorLegalSubjects;
import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.compliance.application.DestinationNameMismatchException;
import az.ideanest.compliance.application.SelfVerifiedDestinationException;
import az.ideanest.compliance.application.UnknownDestinationProviderException;
import az.ideanest.compliance.application.UnknownPayoutDestinationException;
import az.ideanest.compliance.domain.DestinationState;
import az.ideanest.compliance.domain.DestinationVerificationMethod;
import az.ideanest.compliance.domain.Iban;
import az.ideanest.compliance.domain.MalformedIbanException;
import az.ideanest.compliance.domain.PayoutDestination;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.compliance.BankAccount;
import az.ideanest.shared.compliance.DestinationKind;
import az.ideanest.shared.compliance.DestinationStanding;
import az.ideanest.shared.compliance.LegalSubject;
import az.ideanest.shared.compliance.RejectionReason;
import az.ideanest.shared.crypto.FieldEncryptionNotConfiguredException;
import az.ideanest.shared.crypto.Sealed;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.BankDetailsKeys;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import az.ideanest.user.infrastructure.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Filing a payout destination, and who may say it is the creator's — part of issue #432.
 *
 * <p>The rules under test are the ones whose failures are silent. A replacement that inherited
 * the previous verification, a reviewer waving through an account held by somebody else, and
 * somebody confirming their own — none of those produce an error anywhere, and all three end
 * with money leaving to an account nobody checked.
 */
@DisplayName("A creator's payout destination")
class CreatorPayoutDestinationTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String ADMIN_EMAIL = "moderator@ideanest.test";

    @Autowired
    private CreatorPayoutDestinations destinations;

    @Autowired
    private CreatorLegalSubjects subjects;

    @Autowired
    private UserRepository users;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    /** A bank-details key, installed by the tests that store an IBAN. */
    private BankDetailsKeys.Installed keys;

    @AfterEach
    void clear() {
        if (keys != null) {
            keys.close();
            keys = null;
        }
        Destinations.clear(dataSource);
        new JdbcTemplate(dataSource).update("DELETE FROM creator_legal_subjects");
        Campaigns.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // Filing one
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a creator with no legal subject files a destination and it waits for a reviewer")
    void filingWithNoSubjectWaits() {
        UUID creator = creator();

        PayoutDestination filed = destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");

        assertThat(filed.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
        assertThat(filed.getProvider()).isEqualTo("EPOINT");
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.AWAITING_VERIFICATION);
    }

    @Test
    @DisplayName("the provider name is normalised rather than stored as it was typed")
    void theProviderIsCanonicalised() {
        UUID creator = creator();

        PayoutDestination filed = destinations.record(creator, "  epoint ", "tok-1", "Aysel Mammadova", null);

        // A token filed as "epoint" and a payout sent through "EPOINT" is a comparison that
        // fails on nothing, which is why the vocabulary crosses from the payment module rather
        // than being trusted from the request body.
        assertThat(filed.getProvider()).isEqualTo("EPOINT");
        assertThat(filed.issuedBy("EPOINT")).isTrue();
    }

    @Test
    @DisplayName("a provider §9.3 has never heard of is refused, and the refusal names it")
    void anUnknownProviderIsRefused() {
        UUID creator = creator();

        assertThatThrownBy(() -> destinations.record(creator, "stripe", "tok-1", "Aysel Mammadova", null))
                .isInstanceOf(UnknownDestinationProviderException.class)
                .satisfies(thrown ->
                        assertThat(((UnknownDestinationProviderException) thrown).provider()).isEqualTo("stripe"));
    }

    // ------------------------------------------------------------------
    // The name match
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account holder who is not the creator's legal name is stored as a mismatch, not rejected")
    void aMismatchIsStoredRatherThanRefused() {
        UUID creator = creator();
        subjects.record(creator, LegalSubject.individual("Aysel Mammadova"));

        PayoutDestination filed = destinations.record(creator, "EPOINT", "tok-1", "Rashad Aliyev", "**4321");

        // Stored, because the two ways of refusing lead somewhere different: a rejected write
        // leaves the creator staring at a form with no record that anything happened, and a
        // stored mismatch is a row a reviewer can see, ask about and resolve.
        assertThat(filed.getState()).isEqualTo(DestinationState.NAME_MISMATCH);
        assertThat(filed.getHolderName()).isEqualTo("Rashad Aliyev");
    }

    @Test
    @DisplayName("case and spacing do not make a mismatch")
    void presentationIsForgiven() {
        UUID creator = creator();
        subjects.record(creator, LegalSubject.individual("Aysel Mammadova"));

        PayoutDestination filed = destinations.record(creator, "EPOINT", "tok-1", "  AYSEL   MAMMADOVA ", null);

        // LegalSubject.nameMatches is deliberately forgiving about presentation and about
        // nothing else. A MISMATCHED_NAME that means "you pressed shift" is how a real refusal
        // stops being read.
        assertThat(filed.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
    }

    @Test
    @DisplayName("a reviewer cannot confirm an account held by a differently named party")
    void aReviewerCannotWaveThroughAMismatch() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        subjects.record(creator, LegalSubject.individual("Aysel Mammadova"));
        destinations.record(creator, "EPOINT", "tok-1", "Rashad Aliyev", null);

        // The control that would otherwise report rather than enforce. There are two honest
        // ways past it — the creator corrects a name, or an administrator grants #436's
        // override — and both leave a trail. Clicking through is not one of them.
        assertThatThrownBy(() ->
                        destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED))
                .isInstanceOf(DestinationNameMismatchException.class)
                .satisfies(thrown ->
                        assertThat(((DestinationNameMismatchException) thrown).holderName()).isEqualTo("Rashad Aliyev"));
    }

    // ------------------------------------------------------------------
    // Confirming, refusing, and replacing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reviewer confirms it, and the row records who, how and when")
    void aConfirmationRecordsItsMechanism() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");

        PayoutDestination verified =
                destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED);

        assertThat(verified.getState()).isEqualTo(DestinationState.VERIFIED);
        assertThat(verified.getVerifiedBy()).isEqualTo(reviewer);
        assertThat(verified.getVerifiedAt()).isNotNull();
        // #432 asks the row to carry which mechanism verified it. A column that said only
        // "verified" would answer an investigation with the least useful of three truths.
        assertThat(verified.verifiedHow()).contains(DestinationVerificationMethod.STAFF_ATTESTED);
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.VERIFIED);
    }

    @Test
    @DisplayName("replacing the account clears the verification rather than inheriting it")
    void replacingResetsTheVerification() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");
        destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED);
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.VERIFIED);

        PayoutDestination replaced = destinations.record(creator, "EPOINT", "tok-2", "Aysel Mammadova", "**9876");

        // The invisible bug this asserts against: a destination verified in March, swapped in
        // June, still reading VERIFIED, looks like a perfectly ordinary row — and is the exact
        // fraud #432 exists to stop.
        assertThat(replaced.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
        assertThat(replaced.getVerifiedAt()).isNull();
        assertThat(replaced.getVerifiedBy()).isNull();
        assertThat(replaced.verifiedHow()).isEmpty();
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.AWAITING_VERIFICATION);
    }

    @Test
    @DisplayName("re-filing the identical account still resets, because the reason to re-file is unknown")
    void anIdenticalReFilingAlsoResets() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");
        destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED);

        PayoutDestination again = destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");

        assertThat(again.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
    }

    @Test
    @DisplayName("a refusal carries a reason from V58's closed set")
    void aRefusalCarriesItsReason() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", null);

        PayoutDestination rejected = destinations.reject(reviewer, creator, RejectionReason.INCOMPLETE);

        assertThat(rejected.getState()).isEqualTo(DestinationState.REJECTED);
        assertThat(rejected.rejection()).contains(RejectionReason.INCOMPLETE);
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.REJECTED);
    }

    // ------------------------------------------------------------------
    // Who may decide
    // ------------------------------------------------------------------

    @Test
    @DisplayName("nobody confirms their own destination")
    void nobodyConfirmsTheirOwn() {
        UUID reviewer = complianceReviewer();
        destinations.record(reviewer, "EPOINT", "tok-1", "Compliance Reviewer", null);

        // V66: "A member of staff may also be a creator. Nothing stops that and nothing
        // should. What must stop is one of them approving their own."
        assertThatThrownBy(() ->
                        destinations.verify(reviewer, reviewer, DestinationVerificationMethod.STAFF_ATTESTED))
                .isInstanceOf(SelfVerifiedDestinationException.class);
    }

    @Test
    @DisplayName("finance cannot confirm a destination, which is the whole point of V66's split")
    void financeMayNotConfirm() {
        UUID creator = creator();
        UUID financeOfficer = staff("finance-dest", StaffRole.FINANCE);
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", null);

        // The person who confirms that an account belongs to the creator it is filed under is
        // not the person who sends money to it. FINANCE holds APPROVE_PAYOUT's neighbours and
        // deliberately not VERIFY_PAYOUT_DESTINATION.
        assertThatThrownBy(() ->
                        destinations.verify(financeOfficer, creator, DestinationVerificationMethod.STAFF_ATTESTED))
                .isInstanceOf(InsufficientStaffCapabilityException.class);
    }

    @Test
    @DisplayName("confirming a destination that is not there is a refusal a reload answers")
    void confirmingNothingIsRefused() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();

        assertThatThrownBy(() ->
                        destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED))
                .isInstanceOf(UnknownPayoutDestinationException.class);
    }

    // ------------------------------------------------------------------
    // A bank account (#394)
    // ------------------------------------------------------------------

    private static final String IBAN = "AZ21NABZ00000000137010001944";

    @Test
    @DisplayName("a creator files an IBAN; it is sealed, fingerprinted, and only the hint is readable")
    void aBankAccountIsSealed() {
        keys = BankDetailsKeys.install(destinations);
        UUID creator = creator();

        PayoutDestination filed = destinations.recordBankAccount(creator, "az21 nabz 0000 0000 1370 1000 1944", "Aysel Mammadova");

        assertThat(filed.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
        assertThat(filed.kind()).isEqualTo(DestinationKind.BANK_TRANSFER);
        assertThat(filed.getProvider()).isEqualTo("BANK_TRANSFER");
        assertThat(filed.getDisplayHint()).isEqualTo("AZ21…1944");
        assertThat(destinations.kindOf(creator)).contains(DestinationKind.BANK_TRANSFER);

        // What is in the row: no IBAN anywhere a SELECT would show it.
        Map<String, Object> row = new JdbcTemplate(dataSource)
                .queryForMap("SELECT * FROM payout_destinations WHERE user_id = ?", creator);
        assertThat(row.values()).noneSatisfy(value -> assertThat(String.valueOf(value)).contains("NABZ0000"));
        assertThat((byte[]) row.get("account_ciphertext"))
                .isNotEmpty()
                .satisfies(bytes -> assertThat(new String(bytes, StandardCharsets.ISO_8859_1)).doesNotContain(IBAN));
        assertThat(row.get("account_key_id")).isEqualTo(BankDetailsKeys.LABEL);
        // The reference is the keyed fingerprint, under the key it was made with.
        assertThat(row.get("reference")).isEqualTo(BankDetailsKeys.fingerprints().of(IBAN));
        assertThat((String) row.get("reference")).startsWith(BankDetailsKeys.LABEL + ":").doesNotContain("NABZ");

        // And it opens, with this creator's row as the additional data and with nothing else.
        Sealed sealed = filed.sealedAccount().orElseThrow();
        assertThat(new String(
                        BankDetailsKeys.cipher().open(sealed, PayoutDestination.accountContext(creator)),
                        StandardCharsets.UTF_8))
                .isEqualTo(IBAN);
        assertThatThrownBy(() -> BankDetailsKeys.cipher().open(sealed, PayoutDestination.accountContext(creator())))
                .isInstanceOf(az.ideanest.shared.crypto.FieldUnreadableException.class);

        // The trail carries the hint, never the number.
        String detail = auditDetail("compliance.payout_destination_recorded", creator);
        assertThat(detail).contains("account=AZ21…1944").contains("sameAccountElsewhere=0").doesNotContain("NABZ");
    }

    @Test
    @DisplayName("without a bank-details key nothing is stored, and what was on file stays")
    void withoutAKeyNothingChanges() {
        UUID creator = creator();
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");

        assertThatThrownBy(() -> destinations.recordBankAccount(creator, IBAN, "Aysel Mammadova"))
                .isInstanceOf(FieldEncryptionNotConfiguredException.class);

        // Never stored in the clear to satisfy the request, and the token on file is untouched.
        PayoutDestination still = destinations.mine(creator).orElseThrow();
        assertThat(still.kind()).isEqualTo(DestinationKind.PROVIDER_TOKEN);
        assertThat(still.getReference()).isEqualTo("tok-1");
    }

    @Test
    @DisplayName("an IBAN that is not Azerbaijani, or not an IBAN, is refused before anything is written")
    void aBadIbanIsRefused() {
        keys = BankDetailsKeys.install(destinations);
        UUID creator = creator();

        assertThatThrownBy(() -> destinations.recordBankAccount(creator, "GB82WEST12345698765432", "Aysel Mammadova"))
                .isInstanceOf(MalformedIbanException.class)
                .satisfies(thrown -> assertThat(((MalformedIbanException) thrown).defect())
                        .isEqualTo(Iban.Defect.COUNTRY_NOT_ACCEPTED));
        assertThatThrownBy(() -> destinations.recordBankAccount(creator, "AZ21NABZ00000000137010001945", "Aysel Mammadova"))
                .isInstanceOf(MalformedIbanException.class);

        assertThat(destinations.mine(creator)).isEmpty();
    }

    @Test
    @DisplayName("an account holder who is not the creator's legal name is a mismatch, as for a token")
    void aBankAccountMismatchIsStored() {
        keys = BankDetailsKeys.install(destinations);
        UUID creator = creator();
        subjects.record(creator, LegalSubject.individual("Aysel Mammadova"));

        PayoutDestination filed = destinations.recordBankAccount(creator, IBAN, "Rashad Aliyev");

        assertThat(filed.getState()).isEqualTo(DestinationState.NAME_MISMATCH);
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.NAME_MISMATCH);
    }

    @Test
    @DisplayName("an IBAN filed over a verified token clears the verification, and a token over an IBAN clears the IBAN")
    void replacingAcrossKindsResets() {
        keys = BankDetailsKeys.install(destinations);
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");
        destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED);

        PayoutDestination bank = destinations.recordBankAccount(creator, IBAN, "Aysel Mammadova");

        assertThat(bank.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
        assertThat(bank.getVerifiedBy()).isNull();
        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.AWAITING_VERIFICATION);

        destinations.verify(reviewer, creator, DestinationVerificationMethod.STAFF_ATTESTED);
        PayoutDestination token = destinations.record(creator, "EPOINT", "tok-2", "Aysel Mammadova", "**9876");

        // The sealed account goes with the replacement: a token never sits beside an IBAN.
        assertThat(token.getState()).isEqualTo(DestinationState.AWAITING_VERIFICATION);
        assertThat(token.sealedAccount()).isEmpty();
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT account_ciphertext IS NULL FROM payout_destinations WHERE user_id = ?",
                                Boolean.class,
                                creator))
                .isTrue();
    }

    @Test
    @DisplayName("a verified bank account releases the payout and is never offered to a provider as a token")
    void aBankAccountIsNotAProviderReference() {
        keys = BankDetailsKeys.install(destinations);
        UUID creator = creator();
        destinations.recordBankAccount(creator, IBAN, "Aysel Mammadova");
        destinations.verify(complianceReviewer(), creator, DestinationVerificationMethod.STAFF_ATTESTED);

        assertThat(destinations.standingOf(creator)).isEqualTo(DestinationStanding.VERIFIED);
        // A fingerprint is not somewhere money can be sent, through any provider or none.
        for (String provider : List.of("AZERICARD", "EPOINT", "PAYRIFF", "BANK_TRANSFER")) {
            assertThat(destinations.referenceFor(creator, provider)).isEmpty();
        }
    }

    @Test
    @DisplayName("compliance and finance open the IBAN, the opening is audited with the hint, and a moderator cannot")
    void revealingIsCapabilityCheckedAndAudited() {
        keys = BankDetailsKeys.install(destinations);
        UUID creator = creator();
        destinations.recordBankAccount(creator, IBAN, "Aysel Mammadova");

        BankAccount seenByCompliance =
                destinations.revealBankAccount(complianceReviewer(), creator).orElseThrow();
        BankAccount seenByFinance =
                destinations.revealBankAccount(staff("finance-dest", StaffRole.FINANCE), creator).orElseThrow();

        assertThat(seenByCompliance.iban()).isEqualTo(IBAN);
        assertThat(seenByCompliance.holderName()).isEqualTo("Aysel Mammadova");
        assertThat(seenByFinance).isEqualTo(seenByCompliance);
        assertThat(seenByCompliance.toString()).doesNotContain(IBAN);

        String detail = auditDetail("compliance.payout_destination_account_revealed", creator);
        assertThat(detail).contains("AZ21…1944").doesNotContain("NABZ");

        UUID moderator = staff("moderator-dest", StaffRole.MODERATOR);
        assertThatThrownBy(() -> destinations.revealBankAccount(moderator, creator))
                .isInstanceOf(InsufficientStaffCapabilityException.class);
    }

    @Test
    @DisplayName("a token has no account to reveal, and nothing filed has none either")
    void revealingATokenIsEmpty() {
        UUID creator = creator();
        UUID reviewer = complianceReviewer();
        assertThat(destinations.revealBankAccount(reviewer, creator)).isEmpty();
        assertThat(destinations.kindOf(creator)).isEmpty();

        destinations.record(creator, "EPOINT", "tok-1", "Aysel Mammadova", "**4321");

        assertThat(destinations.revealBankAccount(reviewer, creator)).isEmpty();
        assertThat(destinations.kindOf(creator)).contains(DestinationKind.PROVIDER_TOKEN);
    }

    @Test
    @DisplayName("a second account filing the same IBAN is counted in the trail for the reviewer")
    void theSameAccountTwiceIsNoticed() {
        keys = BankDetailsKeys.install(destinations);
        UUID first = creator();
        UUID second = creator();
        destinations.recordBankAccount(first, IBAN, "Aysel Mammadova");

        destinations.recordBankAccount(second, "AZ21 NABZ 0000 0000 1370 1000 1944", "Aysel Mammadova");

        assertThat(auditDetail("compliance.payout_destination_recorded", second)).contains("sameAccountElsewhere=1");
    }

    private String auditDetail(String action, UUID entity) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT detail FROM audit_logs WHERE action = ? AND entity_id = ? ORDER BY occurred_at DESC LIMIT 1",
                        String.class,
                        action,
                        entity);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private UUID creator() {
        return Campaigns.creator(dataSource, "payout-destination" + SEQUENCE.incrementAndGet());
    }

    /** A member of staff holding COMPLIANCE, which is what V66 gave the capability to. */
    private UUID complianceReviewer() {
        return staff("compliance-dest", StaffRole.COMPLIANCE);
    }

    /**
     * A staff account with one role, granted with SQL.
     *
     * <p>{@code PayoutDualApprovalApiTests}' argument: {@code StaffRoleRepository.grantIfAbsent}
     * is {@code @Modifying} and expects the transaction its service supplies, and a test method
     * is not in one. Opening one here would wrap a transaction around the thing under test as
     * well.
     */
    private UUID staff(String slug, StaffRole role) {
        EmailAddress email = EmailAddress.of(slug + "@ideanest.test");
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test " + role.name()),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT DO NOTHING
                        """,
                        id,
                        role.name(),
                        administrator(),
                        "#432 fixture");
        return id;
    }

    /** The bootstrap administrator, registered once and reused. See {@code Verifications}. */
    private UUID administrator() {
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        return users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
    }
}
