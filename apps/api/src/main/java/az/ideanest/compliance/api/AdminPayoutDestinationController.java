package az.ideanest.compliance.api;

import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.compliance.application.NoBankAccountOnFileException;
import az.ideanest.compliance.domain.DestinationVerificationMethod;
import az.ideanest.compliance.domain.PayoutDestination;
import az.ideanest.shared.compliance.RejectionReason;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
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
 * COMPLIANCE decides where a creator's money may go — part of issue #432.
 *
 * <p>On the account screen beside the legal subject, for {@code AdminLegalSubjectController}'s
 * reason: {@code /v1/admin/accounts/{id}} is where the compliance panels already hang, and a
 * new console screen costs five separate registrations for something that is one panel and one
 * short queue.
 *
 * <p><strong>{@code VERIFY_PAYOUT_DESTINATION}, which FINANCE does not hold.</strong> V66
 * decided that one issue early and recorded why: "the person who confirms that an IBAN belongs
 * to the creator it is filed under is not the person who sends money to it." The capability
 * check is in the service, where the audit row is also written — an authorised action nobody
 * recorded and a recorded action nobody authorised are the same defect from opposite ends.
 *
 * <p><strong>The IBAN is one endpoint of its own</strong> (#394):
 * {@code GET /accounts/{id}/payout-destination/account} returns the number in full to somebody
 * holding {@code READ_BANK_DETAILS} — COMPLIANCE to verify it, FINANCE to pay into it — and
 * audits the opening. Everything else here shows the masked hint.
 *
 * <p><strong>No write of the destination itself.</strong> There is no endpoint here that sets a
 * token, and that absence is the whole point of the issue. A member of staff who could file a
 * destination would be a member of staff typing where money goes, which is what this replaces.
 */
@RestController
@RequestMapping("/v1/admin")
public class AdminPayoutDestinationController {

    private final CreatorPayoutDestinations destinations;

    public AdminPayoutDestinationController(CreatorPayoutDestinations destinations) {
        this.destinations = destinations;
    }

    /** One creator's destination, on the account screen. */
    @GetMapping(path = "/accounts/{creatorId}/payout-destination", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.ForStaff> forAccount(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID creatorId) {

        UUID staffId = callerOf(accessToken);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(destinations
                        .forStaff(staffId, creatorId)
                        .map(row -> PayoutDestinationResponses.ForStaff.of(
                                creatorId, row, destinations.standingOf(creatorId)))
                        .orElseGet(() -> PayoutDestinationResponses.ForStaff.none(creatorId)));
    }

    /**
     * The creator's IBAN in full — #394. {@code READ_BANK_DETAILS}, and audited as
     * {@code PAYOUT_DESTINATION_ACCOUNT_REVEALED}; a 404 when what is on file is not a bank
     * account.
     */
    @GetMapping(
            path = "/accounts/{creatorId}/payout-destination/account",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.RevealedBankAccount> revealAccount(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID creatorId) {

        UUID staffId = callerOf(accessToken);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(destinations
                        .revealBankAccount(staffId, creatorId)
                        .map(account -> PayoutDestinationResponses.RevealedBankAccount.of(creatorId, account))
                        .orElseThrow(() -> new NoBankAccountOnFileException(creatorId)));
    }

    /** The destinations waiting on somebody, oldest first. */
    @GetMapping(path = "/payout-destinations", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.Queue> queue(@AuthenticationPrincipal Jwt accessToken) {
        UUID staffId = callerOf(accessToken);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new PayoutDestinationResponses.Queue(destinations.queue(staffId).stream()
                        .map(row -> PayoutDestinationResponses.ForStaff.of(
                                row.getUserId(), row, destinations.standingOf(row.getUserId())))
                        .toList()));
    }

    /**
     * Confirm that the account belongs to the creator it is filed under.
     *
     * <p>A {@code POST} to a sub-resource rather than a {@code PUT} of a state field, on
     * {@code PayoutController.approve}'s argument: this is an act with a person's name attached
     * and not an edit of a value, and a {@code PUT} would invite a client to send the state it
     * wanted rather than the decision it took.
     */
    @PostMapping(
            path = "/accounts/{creatorId}/payout-destination/verify",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.ForStaff> verify(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID creatorId,
            @Valid @RequestBody VerifyRequest request) {

        UUID staffId = callerOf(accessToken);
        PayoutDestination saved = destinations.verify(staffId, creatorId, request.method());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PayoutDestinationResponses.ForStaff.of(creatorId, saved, destinations.standingOf(creatorId)));
    }

    /** Refuse it, with a reason the creator is shown. */
    @PostMapping(
            path = "/accounts/{creatorId}/payout-destination/reject",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.ForStaff> reject(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID creatorId,
            @Valid @RequestBody RejectRequest request) {

        UUID staffId = callerOf(accessToken);
        PayoutDestination saved = destinations.reject(staffId, creatorId, request.reason());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PayoutDestinationResponses.ForStaff.of(creatorId, saved, destinations.standingOf(creatorId)));
    }

    /**
     * How ownership was established.
     *
     * <p>Sent by the client rather than assumed to be {@code STAFF_ATTESTED}, although that is
     * the only one anybody can send today. The field is what #432 asks the row to record, and a
     * server that filled it in itself would be recording an assumption where the issue asked
     * for a fact — which is exactly what the column exists to stop happening again once #422
     * makes the other two possible.
     */
    public record VerifyRequest(@NotNull DestinationVerificationMethod method) {
    }

    /** Why it was refused. V58's closed set, so the creator can be told in each language. */
    public record RejectRequest(@NotNull RejectionReason reason) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
