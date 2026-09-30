package az.ideanest.subscription.application;

import az.ideanest.shared.finance.RevenueFigures;
import az.ideanest.subscription.infrastructure.SubscriptionRevenueRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The subscription journal as sums and counts, answering {@link RevenueFigures} — #205, part of #202.
 *
 * <p><strong>No row ever leaves this class.</strong> Everything here is a {@code SUM} or a
 * {@code COUNT} grouped by day or by plan, so there is no payment id, payer, reference or
 * per-payment amount to hand on. That is what lets {@code staff}'s partner statistics be built
 * on the real journal without the partner's response being able to contain a transaction: the
 * data it is given does not have one.
 *
 * <p><strong>There is no staff check here, on purpose and with a limit.</strong>
 * {@link SubscriptionRevenue} checks {@code CONFIGURE_PLATFORM} because it returns rows and
 * payers. This returns neither, and its one caller scales the figures by a percentage before
 * anybody sees them, so that caller is where the authority is checked and recorded. A second
 * caller that returned these figures unscaled to somebody who should see a share would be the
 * defect this paragraph is here to prevent: read the caller's check before adding one.
 *
 * <p>Days are Baku's, and a window is at most {@link RevenuePeriod#MAX_DAYS} days, for the
 * reasons {@link RevenuePeriod} gives.
 */
@Service
public class SubscriptionFigures implements RevenueFigures {

    private final SubscriptionRevenueRepository journal;

    public SubscriptionFigures(SubscriptionRevenueRepository journal) {
        this.journal = journal;
    }

    /**
     * What arrived each day in each currency.
     *
     * @param from inclusive
     * @param to exclusive
     * @throws InvalidRevenuePeriodException when the window is empty or longer than a year
     */
    @Override
    @Transactional(readOnly = true)
    public List<DayFigures> perDay(Instant from, Instant to) {
        RevenuePeriod window = new RevenuePeriod(from, to);
        return journal.totalsByDay(window.from(), window.to()).stream()
                .map(row -> new DayFigures(
                        LocalDate.parse(row.getDay()),
                        row.getCurrency(),
                        row.getNet(),
                        row.getPayments(),
                        row.getReversals()))
                .toList();
    }

    /**
     * What each plan brought in over a window, per currency.
     *
     * @param from inclusive
     * @param to exclusive
     */
    @Override
    @Transactional(readOnly = true)
    public List<PlanFigures> perPlan(Instant from, Instant to) {
        RevenuePeriod window = new RevenuePeriod(from, to);
        return journal.figuresByPlan(window.from(), window.to()).stream()
                .map(row -> new PlanFigures(
                        row.getPlanCode(),
                        row.getPlanName(),
                        row.getCurrency(),
                        row.getNet(),
                        row.getPayments(),
                        row.getReversals()))
                .toList();
    }
}
