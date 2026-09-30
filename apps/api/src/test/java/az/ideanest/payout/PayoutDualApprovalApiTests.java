package az.ideanest.payout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payout.application.PayoutNotSendableException;
import az.ideanest.payout.application.PayoutService;
import az.ideanest.payout.application.PayoutSignaturesShortException;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutState;
import az.ideanest.payout.infrastructure.PayoutApprovalRepository;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.money.Money;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Destinations;
import az.ideanest.support.Verifications;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
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
 * The dual-approval rule, asserted against the service rather than the browser — issue #398.
 *
 * <h2>What was wrong, and why nothing caught it</h2>
 *
 * <p>A payout requiring two signatures could be left {@code APPROVED} with one, by approving
 * it and then withdrawing that approval. {@code withdrawApproval} called {@code
 * Payout.payable()} to put it back, and {@code payable()} only transitions from {@code
 * CALCULATED} — so from {@code APPROVED} it returned without doing anything, and the guard
 * that called it compiled, ran and had no effect. {@code send()} then gated on the state
 * alone and never counted the signatures.
 *
 * <p>The only thing standing in the way was {@code PayoutQueue} in the browser, which
 * disables its send control while the count is short: a client-side check in front of a
 * service that would have accepted the call. {@code PayoutApprovalTests} does assert that
 * {@code payable()} is a no-op from {@code APPROVED} — correctly, because the queue read
 * calls it on every row it lists — and never sees the service that relied on it not being
 * one. The gap was between the two.
 *
 * <p>So these are service-level, and they are the transitions CLAUDE.md names as not
 * optional to test: they "fail silently and expensively".
 *
 * <h2>The rows are written rather than earned</h2>
 *
 * <p>A payout produced by {@code calculate} needs a closed campaign, settled charges and a
 * fee schedule in force, none of which is what is under test here — this is about what
 * happens to {@code state} and {@code payout_approvals} once a payout exists.
 * {@code ConsoleReadApiTests} makes the same trade for the same reason.
 */
class PayoutDualApprovalApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} bootstraps as an administrator. */
    private static final String ADMINISTRATOR_EMAIL = "moderator@ideanest.test";

    /** A second administrator, because the rule is about two <em>different</em> people. */
    private static final String SECOND_APPROVER_EMAIL = "payout-approver@ideanest.test";

    private static final Money HUNDRED = Money.of(new BigDecimal("100.00"), "AZN");

    @Autowired
    private PayoutService payouts;

    @Autowired
    private PayoutRepository payoutRows;

    @Autowired
    private PayoutApprovalRepository approvals;

    @Autowired
    private UserRepository users;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    /**
     * {@code payouts.project_id} is {@code ON DELETE NO ACTION}, so a row left behind makes
     * the next suite's {@code DELETE FROM projects} fail on a foreign key three frames away
     * from anything it did.
     */
    @AfterEach
    void clearThePayouts() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM payout_approvals");
        jdbc.update("DELETE FROM payouts");
        Destinations.clear(dataSource);
        Campaigns.clear(dataSource);
    }

    @Test
    @DisplayName("withdrawing a signature below the bar puts the payout back to waiting")
    void withdrawingASignatureUnApprovesIt() {
        UUID payoutId = payoutAwaitingTwoSignatures();
        UUID first = administrator();
        UUID second = secondApprover();

        payouts.approve(first, payoutId, "first");
        assertThat(payoutRows.findById(payoutId).orElseThrow().state()).isEqualTo(PayoutState.PENDING_APPROVAL);

        payouts.approve(second, payoutId, "second");
        assertThat(payoutRows.findById(payoutId).orElseThrow().state()).isEqualTo(PayoutState.APPROVED);

        payouts.withdrawApproval(second, payoutId);

        // The bug: this read APPROVED with one signature of two, and the console's badge
        // still said "approved" beside a count that said 1 of 2.
        assertThat(approvals.countFor(payoutId)).isEqualTo(1);
        assertThat(payoutRows.findById(payoutId).orElseThrow().state()).isEqualTo(PayoutState.PENDING_APPROVAL);
    }

    @Test
    @DisplayName("a payout whose signature was withdrawn cannot be sent")
    void aWithdrawnSignatureBlocksTheSend() {
        UUID payoutId = payoutAwaitingTwoSignatures();
        UUID first = administrator();
        UUID second = secondApprover();

        payouts.approve(first, payoutId, "first");
        payouts.approve(second, payoutId, "second");
        payouts.withdrawApproval(second, payoutId);

        // The whole rule, in one assertion. Before #398 this call reached the provider.
        assertThatThrownBy(() -> payouts.send(first, payoutId))
                .isInstanceOf(PayoutNotSendableException.class);
    }

    @Test
    @DisplayName("a row that says approved with too few signatures is refused by the count")
    void theSendCountsSignaturesRatherThanTrustingTheState() {
        UUID payoutId = payoutAwaitingTwoSignatures();
        UUID first = administrator();

        payouts.approve(first, payoutId, "only one");

        // Written directly, which is the point: `state` is a cache of rows in another table,
        // and this asserts the money is gated on the rows. #398 produced exactly this
        // disagreement through the withdrawal path, and the guard is what stops the next way
        // of producing it from being a way of sending an unapproved payout.
        new JdbcTemplate(dataSource).update("UPDATE payouts SET state = 'APPROVED' WHERE id = ?", payoutId);

        assertThatThrownBy(() -> payouts.send(first, payoutId))
                .isInstanceOf(PayoutSignaturesShortException.class)
                .satisfies(cause -> {
                    PayoutSignaturesShortException refusal = (PayoutSignaturesShortException) cause;
                    assertThat(refusal.signatures()).isEqualTo(1);
                    assertThat(refusal.required()).isEqualTo((short) 2);
                });
    }

    @Test
    @DisplayName("two different people still approve it, and the send gets past the signatures")
    void twoDistinctApproversReachApprovedAndPassTheGuard() {
        UUID payoutId = payoutAwaitingTwoSignatures();
        UUID first = administrator();
        UUID second = secondApprover();

        payouts.approve(first, payoutId, "first");
        payouts.approve(second, payoutId, "second");
        assertThat(payoutRows.findById(payoutId).orElseThrow().state()).isEqualTo(PayoutState.APPROVED);

        /*
         * And then it is refused for a different reason, which is what this asserts.
         *
         * The fixture's campaign has no settled charge, so `send` re-reads the funds, finds
         * a collected zero against a payout of 100.00, and takes the figures-moved branch —
         * which cancels the payout before refusing, so the state on the exception is
         * CANCELLED. That is the assertion: the state guard would have refused with the
         * state it found, and a payout short of signatures never reaches the funds check at
         * all. Getting here is the proof the new count let a properly approved payout past.
         *
         * The row itself is still APPROVED afterwards — `send` is @Transactional and throws,
         * so the cancellation rolls back with everything else it did.
         *
         * A send that actually moved money would need `ScriptedPaymentProvider` to answer
         * payouts, and it does not: it throws "Payouts are #69; no test drives them yet".
         * Building that double is a fixture for a different issue than this one.
         *
         * Note that `send` no longer takes a destination — #432 removed the parameter, and
         * there is deliberately no argument on this call that decides where money goes.
         */
        assertThatThrownBy(() -> payouts.send(first, payoutId))
                .isInstanceOf(PayoutNotSendableException.class)
                .satisfies(cause -> assertThat(((PayoutNotSendableException) cause).state())
                        .isEqualTo(PayoutState.CANCELLED));
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A payout past its hold, waiting on two signatures. */
    private UUID payoutAwaitingTwoSignatures() {
        String unique = "payout-dual" + SEQUENCE.incrementAndGet();
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
                (short) 2,
                "payout-key-" + UUID.randomUUID());
        payout.payable();

        // #431: this profile runs with `ideanest.verification.required` on, so a payout whose
        // creator has no approved verification will not move out of §6.3's hold. The
        // verification is a precondition of this suite rather than its subject -- what it is
        // checking is the dual-approval rule -- so the fixture supplies it, which is what #431
        // asks for: "extend the fixture helper rather than each suite".
        Verifications.approve(dataSource, creatorId, administrator());

        // #432: and a second precondition of the same kind. Approval now also refuses a payout
        // whose creator has no confirmed destination, because a signature given before anybody
        // established where the money would go is a signature on a blank line. Same argument as
        // above: the destination is this suite's precondition and not its subject.
        Destinations.verified(dataSource, creatorId, administrator(), "Test Creator");

        return payoutRows.save(payout).id();
    }

    private UUID administrator() {
        return accountOf(ADMINISTRATOR_EMAIL, "Test Administrator");
    }

    /**
     * A second administrator, holding a V48 grant rather than a configured bootstrap.
     *
     * <p>{@code application-test.yml} bootstraps one address, and a second entry there would
     * change what every other suite's staff fixture means. So this account is staff the way
     * every real one is: a row in {@code staff_role_grants}.
     *
     * <p>Written with SQL rather than through {@code StaffRoleRepository.grantIfAbsent},
     * which is {@code @Modifying} and expects the transaction its service supplies. A test
     * method is not in one, and opening one here to write a fixture row would be a
     * transaction wrapped around the thing under test as well.
     */
    private UUID secondApprover() {
        UUID id = accountOf(SECOND_APPROVER_EMAIL, "Second Approver");
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO staff_role_grants (account_id, role, granted_by, note)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT DO NOTHING
                        """,
                        id,
                        StaffRole.SUPER_ADMIN.name(),
                        administrator(),
                        "#398 fixture");
        return id;
    }

    /**
     * An account, registered once and reused.
     *
     * <p>Registered rather than signed in: §11's sign-ins-per-email limit is five and a
     * dozen suites share {@code moderator@ideanest.test}. Nothing here needs a token — the
     * service is called directly — but the account has to exist for the staff lookup.
     */
    private UUID accountOf(String address, String name) {
        EmailAddress email = EmailAddress.of(address);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", name),
                    String.class);
        }
        return users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
    }
}
