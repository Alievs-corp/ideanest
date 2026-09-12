package az.ideanest.subscription.application;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.PaymentMethod;
import az.ideanest.subscription.infrastructure.SubscriptionRevenueRepository;
import java.util.List;

/**
 * What the platform was paid in one period — #23's totals.
 *
 * <h2>Three breakdowns, and no grand total</h2>
 *
 * <p>There is deliberately no single number on this object. §21.2 gives no rate at which
 * one currency balances another for anything that moves money, so "revenue in September"
 * is a figure per currency and adding them would be the one mistake this whole feature
 * exists to make impossible. Everything is AZN today; the shape does not depend on that
 * staying true, and the day it stops being true nothing here has to change.
 *
 * <h2>Why the projections are copied into records</h2>
 *
 * <p>{@link SubscriptionRevenueRepository}'s interfaces are proxies over a result set.
 * Handing them to a controller would put the persistence layer's own types on the API's
 * boundary and make the response's shape depend on a query's aliases; copying is a loop
 * over a handful of rows, and it is where the amounts become {@link Money} rather than
 * bare {@link java.math.BigDecimal}s that a caller could add across currencies.
 *
 * @param period the window these figures are about, which the client is told back because
 *     a request that named no period got a default and the screen has to label what it is
 *     showing
 * @param filter what was asked, for the same reason
 * @param currencies one row per currency: what arrived, what was given back, what was kept
 * @param plans one row per plan and name — see {@link Plan} on why the name is part of the
 *     grouping
 * @param methods one row per way of being paid, which is where a reconciliation starts
 */
public record RevenueReport(
        RevenuePeriod period,
        RevenueFilter filter,
        List<Currency> currencies,
        List<Plan> plans,
        List<Method> methods) {

    /**
     * One currency's three figures.
     *
     * @param gross what arrived, reversals excluded
     * @param reversed what was given back. Zero or negative, as it is stored — a figure
     *     shown as a negative rather than as a positive labelled "refunds", so that
     *     {@code gross + reversed = net} is visible on the screen rather than asserted
     * @param net what the platform kept
     * @param payments how many payments arrived
     * @param reversals how many of them were reversed. Separate from {@code payments}
     *     because "forty payments" and "forty payments, three of them reversed" are
     *     different months and a count that merged them would hide the second
     */
    public record Currency(
            Money gross, Money reversed, Money net, long payments, long reversals) {

        static Currency of(SubscriptionRevenueRepository.CurrencyTotal total) {
            String currency = total.getCurrency();
            return new Currency(
                    Money.of(total.getGross(), currency),
                    Money.of(total.getReversed(), currency),
                    Money.of(total.getNet(), currency),
                    total.getPayments(),
                    total.getReversals());
        }
    }

    /**
     * One plan's net, under the name it carried while that money arrived.
     *
     * <p><strong>The name is part of the grouping, not a label attached to the code.</strong>
     * A plan renamed mid-period has payments carrying two names and both are true, so this
     * reports two rows under one code rather than choosing a name — any choice retitles
     * history, and the most recent one rewrites March in April. V73's header argues the
     * same point about the snapshot itself.
     *
     * @param entries rows, payments and reversals together, since {@code net} nets them
     */
    public record Plan(
            String code, String name, BillingPeriod billingPeriod, Money net, long entries) {

        static Plan of(SubscriptionRevenueRepository.PlanTotal total) {
            return new Plan(
                    total.getPlanCode(),
                    total.getPlanName(),
                    BillingPeriod.valueOf(total.getBillingPeriod()),
                    Money.of(total.getNet(), total.getCurrency()),
                    total.getEntries());
        }
    }

    /** One method's net. */
    public record Method(PaymentMethod method, Money net, long entries) {

        static Method of(SubscriptionRevenueRepository.MethodTotal total) {
            return new Method(
                    PaymentMethod.valueOf(total.getMethod()),
                    Money.of(total.getNet(), total.getCurrency()),
                    total.getEntries());
        }
    }
}
