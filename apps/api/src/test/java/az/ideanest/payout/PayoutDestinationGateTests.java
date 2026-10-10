package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.compliance.application.ComplianceOverrides;
import az.ideanest.compliance.domain.OverrideReason;
import az.ideanest.payout.application.PayoutDestinationNotVerifiedException;
import az.ideanest.payout.application.PayoutService;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutState;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.compliance.ComplianceRequirement;
import az.ideanest.shared.compliance.DestinationStanding;
import az.ideanest.shared.compliance.PayoutDestinations;
import az.ideanest.shared.money.Money;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import az.ideanest.support.Verifications;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
 * Money leaves only to an account the creator supplied and somebody confirmed — part of #432.
 *
 * <p>{@code PayoutVerificationGateTests}' companion, one question along. That suite asks
 * whether the platform has established <em>who</em> the creator is; this asks whether it has
 * established <em>where</em> their money goes. The two gates sit side by side in front of
 * {@code approve} and are deliberately separate: they hold a payout for different reasons and
 * are resolved by different people.
 *
 * <h2>What was wrong before, and why a test could not have caught it</h2>
 *
 * <p>{@code send} took a {@code String destinationReference} that an operator typed into the
 * console at the moment of sending. There was nothing to assert about it: no row, no owner, no
 * check — the value went straight to the provider and was never stored. §4.11's dual approval
 * was intact and hollow, because the two signatures were on an amount and the destination was
 * chosen afterwards by one of the signatories.
 *
 * <p>Every case below is a state transition or a gate, which CLAUDE.md names as not optional to
 * test because they "fail silently and expensively". A payout sent to the wrong account is the
 * most expensive silent failure on the platform.
 */
