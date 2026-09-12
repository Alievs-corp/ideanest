package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * What V73 refuses about a record of money received.
 *
 * <p><strong>The tests that carry the design are {@link #anUpdateIsRefused()},
 * {@link #aDeleteIsRefused()} and {@link #aPaymentOutlivesTheSubscriptionItPaidFor()}.</strong>
 * The first two are {@code AuditLogSchemaTests}' property on a different table and for a
 * stronger reason — this is the platform's only note that a transfer arrived, and while
 * #60 is unanswered there is no provider-side record to reconstruct it from. The third is
 * the one that looks like a missing foreign key and is not: V62 cascades a subscription
 * away with its account, and a receipt that cascaded with it would be revenue deleted
 * because the payer closed their account.
 *
 * <p>Asserted against a real PostgreSQL, because a trigger and a CHECK are not something
 * an in-memory substitute reproduces.
 *
 * <p>Deliberately not {@code @Transactional}: a statement that violates a constraint
 * aborts the surrounding transaction, so each of these needs its own, which a
 * {@link JdbcTemplate} against an auto-committing connection gives.
 *
 * <p><strong>And deliberately no cleanup</strong>, which this table cannot have by
 * construction — {@code TRUNCATE} is refused with the rest. Every test invents its own
 * identifiers and asserts only about rows carrying them, which is how a reader of this
 * table has to work anyway.
 */
class SubscriptionPaymentSchemaTests extends AbstractIntegrationTest {

    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    /**
     * One row, spelled out, so that a test varying one column is varying exactly one
     * thing. The identifiers are invented rather than looked up — that is the property
     * {@link #aPaymentOutlivesTheSubscriptionItPaidFor()} is about.
     */
    private UUID insert(String planCode, String amount, String currency, String method, UUID reverses) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        """
                        INSERT INTO subscription_payments (
                            id, subscription_id, account_id, plan_id, plan_code, plan_name,
                            amount, currency, billing_period, method, reference, note,
                            received_at, recorded_by, reverses)
                        VALUES (?, ?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, now(), ?, ?)
                        """,
                        id,
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        planCode,
                        "Growth",
                        amount,
                        currency,
                        "MONTHLY",
                        method,
                        "transfer 44",
                        "a note",
                        Identifiers.newIdentifier(),
                        reverses);
        return id;
    }

    private UUID insertSucceeded() {
        return insert("GROWTH", "49.00", "AZN", "BANK_TRANSFER", null);
    }

    @Test
    @DisplayName("an ordinary payment is accepted")
    void theHappyPathInserts() {
        assertThatCode(this::insertSucceeded).doesNotThrowAnyException();
    }

    // -----------------------------------------------------------------------
    // Append-only
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("an UPDATE against the table is refused by PostgreSQL")
    void anUpdateIsRefused() {
        UUID id = insertSucceeded();

        // Editing this row is how a record of what the platform was paid becomes a record
        // of whatever the last person to touch it preferred, and no application-side rule
        // reaches a support session with psql open. A correction is a reversing row.
        assertThatThrownBy(() -> jdbc().update("UPDATE subscription_payments SET amount = 1 WHERE id = ?", id))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");

        assertThat(jdbc().queryForObject("SELECT amount FROM subscription_payments WHERE id = ?", BigDecimal.class, id))
                .isEqualByComparingTo("49.00");
    }

    @Test
    @DisplayName("a DELETE against the table is refused, matching rows or not")
    void aDeleteIsRefused() {
        UUID id = insertSucceeded();

        assertThatThrownBy(() -> jdbc().update("DELETE FROM subscription_payments WHERE id = ?", id))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");

        // A statement that matches nothing is refused too — what statement-level buys over
        // row-level. "DELETE FROM subscription_payments WHERE received_at < ..." reporting
        // zero rows would read as "there was nothing there" rather than as a rule.
        assertThatThrownBy(
                        () -> jdbc().update("DELETE FROM subscription_payments WHERE id = ?", Identifiers.newIdentifier()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");

        assertThat(jdbc().queryForObject("SELECT count(*) FROM subscription_payments WHERE id = ?", Integer.class, id))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("TRUNCATE is refused as well")
    void aTruncateIsRefused() {
        insertSucceeded();

        // The statement somebody reaches for when DELETE has just refused them.
        assertThatThrownBy(() -> jdbc().execute("TRUNCATE TABLE subscription_payments"))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("append-only");
    }

    // -----------------------------------------------------------------------
    // Rows that would be read the wrong way
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a payment of nothing is refused, because it would sit in a history as one")
    void zeroIsNotAPayment() {
        assertThatThrownBy(() -> insert("GROWTH", "0.00", "AZN", "BANK_TRANSFER", null))
                .isInstanceOf(DataIntegrityViolationException.class);

        // A negative is accepted, though, and that is the point: a correction on an
        // append-only table is a reversing row, so every total here is a sum that nets.
        assertThatCode(() -> insert("GROWTH", "-49.00", "AZN", "BANK_TRANSFER", null)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("the currency is a currency and the method is one the platform reconciles")
    void theVocabularyIsHeld() {
        assertThatThrownBy(() -> insert("GROWTH", "49.00", "manat", "BANK_TRANSFER", null))
                .isInstanceOf(DataIntegrityViolationException.class);

        // Not a closed list on a whim: nobody adds a way of being paid without the
        // platform learning to reconcile it. A plan code is the opposite case and V62
        // leaves it as free text with a shape.
        assertThatThrownBy(() -> insert("GROWTH", "49.00", "AZN", "CRYPTO", null))
                .isInstanceOf(DataIntegrityViolationException.class);

        // And the plan code keeps V62's shape, so that a report grouping by it does not
        // show `growth` and `GROWTH` as two plans.
        assertThatThrownBy(() -> insert("growth", "49.00", "AZN", "BANK_TRANSFER", null))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a payment is reversed once, and never by itself")
    void aReversalIsSingularAndPointsElsewhere() {
        UUID paid = insertSucceeded();

        assertThatCode(() -> insert("GROWTH", "-49.00", "AZN", "BANK_TRANSFER", paid)).doesNotThrowAnyException();

        // A second reversal of the same payment nets to the negative of a payment nobody
        // made, which is a total that cannot be reconciled against anything.
        assertThatThrownBy(() -> insert("GROWTH", "-49.00", "AZN", "BANK_TRANSFER", paid))
                .isInstanceOf(DataIntegrityViolationException.class);

        // A row reversing itself nets to zero and refers to nothing.
        UUID id = Identifiers.newIdentifier();
        assertThatThrownBy(() -> jdbc().update(
                        """
                        INSERT INTO subscription_payments (
                            id, subscription_id, account_id, plan_id, plan_code, plan_name,
                            amount, currency, billing_period, method, received_at, reverses)
                        VALUES (?, ?, ?, ?, 'GROWTH', 'Growth', -49.00, 'AZN', 'MONTHLY',
                                'BANK_TRANSFER', now(), ?)
                        """,
                        id,
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        id))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a payment outlives the subscription and the account it was paid by")
    void aPaymentOutlivesTheSubscriptionItPaidFor() {
        // Identifiers that name nothing at all, which is the shape this table accepts on
        // purpose. V62's `subscriptions.account_id` is ON DELETE CASCADE, so a closed
        // account takes its subscription with it; a foreign key here would take the
        // receipt as well, or — with NO ACTION — make closing the account fail. Either
        // way the platform would lose or block its own record of money it was paid.
        assertThatCode(this::insertSucceeded).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("the two instants are separate, so a backdated payment is visible as one")
    void receivedAndRecordedAreNotTheSameColumn() {
        UUID id = Identifiers.newIdentifier();
        Instant lastMonth = Instant.now().minus(35, ChronoUnit.DAYS);

        jdbc().update(
                        """
                        INSERT INTO subscription_payments (
                            id, subscription_id, account_id, plan_id, plan_code, plan_name,
                            amount, currency, billing_period, method, received_at)
                        VALUES (?, ?, ?, ?, 'GROWTH', 'Growth', 49.00, 'AZN', 'MONTHLY',
                                'BANK_TRANSFER', ?)
                        """,
                        id,
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        java.sql.Timestamp.from(lastMonth));

        // `received_at` is the caller's and is what every total is grouped by, so that the
        // report agrees with the bank statement it is checked against. `recorded_at` is the
        // database's, and it is what makes the backdating visible rather than silent.
        Instant received = jdbc().queryForObject(
                        "SELECT received_at FROM subscription_payments WHERE id = ?", Instant.class, id);
        Instant recorded = jdbc().queryForObject(
                        "SELECT recorded_at FROM subscription_payments WHERE id = ?", Instant.class, id);

        assertThat(received).isCloseTo(lastMonth, within(1, ChronoUnit.SECONDS));
        assertThat(recorded).isAfter(received);
    }
}
