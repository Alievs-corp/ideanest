package az.ideanest.payout.api;

import java.util.Map;
import az.ideanest.shared.money.Money;
import az.ideanest.payment.application.PledgeFunds;
import az.ideanest.payment.application.PledgeBackers;
import az.ideanest.payout.application.BackerDisputes;
import az.ideanest.payout.application.DisputeWindow;
import az.ideanest.payout.domain.BackerDispute;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Backer disputes during the payout hold — IDN-EXT-01 (#43), §6.3.
 *
 * <p>The backer's one request, and the administrators' queue and decision. The web surfaces for both
 * belong to stage 3 (#44).
 */
@RestController
public class BackerDisputeController {

    private final BackerDisputes disputes;
    private final PledgeFunds funds;
    private final PledgeBackers backers;

    public BackerDisputeController(BackerDisputes disputes, PledgeFunds funds, PledgeBackers backers) {
        this.disputes = disputes;
        this.funds = funds;
        this.backers = backers;
    }

    /**
     * Disputes a payment while the creator's payout is held. Answers the dispute already open for the
     * pledge when there is one. 409 {@code DISPUTE_WINDOW_CLOSED} once the payout has been sent, or before
     * one was requested; 409 {@code NOTHING_TO_DISPUTE} when nothing is left to refund.
     */
    @PostMapping("/v1/pledges/{pledgeId}/disputes")
    public ResponseEntity<DisputeBody> open(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID pledgeId,
            @Valid @RequestBody OpenDisputeRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(DisputeBody.of(disputes.open(callerOf(accessToken), pledgeId, request.reason())));
    }

    /** Whether the caller may dispute their pledge now, and the dispute already open on it (#480). */
    @GetMapping("/v1/pledges/{pledgeId}/disputes/window")
    public ResponseEntity<DisputeWindowBody> window(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID pledgeId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(DisputeWindowBody.of(disputes.window(callerOf(accessToken), pledgeId)));
    }

    /**
     * The undecided disputes, oldest first. {@code MANAGE_DISPUTES}.
     *
     * <p>Each carries what upholding it would refund — {@code refundable}, everything the pledge has left,
     * since an upheld dispute refunds in full — and the pledge's backer, so the console can say how much
     * and to whom before anybody presses the button that sends it. A bare array of at most fifty: a page
     * shorter than that is the last.
     */
    @GetMapping("/v1/admin/backer-disputes")
    public ResponseEntity<List<DisputeBody>> queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(defaultValue = "0") int page) {
        List<BackerDispute> queued = disputes.queue(callerOf(accessToken), page);
        Map<UUID, UUID> backerOf = backers.of(queued.stream().map(BackerDispute::pledgeId).toList());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(queued.stream()
                        .map(dispute -> DisputeBody.of(
                                dispute,
                                funds.refundableOn(dispute.pledgeId()).orElse(null),
                                backerOf.get(dispute.pledgeId())))
                        .toList());
    }

    /** Upholds or rejects a dispute. Upholding refunds the backer in full and recalculates the payout. */
    @PostMapping("/v1/admin/backer-disputes/{disputeId}/decision")
    public ResponseEntity<DisputeBody> decide(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID disputeId,
            @Valid @RequestBody DecisionRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(DisputeBody.of(disputes.decide(
                        callerOf(accessToken), disputeId, request.outcome() == Outcome.UPHOLD, request.note())));
    }

    public record OpenDisputeRequest(@NotBlank @Size(max = 2000) String reason) {
    }

    public enum Outcome {
        UPHOLD,
        REJECT
    }

    public record DecisionRequest(@NotNull Outcome outcome, @Size(max = 2000) String note) {
    }

    public record DisputeBody(
            UUID id,
            UUID pledgeId,
            UUID projectId,
            UUID payoutId,
            String reason,
            String state,
            Instant openedAt,
            Instant decidedAt,
            UUID refundId,
            Money refundable,
            UUID backerId) {

        static DisputeBody of(BackerDispute dispute) {
            return of(dispute, null, null);
        }

        /**
         * @param refundable what the pledge has left to refund — what upholding sends; null on every
         *     response but the administrators' queue, and when nothing is left
         * @param backerId the pledge's backer, on the administrators' queue only
         */
        static DisputeBody of(BackerDispute dispute, Money refundable, UUID backerId) {
            return new DisputeBody(
                    dispute.id(),
                    dispute.pledgeId(),
                    dispute.projectId(),
                    dispute.payoutId(),
                    dispute.reason(),
                    dispute.state().name(),
                    dispute.openedAt(),
                    dispute.decidedAt(),
                    dispute.refundId(),
                    refundable,
                    backerId);
        }
    }

    public record DisputeWindowBody(String status, Instant until, DisputeBody dispute) {

        static DisputeWindowBody of(DisputeWindow window) {
            return new DisputeWindowBody(
                    window.status().name(), window.until(), window.open().map(DisputeBody::of).orElse(null));
        }
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
