package az.ideanest.subscription.application;

import az.ideanest.subscription.domain.PaymentMethod;
import java.util.Locale;
import java.util.UUID;

/**
 * Which payments a report is about — #23.
 *
 * <p>Three axes, all optional, all combining with each other and with the period. Null
 * means "any" and never "none": an absent filter widens the question, and the day one of
 * these comes to mean "no rows" is the day a report shows zero revenue for a month that
 * had some.
 *
 * <p><strong>No text search.</strong> The columns somebody would search — a transfer
 * reference, a note — are exactly the ones a reconciliation looks up one at a time, and a
 * substring match over them is a scan of the journal with no index behind it. When that is
 * the thing people actually need, it is a trigram index and its own decision rather than a
 * parameter added quietly to a report.
 *
 * @param planCode one plan, by the code payments carry rather than by the plan's
 *     identifier. The code is immutable — {@code SubscriptionPlans.change} cannot alter it
 *     — so it is the one handle on a plan that means the same thing in March and in
 *     December, which is what a report needs and what {@code plan_id} very nearly is
 * @param accountId one account. The whole of the per-account history: the console's
 *     account page asks this question with a period wide enough to cover the account's
 *     life
 * @param method one way of being paid, which is where a reconciliation starts — the bank
 *     statement accounts for the transfers and nothing else
 */
public record RevenueFilter(String planCode, UUID accountId, PaymentMethod method) {

    /** Everything in the period. */
    public static final RevenueFilter ANY = new RevenueFilter(null, null, null);

    public RevenueFilter {
        // `Locale.ROOT`, for the reason `SubscriptionPlan.normalise` and `Slugs` both
        // give: the platform's default locale is Azerbaijani, where `"i".toUpperCase()` is
        // `"İ"` — so a filter for a plan code containing an i would match nothing, on a
        // deployment configured exactly as production is.
        planCode = planCode == null || planCode.isBlank() ? null : planCode.trim().toUpperCase(Locale.ROOT);
    }

    /** The method as the column holds it, or null — what the native queries bind. */
    public String methodName() {
        return method == null ? null : method.name();
    }

    /** Whether this narrows anything at all, which is what a log line and an audit detail say. */
    public boolean isAny() {
        return planCode == null && accountId == null && method == null;
    }
}
