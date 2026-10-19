package az.ideanest.subscription.api;

import az.ideanest.payment.application.SubscriptionPaymentPage;
import az.ideanest.shared.ReaderLocale;
import az.ideanest.shared.idempotency.IdempotencyKey;
import az.ideanest.shared.idempotency.IdempotentRequests;
import az.ideanest.shared.idempotency.RecordedResponse;
import az.ideanest.subscription.application.SubscriptionCardPayments;
import az.ideanest.subscription.application.SubscriptionPlans;
import az.ideanest.subscription.application.Subscriptions;
import az.ideanest.subscription.application.UnknownPlanException;
import az.ideanest.subscription.domain.Subscription;
import az.ideanest.subscription.domain.SubscriptionPlan;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * The catalogue, and what one account holds against it.
 *
 * <h2>Two prefixes on one controller, and the reason they belong together</h2>
 *
 * <p>{@code GET /v1/plans} is public and {@code /v1/me/subscription} is not, which usually
 * argues for two controllers. They are one here because the pricing page asks both in the
 * same render and the two answers have to agree about what a plan is: a creator sees "you
 * are on Growth" beside the Growth card, and a plan serialised two ways by two controllers
 * is a card that eventually disagrees with the badge on it.
 *
 * <h2>The catalogue is cacheable and everything else is not</h2>
 *
 * <p>A price list is the same for everybody and changes a few times a year, so it carries
 * a short public max-age. Everything under {@code /v1/me} is {@code no-store}, like every
 * per-person response in this service.
 *
 * <h2>Buying is two steps for a priced plan, and the response says which step it is in</h2>
 *
 * <p>A priced plan comes back {@code PENDING_PAYMENT} with {@code entitled: false} and
 * {@code paymentDue: FIRST_PERIOD}. The creator pays it by card through
 * {@code POST /v1/me/subscription/payment} (#449), or by bank transfer that a member of staff
 * records. A free plan comes back {@code ACTIVE}. The client branches on {@code entitled} and
 * {@code paymentDue} rather than on the price.
 *
 * <p>Every later period is paid the same way, inside the renewal window, by the creator: nothing
 * is charged on a schedule (epic #448).
 */
@RestController
public class SubscriptionController {

    private final SubscriptionPlans plans;
    private final Subscriptions subscriptions;
    private final SubscriptionCardPayments cardPayments;
    private final IdempotentRequests idempotency;
    private final Clock clock;

    public SubscriptionController(
            SubscriptionPlans plans,
            Subscriptions subscriptions,
            SubscriptionCardPayments cardPayments,
            IdempotentRequests idempotency,
            Clock clock) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.cardPayments = cardPayments;
        this.idempotency = idempotency;
        this.clock = clock;
    }

    /**
     * The plans on sale.
     *
     * <p>Public. A price list behind authentication is one nobody can decide to buy from,
     * and it is also what the marketing site links to.
     *
     * <p>Five minutes, public. Long enough that the page is served from a cache under any
     * load worth caring about; short enough that an operator who repriced a plan does not
     * spend an afternoon being told the browser is broken.
     *
     * <p>In the reader's language, negotiated from {@code Accept-Language} the way the
     * category tree is, and {@code Vary} says so to every shared cache in between.
     */
    @GetMapping("/v1/plans")
    public ResponseEntity<SubscriptionResponses.Catalogue> catalogue(
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic())
                .varyBy(HttpHeaders.ACCEPT_LANGUAGE)
                .body(SubscriptionResponses.Catalogue.of(
                        plans.onSale(), ReaderLocale.fromAcceptLanguage(acceptLanguage)));
    }

    /**
     * What the caller holds, or nothing.
     *
     * <p>200 with a null subscription rather than 404 — {@code SubscriptionResponses.Mine}
     * says why.
     */
    @GetMapping("/v1/me/subscription")
    public ResponseEntity<SubscriptionResponses.Mine> mine(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(describe(callerOf(accessToken), acceptLanguage));
    }

    /**
     * Buys a plan.
     *
     * <p>201, because a subscription is a thing that now exists whichever state it is in.
     * A 200 for the pending case and a 201 for the active one would make the status code a
     * second, worse copy of the field the client is already reading.
     */
    @PostMapping("/v1/me/subscription")
    public ResponseEntity<SubscriptionResponses.Mine> subscribe(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage,
            @Valid @RequestBody SubscribeRequest request) {

        UUID accountId = callerOf(accessToken);
        subscriptions.subscribe(accountId, request.planId());

        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(describe(accountId, acceptLanguage));
    }

    /**
     * Cancels: keeps the period that was paid for, stops the renewal.
     *
     * <p>{@code DELETE} on a resource that does not disappear, which is worth one line of
     * defence. The alternative is {@code POST /v1/me/subscription/cancel}, and it was not
     * taken because what the creator means is "I no longer want this" — the subscription
     * outliving their request by three weeks is the platform being fair about a month they
     * paid for, not the request being something other than a deletion.
     *
     * <p>200 rather than 204, because the response is the point: it carries the date the
     * entitlement actually stops, which is the one thing the creator wants to know and
     * cannot work out from the request.
     */
    /**
     * Opens the provider's page for whatever the caller owes now — #449.
     *
     * <p>The first period of a pending subscription, or the next period of one whose end is inside
     * the renewal window. Idempotent on the key like every payment mutation: a retried request
     * answers with the page it opened. A second key while that page is still open is sent back to
     * it rather than given a second order.
     */
    @PostMapping(path = "/v1/me/subscription/payment", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> pay(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) PayForPlanRequest body) {

        UUID accountId = callerOf(accessToken);
        PayForPlanRequest request = body == null ? new PayForPlanRequest(null, null, null) : body;
        RecordedResponse response = idempotency.execute(
                accountId,
                "subscription.pay",
                IdempotencyKey.of(idempotencyKey),
                request,
                HttpStatus.OK.value(),
                () -> {
                    SubscriptionPaymentPage page =
                            cardPayments.pay(accountId, request.language(), request.successUrl(), request.errorUrl());
                    return new SubscriptionResponses.PaymentPage(page.providerTransactionId(), page.redirectUrl());
                });
        return ResponseEntity.status(response.status())
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .body(response.body());
    }

    /**
     * @param language the payment page's language: az, en or ru
     * @param successUrl where the provider returns the creator after paying
     * @param errorUrl where it returns them after a failure
     */
    public record PayForPlanRequest(String language, URI successUrl, URI errorUrl) {
    }

    @DeleteMapping("/v1/me/subscription")
    public ResponseEntity<SubscriptionResponses.Mine> cancel(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage) {
        UUID accountId = callerOf(accessToken);
        subscriptions.cancel(accountId);

        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(describe(accountId, acceptLanguage));
    }

    /** @param planId which plan, from {@code GET /v1/plans} */
    public record SubscribeRequest(@NotNull UUID planId) {
    }

    /**
     * Re-reads what the account holds and renders it.
     *
     * <p>Read back rather than composed from what the service returned, so that the three
     * endpoints cannot disagree about the shape of an answer they all give. The plan is
     * looked up by identifier — including an unlisted one, which is exactly the case a
     * catalogue lookup would miss.
     */
    private SubscriptionResponses.Mine describe(UUID accountId, String acceptLanguage) {
        Instant now = clock.instant();

        return subscriptions
                .heldBy(accountId)
                .map(held -> new SubscriptionResponses.Mine(SubscriptionResponses.Held.of(
                        held,
                        planOf(held),
                        ReaderLocale.fromAcceptLanguage(acceptLanguage),
                        now,
                        cardPayments.dueFor(held, now).orElse(null),
                        cardPayments.renewalOpensAt(held))))
                .orElse(SubscriptionResponses.Mine.NONE);
    }

    private SubscriptionPlan planOf(Subscription subscription) {
        return plans.byId(subscription.getPlanId())
                .orElseThrow(() -> new UnknownPlanException(subscription.getPlanId()));
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
