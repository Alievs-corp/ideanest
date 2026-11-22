package az.ideanest.subscription.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.SubscriptionPlan;
import az.ideanest.subscription.infrastructure.SubscriptionPlanRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The plan catalogue, read by everybody and changed by the console.
 *
 * <h2>Two audiences, and only one of them is authorised</h2>
 *
 * <p>{@link #onSale} is public and is what the pricing page renders. Everything else needs
 * {@link StaffCapability#CONFIGURE_PLATFORM}, which only {@code SUPER_ADMIN} holds —
 * the same capability AD-11's fee editor asks for, because what the platform charges a
 * creator to publish and what it charges a backer to pledge are the same kind of decision:
 * one screen, changing the behaviour of the running platform for everybody at once.
 *
 * <p>The capability is checked here rather than by an annotation on the controller,
 * following {@code FeeSchedules} and {@code AuditTrailController}: this is also where the
 * change is recorded, and an authorised action nobody recorded and a recorded action
 * nobody authorised are the same defect from opposite ends.
 *
 * <h2>Editing in place is deliberate, and is not what AD-11 does</h2>
 *
 * <p>A fee schedule is replaced rather than edited because a past payout was priced
 * against it. A plan is edited, because what a subscriber was charged is snapshotted onto
 * their own row at purchase — so nothing here can reach backwards into a bill. V62's
 * header carries the argument in full, including why the limits are <em>not</em>
 * snapshotted and therefore do move under everybody on the plan.
 *
 * <h2>Nothing is deleted</h2>
 *
 * <p>{@link #list} is how a plan leaves the catalogue. There is no delete endpoint and no
 * delete method: V62's {@code ON DELETE RESTRICT} would refuse one against any plan that
 * has ever been bought, and a plan nobody bought is one nobody misses when it is simply
 * unlisted.
 */
@Service
public class SubscriptionPlans {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionPlans.class);

    private final SubscriptionPlanRepository plans;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public SubscriptionPlans(
            SubscriptionPlanRepository plans, PlatformStaff staff, AuditLog audit, Clock clock) {
        this.plans = plans;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * What the pricing page offers, in the order it draws them.
     *
     * <p>No caller, no capability: this is the price list, and a price list behind
     * authentication is one nobody can decide to buy from.
     */
    @Transactional(readOnly = true)
    public List<SubscriptionPlan> onSale() {
        return plans.listed();
    }

    /**
     * One plan by identifier, whether or not it is on sale.
     *
     * <p>Used by everything that resolves a subscription back to what it was bought
     * against — including a subscription on a plan that has since been unlisted, which is
     * exactly the case a listed-only lookup would break.
     */
    @Transactional(readOnly = true)
    public Optional<SubscriptionPlan> byId(UUID planId) {
        return plans.findById(planId);
    }

    /** Every plan, listed or not, for the console. */
    @Transactional(readOnly = true)
    public List<SubscriptionPlan> catalogue(UUID staffId) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        return plans.catalogue();
    }

    /**
     * Adds a plan to the catalogue.
     *
     * <p>Listed from the moment it is written. An unlisted-by-default plan would mean
     * every addition took two actions, and the second one would be the one somebody
     * forgot — leaving a plan an operator believes is on sale and nobody can buy.
     *
     * @param prices every period it is sold for and its price, in {@code currency} — #655. Null
     *     or empty means one period, {@code billingPeriod} at {@code price}, which is what the
     *     console asked for before a plan had several
     * @param studentOnly whether only a verified student may buy it — #655
     * @throws PlanCodeTakenException when the code is in use. Checked first for the
     *     message, and caught from the index as well, because between the read and the
     *     write another administrator may have added the same one
     */
    @Transactional
    public SubscriptionPlan add(
            UUID staffId,
            String code,
            String name,
            String description,
            Map<String, SubscriptionPlan.PlanTranslation> translations,
            BigDecimal price,
            String currency,
            BillingPeriod billingPeriod,
            List<PeriodPrice> prices,
            boolean studentOnly,
            Integer maxActiveCampaigns,
            BigDecimal goalCeiling,
            int sortOrder) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        Map<BillingPeriod, BigDecimal> byPeriod = prices == null ? null : PeriodPrice.byPeriod(prices, currency);
        if (byPeriod == null && (price == null || billingPeriod == null)) {
            throw new IllegalArgumentException("A plan needs its prices, or a price and the period it buys");
        }
        Map.Entry<BillingPeriod, BigDecimal> first = byPeriod != null
                ? new TreeMap<>(byPeriod).firstEntry()
                : Map.entry(billingPeriod, price);

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        SubscriptionPlan plan = SubscriptionPlan.create(
                Identifiers.newIdentifier(),
                code,
                name,
                description,
                translations,
                Money.of(first.getValue(), currency),
                first.getKey(),
                maxActiveCampaigns,
                goalCeiling,
                sortOrder,
                now,
                staffId);
        if (byPeriod != null) {
            plan.reprice(byPeriod, currency);
        }
        plan.restrictToStudents(studentOnly);

        plans.findByCode(plan.getCode()).ifPresent(existing -> {
            throw new PlanCodeTakenException(plan.getCode());
        });

        SubscriptionPlan saved;
        try {
            saved = plans.saveAndFlush(plan);
        } catch (DataIntegrityViolationException e) {
            throw new PlanCodeTakenException(plan.getCode());
        }

        audit.record(
                AuditAction.SUBSCRIPTION_PLAN_CREATED,
                saved.getId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                describe(saved));

        log.info("Subscription plan {} ({}) added by {}", saved.getId(), saved.getCode(), staffId);
        return saved;
    }

    /**
     * Changes a plan.
     *
     * <p>Every argument is optional and null means "leave it alone", which is what makes
     * this a PATCH rather than a PUT. The alternative — a full replacement — would mean
     * the console had to send every field to change one, and a screen that resends a stale
     * price while editing a limit is a repricing nobody performed.
     *
     * <p><strong>The limits are the exception to "null means leave it alone", and they
     * have to be.</strong> Null is also how a limit is <em>removed</em>: a plan with no
     * ceiling is one whose {@code goalCeiling} is null. So the two are distinguished by
     * the flags rather than by the values, and the caller says which fields it is
     * touching. {@code SubscriptionPlanController} has the wire shape.
     *
     * @param price the shortest period's price. Ignored when {@code prices} is present, which
     *     says the same thing and more
     * @param prices when present, every period the plan is sold for from now on — #655. It
     *     replaces the whole set; a period left out stops being sold to anybody new
     * @param studentOnly when present, whether only a verified student may buy it — #655
     * @param clearMaxActiveCampaigns when true, the limit is removed whatever
     *     {@code maxActiveCampaigns} says
     * @param clearGoalCeiling likewise
     */
    @Transactional
    public SubscriptionPlan change(
            UUID staffId,
            UUID planId,
            String name,
            String description,
            Map<String, SubscriptionPlan.PlanTranslation> translations,
            BigDecimal price,
            String currency,
            List<PeriodPrice> prices,
            Boolean studentOnly,
            Integer maxActiveCampaigns,
            boolean clearMaxActiveCampaigns,
            BigDecimal goalCeiling,
            boolean clearGoalCeiling,
            Boolean listed,
            Integer sortOrder) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);

        SubscriptionPlan plan = plans.findById(planId).orElseThrow(() -> new UnknownPlanException(planId));
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        if (name != null || description != null) {
            // Renaming carries the description with it, because the two are one sentence
            // on the pricing card and editing them separately produces a card whose second
            // line describes the plan's previous name.
            plan.rename(name == null ? plan.getName() : name, description == null ? plan.getDescription() : description);
        }
        if (translations != null) {
            plan.translate(translations);
        }
        String inCurrency = currency == null ? plan.getPrice().currency() : currency;
        if (prices != null) {
            plan.reprice(PeriodPrice.byPeriod(prices, inCurrency), inCurrency);
        } else if (price != null) {
            plan.price(Money.of(price, inCurrency));
        } else if (currency != null) {
            // A currency alone moves every price into it, figures unchanged — what changing only
            // that field always did to the one price there was.
            plan.reprice(amountsOf(plan), inCurrency);
        }
        if (studentOnly != null) {
            plan.restrictToStudents(studentOnly);
        }

        boolean limitsTouched = clearMaxActiveCampaigns || clearGoalCeiling || maxActiveCampaigns != null
                || goalCeiling != null;
        if (limitsTouched) {
            plan.limits(
                    clearMaxActiveCampaigns
                            ? null
                            : maxActiveCampaigns == null ? plan.getMaxActiveCampaigns() : maxActiveCampaigns,
                    clearGoalCeiling ? null : goalCeiling == null ? plan.getGoalCeiling() : goalCeiling);
        }
        if (listed != null) {
            plan.list(listed);
        }
        if (sortOrder != null) {
            plan.sortAt(sortOrder);
        }
        plan.touch(now);

        audit.record(
                AuditAction.SUBSCRIPTION_PLAN_CHANGED,
                plan.getId(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                describe(plan));

        log.info("Subscription plan {} ({}) changed by {}", plan.getId(), plan.getCode(), staffId);
        return plan;
    }

    /** Puts a plan on sale, or takes it off. The one way a plan leaves the catalogue. */
    @Transactional
    public SubscriptionPlan list(UUID staffId, UUID planId, boolean listed) {
        return change(
                staffId, planId, null, null, null, null, null, null, null, null, false, null, false, listed, null);
    }

    private static Map<BillingPeriod, BigDecimal> amountsOf(SubscriptionPlan plan) {
        Map<BillingPeriod, BigDecimal> amounts = new EnumMap<>(BillingPeriod.class);
        plan.getPrices().forEach((period, money) -> amounts.put(period, money.amount()));
        return amounts;
    }

    /**
     * What the audit row says about a plan, in one line.
     *
     * <p>The numbers and not the prose: a description copied into {@code audit_logs} is
     * marketing text under a retention rule written for privileged actions, and the
     * question the trail answers is "what did this plan cost and allow", not "how was it
     * worded".
     */
    private static String describe(SubscriptionPlan plan) {
        return ("code=%s; languages=%s; price=%s; period=%s; prices=%s; studentOnly=%s; maxActive=%s;"
                        + " goalCeiling=%s; listed=%s")
                .formatted(
                        plan.getCode(),
                        plan.getTranslations().keySet(),
                        plan.getPrice(),
                        plan.getBillingPeriod(),
                        plan.getPrices(),
                        plan.isStudentOnly(),
                        plan.getMaxActiveCampaigns() == null ? "none" : plan.getMaxActiveCampaigns(),
                        plan.getGoalCeiling() == null ? "none" : plan.getGoalCeiling(),
                        plan.isListed());
    }
}
