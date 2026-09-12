package az.ideanest.subscription.infrastructure;

import az.ideanest.subscription.domain.SubscriptionPayment;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * V73's journal read as a report — #23's second step.
 *
 * <h2>Why these are native queries</h2>
 *
 * <p>Not preference: the other repositories in this module are JPQL and these are the
 * ones that are actually SQL. Three of the four are {@code GROUP BY} with conditional
 * sums, the fourth is a keyset page whose predicate is a row-value comparison, and every
 * one of them carries four optional filters. Expressed in JPQL that is either a
 * {@code CriteriaBuilder} assembly this codebase uses nowhere else, or — following
 * {@link az.ideanest.audit.AuditEntryRepository} — sixteen methods for one query.
 *
 * <p>{@code CAST(:param AS …)} on every optional filter, and it is load-bearing.
 * {@code AuditEntryRepository}'s header records what a null parameter with nothing to
 * infer a type from costs: the whole of AD-14 answered 500. That file's answer was
 * sentinel bounds and no nullable parameters at all; here the cast states the type to
 * PostgreSQL directly, which is available because these are native. A filter left out is
 * a null that the cast still types, so {@code IS NULL} short-circuits the comparison and
 * the planner drops the branch.
 *
 * <h2>Why the period bounds are not optional</h2>
 *
 * <p>Half-open, {@code from} inclusive and {@code to} exclusive, matching every other
 * window on this platform. The service always supplies both — an unbounded revenue report
 * is "every payment the platform has ever taken" one absent parameter away, and it is one
 * request in the log rather than the hundreds paging would have been.
 *
 * <h2>{@code received_at}, never {@code recorded_at}</h2>
 *
 * <p>Every query here groups and pages by when the money arrived rather than when
 * somebody typed it in. A transfer that cleared on the 31st and was recorded on the 3rd
 * belongs to the month it cleared, or the report disagrees with the bank statement it is
 * being checked against — which is the one document it will always be checked against.
 */
public interface SubscriptionRevenueRepository extends Repository<SubscriptionPayment, UUID> {

    /**
     * What came in, per currency.
     *
     * <p><strong>Three figures rather than one</strong>, because a single net total cannot
     * be reconciled against anything. {@code gross} is what arrived, {@code reversed} is
     * what was given back — negative, as it is stored — and {@code net} is what the
     * platform kept. An operator holding a bank statement checks the first; an accountant
     * closing a month uses the third; the difference between them is the question that
     * gets asked when the two disagree.
     *
     * <p>Grouped by currency and never summed across it. §21.2 has no rate at which one
     * currency balances another for anything that moves money, so one row per currency is
     * the only honest shape — everything is AZN today and the shape does not depend on
     * that staying true.
     */
    @Query(
            nativeQuery = true,
            value =
                    """
                    SELECT p.currency                                                       AS "currency",
                           SUM(CASE WHEN p.reverses IS NULL THEN p.amount ELSE 0 END)        AS "gross",
                           SUM(CASE WHEN p.reverses IS NOT NULL THEN p.amount ELSE 0 END)    AS "reversed",
                           SUM(p.amount)                                                     AS "net",
                           COUNT(*) FILTER (WHERE p.reverses IS NULL)                        AS "payments",
                           COUNT(*) FILTER (WHERE p.reverses IS NOT NULL)                    AS "reversals"
                      FROM subscription_payments p
                     WHERE p.received_at >= :from
                       AND p.received_at <  :to
                       AND (CAST(:planCode AS text) IS NULL OR p.plan_code = CAST(:planCode AS text))
                       AND (CAST(:accountId AS uuid) IS NULL OR p.account_id = CAST(:accountId AS uuid))
                       AND (CAST(:method AS text) IS NULL OR p.method = CAST(:method AS text))
                     GROUP BY p.currency
                     ORDER BY p.currency
                    """)
    List<CurrencyTotal> totalsByCurrency(
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("planCode") String planCode,
            @Param("accountId") UUID accountId,
            @Param("method") String method);

