package az.ideanest.subscription.api;

import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.domain.SubscriptionState;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
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
     * @param listed sent to the console, which shows retired plans, and true for
     *     everything the public catalogue returns. Kept on both so that one type serves
     *     both readers — the alternative is two records that drift
     */
    public record Plan(
            UUID id,
            String code,
            String name,
            String description,
            String price,
            String currency,
            BillingPeriod billingPeriod,
            Integer maxActiveCampaigns,
            String goalCeiling,
            boolean listed,
            int sortOrder,
            Instant updatedAt) {

        public static Plan of(SubscriptionPlan plan) {
            return new Plan(
                    plan.getId(),
                    plan.getCode(),
                    plan.getName(),
                    plan.getDescription(),
                    plan.getPrice().amount().toPlainString(),
                    plan.getPrice().currency(),
                    plan.getBillingPeriod(),
                    plan.getMaxActiveCampaigns(),
                    plan.getGoalCeiling() == null ? null : plan.getGoalCeiling().toPlainString(),
                    plan.isListed(),
                    plan.getSortOrder(),
                    plan.getUpdatedAt());
        }

        public static List<Plan> of(List<SubscriptionPlan> plans) {
            return plans.stream().map(Plan::of).toList();
        }
    }

    /** The catalogue. A wrapper rather than a bare array, as every list response here is. */
    public record Catalogue(List<Plan> plans) {

        public static Catalogue of(List<SubscriptionPlan> plans) {
            return new Catalogue(Plan.of(plans));
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
            Instant createdAt) {

        public static Held of(Subscription subscription, SubscriptionPlan plan, Instant now) {
            return new Held(
                    subscription.getId(),
                    subscription.getState(),
                    subscription.entitlesAt(now),
                    Plan.of(plan),
                    subscription.getPrice().amount().toPlainString(),
                    subscription.getPrice().currency(),
                    subscription.getBillingPeriod(),
                    subscription.getStartedAt(),
                    subscription.getCurrentPeriodEnd(),
                    subscription.isCancelAtPeriodEnd(),
                    subscription.getCreatedAt());
        }
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
