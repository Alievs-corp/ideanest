package az.ideanest.payment.api;

import az.ideanest.payment.application.PledgeBackers;
import az.ideanest.payment.application.RefundBankTransfers;
import az.ideanest.payment.application.RefundService;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundState;
import az.ideanest.shared.money.Money;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-06 over HTTP — issues #67 and #307.
 *
 * <h2>The idempotency key is a header and is required</h2>
 *
 * <p>{@code Idempotency-Key}, following the convention every other payment mutation on
 * this platform uses. <strong>Required rather than optional</strong>, which is stricter
 * than most of §10.2: a refund is the one write where a duplicate is money leaving twice
 * and where — unlike a duplicate charge — nobody complains about it. A request without a
 * key is refused, so a client that has not thought about retries finds out at the first
 * call rather than at the first timeout.
 *
 * <h2>Two capabilities across three endpoints</h2>
 *
 * <p>The reads need {@code VIEW_FINANCE}; the write needs {@code ISSUE_REFUND}. Checked in
 * the service, following {@code AuditTrailController}, because that is also where the
 * refund is recorded.
 *
 * <p><strong>{@code no-store}</strong>: these responses name pledges and amounts.
 */
@RestController
@RequestMapping("/v1/admin/refunds")
public class RefundController {

    private final RefundService refunds;
    private final RefundBankTransfers bankRefunds;
    private final PledgeBackers backers;

    /**
     * The console's page size.
     *
     * <p>Fixed rather than configurable, unlike the audit trail and the payment log.
     * Those page over tables that grow continuously and an incident may want a larger
     * window; this one is a working queue that a person reads, and fifty rows is what fits
     * on a screen somebody is scanning for one pledge.
     */
    private static final int PAGE_SIZE = 50;

    public RefundController(RefundService refunds, RefundBankTransfers bankRefunds, PledgeBackers backers) {
        this.refunds = refunds;
        this.bankRefunds = bankRefunds;
        this.backers = backers;
    }

    /**
     * The refund list, newest first.
     *
     * @param state narrows to {@code REQUESTED}, {@code SUCCEEDED} or {@code FAILED}, or since
     *     #399 to {@code AWAITING_BANK_DETAILS} or {@code AWAITING_TRANSFER}, support's and
     *     finance's queues for a refund paid by bank transfer. {@code REQUESTED} is the one worth
     *     watching: a row that stays there is a refund the platform intended and did not complete
     * @param page offset-paged rather than keyset, which is a departure from the rest of
     *     the console — {@code RefundRepository} has the argument
     */
    @GetMapping
    public ResponseEntity<PaymentAdminResponses.RefundPage> list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) RefundState state,
            @RequestParam(defaultValue = "0") int page) {

        List<az.ideanest.payment.domain.Refund> listed = refunds.list(callerOf(accessToken), state, page, PAGE_SIZE);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(pageOf(listed, page));
    }

    /** Every refund against one pledge. */
    @GetMapping("/by-pledge/{pledgeId}")
    public ResponseEntity<PaymentAdminResponses.RefundPage> forPledge(
            @AuthenticationPrincipal Jwt accessToken, @org.springframework.web.bind.annotation.PathVariable UUID pledgeId) {

        List<az.ideanest.payment.domain.Refund> listed = refunds.forPledge(callerOf(accessToken), pledgeId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(pageOf(listed, 0));
    }

    /**
     * What a refund of the pledge for this reason could send now — the console's confirmation, before the
     * press that sends it: the pledge's currency, what "the rest" comes to, and the provider fee a campaign's
     * reason keeps back (#436). {@code ISSUE_REFUND}; 409 {@code NOTHING_TO_REFUND} for a pledge with no
     * settled charge.
     */
    @GetMapping("/refundable")
    public ResponseEntity<PaymentAdminResponses.Refundable> refundable(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam UUID pledgeId,
            @RequestParam(defaultValue = "BACKER_REQUEST") RefundReason reason) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.Refundable.of(
                        pledgeId, reason, refunds.refundable(callerOf(accessToken), pledgeId, reason)));
    }

    /** Sends money back. */
    @PostMapping
    public ResponseEntity<PaymentAdminResponses.Refund> issue(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestHeader("Idempotency-Key") @NotBlank @Size(min = 8, max = 200) String idempotencyKey,
            @Valid @RequestBody IssueRefundRequest request) {

        List<az.ideanest.payment.domain.Refund> parts = refunds.issueParts(
                callerOf(accessToken),
                request.pledgeId(),
                request.amount(),
                request.reason(),
                request.detail(),
                idempotencyKey);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.Refund.issued(RefundService.describing(parts), parts));
    }

    private PaymentAdminResponses.RefundPage pageOf(List<az.ideanest.payment.domain.Refund> listed, int page) {
        return PaymentAdminResponses.RefundPage.of(
                listed,
                bankRefunds.of(listed),
                refunds.routedTo(listed),
                backers.of(listed.stream().map(az.ideanest.payment.domain.Refund::pledgeId).toList()),
                page,
                PAGE_SIZE);
    }

    /**
     * What to send back and why.
     *
     * @param amount <strong>null means "the rest of it".</strong> Not a {@code full}
     *     boolean beside a number, because the two can disagree — a console that computed
     *     the full amount from a page loaded before an earlier partial refund would send a
     *     figure that is both "full" and too large. Null makes the service compute it from
     *     the row it just locked. {@link Money} carries the currency and crosses the wire
     *     as a string, per §10.3
     * @param reason one of §9.7's codes. The countable half — {@code RefundReason} has why
     * @param detail the story. Required, because a code is never the whole of it and the
     *     person reading this row in six months is answering a complaint
     */
    public record IssueRefundRequest(
            @NotNull UUID pledgeId,
            Money amount,
            @NotNull RefundReason reason,
            @NotBlank @Size(max = 2000) String detail) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