@DisplayName("The payout's destination gate")
class PayoutDestinationGateTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final Money HUNDRED = Money.of(new BigDecimal("100.00"), "AZN");
    private static final String ADMINISTRATOR_EMAIL = "moderator@ideanest.test";

    @Autowired
    private PayoutService payouts;

    @Autowired
    private PayoutRepository payoutRows;

    @Autowired
    private PayoutDestinations destinations;

    @Autowired
    private ComplianceOverrides overrides;

    @Autowired
    private UserRepository users;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM payout_approvals");
        jdbc.update("DELETE FROM payouts");
        jdbc.update("DELETE FROM compliance_overrides");
        jdbc.update("DELETE FROM identity_verifications");
        Destinations.clear(dataSource);
        Campaigns.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // What releases, and what holds
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a confirmed destination lets the payout be approved")
    void confirmedReleases() {
        Held held = heldPayout();
        Destinations.verified(dataSource, held.creatorId(), administrator(), "Test Creator");

        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.VERIFIED);

        payouts.approve(administrator(), held.payoutId(), "checked");
        assertThat(state(held.payoutId())).isEqualTo(PayoutState.APPROVED);
    }

    @Test
    @DisplayName("a creator who has filed nothing cannot have a payout approved, and the refusal says so")
    void nothingFiledRefusesApproval() {
        Held held = heldPayout();

        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.NONE);

        assertThatThrownBy(() -> payouts.approve(administrator(), held.payoutId(), "send it anyway"))
                .isInstanceOf(PayoutDestinationNotVerifiedException.class)
                .satisfies(thrown -> assertThat(((PayoutDestinationNotVerifiedException) thrown).standing())
                        .isEqualTo(DestinationStanding.NONE));

        // Held rather than failed. The money is owed; what is missing is a form the creator has
        // not filled in, and a payout that failed would have to be recalculated to pay somebody
        // the platform always intended to pay.
        assertThat(state(held.payoutId())).isEqualTo(PayoutState.PENDING_APPROVAL);
    }

    @Test
    @DisplayName("a destination nobody has looked at yet holds the payout")
    void awaitingVerificationHolds() {
        Held held = heldPayout();
        Destinations.awaiting(dataSource, held.creatorId(), "Test Creator");

        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.AWAITING_VERIFICATION);
        assertThatThrownBy(() -> payouts.approve(administrator(), held.payoutId(), "looks fine"))
                .isInstanceOf(PayoutDestinationNotVerifiedException.class);
    }

    @Test
    @DisplayName("an account held by somebody else holds the payout, and the standing says which problem it is")
    void nameMismatchHolds() {
        Held held = heldPayout();
        Destinations.nameMismatch(dataSource, held.creatorId(), "Somebody Else");

        // NAME_MISMATCH rather than a shared "refused". The operator reading this is deciding
        // whether a patronymic is missing or whether somebody has filed another person's
        // account, and a single value would not tell them which.
        assertThatThrownBy(() -> payouts.approve(administrator(), held.payoutId(), "close enough"))
                .isInstanceOf(PayoutDestinationNotVerifiedException.class)
                .satisfies(thrown -> assertThat(((PayoutDestinationNotVerifiedException) thrown).standing())
                        .isEqualTo(DestinationStanding.NAME_MISMATCH));
    }

    @Test
    @DisplayName("a refused destination holds the payout")
    void rejectedHolds() {
        Held held = heldPayout();
        Destinations.rejected(dataSource, held.creatorId(), "Test Creator", "INCOMPLETE");

        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.REJECTED);
        assertThatThrownBy(() -> payouts.approve(administrator(), held.payoutId(), "anyway"))
                .isInstanceOf(PayoutDestinationNotVerifiedException.class);
    }

    // ------------------------------------------------------------------
    // The override
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a live override releases the payout, and is not drawn as though somebody checked an account")
    void aWaiverReleases() {
        Held held = heldPayout();
        Destinations.awaiting(dataSource, held.creatorId(), "Test Creator");

        overrides.grant(
                administrator(),
                held.creatorId(),
                ComplianceRequirement.PAYOUT_DESTINATION,
                OverrideReason.DOCUMENT_UNAVAILABLE_ABROAD,
                "Bank confirmation letter is with the branch until Friday.",
                Instant.now().plus(30, ChronoUnit.DAYS));

        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.WAIVED);

        payouts.approve(administrator(), held.payoutId(), "waived");
        assertThat(state(held.payoutId())).isEqualTo(PayoutState.APPROVED);
    }

    @Test
    @DisplayName("an override cannot conjure an account: with no row at all the payout still holds")
    void aWaiverDoesNotInventADestination() {
        Held held = heldPayout();

        overrides.grant(
                administrator(),
                held.creatorId(),
                ComplianceRequirement.PAYOUT_DESTINATION,
                OverrideReason.DOCUMENT_UNAVAILABLE_ABROAD,
                "Granted before the creator filed anything, which is the case this asserts.",
                Instant.now().plus(30, ChronoUnit.DAYS));

        // The distinction the whole standing exists for. A waiver excuses the *check*; there
        // is still nowhere to send the money, and a gate that read the override alone would
        // approve a payout with a null destination and discover it at the provider.
        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.NONE);
        assertThatThrownBy(() -> payouts.approve(administrator(), held.payoutId(), "waived"))
                .isInstanceOf(PayoutDestinationNotVerifiedException.class);
    }

    // ------------------------------------------------------------------
    // The token belongs to a provider
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a token issued by another provider is not offered to the one that would send")
    void aTokenIsReadableOnlyByItsIssuer() {
        Held held = heldPayout();
        Destinations.verifiedWith(dataSource, held.creatorId(), administrator(), "AZERICARD", "Test Creator");

        // The standing releases — somebody did confirm this account — and the reference does
        // not, because a Payriff token means nothing to Epoint. The two questions are separate
        // for exactly this case, and `send` refuses on the second rather than passing a token
        // along and reading back a decline nobody can account for.
        assertThat(destinations.standingOf(held.creatorId())).isEqualTo(DestinationStanding.VERIFIED);
        assertThat(destinations.referenceFor(held.creatorId(), "EPOINT")).isEmpty();
        assertThat(destinations.referenceFor(held.creatorId(), "AZERICARD")).isPresent();
    }

    @Test
    @DisplayName("a held standing offers no reference at all, whatever the provider")
    void aHeldStandingOffersNoReference() {
        Held held = heldPayout();
        Destinations.nameMismatch(dataSource, held.creatorId(), "Somebody Else");

        assertThat(destinations.referenceFor(held.creatorId(), Destinations.PROVIDER))
                .isEmpty();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private PayoutState state(UUID payoutId) {
        return payoutRows.findById(payoutId).orElseThrow().state();
    }

    /**
     * A payout past its hold, with the identity gate already open.
     *
     * <p>Written at {@code PENDING_APPROVAL} and with the verification supplied, so that the
     * only thing standing between it and an approval is the gate under test. A payout that was
     * also unverified would fail every assertion below for the wrong reason — the identity gate
     * runs first — and the suite would pass while testing nothing.
     */
    private Held heldPayout() {
        String unique = "payout-dest" + SEQUENCE.incrementAndGet();
        UUID creatorId = Campaigns.creator(dataSource, unique);
        UUID projectId = Campaigns.seed(dataSource, creatorId, unique)
                .state("SUCCESSFUL")
                .goal("100.00")
                .insert();

        Payout payout = Payout.calculated(
                projectId,
                creatorId,
                HUNDRED,
                Money.zero("AZN"),
                Money.zero("AZN"),
                Money.zero("AZN"),
                HUNDRED,
                null,
                Instant.parse("2026-01-01T00:00:00Z"),
                (short) 1,
                "payout-key-" + UUID.randomUUID());
        payout.payable();

        Verifications.approve(dataSource, creatorId, administrator());

        return new Held(payoutRows.save(payout).id(), creatorId);
    }

    /**
     * The bootstrap staff account, registered once and reused.
     *
     * <p>A dozen suites share this address. It is registered rather than signed in for, because
     * sign-ins per email are limited to five and a suite that signed in would fail whenever it
     * happened to run late in the pass.
     */
    private UUID administrator() {
        EmailAddress email = EmailAddress.of(ADMINISTRATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of(
                            "email", email.value(),
                            "password", "a-long-enough-password",
                            "name", "Test Administrator"),
                    String.class);
        }
        return users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
    }

    private record Held(UUID payoutId, UUID creatorId) {
    }
}
