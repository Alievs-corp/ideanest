package az.ideanest.compliance.api;

import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.compliance.domain.PayoutDestination;
import az.ideanest.payment.application.PayoutCardPage;
import az.ideanest.payment.application.PayoutCardRegistrations;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * A creator says where their money goes — part of issue #432.
 *
 * <p>Under {@code /v1/me} beside the legal subject, and for the same reason: the destination is
 * a fact about the account rather than about a campaign. A creator with three campaigns is paid
 * to one account.
 *
 * <p><strong>{@code PUT} and not {@code PATCH}</strong>, on {@code MyLegalSubjectController}'s
 * argument with an extra edge to it. The fields describe one account, so a partial update would
 * need a rule for what a missing token means — and the only safe rule, "keep the old one", is
 * how a creator changes the holder's name on somebody else's account.
 *
 * <h2>The token is supplied and not issued here, and nothing can issue one yet</h2>
 *
 * <p>The creator enters their bank details at the provider and the platform stores what comes
 * back, exactly as it stores a card token: {@code PayoutRequest} sets out at length why an IBAN
 * is not held here. No provider adapter exists to run that hosted flow — §9.2's refusal to ship
 * a stub, and #433 is what ends it — so in a deployed environment this endpoint has nothing
 * real to be handed. That is the same inert-behind-the-interface state the whole collection
 * path has been in since #61, and it is why the shape is worth having now: the gate, the
 * verification and the audit are real, and the day an adapter lands the flow in front of them
 * is the only thing missing.
 */
@RestController
public class MyPayoutDestinationController {

    private final CreatorPayoutDestinations destinations;
    private final PayoutCardRegistrations cards;

    public MyPayoutDestinationController(CreatorPayoutDestinations destinations, PayoutCardRegistrations cards) {
        this.destinations = destinations;
        this.cards = cards;
    }

    @GetMapping(path = "/v1/me/payout-destination", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.Mine> mine(@AuthenticationPrincipal Jwt accessToken) {
        UUID accountId = callerOf(accessToken);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(destinations
                        .mine(accountId)
                        .map(row -> PayoutDestinationResponses.Mine.of(row, destinations.standingOf(accountId)))
                        .orElseGet(PayoutDestinationResponses.Mine::none));
    }

    @PutMapping(
            path = "/v1/me/payout-destination",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.Mine> record(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody DestinationRequest request) {

        UUID accountId = callerOf(accessToken);
        PayoutDestination saved = destinations.record(
                accountId, request.provider(), request.reference(), request.holderName(), request.displayHint());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PayoutDestinationResponses.Mine.of(saved, destinations.standingOf(accountId)));
    }

    /**
     * IDN-EXT-01 (#44): open the provider's page for registering a business card as the payout
     * destination.
     *
     * <p>The card is entered there and never here. When the provider confirms it, the card is filed
     * as this account's destination and waits for verification like any other; until then nothing on
     * file changes. {@code successUrl} and {@code errorUrl} are where the provider returns the creator,
     * and {@code language} is the page's.
     */
    @PostMapping(
            path = "/v1/me/payout-destination/card-registration",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CardRegistrationResponse> registerCard(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody CardRegistrationRequest request) {

        PayoutCardPage page = cards.begin(
                callerOf(accessToken), request.language(), request.successUrl(), request.errorUrl());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new CardRegistrationResponse(page.provider(), page.redirectUrl()));
    }

    /** Where the provider returns the creator, and in which language its page speaks. */
    public record CardRegistrationRequest(@Size(max = 8) String language, URI successUrl, URI errorUrl) {
    }

    /** The provider that will hold the card, and its page. */
    public record CardRegistrationResponse(String provider, URI redirectUrl) {
    }

    /**
     * What a creator sends.
     *
     * @param provider whose token this is, as a {@code ProviderName} constant. Required rather
     *     than inferred from the deployment's configured primary: a platform that changes
     *     provider holds tokens from two, and a token attributed to the wrong one is a payout
     *     refused at the far end for a reason nobody can see from here
     * @param reference the provider's token for the account. Never an IBAN, and the two-hundred
     *     character ceiling is the one {@code SendRequest} used to carry
     * @param holderName what the provider says the account holder is called. Matched against
     *     #430's legal name on the way in
     * @param displayHint the masked tail the creator recognises the account by. Twelve
     *     characters, which is more than a mask and less than an account number
     */
    public record DestinationRequest(
            @NotBlank @Size(max = 20) String provider,
            @NotBlank @Size(max = 200) String reference,
            @NotBlank @Size(max = 200) String holderName,
            @Size(max = 12) String displayHint) {
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
