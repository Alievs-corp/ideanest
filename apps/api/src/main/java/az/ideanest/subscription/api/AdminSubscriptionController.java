package az.ideanest.subscription.api;

import az.ideanest.subscription.application.SubscriptionPlans;
import az.ideanest.subscription.application.Subscriptions;
import az.ideanest.subscription.domain.BillingPeriod;
import az.ideanest.subscription.domain.PaymentMethod;
import az.ideanest.subscription.domain.SubscriptionPlan;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * AD-11's second screen: what the platform charges a creator to publish — §4.11.
 *
 * <h2>Why this is AD-11 and not a seventeenth module</h2>
 *
 * <p>§4.11's table has sixteen rows and the fee editor is the one about what the platform
 * charges. A subscription is the other half of that question — a fee comes out of a
 * backer's pledge and this comes out of a creator's pocket — so it is the same authority
 * over the same subject, and {@code lib/admin/navigation.ts} files it under AD-11 the way
 * {@code /admin/staff} is filed under AD-04. A seventeenth row would make the console and
 * the specification disagree about how many modules there are.
 *
 * <h2>Needs {@code CONFIGURE_PLATFORM}, checked in the services</h2>
 *
 * <p>Which only {@code ADMINISTRATOR} holds. Not an annotation here, following
 * {@code FeeScheduleController}: the service is also where the change is recorded, and an
 * authorised action nobody recorded and a recorded action nobody authorised are the same
 * defect from opposite ends.
 *
 * <h2>There is no delete</h2>
 *
 * <p>A plan leaves the catalogue by being unlisted. V62's foreign key would refuse a
 * delete against any plan anybody has ever bought, and a plan nobody bought is one nobody
 * misses when it is simply taken off sale.
 *
 * <p><strong>{@code no-store}</strong>, like every response under this prefix.
 */
@RestController
@RequestMapping("/v1/admin")
public class AdminSubscriptionController {

    private final SubscriptionPlans plans;
    private final Subscriptions subscriptions;
    private final Clock clock;

