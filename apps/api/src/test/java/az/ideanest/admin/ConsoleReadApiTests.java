package az.ideanest.admin;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Ledgers;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
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
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The console's three read surfaces — AD-05 and AD-14, issues #304, #305 and #314.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aPostingShowsBothSidesEvenWhenTheFilterMatchedOne()} — the one assertion
 *       this whole feature is for. A ledger that showed you the escrow side of a posting
 *       because you filtered on escrow would be showing half a double entry and calling it
 *       a ledger.
 *   <li>{@link #anUnknownLedgerAccountIsRefusedRatherThanEmpty()} — a page of nothing on a
 *       ledger reads as "this account is empty", which is a statement about the platform's
 *       money and not about a typo.
 *   <li>{@link #thePaymentLogKeepsEveryAttempt()} — a status never moves, so a pending call
 *       that later resolves is two rows. The log is what makes §9.6's retry schedule
 *       answerable.
 *   <li>{@link #everyConsoleReadIsAudited()} — none of these three endpoints writes
 *       anything, and all three are recorded anyway: they hand somebody with no
 *       relationship to a pledge the record of what a named person paid.
 *   <li>{@link #onlyStaffMayReadTheConsole()} — the default case, asserted for all three.
 * </ul>
 *
 * <p><strong>Rows are written with SQL rather than driven through a collection run.</strong>
 * These are read endpoints over two append-only tables; driving a real charge would make a
 * suite about paging depend on the whole payment provider configuration, and
 * {@code CollectionTests} already owns that path. What is <em>not</em> faked is the
 * identifier: {@link Identifiers#newIdentifier()} rather than {@link UUID#randomUUID()},
 * because both endpoints page by the primary key on the strength of it being a UUID v7, and
 * a fixture using version 4 would order at random and pass anyway.
 */
class ConsoleReadApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} lists as a moderator. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    /** What this suite's own role grants are marked with, so teardown can find them. */
    private static final String ROLE_FIXTURE_NOTE = "console capability fixture";

    private static Account staff;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    /**
     * Every financial row this suite wrote, gone.
     *
     * <p>{@code transactions} references {@code projects} with {@code ON DELETE NO ACTION},
     * so rows left behind make the next suite's {@code DELETE FROM projects} fail.
     * {@code Ledgers} argues why teardown may turn the append-only triggers off and why
     * doing so weakens nothing asserted here. Audit rows are left where they are — V21
     * refuses a DELETE, which is the point of that table — so every assertion about the
     * trail is scoped to a row this suite can name.
     */
    @AfterEach
    void clearTheMoney() {
        Ledgers.clear(dataSource);
        Campaigns.clear(dataSource);
        /*
         * And the one role grant this suite makes. `staff_role_grants.granted_by` references
         * `users`, so a row left behind makes the next suite's `DELETE FROM users` fail with a
         * foreign key violation twenty tests wide and nothing pointing back here.
         * `BackerDisputeApiTests` deletes its own by note for the same reason.
         */
        new JdbcTemplate(dataSource).update("DELETE FROM staff_role_grants WHERE note = ?", ROLE_FIXTURE_NOTE);
    }

    // ------------------------------------------------------------------
    // AD-14: the audit trail
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the trail comes back newest first")
    void theTrailIsNewestFirst() {
        UUID subject = UUID.randomUUID();
        write("first", subject);
        write("second", subject);

        List<Map<String, Object>> entries = entriesIn(get(
                "/v1/admin/audit?entityType=console-test&entityId=" + subject, staff().accessToken()));

        // A queue is worked from the front and a trail is read from the end. The order is
        // the opposite of the report queue's, and deliberately.
        assertThat(entries).hasSize(2);
        assertThat(entries.get(0)).containsEntry("detail", "second");
        assertThat(entries.get(1)).containsEntry("detail", "first");
    }

    @Test
    @DisplayName("the trail narrows to one kind of thing, and to one thing")
    void theTrailNarrows() {
        UUID one = UUID.randomUUID();
        UUID another = UUID.randomUUID();
        write("about one", one);
        write("about another", another);

        assertThat(entriesIn(get("/v1/admin/audit?entityType=console-test", staff().accessToken())))
                .hasSizeGreaterThanOrEqualTo(2);
        assertThat(entriesIn(get(
                        "/v1/admin/audit?entityType=console-test&entityId=" + one, staff().accessToken())))
                .hasSize(1);
    }

    @Test
    @DisplayName("an entity identifier with no kind is dropped, and the response says so")
    void anEntityIdentifierAloneIsDropped() {
        UUID subject = UUID.randomUUID();
        write("orphaned filter", subject);

        ResponseEntity<Map<String, Object>> page =
                get("/v1/admin/audit?entityId=" + subject, staff().accessToken());

        /*
         * V21's index leads on the kind, so an identifier alone cannot use it. Answering
         * with the whole trail and echoing an empty filter is honest; answering with the
         * whole trail while echoing the filter back would tell a client its question had
         * been applied when it had not, which is the failure worth preventing.
         */
        assertThat(page.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(page.getBody().get("entityId")).isNull();
        assertThat(page.getBody().get("entityType")).isNull();
    }

    @Test
    @DisplayName("the trail pages from a cursor rather than an offset")
    void theTrailPagesFromACursor() {
        UUID subject = UUID.randomUUID();
        write("older", subject);
        write("newer", subject);

        String path = "/v1/admin/audit?entityType=console-test&entityId=" + subject + "&limit=1";
        ResponseEntity<Map<String, Object>> firstPage = get(path, staff().accessToken());
        List<Map<String, Object>> first = entriesIn(firstPage);
        assertThat(first).hasSize(1);
        assertThat(first.get(0)).containsEntry("detail", "newer");
        /*
         * Opaque since #404, where it used to be the last row's identifier. The trail is
         * ordered by `occurred_at` now — the column the screen displays, which is written by
         * the database's clock while the key is minted by the application's — so the cursor
         * has to carry the instant and the identifier that breaks its tie. What is asserted
         * here is that a cursor comes back and that it works, which is the contract; the
         * shape is `AuditCursor`'s business, and a test that pinned it would be the reason
         * the ordering could not be changed again.
         */
        assertThat((String) firstPage.getBody().get("nextCursor")).isNotBlank();
        assertThat(firstPage.getBody().get("nextCursor")).isNotEqualTo(first.get(0).get("id"));

        List<Map<String, Object>> second =
                entriesIn(get(path + "&after=" + firstPage.getBody().get("nextCursor"), staff().accessToken()));
        assertThat(second).hasSize(1);
        assertThat(second.get(0)).containsEntry("detail", "older");
    }

    @Test
    @DisplayName("the trail carries what an investigation asks for and not only what happened")
    void theTrailCarriesTheContext() {
        UUID subject = UUID.randomUUID();
        write("with context", subject);

        Map<String, Object> entry = entriesIn(get(
                        "/v1/admin/audit?entityType=console-test&entityId=" + subject, staff().accessToken()))
                .get(0);

        // Who, as what, to what, when, and how it came out. A trail missing any of those
        // is one somebody has to open psql to finish reading, which is what this screen
        // exists to stop.
        assertThat(entry).containsKeys("id", "occurredAt", "actorType", "action", "entityType", "entityId", "outcome");
        assertThat(entry).containsEntry("action", "report.upheld");
        assertThat(entry).containsEntry("outcome", "SUCCEEDED");
    }

    // ------------------------------------------------------------------
    // AD-05: the payment log
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the payment log keeps every attempt, because a status never moves")
    void thePaymentLogKeepsEveryAttempt() {
        Fixture fixture = campaignWithPledge("payments-attempts");
        charge(fixture, "FAILED", "100.00", 1, "51", "Insufficient funds.");
        charge(fixture, "SUCCEEDED", "100.00", 2, null, null);

        List<Map<String, Object>> log = transactionsIn(
                get("/v1/admin/payments?pledgeId=" + fixture.pledgeId(), staff().accessToken()));

        assertThat(log).hasSize(2);
        // Newest first: the attempt that settled is the one somebody is looking for.
        assertThat(log.get(0)).containsEntry("status", "SUCCEEDED");
        assertThat(log.get(0)).containsEntry("attemptNumber", 2);
        assertThat(log.get(1)).containsEntry("status", "FAILED");
        assertThat(log.get(1)).containsEntry("failureCode", "51");
        assertThat(log.get(1)).containsEntry("failureMessage", "Insufficient funds.");
    }

    @Test
    @DisplayName("an amount crosses as a string, never as a JSON number")
    void anAmountIsAString() {
        Fixture fixture = campaignWithPledge("payments-money");
        charge(fixture, "SUCCEEDED", "1234.50", 1, null, null);

        Map<String, Object> row = transactionsIn(
                        get("/v1/admin/payments?pledgeId=" + fixture.pledgeId(), staff().accessToken()))
                .get(0);

        // §10.3, and on this surface it is not a formality: a payment log is read next to
        // a provider's own statement, and a figure that has been through an IEEE 754
        // double eventually disagrees with it by a qapik nobody can account for.
        assertThat(amountOf(row)).containsEntry("amount", "1234.50").containsEntry("currency", "AZN");
    }

    @Test
    @DisplayName("a pledge filter beats a campaign filter, and the response says which it applied")
    void thePledgeFilterWins() {
        Fixture fixture = campaignWithPledge("payments-both");
        charge(fixture, "SUCCEEDED", "100.00", 1, null, null);

        ResponseEntity<Map<String, Object>> page = get(
                "/v1/admin/payments?pledgeId=" + fixture.pledgeId() + "&projectId=" + UUID.randomUUID(),
                staff().accessToken());

        // The two indexes do not combine, so one of them is applied; the response is what
        // tells a client which, rather than leaving it to infer that from the rows.
        assertThat(transactionsIn(page)).hasSize(1);
        assertThat(page.getBody()).containsEntry("pledgeId", fixture.pledgeId().toString());
        assertThat(page.getBody().get("projectId")).isNull();
    }

    @Test
    @DisplayName("an outcome filter answers the question this screen is opened with")
    void anOutcomeFilterNarrowsTheLog() {
        Fixture fixture = campaignWithPledge("payments-outcome");
        charge(fixture, "FAILED", "100.00", 1, "51", "Insufficient funds.");
        charge(fixture, "SUCCEEDED", "100.00", 2, null, null);

        // #404: the log's own description promises it includes rejected calls, failed
        // provider calls are the main reason anybody opens it, and they were the one view
        // it could not select.
        List<Map<String, Object>> failures = transactionsIn(get(
                "/v1/admin/payments?pledgeId=" + fixture.pledgeId() + "&status=FAILED",
                staff().accessToken()));

        assertThat(failures).hasSize(1);
        assertThat(failures.get(0)).containsEntry("status", "FAILED");
        assertThat(failures.get(0)).containsEntry("attemptNumber", 1);
    }

    @Test
    @DisplayName("an outcome combines with a campaign rather than replacing it")
    void anOutcomeCombinesWithTheCampaignFilter() {
        Fixture mine = campaignWithPledge("payments-outcome-mine");
        Fixture theirs = campaignWithPledge("payments-outcome-theirs");
        charge(mine, "FAILED", "100.00", 1, "51", "Insufficient funds.");
        charge(theirs, "FAILED", "100.00", 1, "51", "Insufficient funds.");

        // The one filter on this endpoint that composes. "What did this collection run
        // leave behind" is a campaign and a status together, served by the campaign's own
        // index with the status as a filter step.
        List<Map<String, Object>> log = transactionsIn(get(
                "/v1/admin/payments?projectId=" + mine.projectId() + "&status=FAILED",
                staff().accessToken()));

        assertThat(log).hasSize(1);
        assertThat(log.get(0)).containsEntry("projectId", mine.projectId().toString());
    }

    @Test
    @DisplayName("an outcome is matched whatever case it was typed in, and echoed as the column spells it")
    void anOutcomeIsCaseInsensitiveAndEchoedCanonically() {
        Fixture fixture = campaignWithPledge("payments-outcome-case");
        charge(fixture, "FAILED", "100.00", 1, "51", "Insufficient funds.");

        ResponseEntity<Map<String, Object>> page = get(
                "/v1/admin/payments?pledgeId=" + fixture.pledgeId() + "&status=failed", staff().accessToken());

        // A query parameter is typed by whoever is holding the URL, and `?status=failed`
        // means one thing. What comes back is what was applied.
        assertThat(transactionsIn(page)).hasSize(1);
        assertThat(page.getBody()).containsEntry("status", "FAILED");
    }

    @Test
    @DisplayName("an outcome that is not one is refused rather than quietly dropped")
    void anUnknownOutcomeIsRefused() {
        ResponseEntity<Map<String, Object>> refused =
                get("/v1/admin/payments?status=REFUNDED", staff().accessToken());

        // The mistake somebody actually makes, because a refund IS a thing this table
        // records -- as a `type`, never as a `status`. Dropping the filter would draw every
        // successful charge on the platform under a chip that says "rejected".
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "UNKNOWN_TRANSACTION_OUTCOME");
    }

    @Test
    @DisplayName("no outcome asked for means every outcome, and the answer says so")
    void noOutcomeMeansEveryOutcome() {
        Fixture fixture = campaignWithPledge("payments-outcome-none");
        charge(fixture, "FAILED", "100.00", 1, "51", "Insufficient funds.");
        charge(fixture, "SUCCEEDED", "100.00", 2, null, null);

        ResponseEntity<Map<String, Object>> page =
                get("/v1/admin/payments?pledgeId=" + fixture.pledgeId(), staff().accessToken());

        assertThat(transactionsIn(page)).hasSize(2);
        assertThat(page.getBody().get("status")).isNull();
    }

    @Test
    @DisplayName("an outcome filter pages, and the second page keeps the filter")
    void anOutcomeFilterPages() {
        Fixture fixture = campaignWithPledge("payments-outcome-paging");
        charge(fixture, "FAILED", "100.00", 1, "51", "Insufficient funds.");
        charge(fixture, "SUCCEEDED", "100.00", 2, null, null);
        charge(fixture, "FAILED", "100.00", 3, "51", "Insufficient funds.");

        String scope = "/v1/admin/payments?pledgeId=" + fixture.pledgeId() + "&status=FAILED";
        ResponseEntity<Map<String, Object>> first = get(scope + "&limit=1", staff().accessToken());
        assertThat(transactionsIn(first)).hasSize(1);

        // A cursor that lost the filter would make page two the whole log, which is the
        // failure mode a keyset makes easy to ship and hard to notice.
        List<Map<String, Object>> second = transactionsIn(
                get(scope + "&limit=1&after=" + first.getBody().get("nextCursor"), staff().accessToken()));
        assertThat(second).hasSize(1);
        assertThat(second.get(0)).containsEntry("status", "FAILED");
    }

    @Test
    @DisplayName("the payment log is not cached anywhere")
    void thePaymentLogIsNotCached() {
        Fixture fixture = campaignWithPledge("payments-cache");
        charge(fixture, "SUCCEEDED", "100.00", 1, null, null);

        ResponseEntity<Map<String, Object>> page =
                get("/v1/admin/payments?projectId=" + fixture.projectId(), staff().accessToken());

        assertThat(page.getHeaders().getCacheControl())
                .as("a browser disk cache holding somebody's charge history survives signing out")
                .contains("no-store");
    }

    // ------------------------------------------------------------------
    // AD-05: the ledger
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a posting shows both sides even when the filter matched one of them")
    void aPostingShowsBothSidesEvenWhenTheFilterMatchedOne() {
        Fixture fixture = campaignWithPledge("ledger-sides");
        UUID transactionId = charge(fixture, "SUCCEEDED", "100.00", 1, null, null);
        post(transactionId, fixture.projectId(), "100.00");

        List<Map<String, Object>> postings =
                postingsIn(get("/v1/admin/ledger?account=escrow", staff().accessToken()));

        assertThat(postings).hasSize(1);
        // The filter decides which postings are interesting. It must never decide which
        // half of one is shown -- a balance that does not balance is the one thing this
        // table exists to make impossible.
        assertThat(linesOf(postings.get(0))).hasSize(2);
        assertThat(linesOf(postings.get(0))).extracting(line -> line.get("account"))
                .containsExactlyInAnyOrder("escrow", "platform_fee");
        assertThat(postings.get(0)).containsEntry("balanced", true);
    }

    @Test
    @DisplayName("the page carries what every account holds, not only what moved on it")
    void theLedgerCarriesTheBalances() {
        Fixture fixture = campaignWithPledge("ledger-balances");
        UUID transactionId = charge(fixture, "SUCCEEDED", "100.00", 1, null, null);
        post(transactionId, fixture.projectId(), "100.00");

        ResponseEntity<Map<String, Object>> page =
                get("/v1/admin/ledger?projectId=" + fixture.projectId(), staff().accessToken());

        List<Map<String, Object>> balances = balancesIn(page);
        assertThat(balances).extracting(balance -> balance.get("account"))
                .containsExactlyInAnyOrder("escrow", "platform_fee");
        // Debits positive, credits negative. Escrow holding a hundred and the fee account
        // owing a hundred is the same fact stated from both ends.
        assertThat(netOf(balances, "escrow")).containsEntry("amount", "100.00");
        assertThat(netOf(balances, "platform_fee")).containsEntry("amount", "-100.00");
    }

    @Test
    @DisplayName("balances are not narrowed by the account filter")
    void balancesIgnoreTheAccountFilter() {
        Fixture fixture = campaignWithPledge("ledger-balance-scope");
        UUID transactionId = charge(fixture, "SUCCEEDED", "100.00", 1, null, null);
        post(transactionId, fixture.projectId(), "100.00");

        List<Map<String, Object>> balances = balancesIn(get(
                "/v1/admin/ledger?account=escrow&projectId=" + fixture.projectId(), staff().accessToken()));

        // Filtering the postings to escrow does not make the other accounts stop existing,
        // and a one-line balance panel would read as though it were the whole ledger.
        assertThat(balances).hasSize(2);
    }

    @Test
    @DisplayName("an unknown ledger account is refused rather than answered with an empty page")
    void anUnknownLedgerAccountIsRefusedRatherThanEmpty() {
        ResponseEntity<Map<String, Object>> refused =
                get("/v1/admin/ledger?account=platform_fees", staff().accessToken());

        // The plural is the mistake somebody actually makes. A page of nothing here reads
        // as "this account is empty", which is a statement about the platform's money.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "UNKNOWN_LEDGER_ACCOUNT");
    }

    @Test
    @DisplayName("the ledger pages over postings rather than over entries")
    void theLedgerPagesOverPostings() {
        Fixture fixture = campaignWithPledge("ledger-paging");
        post(charge(fixture, "SUCCEEDED", "100.00", 1, null, null), fixture.projectId(), "100.00");
        post(charge(fixture, "SUCCEEDED", "200.00", 2, null, null), fixture.projectId(), "200.00");

        ResponseEntity<Map<String, Object>> firstPage =
                get("/v1/admin/ledger?projectId=" + fixture.projectId() + "&limit=1", staff().accessToken());

        // One posting, both of its entries. A page of one entry would be half a posting,
        // which is what makes the limit a limit on postings.
        assertThat(postingsIn(firstPage)).hasSize(1);
        assertThat(linesOf(postingsIn(firstPage).get(0))).hasSize(2);
        assertThat(firstPage.getBody().get("nextCursor")).isNotNull();

        List<Map<String, Object>> second = postingsIn(get(
                "/v1/admin/ledger?projectId=" + fixture.projectId() + "&limit=1&after="
                        + firstPage.getBody().get("nextCursor"),
                staff().accessToken()));
        assertThat(second).hasSize(1);
        assertThat(second.get(0).get("transactionId"))
                .isNotEqualTo(postingsIn(firstPage).get(0).get("transactionId"));
    }

    // ------------------------------------------------------------------
    // Who may read, and what that leaves behind
    // ------------------------------------------------------------------

    @Test
    @DisplayName("only staff may read the console")
    void onlyStaffMayReadTheConsole() {
        Account outsider = account("console-outsider");

        assertThat(get("/v1/admin/audit", outsider.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/v1/admin/payments", outsider.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        ResponseEntity<Map<String, Object>> ledger = get("/v1/admin/ledger", outsider.accessToken());
        assertThat(ledger.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(ledger.getBody()).containsEntry("code", "NOT_A_MODERATOR");
    }

    @Test
    @DisplayName("a colleague without VIEW_FINANCE is refused the books, and told which capability")
    void theBooksAreFinancesRatherThanEveryStaffMembers() {
        /*
         * The check above is the older half: a stranger is refused. This is the half #295's
         * role model makes possible and these three endpoints did not make - they asked only
         * whether the caller was staff, so a curator whose whole role is CURATE could read
         * every posting in the platform's ledger and every card decline in the payment log.
         *
         * The audit trail is deliberately in the same test and deliberately allowed: every
         * role holds VIEW_AUDIT, and a test that only asserted refusals would pass just as
         * well if somebody replaced the three capabilities with ADMINISTER_STAFF.
         */
        Account curator = staff("console-curator", StaffRole.CURATOR);

        assertThat(get("/v1/admin/audit", curator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        ResponseEntity<Map<String, Object>> ledger = get("/v1/admin/ledger", curator.accessToken());
        assertThat(ledger.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        /*
         * And not NOT_A_MODERATOR, which is the refusal that cannot be fixed by the person
         * reading it. The console renders the capability out of `meta` and says which
         * authority the screen wanted; the rail hides the entry on the same fact.
         */
        assertThat(ledger.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
        assertThat(ledger.getBody()).extracting("meta").hasToString("{capability=VIEW_FINANCE}");

        ResponseEntity<Map<String, Object>> payments = get("/v1/admin/payments", curator.accessToken());
        assertThat(payments.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(payments.getBody()).containsEntry("code", "INSUFFICIENT_STAFF_CAPABILITY");
    }

    @Test
    @DisplayName("every console read is audited, with counts and no rows")
    void everyConsoleReadIsAudited() {
        Fixture fixture = campaignWithPledge("console-audit");
        charge(fixture, "SUCCEEDED", "100.00", 1, null, null);

        get("/v1/admin/payments?projectId=" + fixture.projectId(), staff().accessToken());
        get("/v1/admin/ledger", staff().accessToken());
        get("/v1/admin/audit", staff().accessToken());

        assertThat(detailOfLatest(AuditAction.PAYMENT_LOG_READ)).contains("rows=", "project=set");
        assertThat(detailOfLatest(AuditAction.LEDGER_READ)).contains("postings=");
        assertThat(detailOfLatest(AuditAction.AUDIT_TRAIL_READ)).contains("rows=");

        // The filter was used; what it was set to is not repeated into the one table with
        // no retention rule.
        assertThat(detailOfLatest(AuditAction.PAYMENT_LOG_READ))
                .doesNotContain(fixture.projectId().toString());
    }

    @Test
    @DisplayName("a refused read leaves no audit row, because nothing was read")
    void aRefusedReadLeavesNoRow() {
        Account outsider = account("console-refused");
        int before = auditRows(AuditAction.LEDGER_READ).size();

        get("/v1/admin/ledger", outsider.accessToken());

        assertThat(auditRows(AuditAction.LEDGER_READ)).hasSize(before);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    /** A campaign and a pledge on it, which is everything a transaction needs to reference. */
    private record Fixture(UUID projectId, UUID pledgeId) {
    }

    private Fixture campaignWithPledge(String handle) {
        String unique = handle + SEQUENCE.incrementAndGet();
        UUID creatorId = Campaigns.creator(dataSource, unique);
        UUID projectId = Campaigns.seed(dataSource, creatorId, unique)
                .state("COLLECTING")
                .goal("100.00")
                .insert();
        return new Fixture(projectId, Pledges.confirmed(dataSource, projectId, unique + "-backer", "100.00"));
    }

    /**
     * One row in {@code transactions}.
     *
     * <p>The identifier is a UUID v7 rather than a version 4, and that is not incidental. The
     * log pages by {@code (created_at, id)} since #412 — it used to page by the primary key
     * alone, on the strength of that key being time-ordered, and {@code PaymentLogCursor} is
     * where the two clocks that argument overlooked are written down. The key is still the
     * tiebreak, so a fixture using {@link UUID#randomUUID()} would order tied rows at random
     * and let a broken cursor pass.
     */
    private UUID charge(
            Fixture fixture, String status, String amount, int attempt, String failureCode, String failureMessage) {

        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        """
                        INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency,
                                                  provider, provider_transaction_id, failure_code, failure_message,
                                                  attempt_number, idempotency_key)
                        VALUES (?, ?, ?, 'CHARGE', ?, CAST(? AS numeric), 'AZN', 'PAYRIFF', ?, ?, ?, ?, ?)
                        """,
                        id,
                        fixture.pledgeId(),
                        fixture.projectId(),
                        status,
                        amount,
                        "prov-" + id,
                        failureCode,
                        failureMessage,
                        attempt,
                        "console-test-" + id);
        return id;
    }

    /** A balanced pair of entries against a transaction. Anything else is refused at commit. */
    private void post(UUID transactionId, UUID projectId, String amount) {
        jdbc().update(
                        """
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES (?, 'escrow', 'DEBIT', CAST(? AS numeric), 'AZN', ?),
                               (?, 'platform_fee', 'CREDIT', CAST(? AS numeric), 'AZN', ?)
                        """,
                        transactionId,
                        amount,
                        projectId,
                        transactionId,
                        amount,
                        projectId);
    }

    /**
     * An audit row this suite can find again.
     *
     * <p>Written through SQL rather than through {@code AuditLog}, because the writing side
     * is {@code MANDATORY} and would need a transaction of its own here, and because the
     * kind is invented: {@code console-test} is not one of {@code AuditAction}'s entity
     * types, which keeps every assertion in this file away from the rows other suites leave
     * behind in a table nothing may delete from.
     */
    private void write(String detail, UUID entityId) {
        jdbc().update(
                """
                INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, outcome, detail)
                VALUES (?, 'MODERATOR', ?, 'report.upheld', 'console-test', ?, 'SUCCEEDED', ?)
                """,
                Identifiers.newIdentifier(),
                staff().id(),
                entityId,
                detail);
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return signIn(email);
    }

    /**
     * The one account this suite's configuration treats as platform staff.
     *
     * <p>Its token is minted rather than signed in for, exactly as
     * {@code ContentReportApiTests} and {@code AdminUserApiTests} do: several suites share
     * this address and {@code sign-ins-per-email} is deliberately left at its real value of
     * five, so a suite that signs in as it spends one of those five and makes somebody
     * else's tests fail with a 401 that has nothing to do with them.
     */
    private Account staff() {
        if (staff != null) {
            return staff;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        staff = new Account(accessToken, id);
        return staff;
    }

    /**
     * A member of staff holding exactly one role.
     *
     * <p>Granted with SQL rather than through `PUT /v1/admin/staff/{id}/roles/{role}`, which
     * is {@code CreatorPayoutDestinationTests}' argument and holds here: driving the grant
     * through the API would make a suite about three read endpoints depend on the staff
     * administration endpoint, its audit write and its own refusals.
     *
     * <p>The token is minted rather than signed in for, for the reason {@link #staff()} gives:
     * {@code sign-ins-per-email} is left at its real value, and a suite that spends one makes
     * somebody else's tests fail with a 401 that has nothing to do with them.
     */
    private Account staff(String slug, StaffRole role) {
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
                        staff().id(),
                        ROLE_FIXTURE_NOTE);

        String accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();

        return new Account(accessToken, id);
    }

    private Account signIn(EmailAddress email) {
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return rest.exchange(
                path,
                HttpMethod.GET,
                new HttpEntity<>(bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private List<AuditEntry> auditRows(AuditAction action) {
        return auditEntries.findByActorIdOrderByOccurredAtDesc(staff().id()).stream()
                .filter(entry -> entry.getAction().equals(action.action()))
                .toList();
    }

    private String detailOfLatest(AuditAction action) {
        List<AuditEntry> rows = auditRows(action);
        assertThat(rows).as("%s should have been recorded", action.action()).isNotEmpty();
        return rows.getFirst().getDetail();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> entriesIn(ResponseEntity<Map<String, Object>> page) {
        return (List<Map<String, Object>>) page.getBody().get("entries");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> transactionsIn(ResponseEntity<Map<String, Object>> page) {
        return (List<Map<String, Object>>) page.getBody().get("transactions");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> postingsIn(ResponseEntity<Map<String, Object>> page) {
        return (List<Map<String, Object>>) page.getBody().get("postings");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> balancesIn(ResponseEntity<Map<String, Object>> page) {
        return (List<Map<String, Object>>) page.getBody().get("balances");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> linesOf(Map<String, Object> posting) {
        return (List<Map<String, Object>>) posting.get("lines");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> amountOf(Map<String, Object> row) {
        return (Map<String, Object>) row.get("amount");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> netOf(List<Map<String, Object>> balances, String account) {
        return (Map<String, Object>) balances.stream()
                .filter(balance -> account.equals(balance.get("account")))
                .findFirst()
                .orElseThrow()
                .get("net");
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
