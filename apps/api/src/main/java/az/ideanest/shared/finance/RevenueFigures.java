package az.ideanest.shared.finance;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * The subscription journal as sums and counts, asked from outside the module that owns it —
 * #205, part of #202.
 *
 * <p><strong>A published question, not a shortcut.</strong> The staff module produces the
 * partner statistics and the subscription module owns the journal the figures come from, and
 * each already depends on the other through the console. A direct call from one to the other
 * closes a cycle, which {@code ModuleBoundaryTests} refuses, so the question is published here
 * and answered by the subscription module, as {@code PlatformStaff} and {@code ProjectSummaries}
 * are for the same reason.
 *
 * <p><strong>No row can cross this interface.</strong> Every value is a {@code SUM} or a
 * {@code COUNT} grouped by day or by plan: there is no payment identifier, payer, reference or
 * per-payment amount in any type below for an implementation to fill in or a caller to forget
 * to strip. That is what lets a partner's statistics be built on the real journal without the
 * partner's response being able to contain a transaction.
 *
 * <p><strong>It decides nothing and checks nothing.</strong> The caller is where authority is
 * checked and where the figures are scaled by a percentage before anybody sees them. A second
 * caller that returned these figures unscaled to somebody who should see a share would be the
 * defect this paragraph exists to prevent: read the caller's check before adding one.
 *
 * <p>Days are Baku's. A window is at most a year, for {@code RevenuePeriod}'s reasons.
 */
public interface RevenueFigures {

    /**
     * What arrived each day in each currency.
     *
     * @param from inclusive
     * @param to exclusive. An implementation refuses an empty window or one longer than a year
     */
    List<DayFigures> perDay(Instant from, Instant to);

    /**
     * What each plan brought in over a window, per currency.
     *
     * @param from inclusive
     * @param to exclusive. An implementation refuses an empty window or one longer than a year
     */
    List<PlanFigures> perPlan(Instant from, Instant to);

    /**
     * One day in one currency.
     *
     * @param net what the platform kept that day: payments plus reversals, which are negative
     * @param payments payments received, reversals excluded
     * @param reversals reversals recorded
     */
    record DayFigures(LocalDate day, String currency, BigDecimal net, long payments, long reversals) {}

    /**
     * One plan over a window, under the name it carried while that money arrived.
     *
     * @param net payments plus reversals
     */
    record PlanFigures(
            String planCode, String planName, String currency, BigDecimal net, long payments, long reversals) {}
}