    public AdminSubscriptionController(SubscriptionPlans plans, Subscriptions subscriptions, Clock clock) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.clock = clock;
    }

    /** Every plan, listed or not. The unlisted ones are the point — see the repository. */
    @GetMapping("/plans")
    public ResponseEntity<SubscriptionResponses.Catalogue> catalogue(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionResponses.Catalogue.of(plans.catalogue(callerOf(accessToken))));
    }

    /** Adds a plan. On sale from the moment it is written. */
    @PostMapping("/plans")
    public ResponseEntity<SubscriptionResponses.Plan> add(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody AddPlanRequest request) {

        SubscriptionPlan plan = plans.add(
                callerOf(accessToken),
                request.code(),
                request.name(),
                request.description(),
                request.price(),
                request.currency(),
                request.billingPeriod(),
                request.maxActiveCampaigns(),
                request.goalCeiling(),
                request.sortOrder() == null ? 0 : request.sortOrder());

        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionResponses.Plan.of(plan));
    }

    /**
     * Changes a plan. Every field is optional; an absent one is left alone.
     *
     * <p><strong>Removing a limit needs its own flag</strong>, because null already means
     * "leave it alone" and a plan with no ceiling is a plan whose ceiling is null. Two
     * meanings for one absent field is the ambiguity that makes a PATCH endpoint
     * untestable, so {@code clearMaxActiveCampaigns} and {@code clearGoalCeiling} say
     * which of the two the caller meant.
     */
    @PatchMapping("/plans/{planId}")
    public ResponseEntity<SubscriptionResponses.Plan> change(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID planId,
            @Valid @RequestBody ChangePlanRequest request) {

        SubscriptionPlan plan = plans.change(
                callerOf(accessToken),
                planId,
                request.name(),
                request.description(),
                request.price(),
                request.currency(),
                request.maxActiveCampaigns(),
                Boolean.TRUE.equals(request.clearMaxActiveCampaigns()),
                request.goalCeiling(),
                Boolean.TRUE.equals(request.clearGoalCeiling()),
                request.listed(),
                request.sortOrder());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionResponses.Plan.of(plan));
    }

    /**
     * Who is on what.
     *
     * @param awaitingPayment the queue rather than the archive. Defaults to the queue,
     *     because that is the only part of this screen that is somebody's work
     */
    @GetMapping("/subscriptions")
    public ResponseEntity<SubscriptionResponses.ConsoleList> list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(name = "awaitingPayment", defaultValue = "true") boolean awaitingPayment) {

        UUID staffId = callerOf(accessToken);
        Instant now = clock.instant();

        // One query for the plans rather than one per row. The catalogue is a handful of
        // rows and the list may be hundreds; the alternative is a lookup per subscription,
        // which is the shape that looks harmless until the archive view is opened.
        Map<UUID, SubscriptionPlan> byId = new HashMap<>();
        for (SubscriptionPlan plan : plans.catalogue(staffId)) {
            byId.put(plan.getId(), plan);
        }

        List<SubscriptionResponses.ConsoleRow> rows = subscriptions.forConsole(staffId, awaitingPayment).stream()
                .map(subscription ->
                        SubscriptionResponses.ConsoleRow.of(subscription, byId.get(subscription.getPlanId()), now))
                .toList();

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new SubscriptionResponses.ConsoleList(rows));
    }

    /**
     * Records that the payment arrived, which is what starts the entitlement.
     *
     * <p>This exists because no payment provider is integrated (#60). V62's header argues
     * why that is how a platform with no processor sells rather than a stub pretending to
     * be one, and what changes when a provider lands: this endpoint, and nothing above it.
     *
     * <p><strong>It also writes V73's journal row</strong>, in the same transaction, which
     * is what the revenue report is built on. The three payment fields are optional so
     * that the console's existing dialogue keeps working unchanged — a request carrying
     * only a note records a bank transfer received now, which is what every activation
     * before this endpoint learned to ask was.
     */
    @PostMapping("/subscriptions/{subscriptionId}/activate")
    public ResponseEntity<SubscriptionResponses.ConsoleRow> activate(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID subscriptionId,
            @Valid @RequestBody ActivateRequest request) {

        UUID staffId = callerOf(accessToken);
        var activated = subscriptions.activate(
                staffId,
                subscriptionId,
                request.method(),
                request.receivedAt(),
                request.reference(),
                request.note());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionResponses.ConsoleRow.of(
                        activated, plans.byId(activated.getPlanId()).orElse(null), clock.instant()));
    }

    /** Ends a subscription outright — a reversed payment, a fraud finding, a mistake. */
    @PostMapping("/subscriptions/{subscriptionId}/cancel")
    public ResponseEntity<SubscriptionResponses.ConsoleRow> cancel(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID subscriptionId,
            @Valid @RequestBody CancelRequest request) {

        UUID staffId = callerOf(accessToken);
        var ended = subscriptions.end(staffId, subscriptionId, request.reason());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(SubscriptionResponses.ConsoleRow.of(
                        ended, plans.byId(ended.getPlanId()).orElse(null), clock.instant()));
    }

    /**
     * A new plan.
     *
     * <p><strong>The price is a {@code BigDecimal} and never a {@code double}.</strong>
     * CLAUDE.md, and it is a price somebody is charged rather than a rate multiplied by
     * one, so the argument is if anything shorter: 19.90 has no exact binary
     * representation.
     *
     * @param maxActiveCampaigns null for no limit. There is no "unlimited" sentinel on the
     *     wire for {@code PublishingAllowance}'s reason
     * @param goalCeiling null for no ceiling. In {@code currency}
     */
    public record AddPlanRequest(
            @NotBlank @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{1,39}$") String code,
            @NotBlank @Size(max = 120) String name,
            @Size(max = 2000) String description,
            @NotNull @DecimalMin("0") BigDecimal price,
            @NotBlank @Pattern(regexp = "^[A-Z]{3}$") String currency,
            @NotNull BillingPeriod billingPeriod,
            @Min(1) Integer maxActiveCampaigns,
            @DecimalMin(value = "0", inclusive = false) BigDecimal goalCeiling,
            Integer sortOrder) {
    }

    /**
     * A change to a plan. Absent means "leave it alone"; the {@code clear*} flags mean
     * "remove it".
     */
    public record ChangePlanRequest(
            @Size(max = 120) String name,
            @Size(max = 2000) String description,
            @DecimalMin("0") BigDecimal price,
            @Pattern(regexp = "^[A-Z]{3}$") String currency,
            @Min(1) Integer maxActiveCampaigns,
            Boolean clearMaxActiveCampaigns,
            @DecimalMin(value = "0", inclusive = false) BigDecimal goalCeiling,
            Boolean clearGoalCeiling,
            Boolean listed,
            Integer sortOrder) {
    }

    /**
     * The payment being recorded.
     *
     * <p><strong>Every field is optional, including all three of the new ones.</strong>
     * The console's activation dialogue asked for a note and nothing else, and an
     * endpoint that started refusing those requests would stop a member of staff
     * recording a transfer that has already arrived — over a field the platform can
     * default correctly. {@code Subscriptions.activate} states the defaults: a bank
     * transfer, received now.
     *
     * <p>There is no {@code amount}. What was paid is {@code subscriptions.price}, the
     * figure snapshotted when the creator bought the plan and the figure on the invoice
     * they were sent; taking it from the request would let a typo record a payment for
     * a sum nobody agreed. A transfer that arrived short is a discrepancy to settle
     * before the entitlement opens, not a different number to write down.
     *
     * @param method how it arrived. Absent means {@code BANK_TRANSFER}
     * @param receivedAt when the money arrived, absent meaning now. May be earlier — a
     *     transfer that cleared on the 31st belongs in the month it cleared — and is
     *     refused if it is later, because {@code received_at} is what every total is
     *     grouped by and the row cannot be edited afterwards
     * @param reference the transfer reference or invoice number. Optional — see
     *     {@code Subscriptions.activate} on why a missing reference does not hold up a
     *     paying creator
     * @param note anything else worth recording, kept on the subscription and on the
     *     journal row
     */
    public record ActivateRequest(
            PaymentMethod method,
            Instant receivedAt,
            @Size(max = 200) String reference,
            @Size(max = 2000) String note) {
    }

    /** @param reason required: this takes an entitlement away from somebody */
    public record CancelRequest(@NotBlank @Size(max = 2000) String reason) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
