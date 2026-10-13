package az.ideanest.payment.api;

import az.ideanest.payment.application.RefundBankTransfers;
import az.ideanest.payment.domain.RefundBankTransfer;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Refunds paid by bank transfer over HTTP — issue #399. {@code RefundBankTransfers} has the workflow.
 *
 * <p><strong>No {@code Idempotency-Key} header</strong>, unlike {@code POST /v1/admin/refunds}, and
 * none is needed: each write here is idempotent by what it names. Recording the account replaces it;
 * routing a refused refund is keyed on the refused refund; recording a transfer twice under the same
 * bank reference answers the settled refund.
 *
 * <p><strong>{@code no-store}</strong>, and for the reveal more than ever: it is a backer's account
 * number.
 */
@RestController
@RequestMapping("/v1/admin")
public class RefundBankTransferController {

    private final RefundBankTransfers bankRefunds;

    public RefundBankTransferController(RefundBankTransfers bankRefunds) {
        this.bankRefunds = bankRefunds;
    }

    /** Support records the account a pledge's refund is paid into. {@code HANDLE_SUPPORT}. */
    @PutMapping("/pledges/{pledgeId}/refund-bank-details")
    public ResponseEntity<PaymentAdminResponses.RefundPage> recordBankDetails(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID pledgeId,
            @Valid @RequestBody BankDetailsRequest request) {

        List<az.ideanest.payment.domain.Refund> parts = bankRefunds.recordBankDetails(
                callerOf(accessToken), pledgeId, request.iban(), request.holderName(), request.ticketId());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(page(parts));
    }

    /** The backer's account in full, for the transfer. {@code ISSUE_REFUND}, audited. */
    @GetMapping("/refunds/{refundId}/bank-details")
    public ResponseEntity<PaymentAdminResponses.BankDetails> bankDetails(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID refundId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.BankDetails.of(bankRefunds.reveal(callerOf(accessToken), refundId)));
    }

    /** A refund the provider refused, sent by bank transfer instead. {@code ISSUE_REFUND}. */
    @PostMapping("/refunds/{refundId}/bank-transfer")
    public ResponseEntity<PaymentAdminResponses.Refund> routeToBankTransfer(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID refundId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(one(bankRefunds.routeRefused(callerOf(accessToken), refundId)));
    }

    /** The transfer was made. {@code ISSUE_REFUND}, and not by whoever recorded the account. */
    @PostMapping("/refunds/{refundId}/bank-transfer/record")
    public ResponseEntity<PaymentAdminResponses.Refund> recordTransfer(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID refundId,
            @Valid @RequestBody TransferRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(one(bankRefunds.recordTransfer(
                        callerOf(accessToken),
                        refundId,
                        request.bankReference(),
                        request.transferredOn(),
                        request.bankFee() == null ? null : new BigDecimal(request.bankFee()))));
    }

    /**
     * Where a backer's refund goes.
     *
     * @param iban any country's IBAN, spaces allowed
     * @param holderName whose account it is, as the backer gave it
     * @param ticketId the support ticket the backer raised, which the account came from
     */
    public record BankDetailsRequest(
            @NotBlank @Size(max = 64) String iban,
            @NotBlank @Size(max = 200) String holderName,
            @NotNull UUID ticketId) {

        /** A record prints every component, and the IBAN would reach a log with it. */
        @Override
        public String toString() {
            return "BankDetailsRequest[iban=<redacted>, ticketId=" + ticketId + "]";
        }
    }

    /**
     * The transfer that paid a refund.
     *
     * @param bankReference the bank's reference for the payment, as the statement shows it
     * @param transferredOn the day it left IdeyaNest's account, not after today
     * @param bankFee what the bank charged for the transfer, in the refund's currency, as a decimal
     *     string; absent or zero when it charged nothing (#401)
     */
    public record TransferRequest(
            @NotBlank @Size(max = 100) String bankReference,
            @NotNull LocalDate transferredOn,
            @Pattern(regexp = "^\\d{1,12}(\\.\\d{1,2})?$") String bankFee) {
    }

    private PaymentAdminResponses.Refund one(az.ideanest.payment.domain.Refund refund) {
        Map<UUID, RefundBankTransfer> rows = bankRefunds.of(List.of(refund));
        return PaymentAdminResponses.Refund.of(refund, rows.get(refund.id()));
    }

    private PaymentAdminResponses.RefundPage page(List<az.ideanest.payment.domain.Refund> parts) {
        return PaymentAdminResponses.RefundPage.of(parts, bankRefunds.of(parts), 0, Integer.MAX_VALUE);
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
