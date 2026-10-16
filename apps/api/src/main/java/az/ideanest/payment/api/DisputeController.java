package az.ideanest.payment.api;

import az.ideanest.payment.application.DisputeService;
import az.ideanest.payment.application.PledgeBackers;
import az.ideanest.payment.domain.DisputeState;
import az.ideanest.payment.domain.EvidenceKind;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-07 over HTTP — issues #68 and #308.
 *
 * <h2>There is no endpoint that opens a dispute</h2>
 *
 * <p>Deliberately. A chargeback is raised by a card network and arrives through a
 * provider's webhook; an endpoint that let staff open one would be a way to invent a
 * dispute the network never made, and the platform would then answer it. Intake is
 * {@code DisputeService.notified}, called from the webhook path.
 *
 * <p>What staff can do is answer: add evidence, submit it, and record the outcome.
 *
 * <h2>Reading needs {@code VIEW_FINANCE} and answering needs {@code MANAGE_DISPUTES}</h2>
 *
 * <p>The same split as refunds and for the same reason. Assembling the argument against a
 * chargeback and being trusted to concede one are different authorities.
 *
 * <p><strong>{@code no-store}</strong>: these responses name pledges, amounts and the
 * platform's own case notes.
 */
@RestController
@RequestMapping("/v1/admin/disputes")
public class DisputeController {

    private final DisputeService disputes;
    private final PledgeBackers backers;

    public DisputeController(DisputeService disputes, PledgeBackers backers) {
        this.disputes = disputes;
        this.backers = backers;
    }

    /**
     * The queue, soonest deadline first.
     *
     * <p>Separate from {@link #list} rather than a filter on it, because they are ordered
     * differently and the ordering is the point: a queue is worked by deadline and a
     * history is read by date. One endpoint with a flag would make the sort a parameter,
     * and the caller that forgot it would work the queue in the wrong order.
     */
    @GetMapping("/queue")
    public ResponseEntity<PaymentAdminResponses.DisputePage> queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(defaultValue = "0") int page) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(pageOf(disputes.queue(callerOf(accessToken), page), page));
    }

    /** Everything, newest first, optionally narrowed to one state. */
    @GetMapping
    public ResponseEntity<PaymentAdminResponses.DisputePage> list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) DisputeState state,
            @RequestParam(defaultValue = "0") int page) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(pageOf(disputes.list(callerOf(accessToken), state, page), page));
    }

    /** One case with its evidence, oldest piece first. */
    @GetMapping("/{disputeId}")
    public ResponseEntity<PaymentAdminResponses.Dispute> inspect(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID disputeId) {

        DisputeService.DisputeCase found = disputes.inspect(callerOf(accessToken), disputeId);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.Dispute.of(
                        found.dispute(),
                        found.evidence(),
                        backers.of(List.of(found.dispute().pledgeId())).get(found.dispute().pledgeId())));
    }

    /** A page, each case naming its backer so the console can say whose money it is. */
    private PaymentAdminResponses.DisputePage pageOf(List<az.ideanest.payment.domain.Dispute> listed, int page) {
        return PaymentAdminResponses.DisputePage.of(
                listed, backers.of(listed.stream().map(az.ideanest.payment.domain.Dispute::pledgeId).toList()), page, 50);
    }

    /** Adds a piece to the argument. Assembled, not sent — {@link #submit} sends. */
    @PostMapping("/{disputeId}/evidence")
    public ResponseEntity<PaymentAdminResponses.Evidence> addEvidence(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID disputeId,
            @Valid @RequestBody AddEvidenceRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.Evidence.of(disputes.addEvidence(
                        callerOf(accessToken),
                        disputeId,
                        request.kind(),
                        request.description(),
                        request.mediaId())));
    }

    /** Answers the case with everything assembled so far. */
    @PostMapping("/{disputeId}/submit")
    public ResponseEntity<PaymentAdminResponses.Dispute> submit(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID disputeId) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.Dispute.summary(disputes.submit(callerOf(accessToken), disputeId)));
    }

    /** Records how the network decided, or that the platform chose not to argue. */
    @PostMapping("/{disputeId}/resolve")
    public ResponseEntity<PaymentAdminResponses.Dispute> resolve(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID disputeId,
            @Valid @RequestBody ResolveRequest request) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PaymentAdminResponses.Dispute.summary(
                        disputes.resolve(callerOf(accessToken), disputeId, request.outcome())));
    }

    /**
     * A piece of evidence.
     *
     * @param mediaId a stored document, when there is one. Optional: much of a
     *     representment is a sentence about what the platform's own records show, and
     *     forcing an upload would make people attach screenshots of their own screens
     */
    public record AddEvidenceRequest(
            @NotNull EvidenceKind kind, @NotBlank @Size(max = 5000) String description, UUID mediaId) {
    }

    /**
     * How it ended.
     *
     * @param outcome {@code WON}, {@code LOST} or {@code CONCEDED}. The service refuses
     *     anything else — a dispute cannot be "resolved" as {@code OPEN}
     */
    public record ResolveRequest(@NotNull DisputeState outcome) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