    /**
     * What came in, per plan.
     *
     * <p><strong>Grouped by the name as well as the code</strong>, which looks like a
     * mistake and is the whole point. V62 makes a plan editable, so a plan renamed
     * mid-period has payments carrying two different names — and both are true, each of
     * them the name in force when that money arrived. Grouping by the code alone would
     * need one name chosen for the group, and any choice retitles history: the most recent
     * one rewrites March in April, and an arbitrary one is worse. So a rename shows as two
     * rows under one code, which is what actually happened.
     *
     * <p>Net only. A reversal belongs to the plan it reverses and nets against it here;
     * the gross-and-reversed split is {@link #totalsByCurrency} 's job, where it is a
     * figure somebody reconciles rather than a breakdown they read.
     */
    @Query(
            nativeQuery = true,
            value =
                    """
                    SELECT p.plan_code                  AS "planCode",
                           p.plan_name                  AS "planName",
                           p.currency                   AS "currency",
                           p.billing_period             AS "billingPeriod",
                           SUM(p.amount)                AS "net",
                           COUNT(*)                     AS "entries"
                      FROM subscription_payments p
                     WHERE p.received_at >= :from
                       AND p.received_at <  :to
                       AND (CAST(:planCode AS text) IS NULL OR p.plan_code = CAST(:planCode AS text))
                       AND (CAST(:accountId AS uuid) IS NULL OR p.account_id = CAST(:accountId AS uuid))
                       AND (CAST(:method AS text) IS NULL OR p.method = CAST(:method AS text))
                     GROUP BY p.plan_code, p.plan_name, p.currency, p.billing_period
                     ORDER BY p.plan_code, p.plan_name, p.currency
                    """)
    List<PlanTotal> totalsByPlan(
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("planCode") String planCode,
            @Param("accountId") UUID accountId,
            @Param("method") String method);

    /**
     * What came in, per way of being paid.
     *
     * <p>The breakdown a reconciliation actually starts from: the bank statement accounts
     * for the transfers and nothing else, so "everything except {@code BANK_TRANSFER}" is
     * the list somebody has to check against receipts by hand.
     */
    @Query(
            nativeQuery = true,
            value =
                    """
                    SELECT p.method        AS "method",
                           p.currency      AS "currency",
                           SUM(p.amount)   AS "net",
                           COUNT(*)        AS "entries"
                      FROM subscription_payments p
                     WHERE p.received_at >= :from
                       AND p.received_at <  :to
                       AND (CAST(:planCode AS text) IS NULL OR p.plan_code = CAST(:planCode AS text))
                       AND (CAST(:accountId AS uuid) IS NULL OR p.account_id = CAST(:accountId AS uuid))
                       AND (CAST(:method AS text) IS NULL OR p.method = CAST(:method AS text))
                     GROUP BY p.method, p.currency
                     ORDER BY p.method, p.currency
                    """)
    List<MethodTotal> totalsByMethod(
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("planCode") String planCode,
            @Param("accountId") UUID accountId,
            @Param("method") String method);

