package az.ideanest.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Ledgers;
import az.ideanest.support.Pledges;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * What V41 refuses (#62).
 *
 * <p><strong>The rules asserted here are the ones the application cannot be trusted
 * with.</strong> {@code PostingTests} checks that {@code Posting} refuses an unbalanced
 * set of lines, which protects every caller that goes through {@code Ledger}. This
 * checks the other half: that a support script, a migration, or a future service that
 * writes the table directly is refused too. §7.2 says the invariant is "enforced by a
 * database constraint", and a constraint nobody has watched fail is a comment.
 *
 * <p>Everything here is written with plain SQL rather than through the repositories,
 * deliberately — the point is what happens when somebody goes round the application.
 */
class LedgerSchemaTests extends AbstractIntegrationTest {

    /**
     * The pledge every test hangs its transactions from, created once.
     *
     * <p>Static because V41's foreign keys are {@code ON DELETE NO ACTION}: nothing here
     * can be tidied up afterwards, so a pledge per test would leave a dozen campaigns
     * behind to prove a point about a trigger.
     */
    private static UUID sharedPledgeId;

    @Autowired
    private DataSource dataSource;

    /**
     * Every row this suite wrote, gone.
     *
     * <p>Not tidiness: {@code transactions} references {@code projects} with
     * {@code ON DELETE NO ACTION}, so rows left here make the next suite's
     * {@code DELETE FROM projects} fail. {@code Ledgers} argues why teardown may turn the
     * append-only triggers off, and why doing so does not weaken what this class asserts.
     */
    @AfterEach
    void clearTheLedger() {
        Ledgers.clear(dataSource);
    }

    // ------------------------------------------------------------------
    // The invariant
    // ------------------------------------------------------------------

    /**
     * §7.2: "for every {@code transaction_id}, SUM(debit) = SUM(credit)."
     *
     * <p>The failure surfaces at {@code COMMIT} rather than at the offending
     * {@code INSERT}, because the trigger is deferred — see V41 for why it has to be, and
     * why {@code Posting} refuses first so that ordinary callers never meet this.
     */
    @Test
    @DisplayName("a posting whose debits and credits disagree is refused at commit")
    void anUnbalancedPostingIsRefused() {
        UUID transactionId = aCharge("100.00");

        assertThatThrownBy(() -> jdbc().execute(
                        """
                        BEGIN;
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES ('%s', 'escrow', 'DEBIT', 100.00, 'AZN', '%s'),
                               ('%s', 'platform_fee', 'CREDIT', 99.99, 'AZN', '%s');
                        COMMIT;
                        """
                                .formatted(transactionId, projectOf(transactionId), transactionId, projectOf(transactionId))))
                .hasMessageContaining("does not balance");
    }

    /**
     * A transaction may pass through unbalanced intermediate states and may not end in
     * one.
     *
     * <p>This is what the deferral buys, and it is the reason an ordinary
     * {@code AFTER INSERT} trigger could not express the rule: the first entry of a
     * balanced pair is, on its own, unbalanced.
     */
    @Test
    @DisplayName("a posting written one row at a time is accepted, because the check is deferred")
    void aPostingWrittenOneRowAtATimeIsAccepted() {
        UUID transactionId = aCharge("100.00");
        UUID projectId = projectOf(transactionId);

        jdbc().execute(
                        """
                        BEGIN;
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES ('%s', 'escrow', 'DEBIT', 100.00, 'AZN', '%s');
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES ('%s', 'platform_fee', 'CREDIT', 100.00, 'AZN', '%s');
                        COMMIT;
                        """
                                .formatted(transactionId, projectId, transactionId, projectId));

        assertThat(entryCount(transactionId)).isEqualTo(2);
    }

    /**
     * §21.2: there is no rate at which one currency balances another for anything that
     * moves money.
     *
     * <p>A currency-blind sum would report this posting as correct, which is why the
     * trigger groups by currency as well as by transaction.
     */
    @Test
    @DisplayName("a posting that balances only if two currencies are added together is refused")
    void aPostingInTwoCurrenciesIsRefused() {
        UUID transactionId = aCharge("100.00");
        UUID projectId = projectOf(transactionId);

        assertThatThrownBy(() -> jdbc().execute(
                        """
                        BEGIN;
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES ('%s', 'escrow', 'DEBIT', 100.00, 'AZN', '%s'),
                               ('%s', 'platform_fee', 'CREDIT', 100.00, 'USD', '%s');
                        COMMIT;
                        """
                                .formatted(transactionId, projectId, transactionId, projectId)))
                .hasMessageContaining("does not balance");
    }

    // ------------------------------------------------------------------
    // Append-only
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a ledger entry cannot be changed or removed")
    void ledgerEntriesAreAppendOnly() {
        UUID transactionId = balanced("100.00");

        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE ledger_entries SET amount = 1.00 WHERE transaction_id = ?", transactionId))
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc().update("DELETE FROM ledger_entries WHERE transaction_id = ?", transactionId))
                .hasMessageContaining("append-only");
        // Statement-level, so a sweeping DELETE that matches nothing is refused too --
        // which is the point V21 makes about audit_logs: "DELETE FROM ... WHERE
        // created_yesterday" reporting success is worse than it failing.
        assertThatThrownBy(() -> jdbc().update("DELETE FROM ledger_entries WHERE amount = -1"))
                .hasMessageContaining("append-only");
    }

    @Test
    @DisplayName("a transaction cannot be changed or removed; a correction is a new row")
    void transactionsAreAppendOnly() {
        UUID transactionId = aCharge("100.00");

        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE transactions SET status = 'SUCCEEDED' WHERE id = ?", transactionId))
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc().update("DELETE FROM transactions WHERE id = ?", transactionId))
                .hasMessageContaining("append-only");
    }

    // ------------------------------------------------------------------
    // The vocabulary
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an account outside §7.2's six is refused by the database, not only by Java")
    void anUnknownAccountIsRefused() {
        UUID transactionId = aCharge("100.00");
        UUID projectId = projectOf(transactionId);

        assertThatThrownBy(() -> insertEntry(transactionId, projectId, "platform_fees", "DEBIT", "100.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertEntry(transactionId, projectId, "creator:nope", "DEBIT", "100.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a zero or negative entry is refused; the direction carries the sign")
    void aZeroOrNegativeEntryIsRefused() {
        UUID transactionId = aCharge("100.00");
        UUID projectId = projectOf(transactionId);

        assertThatThrownBy(() -> insertEntry(transactionId, projectId, "escrow", "DEBIT", "0.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertEntry(transactionId, projectId, "escrow", "DEBIT", "-1.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * §9.3's R-08 as an index, and the shape V41 chose so that a {@code PENDING} row and
     * the row that settles it can share a key.
     */
    @Test
    @DisplayName("two settled charges cannot share one idempotency key")
    void oneKeySettlesOnce() {
        UUID pledgeId = anyPledge();
        UUID projectId = anyProjectOf(pledgeId);
        String key = "collect:" + UUID.randomUUID() + ":1";

        insertTransaction(pledgeId, projectId, "SUCCEEDED", "100.00", key, "prov-" + UUID.randomUUID());

        assertThatThrownBy(() -> insertTransaction(
                        pledgeId, projectId, "SUCCEEDED", "100.00", key, "prov-" + UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a PENDING row and the row that settles it may share a key")
    void aPendingRowDoesNotBlockItsSettlement() {
        UUID pledgeId = anyPledge();
        UUID projectId = anyProjectOf(pledgeId);
        String key = "collect:" + UUID.randomUUID() + ":1";
        String providerTransactionId = "prov-" + UUID.randomUUID();

        insertTransaction(pledgeId, projectId, "PENDING", "100.00", key, providerTransactionId);
        insertTransaction(pledgeId, projectId, "SUCCEEDED", "100.00", key, providerTransactionId);

        assertThat(transactionCountFor(key)).isEqualTo(2);
    }

    @Test
    @DisplayName("a failed transaction has to say why")
    void aFailureSaysWhy() {
        UUID pledgeId = anyPledge();
        UUID projectId = anyProjectOf(pledgeId);

        assertThatThrownBy(() -> jdbc().update(
                        """
                        INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency,
                                                  provider, attempt_number, idempotency_key)
                        VALUES (?, ?, ?, 'CHARGE', 'FAILED', 100.00, 'AZN', 'AZERICARD', 1, ?)
                        """,
                        UUID.randomUUID(),
                        pledgeId,
                        projectId,
                        "no-reason-" + UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /**
     * A charge row to hang entries from, with no entries of its own.
     *
     * <p>Reuses whatever pledge the suite finds, because these tests are about the ledger
     * rather than about a campaign; {@link #anyPledge()} creates one if the database has
     * none.
     */
    private UUID aCharge(String amount) {
        UUID pledgeId = anyPledge();
        UUID projectId = anyProjectOf(pledgeId);
        UUID transactionId = UUID.randomUUID();
        insertTransaction(
                transactionId,
                pledgeId,
                projectId,
                "SUCCEEDED",
                amount,
                "ledger-test-" + transactionId,
                "prov-" + transactionId);
        return transactionId;
    }

    /** A charge with a balanced pair of entries already on it. */
    private UUID balanced(String amount) {
        UUID transactionId = aCharge(amount);
        UUID projectId = projectOf(transactionId);
        jdbc().execute(
                        """
                        BEGIN;
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES ('%s', 'escrow', 'DEBIT', %s, 'AZN', '%s'),
                               ('%s', 'platform_fee', 'CREDIT', %s, 'AZN', '%s');
                        COMMIT;
                        """
                                .formatted(transactionId, amount, projectId, transactionId, amount, projectId));
        return transactionId;
    }

    private void insertEntry(UUID transactionId, UUID projectId, String account, String direction, String amount) {
        jdbc().update(
                        """
                        INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id)
                        VALUES (?, ?, ?, CAST(? AS numeric), 'AZN', ?)
                        """,
                        transactionId,
                        account,
                        direction,
                        amount,
                        projectId);
    }

    private void insertTransaction(
            UUID pledgeId, UUID projectId, String status, String amount, String key, String providerTransactionId) {
        insertTransaction(UUID.randomUUID(), pledgeId, projectId, status, amount, key, providerTransactionId);
    }

    private void insertTransaction(
            UUID id,
            UUID pledgeId,
            UUID projectId,
            String status,
            String amount,
            String key,
            String providerTransactionId) {
        jdbc().update(
                        """
                        INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency,
                                                  provider, provider_transaction_id, attempt_number, idempotency_key)
                        VALUES (?, ?, ?, 'CHARGE', ?, CAST(? AS numeric), 'AZN', 'AZERICARD', ?, 1, ?)
                        """,
                        id,
                        pledgeId,
                        projectId,
                        status,
                        amount,
                        providerTransactionId,
                        key);
    }

    /**
     * Any pledge in the database, or a fresh campaign and pledge if there is none.
     *
     * <p>These tests need a row to reference and do not care which; V41's foreign keys are
     * {@code ON DELETE NO ACTION}, so nothing here can be tidied up afterwards and
     * creating a campaign per assertion would leave a great many behind.
     */
    private UUID anyPledge() {
        if (sharedPledgeId == null) {
            UUID creatorId = Campaigns.creator(dataSource, "ledger-schema");
            UUID projectId = Campaigns.seed(dataSource, creatorId, "ledger-schema")
                    .state("COLLECTING")
                    .goal("100.00")
                    .insert();
            sharedPledgeId = Pledges.confirmed(dataSource, projectId, "ledger-schema-b", "100.00");
        }
        return sharedPledgeId;
    }

    private UUID anyProjectOf(UUID pledge) {
        return jdbc().queryForObject("SELECT project_id FROM pledges WHERE id = ?", UUID.class, pledge);
    }

    private UUID projectOf(UUID transactionId) {
        return jdbc().queryForObject("SELECT project_id FROM transactions WHERE id = ?", UUID.class, transactionId);
    }

    private int entryCount(UUID transactionId) {
        Integer count = jdbc().queryForObject(
                "SELECT count(*) FROM ledger_entries WHERE transaction_id = ?", Integer.class, transactionId);
        return count == null ? 0 : count;
    }

    private int transactionCountFor(String key) {
        Integer count = jdbc().queryForObject(
                "SELECT count(*) FROM transactions WHERE idempotency_key = ?", Integer.class, key);
        return count == null ? 0 : count;
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
