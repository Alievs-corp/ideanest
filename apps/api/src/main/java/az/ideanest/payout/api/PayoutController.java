package az.ideanest.payout.api;

import az.ideanest.payout.application.PayoutService;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutState;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-05 payout queue over HTTP — issues #69 and #306.
 *
 * <h2>Five verbs, and each is a different authority</h2>
 *
 * <p>Reading needs {@code VIEW_FINANCE}. Calculating needs it too — it moves no money, and
 * a finance member of staff has to be able to answer a creator asking what they will be
 * paid. <strong>Approving, sending, cancelling and settling an unconfirmed send need
 * {@code APPROVE_PAYOUT}</strong>,
 * which {@code FINANCE} deliberately does not confer: §4.11 requires dual approval above a
 * threshold, and a role granting both issuing and approving would make the second
 * signature a formality whenever the finance team is one person.
 *
 * <h2>Approving is a POST and not a PUT</h2>
 *
 * <p>Unlike a staff role grant, which is a state and therefore idempotent under
 * {@code PUT}. A signature is an event: it happens at a moment, by a person, and the
 * response says how many more are needed. Signing twice is still a no-op — V55's primary
 * key sees to that — but the verb should not suggest that the second call replaced the
 * first.
 *
 * <p><strong>{@code no-store}</strong>: these responses carry what the platform is about
 * to pay out, and to whom.
 */
@RestController
@RequestMapping("/v1/admin/payouts")
public class PayoutController {

    private static final int PAGE_SIZE = 50;

    private final PayoutService payouts;
    private final Clock clock;

    public PayoutController(PayoutService payouts, Clock clock) {
        this.payouts = payouts;
        this.clock = clock;
    }

    /**
     * The queue: everything still on its way, oldest first.
     *
     * <p>Includes payouts whose hold has not expired, and says so per row — hiding them
     * would make a creator's "when will I be paid" unanswerable for the length of the hold.
     */
    @GetMapping("/queue")
    public ResponseEntity<PayoutResponses.PayoutPage> queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(defaultValue = "0") int page) {

        List<Payout> queued = payouts.queue(callerOf(accessToken), page);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PayoutResponses.PayoutPage.of(
                        queued,
                        page,
                        PAGE_SIZE,
                        clock.instant(),
                        payouts.standingsOf(queued),
                        payouts.destinationStandingsOf(queued)));
    }

    /** Everything, newest first, optionally narrowed to one state. */
    @GetMapping
    public ResponseEntity<PayoutResponses.PayoutPage> list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) PayoutState state,
            @RequestParam(defaultValue = "0") int page) {

        List<Payout> listed = payouts.list(callerOf(accessToken), state, page);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PayoutResponses.PayoutPage.of(
                        listed,
                        page,
                        PAGE_SIZE,
                        clock.instant(),
                        payouts.standingsOf(listed),
                        payouts.destinationStandingsOf(listed)));
    }

    /** One payout with its signatures. */
    @GetMapping("/{payoutId}")
    public ResponseEntity<PayoutResponses.PayoutFile> inspect(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID payoutId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(fileOf(payouts.inspect(callerOf(accessToken), payoutId)));
    }

    /** Works out what a campaign owes, and starts the hold. */
    @PostMapping
    public ResponseEntity<PayoutResponses.PayoutSummary> calculate(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody CalculateRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(summaryOf(payouts.calculate(callerOf(accessToken), request.projectId())));
    }

    /** Signs off. */
    @PostMapping("/{payoutId}/approvals")
    public ResponseEntity<PayoutResponses.PayoutFile> approve(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID payoutId,
            @Valid @RequestBody(required = false) ApproveRequest request) {

        String note = request == null ? null : request.note();

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(fileOf(payouts.approve(callerOf(accessToken), payoutId, note)));
    }

    /**
     * Takes a signature back.
     *
     * <p>The caller's own, and no path parameter names whose. Withdrawing somebody else's
     * approval would be one member of staff overruling another silently, and the platform
     * has no rule saying who may — so the endpoint does not offer it.
     */
    @DeleteMapping("/{payoutId}/approvals")
    public ResponseEntity<PayoutResponses.PayoutFile> withdrawApproval(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID payoutId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(fileOf(payouts.withdrawApproval(callerOf(accessToken), payoutId)));
    }

    /**
     * Instructs the provider.
     *
     * <p><strong>No body, since #432.</strong> It used to carry the destination, and the
     * absence is the point: there is nothing on this request that decides where money goes.
     * The service reads the account the creator filed and a compliance reviewer confirmed, and
     * refuses when there is not one.
     */
    @PostMapping("/{payoutId}/send")
    public ResponseEntity<PayoutResponses.PayoutSummary> send(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID payoutId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(summaryOf(payouts.send(callerOf(accessToken), payoutId)));
    }

    /**
     * Settles a send the provider never answered as carried out, from its statement — #184's review.
     *
     * <p>One of the two ways out of {@code PAYOUT_SEND_UNCONFIRMED}. A person read the statement, so
     * the note says what they read, and the provider's reference ties the record to the money.
     */
    @PostMapping("/{payoutId}/unconfirmed-send/sent")
    public ResponseEntity<PayoutResponses.PayoutSummary> unconfirmedSent(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID payoutId,
            @Valid @RequestBody UnconfirmedSentRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(summaryOf(payouts.resolveUnconfirmed(
                        callerOf(accessToken), payoutId, true, request.providerTransactionId().trim(), request.note().trim())));
    }

    /** The other way out: the statement shows it was not carried out, so the campaign may be priced again. */
    @PostMapping("/{payoutId}/unconfirmed-send/not-sent")
    public ResponseEntity<PayoutResponses.PayoutSummary> unconfirmedNotSent(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID payoutId,
            @Valid @RequestBody UnconfirmedNotSentRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(summaryOf(payouts.resolveUnconfirmed(
                        callerOf(accessToken), payoutId, false, null, request.note().trim())));
    }

    /** Withdraws a payout before it is sent. */
    @PostMapping("/{payoutId}/cancel")
    public ResponseEntity<PayoutResponses.PayoutSummary> cancel(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID payoutId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(summaryOf(payouts.cancel(callerOf(accessToken), payoutId)));
    }

    /** Which campaign to work out a payout for. */
    public record CalculateRequest(@NotNull UUID projectId) {
    }

    /** Why this payout is being approved, for the next person to read. */
    public record ApproveRequest(@Size(max = 2000) String note) {
    }

    /**
     * The provider's statement shows the unconfirmed send was carried out.
     *
     * @param providerTransactionId the provider's reference for the payout, as the statement shows it
     */
    public record UnconfirmedSentRequest(
            @NotBlank @Size(max = 200) String providerTransactionId, @NotBlank @Size(max = 2000) String note) {
    }

    /** The provider's statement shows the unconfirmed send was not carried out. */
    public record UnconfirmedNotSentRequest(@NotBlank @Size(max = 2000) String note) {
    }

    /** One payout, with both standings beside it — #431's and #432's "show why". */
    private PayoutResponses.PayoutSummary summaryOf(Payout payout) {
        return PayoutResponses.PayoutSummary.of(
                payout, clock.instant(), payouts.standingOf(payout), payouts.destinationStandingOf(payout));
    }

    private PayoutResponses.PayoutFile fileOf(PayoutService.PayoutFile file) {
        return PayoutResponses.PayoutFile.of(
                file,
                clock.instant(),
                payouts.standingOf(file.payout()),
                payouts.destinationStandingOf(file.payout()));
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