    /**
     * One page of payments, newest first.
     *
     * <p><strong>Keyset on {@code (received_at DESC, id DESC)}</strong>, which is
     * {@code subscription_payments_by_period}'s own order for the leading column, and
     * {@code AuditEntryRepository}'s argument applies unchanged: a payment recorded while
     * somebody is paging must not shift the page under them, and an offset does exactly
     * that. The tie on the instant is the normal case rather than the edge one here — a
     * backdated batch entered in one sitting shares a date — so the cursor carries both
     * halves. Written out rather than as a row comparison because the two halves are
     * compared in the same direction and PostgreSQL's own {@code (a, b) < (x, y)} would
     * read as one predicate that a reader of the plan cannot map back to the index.
     *
     * <p><strong>The account's address is a {@code LEFT JOIN} and may be null.</strong>
     * V73 has no foreign key to {@code users} on purpose — a receipt outlives the account
     * that paid it — so the join is the one place this shows: a payment from a closed
     * account still appears, with its amount and its plan, and nothing to name the payer
     * but the identifier. That is the correct answer rather than a gap; the alternative
     * is a report that quietly under-reports revenue by the accounts that have since left.
     * §17.4's anonymiser blanks the address in place, which this follows for free.
     */
    @Query(
            nativeQuery = true,
            value =
                    """
                    SELECT p.id                 AS "id",
                           p.subscription_id    AS "subscriptionId",
                           p.account_id         AS "accountId",
                           u.email              AS "accountEmail",
                           u.name               AS "accountName",
                           p.plan_id            AS "planId",
                           p.plan_code          AS "planCode",
                           p.plan_name          AS "planName",
                           p.amount             AS "amount",
                           p.currency           AS "currency",
                           p.billing_period     AS "billingPeriod",
                           p.method             AS "method",
                           p.reference          AS "reference",
                           p.note               AS "note",
                           p.received_at        AS "receivedAt",
                           p.recorded_at        AS "recordedAt",
                           p.recorded_by        AS "recordedBy",
                           p.reverses           AS "reverses"
                      FROM subscription_payments p
                      LEFT JOIN users u ON u.id = p.account_id
                     WHERE p.received_at >= :from
                       AND p.received_at <  :to
                       AND (CAST(:planCode AS text) IS NULL OR p.plan_code = CAST(:planCode AS text))
                       AND (CAST(:accountId AS uuid) IS NULL OR p.account_id = CAST(:accountId AS uuid))
                       AND (CAST(:method AS text) IS NULL OR p.method = CAST(:method AS text))
                       AND (CAST(:before AS timestamptz) IS NULL
                            OR p.received_at < CAST(:before AS timestamptz)
                            OR (p.received_at = CAST(:before AS timestamptz) AND p.id < CAST(:beforeId AS uuid)))
                     ORDER BY p.received_at DESC, p.id DESC
                     LIMIT :limit
                    """)
    List<PaymentRow> page(
            @Param("from") Instant from,
            @Param("to") Instant to,
            @Param("planCode") String planCode,
            @Param("accountId") UUID accountId,
            @Param("method") String method,
            @Param("before") Instant before,
            @Param("beforeId") UUID beforeId,
            @Param("limit") int limit);

    /**
     * One currency's three figures.
     *
     * <p>Interface projections rather than records, because these are native queries: a
     * constructor expression is a JPQL feature, and the alternative — {@code Object[]} with
     * positional casts in the service — is a mapping nothing checks. The quoted aliases
     * above are what bind the columns to these getters, and the quotes are required:
     * PostgreSQL folds an unquoted alias to lower case, and {@code planCode} would arrive
     * as {@code plancode}.
     */
    interface CurrencyTotal {

        String getCurrency();

        /** What arrived, reversals excluded. */
        BigDecimal getGross();

        /** What was given back. Negative or zero, as it is stored. */
        BigDecimal getReversed();

        /** What the platform kept: {@code gross + reversed}. */
        BigDecimal getNet();

        long getPayments();

        long getReversals();
    }

    /** One plan's net, under the name it carried while that money arrived. */
    interface PlanTotal {

        String getPlanCode();

        String getPlanName();

        String getCurrency();

        String getBillingPeriod();

        BigDecimal getNet();

        /** Rows, payments and reversals together — see {@link #getNet()}. */
        long getEntries();
    }

    /** One method's net. */
    interface MethodTotal {

        String getMethod();

        String getCurrency();

        BigDecimal getNet();

        long getEntries();
    }

    /** One payment, with the payer named if the platform still knows who they were. */
    interface PaymentRow {

        UUID getId();

        UUID getSubscriptionId();

        UUID getAccountId();

        /** Null when the account has been closed or anonymised — see the query. */
        String getAccountEmail();

        /** Null for the same reason as the address. */
        String getAccountName();

        UUID getPlanId();

        String getPlanCode();

        String getPlanName();

        BigDecimal getAmount();

        String getCurrency();

        String getBillingPeriod();

        String getMethod();

        String getReference();

        String getNote();

        Instant getReceivedAt();

        Instant getRecordedAt();

        UUID getRecordedBy();

        /** The payment this row reverses, or null on an ordinary one. */
        UUID getReverses();
    }
}
