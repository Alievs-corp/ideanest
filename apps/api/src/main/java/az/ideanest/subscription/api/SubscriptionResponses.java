package az.ideanest.subscription.api;

import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.domain.SubscriptionState;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.SortedMap;
import java.util.UUID;

/**
 * What the pricing page and the console are told.
 *
 * <p><strong>Money travels as a string.</strong> §10.3 and CLAUDE.md: a JSON number is an
 * IEEE 754 double in every mainstream parser, and 19.90 is not representable in one. The
 * currency travels beside it rather than being assumed, because assuming one is how a
 * price list ends up saying the wrong number in the wrong place.
 *
 * <p><strong>A null limit is sent as null and not as a large number.</strong> The
 * unlimited case has to stay distinguishable on the wire, for the same reason it stays
 * distinguishable in {@code PublishingAllowance}: a client that compared against a
 * sentinel would eventually render "up to 2147483647 campaigns".
 */
public final class SubscriptionResponses {

    private SubscriptionResponses() {
    }

    /**
     * One plan, as the pricing page draws it.
     *
     * @param name in the reader's language when the plan has it, otherwise the primary
     *     language's. The console always gets the primary language's
     * @param translations the console's only: every other language's name and description,
     *     by locale code. Absent from the public catalogue, which sends one language
     * @param listed sent to the console, which shows retired plans, and true for
     *     everything the public catalogue returns. Kept on both so that one type serves
     *     both readers — the alternative is two records that drift
     * @param price what the shortest period on sale costs — {@code billingPeriod}'s price
     * @param billingPeriod the shortest period the plan is sold for
     * @param prices every period it is sold for and its price, shortest first (#655). Never
     *     empty, and its first entry is {@code billingPeriod} at {@code price}
     * @param studentOnly whether only an account with an approved, unexpired student verification
     *     may buy it (#655)
     */
    public record Plan(
            UUID id,
            String code,
            String name,
            String description,
            Map<String, SubscriptionPlan.PlanTranslation> translations,
            String price,
            String currency,
            BillingPeriod billingPeriod,
            List<PlanPrice> prices,
            boolean studentOnly,
            Integer maxActiveCampaigns,
            String goalCeiling,
            boolean listed,
            int sortOrder,
            Instant updatedAt) {

        /** The plan as a reader of {@code locale} sees it. */
        public static Plan of(SubscriptionPlan plan, String locale) {
            return of(plan, plan.nameIn(locale), plan.descriptionIn(locale), null);
        }

        /** The plan as the console edits it: the primary language, and every translation beside it. */
        public static Plan forConsole(SubscriptionPlan plan) {
            return of(plan, plan.getName(), plan.getDescription(), plan.getTranslations());
        }

        private static Plan of(
                SubscriptionPlan plan, String name, String description, Map<String, SubscriptionPlan.PlanTranslation> translations) {
            return new Plan(
                    plan.getId(),
                    plan.getCode(),
                    name,
                    description,
                    translations,
                    plan.getPrice().amount().toPlainString(),
                    plan.getPrice().currency(),
                    plan.getBillingPeriod(),
                    plan.getPrices().entrySet().stream()
                            .map(entry -> new PlanPrice(
                                    entry.getKey(),
                                    entry.getValue().amount().toPlainString(),
                                    entry.getValue().currency()))
                            .toList(),
                    plan.isStudentOnly(),
                    plan.getMaxActiveCampaigns(),
                    plan.getGoalCeiling() == null ? null : plan.getGoalCeiling().toPlainString(),
                    plan.isListed(),
                    plan.getSortOrder(),
                    plan.getUpdatedAt());
        }

    }

    /**
     * What one period of a plan costs — #655. The money as a string, like every price here.
     */
    public record PlanPrice(BillingPeriod billingPeriod, String price, String currency) {
    }

    /** The catalogue. A wrapper rather than a bare array, as every list response here is. */
    public record Catalogue(List<Plan> plans) {

        public static Catalogue of(List<SubscriptionPlan> plans, String locale) {
            return new Catalogue(plans.stream().map(plan -> Plan.of(plan, locale)).toList());
        }

        public static Catalogue forConsole(List<SubscriptionPlan> plans) {
            return new Catalogue(plans.stream().map(Plan::forConsole).toList());
        }
    }

