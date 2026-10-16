package az.ideanest.payment.api;

import az.ideanest.payment.application.UnappliedPlanPayments;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The refund console's plan payments — issue #457: money taken for a subscription that had ended,
 * and its return to the creator.
 */
@RestController
@RequestMapping("/v1/admin/plan-payments")
public class PlanPaymentRefundController {

    private final UnappliedPlanPayments payments;

    public PlanPaymentRefundController(UnappliedPlanPayments payments) {
        this.payments = payments;
    }

    /** Waiting to be returned, oldest first. {@code VIEW_FINANCE}. */
    @GetMapping("/unapplied")
    public ResponseEntity<UnappliedPlanPaymentList> unapplied(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new UnappliedPlanPaymentList(payments.list(callerOf(accessToken)).stream()
                        .map(UnappliedPlanPayment::of)
                        .toList()));
    }

    /** Back to the card that paid, through the provider. {@code ISSUE_REFUND}. */
    @PostMapping("/{id}/refund")
    public ResponseEntity<UnappliedPlanPayment> refundToCard(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(UnappliedPlanPayment.of(payments.refundToCard(callerOf(accessToken), id)));
    }

    /** Records the bank transfer that returned it, after the card window closed. {@code ISSUE_REFUND}. */
    @PostMapping("/{id}/bank-transfer")
    public ResponseEntity<UnappliedPlanPayment> recordBankTransfer(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody PlanPaymentBankTransferRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(UnappliedPlanPayment.of(payments.recordBankTransfer(
                        callerOf(accessToken), id, request.bankReference(), request.note())));
    }

    /** @param bankReference the bank's reference for the transfer that returned the money */
    public record PlanPaymentBankTransferRequest(
            @NotBlank @Size(max = 200) String bankReference, @Size(max = 500) String note) {
    }

    /**
     * @param amount a decimal string, as money is everywhere in this API
     * @param cardRefundUntil when the provider stops taking a refund to the card, or null when it
     *     names no window
     * @param cardRefundStartedAt when a card refund was sent and its answer never arrived (V108). Null otherwise.
     *     While it is set the money may already be on its way back: the console offers the card refund again,
     *     which asks the provider first, and not the bank transfer
     */
    public record UnappliedPlanPayment(
            UUID id,
            UUID subscriptionId,
            UUID accountId,
            String amount,
            String currency,
            String provider,
            String providerTransactionId,
            Instant paidAt,
            Instant cardRefundUntil,
            Instant cardRefundStartedAt) {

        static UnappliedPlanPayment of(UnappliedPlanPayments.Unapplied payment) {
            return new UnappliedPlanPayment(
                    payment.id(),
                    payment.subscriptionId(),
                    payment.accountId(),
                    payment.amount().amount().toPlainString(),
                    payment.amount().currency(),
                    payment.provider(),
                    payment.providerTransactionId(),
                    payment.paidAt(),
                    payment.cardRefundUntil(),
                    payment.cardRefundStartedAt());
        }
    }

    public record UnappliedPlanPaymentList(List<UnappliedPlanPayment> payments) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
