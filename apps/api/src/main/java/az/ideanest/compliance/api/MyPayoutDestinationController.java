package az.ideanest.compliance.api;

import az.ideanest.compliance.application.CreatorPayoutDestinations;
import az.ideanest.compliance.domain.PayoutDestination;
import az.ideanest.payment.application.PayoutCardPage;
import az.ideanest.payment.application.PayoutCardRegistrations;
import az.ideanest.shared.compliance.DestinationStanding;
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
 * <h2>Two ways to say where: a bank account, or a provider's token</h2>
 *
 * <p><strong>A bank account</strong> at {@code PUT /v1/me/payout-destination/bank-account}
 * (#394): the creator types their IBAN and the holder's name, and the platform holds the IBAN
 * encrypted. This is the primary route since the owner decided on 2026-10-12 that creators
 * are paid by bank transfer, which reverses #432's position that an IBAN is never held here.
 *
 * <p><strong>A provider's token</strong> at {@code PUT /v1/me/payout-destination}, or a card
 * registered on the provider's page: the platform stores what the provider hands back, exactly
 * as it stores a card token. {@code cardRegistrationAvailable} on the response says whether the
 * configured provider can do the second at all, so a screen offers it only when it can work.
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
        boolean cardsAvailable = cards.available();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(destinations
                        .mine(accountId)
                        .map(row -> PayoutDestinationResponses.Mine.of(
                                row, destinations.standingOf(accountId), cardsAvailable))
                        .orElseGet(() -> PayoutDestinationResponses.Mine.none(cardsAvailable)));
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

        return respond(saved, accountId);
    }

    /**
     * File a bank account — #394.
     *
     * <p>A {@code PUT} of the whole account for {@link #record}'s reason: a partial update would
     * need a rule for what a missing IBAN means, and the only safe one is how a creator changes
     * the holder's name on somebody else's account. Replacing whatever is on file, token or
     * account, clears its verification.
     *
     * <p>The response carries the masked hint and never the IBAN, for the token's reason: a
     * response is cached, proxied and pasted into bug reports. Refused with {@code MALFORMED_IBAN}
     * for anything but a valid Azerbaijani IBAN, and with a 503 {@code ENCRYPTED_STORAGE_UNAVAILABLE}
     * while the deployment has no {@code bank-details} key, in which case nothing changes.
     */
    @PutMapping(
            path = "/v1/me/payout-destination/bank-account",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PayoutDestinationResponses.Mine> recordBankAccount(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody BankAccountRequest request) {

        UUID accountId = callerOf(accessToken);
        PayoutDestination saved = destinations.recordBankAccount(accountId, request.iban(), request.holderName());
        return respond(saved, accountId);
    }

    private ResponseEntity<PayoutDestinationResponses.Mine> respond(PayoutDestination saved, UUID accountId) {
        DestinationStanding standing = destinations.standingOf(accountId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PayoutDestinationResponses.Mine.of(saved, standing, cards.available()));
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
     * @param reference the provider's token for the account. Not an IBAN — that is
     *     {@link BankAccountRequest}, which seals it — and the two-hundred character ceiling is
     *     the one {@code SendRequest} used to carry
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

    /**
     * A bank account, as the creator types it — #394.
     *
     * @param iban the account number, with or without the spaces it is printed with, in either
     *     case. Sixty-four characters is a twenty-eight-character IBAN with room for any spacing
     *     a banking app copies with, and refuses a pasted paragraph before it is parsed
     * @param holderName who holds the account, as the bank has it. Matched against the
     *     creator's legal name on the way in
     */
    public record BankAccountRequest(
            @NotBlank @Size(max = 64) String iban, @NotBlank @Size(max = 200) String holderName) {

        /** The holder only: a request logged by a framework must not put an IBAN in a log. */
        @Override
        public String toString() {
            return "BankAccountRequest[iban=<redacted>]";
        }
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
