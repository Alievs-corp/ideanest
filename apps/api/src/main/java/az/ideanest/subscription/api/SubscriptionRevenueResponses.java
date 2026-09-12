package az.ideanest.subscription.api;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.application.PaymentPage;
import az.ideanest.subscription.application.RevenueReport;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.PaymentMethod;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What the revenue screen is told — #23.
 *
 * <p><strong>Money travels as a string with its currency beside it</strong>, in the flat
 * shape {@link SubscriptionResponses} already uses for a plan's price, so the console reads
 * one money shape across AD-11 rather than two. §10.3 and CLAUDE.md: a JSON number is an
 * IEEE 754 double in every mainstream parser, and a revenue total is the last place a
 * rounding error should be allowed to appear silently.
 *
 * <p><strong>Every record here carries the {@code SubscriptionRevenue} or
 * {@code SubscriptionPayment} prefix, and that is not verbosity.</strong> springdoc names a
 * schema by the record's simple name and keeps the first it meets, so a second record of the
 * same name anywhere in the service is not an error — it is silently documented as the
 * first. The first draft of this file named its totals {@code Report}, and the exported
 * contract described the revenue endpoint as returning the reconciliation report's
 * {@code Report} ({@code accountsChecked}, {@code balanced}, {@code findings}); the web
 * client generated from it would have typed the revenue screen's data as a reconciliation
 * run. Nothing failed: the contract test compares the file with the application, and both
 * agreed on the wrong answer.
 *
 * <p><strong>The period and the filter come back with the figures.</strong> A request that
 * named no period got the current month, and a screen that cannot say which month it is
 * showing is a screen whose total will be quoted against the wrong one.
 */
public final class SubscriptionRevenueResponses {

    private SubscriptionRevenueResponses() {
    }

    /** The totals for one period, as the screen draws them. */
    public record SubscriptionRevenueReport(
            Instant from,
            Instant to,
            SubscriptionRevenueFilter filter,
            List<SubscriptionRevenueCurrencyTotal> currencies,
            List<SubscriptionRevenuePlanTotal> plans,
            List<SubscriptionRevenueMethodTotal> methods) {

        public static SubscriptionRevenueReport of(RevenueReport report) {
            return new SubscriptionRevenueReport(
                    report.period().from(),
                    report.period().to(),
                    new SubscriptionRevenueFilter(
                            report.filter().planCode(),
                            report.filter().accountId(),
                            report.filter().method()),
                    report.currencies().stream().map(SubscriptionRevenueCurrencyTotal::of).toList(),
                    report.plans().stream().map(SubscriptionRevenuePlanTotal::of).toList(),
                    report.methods().stream().map(SubscriptionRevenueMethodTotal::of).toList());
        }
    }

    /** What was asked, with null meaning "any". */
    public record SubscriptionRevenueFilter(String planCode, UUID accountId, PaymentMethod method) {
    }

    /**
     * One currency's three figures.
     *
     * @param reversed zero or negative, as stored, so that {@code gross + reversed = net}
     *     is arithmetic a reader can do on the screen rather than a claim they have to trust
     */
    public record SubscriptionRevenueCurrencyTotal(
            String currency, String gross, String reversed, String net, long payments, long reversals) {

        static SubscriptionRevenueCurrencyTotal of(RevenueReport.Currency total) {
            return new SubscriptionRevenueCurrencyTotal(
                    total.net().currency(),
                    amountOf(total.gross()),
                    amountOf(total.reversed()),
                    amountOf(total.net()),
                    total.payments(),
                    total.reversals());
        }
    }

    /**
     * One plan's net under one name. A renamed plan is two of these with one code —
     * {@link RevenueReport.Plan} says why that is the truthful shape.
     */
    public record SubscriptionRevenuePlanTotal(
            String planCode, String planName, BillingPeriod billingPeriod, String currency, String net, long entries) {

        static SubscriptionRevenuePlanTotal of(RevenueReport.Plan total) {
            return new SubscriptionRevenuePlanTotal(
                    total.code(),
                    total.name(),
                    total.billingPeriod(),
                    total.net().currency(),
                    amountOf(total.net()),
                    total.entries());
        }
    }

    /** One method's net. */
    public record SubscriptionRevenueMethodTotal(
            PaymentMethod method, String currency, String net, long entries) {

        static SubscriptionRevenueMethodTotal of(RevenueReport.Method total) {
            return new SubscriptionRevenueMethodTotal(
                    total.method(), total.net().currency(), amountOf(total.net()), total.entries());
        }
    }

    /**
     * One page of payments.
     *
     * @param nextCursor null at the end, and never an empty string
     */
    public record SubscriptionPaymentList(List<SubscriptionPaymentEntry> payments, String nextCursor) {

        public static SubscriptionPaymentList of(PaymentPage page) {
            return new SubscriptionPaymentList(
                    page.payments().stream().map(SubscriptionPaymentEntry::of).toList(), page.nextCursor());
        }
    }

    /**
     * One payment.
     *
     * @param accountEmail null when the account is closed or anonymised. The payment is
     *     still here and still counts: V73 keeps a receipt past the account that paid it
     * @param amount signed — negative on a reversal
     * @param reversal whether this row undoes another. Sent as a flag as well as
     *     {@code reverses}, so a client draws the distinction without having to know that a
     *     non-null identifier is what makes it
     */
    public record SubscriptionPaymentEntry(
            UUID id,
            UUID subscriptionId,
            UUID accountId,
            String accountEmail,
            String accountName,
            UUID planId,
            String planCode,
            String planName,
            BillingPeriod billingPeriod,
            String amount,
            String currency,
            PaymentMethod method,
            String reference,
            String note,
            Instant receivedAt,
            Instant recordedAt,
            UUID recordedBy,
            UUID reverses,
            boolean reversal) {

        static SubscriptionPaymentEntry of(PaymentPage.Payment payment) {
            return new SubscriptionPaymentEntry(
                    payment.id(),
                    payment.subscriptionId(),
                    payment.accountId(),
                    payment.accountEmail(),
                    payment.accountName(),
                    payment.planId(),
                    payment.planCode(),
                    payment.planName(),
                    payment.billingPeriod(),
                    amountOf(payment.amount()),
                    payment.amount().currency(),
                    payment.method(),
                    payment.reference(),
                    payment.note(),
                    payment.receivedAt(),
                    payment.recordedAt(),
                    payment.recordedBy(),
                    payment.reverses(),
                    payment.isReversal());
        }
    }

    /** {@code toPlainString}, never {@code toString}: "5E+3" is not an amount a client should parse. */
    private static String amountOf(Money money) {
        return money.amount().toPlainString();
    }
}