    /**
     * What one account holds.
     *
     * @param entitled <strong>the field every client should branch on</strong>, and the
     *     reason this record exists rather than the entity being serialised. It is the
     *     state and the clock together: an {@code ACTIVE} subscription whose period ended
     *     an hour ago entitles nobody, and a client deriving that from {@code state} and
     *     {@code currentPeriodEnd} is a client that will get the boundary wrong once
     * @param plan the plan as it stands now, so the page can say what the subscription
     *     currently allows. The price on {@link #price} is what was charged, which may
     *     differ — see V62 on why one is snapshotted and the other is not
     * @param paymentDue what {@code POST /v1/me/subscription/payment} would pay for now —
     *     {@code FIRST_PERIOD} or {@code RENEWAL} — or null when nothing is due (#449). The
     *     client offers "Pay" or "Renew" on this rather than working out the window itself
     * @param renewalOpensAt when renewing the running period is first offered, or null for a
     *     pending or free subscription
     * @param renewalPrices what extending the subscription by each period costs now, shortest first
     *     — #660. Only while {@code paymentDue} is {@code RENEWAL}, and empty otherwise. Its own period
     *     at its own (locked) price; any other period the plan is sold for at the plan's current
     *     price. The choices {@code POST /v1/me/subscription/payment}'s {@code billingPeriod} takes
     */
    public record Held(
            UUID id,
            SubscriptionState state,
            boolean entitled,
            Plan plan,
            String price,
            String currency,
            BillingPeriod billingPeriod,
            Instant startedAt,
            Instant currentPeriodEnd,
            boolean cancelAtPeriodEnd,
            Instant createdAt,
            Subscription.DuePayment paymentDue,
            Instant renewalOpensAt,
            List<PlanPrice> renewalPrices) {

        public static Held of(
                Subscription subscription,
                SubscriptionPlan plan,
                String locale,
                Instant now,
                Subscription.DuePayment paymentDue,
                Instant renewalOpensAt,
                SortedMap<BillingPeriod, Money> renewalPrices) {
            return new Held(
                    subscription.getId(),
                    subscription.getState(),
                    subscription.entitlesAt(now),
                    Plan.of(plan, locale),
                    subscription.getPrice().amount().toPlainString(),
                    subscription.getPrice().currency(),
                    subscription.getBillingPeriod(),
                    subscription.getStartedAt(),
                    subscription.getCurrentPeriodEnd(),
                    subscription.isCancelAtPeriodEnd(),
                    subscription.getCreatedAt(),
                    paymentDue,
                    renewalOpensAt,
                    renewalPrices.entrySet().stream()
                            .map(entry -> new PlanPrice(
                                    entry.getKey(),
                                    entry.getValue().amount().toPlainString(),
                                    entry.getValue().currency()))
                            .toList());
        }
    }

    /**
     * Where to send the creator to pay for their plan — #449.
     *
     * <p>Nothing has been paid when this is answered. The subscription changes when the provider
     * tells the platform the payment went through, which is asynchronous; a client reads
     * {@code /v1/me/subscription} again after the creator returns.
     */
    public record PaymentPage(String providerTransactionId, URI redirectUrl) {
    }

    /**
     * The answer to "what do I hold", including when the answer is nothing.
     *
     * <p>A 200 with a null subscription rather than a 404, deliberately. "This account has
     * no subscription" is an ordinary fact about a signed-in visitor opening the pricing
     * page, not an error, and a 404 would put a line in the log for every creator who has
     * not bought anything yet.
     *
     * <p><strong>{@code @JsonInclude(ALWAYS)}, against the service's own default.</strong>
     * {@code application.yml} sets {@code default-property-inclusion: non_null}, which would
     * otherwise omit {@code subscription} entirely rather than write it as {@code null} —
     * the response becomes {@code {}}, indistinguishable from a body Jackson never finished
     * writing. The client reads that as {@code undefined}, not {@code null}, and a
     * subscription-shaped page built to branch on the one and not the other renders
     * something meant for a subscription it does not have. Written out for the same reason
     * {@code NotificationResponse} is.
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Mine(Held subscription) {

        public static final Mine NONE = new Mine(null);
    }

    /**
     * One row of the console's list.
     *
     * @param accountId who holds it. The console resolves the person through AD-04's
     *     directory rather than being handed their address here — this screen is about
     *     subscriptions, and an email in the payload is personal data on a page that does
     *     not need it
     * @param activatedBy which member of staff recorded the payment, null when nobody did
     */
    public record ConsoleRow(
            UUID id,
            UUID accountId,
            SubscriptionState state,
            boolean entitled,
            String planCode,
            String planName,
            String price,
            String currency,
            BillingPeriod billingPeriod,
            Instant startedAt,
            Instant currentPeriodEnd,
            boolean cancelAtPeriodEnd,
            UUID activatedBy,
            String note,
            Instant createdAt) {

        public static ConsoleRow of(Subscription subscription, SubscriptionPlan plan, Instant now) {
            return new ConsoleRow(
                    subscription.getId(),
                    subscription.getAccountId(),
                    subscription.getState(),
                    subscription.entitlesAt(now),
                    plan == null ? null : plan.getCode(),
                    plan == null ? null : plan.getName(),
                    subscription.getPrice().amount().toPlainString(),
                    subscription.getPrice().currency(),
                    subscription.getBillingPeriod(),
                    subscription.getStartedAt(),
                    subscription.getCurrentPeriodEnd(),
                    subscription.isCancelAtPeriodEnd(),
                    subscription.getActivatedBy(),
                    subscription.getNote(),
                    subscription.getCreatedAt());
        }
    }

    /** The console's list. */
    public record ConsoleList(List<ConsoleRow> subscriptions) {
    }

    /**
     * One account's subscriptions and payments, for the console's account page — #23.
     *
     * <p>Named in full rather than {@code History}: springdoc names a schema by the record's
     * simple name and silently keeps the first it meets, and {@code SubscriptionRevenueResponses}
     * records what a short name cost that file.
     *
     * @param subscriptions newest first, every state
     * @param payments newest first by when the money arrived. The payer's address is not on
     *     these rows — the page is already about that one account
     */
    public record AccountSubscriptionHistoryResponse(
            List<ConsoleRow> subscriptions, List<SubscriptionRevenueResponses.SubscriptionPaymentEntry> payments) {
    }
}
