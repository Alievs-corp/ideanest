package az.ideanest.payout.api;

import az.ideanest.payout.application.BackerDisputes;
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

    public BackerDisputeController(BackerDisputes disputes) {
        this.disputes = disputes;
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

    /** The undecided disputes, oldest first. {@code MANAGE_DISPUTES}. */
    @GetMapping("/v1/admin/backer-disputes")
    public ResponseEntity<List<DisputeBody>> queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(defaultValue = "0") int page) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(disputes.queue(callerOf(accessToken), page).stream().map(DisputeBody::of).toList());
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
            UUID refundId) {

        static DisputeBody of(BackerDispute dispute) {
            return new DisputeBody(
                    dispute.id(),
                    dispute.pledgeId(),
                    dispute.projectId(),
                    dispute.payoutId(),
                    dispute.reason(),
                    dispute.state().name(),
                    dispute.openedAt(),
                    dispute.decidedAt(),
                    dispute.refundId());
        }
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
