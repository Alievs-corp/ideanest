package az.ideanest.pledge.api;

import az.ideanest.pledge.PledgeProperties;
import az.ideanest.pledge.application.PledgeService;
import az.ideanest.pledge.application.PledgeSupplementService;
import az.ideanest.shared.idempotency.IdempotencyKey;
import az.ideanest.shared.idempotency.IdempotentRequests;
import az.ideanest.shared.idempotency.RecordedResponse;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * A backer's pledge: making one, reading it, confirming it, changing it, and
 * withdrawing it.
 *
 * <p>Seven of §10.2's eight pledge endpoints, the two purchases of §4.8's PM-09 and
 * PM-10 included (#76). {@code GET /receipt} waits on there being a collection to
 * receipt, which is epic #59's.
 *
 * <p><strong>All six mutations require {@code Idempotency-Key}</strong> (§10.3), and
 * the requirement is enforced before anything else about the request is considered. A
 * missing or malformed key is a refusal rather than a request that quietly runs
 * without protection — see {@link IdempotencyKey}.
 *
 * <p><strong>They answer with recorded bytes, not with an object.</strong> The five
 * that have a body return {@code ResponseEntity<String>} carrying JSON that
 * {@link IdempotentRequests} produced and stored, so that a replay is byte-identical
 * to the response it replays. Serialising the result twice — once now, once from a
 * re-read on the retry — would make the guarantee only as good as the two
 * serialisations agreeing, which they stop doing the first time a field is added.
 * The read has nothing to replay and returns the object; the cancellation has no
 * body at all and goes through
 * {@link IdempotentRequests#executeWithoutContent}, which records the zero bytes a
 * {@code 204} sends.
 *
 * <p><strong>Every mutation is counted against §17.3's limit</strong>, the edit and
 * the cancellation included and in the same bucket. What the limit bounds is the work
 * one account can demand, and an edit is the most expensive request here: it settles
 * nothing, but it re-quotes a whole selection and takes a row lock on a reward tier —
 * the row every other backer of that campaign is contending for.
 *
 * <p><strong>Authorisation is not decided here.</strong> The caller's identifier goes
 * down to {@link PledgeService}, whose reads are scoped to it in the query — so
 * somebody else's pledge is a 404 rather than a 403, for the reason
 * {@code PledgeNotFoundException} gives.
 *
 * <p><strong>No {@code Location} header on the draft.</strong> There is one — the
 * pledge is readable at {@code /v1/pledges/{id}} — but the whole resource is in the
 * body, and a client that has to follow a header to learn what it will be charged is
 * one round trip worse off at the checkout.
 */
@RestController
public class PledgeController {

    /**
     * What a key is spent on, and part of its fingerprint.
     *
     * <p>Named for the operation rather than for the path, so that a key cannot serve
     * a draft and a confirmation as though they were one request — and so that #56's
     * {@code pledge.edit} and {@code pledge.cancel} sit beside these rather than
     * being invented again.
     */
    private static final String DRAFT = "pledge.draft";

    private static final String CONFIRM = "pledge.confirm";

    private static final String EDIT = "pledge.edit";

    private static final String CANCEL = "pledge.cancel";

    /** §4.8's PM-09 and PM-10 (#76). Beside the four above for the same reason. */
    private static final String UPGRADE = "pledge.upgrade";

    private static final String BUY_ADDONS = "pledge.buy_addons";

    /**
     * The request a {@code DELETE} fingerprints, which is nothing.
     *
     * <p>A cancellation carries no body, so what identifies it is entirely the
     * operation — and the operation carries the pledge. An empty map rather than null
     * because the fingerprint is a hash of serialised bytes and there have to be
     * some.
     */
    private static final Object NO_BODY = Map.of();

    private final PledgeService pledges;
    private final PledgeSupplementService supplements;
    private final IdempotentRequests idempotency;
    private final RateLimiter rateLimiter;
    private final PledgeProperties properties;

    public PledgeController(
            PledgeService pledges,
            PledgeSupplementService supplements,
            IdempotentRequests idempotency,
            RateLimiter rateLimiter,
            PledgeProperties properties) {
        this.pledges = pledges;
        this.supplements = supplements;
        this.idempotency = idempotency;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /**
     * Reserves the place, quotes the selection, and answers with the draft.
     *
     * <p>{@code 201 Created}, and the same {@code 201} with the same body for every
     * retry carrying the same key.
     */
    @PostMapping(path = "/v1/pledges/draft", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> draft(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody DraftPledgeRequest request) {

        UUID backerId = callerOf(accessToken);
        // Before the key is even parsed. §17.3's limit bounds the work one caller can
        // demand, and validating a header first would mean a client looping without
        // one is refused by something that does no counting.
        enforcePledgeRateLimit(backerId);

        IdempotencyKey key = IdempotencyKey.of(idempotencyKey);
        return recorded(idempotency.execute(
                backerId,
                DRAFT,
                key,
                request,
                HttpStatus.CREATED.value(),
                () -> PledgeResponse.of(pledges.draft(request.toCommand(backerId, key.value())))));
    }

    /** The backer's own pledge. Somebody else's is a 404. */
    @GetMapping("/v1/pledges/{id}")
    public PledgeResponse read(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return PledgeResponse.of(pledges.read(id, callerOf(accessToken)));
    }

    /**
     * §6.2's {@code DRAFT --> CONFIRMED}: the held place becomes a claimed one.
     *
     * <p><strong>Nothing is charged.</strong> §9.2 puts the collection at the close of
     * a successful campaign and says in terms that no money moves here and no ledger
     * entry is written. The response says {@code cardVerified: false} because even the
     * verification of §9.2's phase 1 is not built — {@code PledgeCapability}.
     *
     * <p><strong>§22.3's acknowledgement is part of the body</strong> — #427. The
     * request carries the version of the backer agreement the checkout showed, and an
     * acceptance is recorded against it in the same transaction as the confirmation. A
     * request that acknowledges nothing, or acknowledges a version that is no longer in
     * force, is refused with {@code AGREEMENT_REQUIRED}.
     *
     * <p>The body is optional: {@code paymentMethodId} is nullable until #55, and the
     * acknowledgement is only required once a backer agreement has been published, so a
     * client with nothing to send may send nothing.
     */
    @PostMapping(path = "/v1/pledges/{id}/confirm", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> confirm(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) ConfirmPledgeRequest body) {

        UUID backerId = callerOf(accessToken);
        enforcePledgeRateLimit(backerId);

        ConfirmPledgeRequest request = ConfirmPledgeRequest.orEmpty(body);
        IdempotencyKey key = IdempotencyKey.of(idempotencyKey);
        return recorded(idempotency.execute(
                backerId,
                // The pledge is part of what the key was spent on, so one key cannot
                // confirm two different pledges — the second would otherwise be
                // replayed with the first one's body, which is a client being told a
                // pledge it never confirmed is confirmed.
                CONFIRM + ":" + id,
                key,
                request,
                HttpStatus.OK.value(),
                () -> PledgeResponse.of(pledges.confirm(
                        id, backerId, request.paymentMethodId(), request.acknowledgedAgreementVersion()))));
    }

    /**
     * §4.5's PL-09: the backer changes their mind while the campaign runs.
     *
     * <p><strong>The whole pledge comes back, not the fields that changed.</strong> A
     * client that merged a partial response would keep a stale total — and on this
     * endpoint the total is what somebody is about to be charged. It is the same
     * {@code PledgeResponse} the other three answer with, so a client applies the
     * same update whichever call it made.
     *
     * <p>Absent and null mean different things in the body. See
     * {@link PatchPledgeRequest}.
     */
    @PatchMapping(path = "/v1/pledges/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> edit(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody PatchPledgeRequest request) {

        UUID backerId = callerOf(accessToken);
        enforcePledgeRateLimit(backerId);

        IdempotencyKey key = IdempotencyKey.of(idempotencyKey);
        return recorded(idempotency.execute(
                backerId,
                // The pledge is part of what the key was spent on, for the reason
                // confirm() gives: one key must not be able to edit two pledges and
                // have the second replayed with the first one's body.
                EDIT + ":" + id,
                key,
                request,
                HttpStatus.OK.value(),
                () -> PledgeResponse.of(pledges.edit(request.toCommand(id, backerId)))));
    }

    /**
     * §4.5's PL-10, as IDN-EXT-01 (#35) leaves it: a backer abandons an unpaid checkout, and the
     * reward's place goes back. <strong>A confirmed pledge cannot be cancelled</strong> — it is
     * refused with {@code PLEDGE_CANNOT_BE_CANCELLED} — because a backer may only raise a pledge and
     * every refund is campaign-level (§9.7). The route stays for the draft.
     *
     * <p><strong>{@code 204 No Content}, and a retry is {@code 204} too.</strong> The
     * ordinary retry carries the same key and is replayed from
     * {@code idempotency_keys} — which is the case that table was added for, since a
     * cancelled pledge is not in an active state and there is nothing left to find by
     * the key on the row. A client that lost its key and sent a fresh one is answered
     * {@code 204} as well, by {@code PledgeService#cancel}, because "it is cancelled"
     * is true either way.
     *
     * <p><strong>Nothing is refunded, because nothing was collected</strong> (§9.7).
     * There is no refund path here and there should not be one: refunding a pledge
     * that really was collected is #67's.
     */
    @DeleteMapping("/v1/pledges/{id}")
    public ResponseEntity<Void> cancel(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        UUID backerId = callerOf(accessToken);
        enforcePledgeRateLimit(backerId);

        IdempotencyKey key = IdempotencyKey.of(idempotencyKey);
        RecordedResponse response = idempotency.executeWithoutContent(
                backerId,
                CANCEL + ":" + id,
                key,
                // There is no body, so the pledge in the operation above is the whole
                // of what this key was spent on. Two cancellations of two different
                // pledges under one key are two operations and therefore a reuse,
                // which is the answer that keeps a client from being told a pledge it
                // never cancelled is gone.
                NO_BODY,
                HttpStatus.NO_CONTENT.value(),
                () -> pledges.cancel(id, backerId));

        return ResponseEntity.status(response.status()).build();
    }

    /**
     * §4.8's PM-09: the backer moves up to a better reward tier after the campaign has
     * closed, and owes the difference.
     *
     * <p><strong>Not the same thing as {@code PATCH /v1/pledges/{id}}</strong>, and the
     * two are refused in each other's window: while the campaign runs, an edit
     * re-quotes the whole pledge and nothing has been charged; afterwards, §5.1's
     * decision has been frozen against those numbers and the difference is a separate
     * transaction. {@code PledgeSupplementService} carries the argument, and a client
     * that calls the wrong one is told which is the right one.
     *
     * <p>Idempotent through the same machinery as every other mutation here, with the
     * pledge in the operation for {@link #confirm}'s reason: one key must not be able to
     * upgrade two pledges and have the second replayed with the first one's body.
     *
     * <p><strong>Nothing is charged.</strong> The supplement is recorded with
     * {@code collectedAt: null}, and PM-16's charge is epic #59's.
     */
    @PostMapping(path = "/v1/pledges/{id}/upgrade", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> upgrade(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody UpgradePledgeRequest request) {

        UUID backerId = callerOf(accessToken);
        enforcePledgeRateLimit(backerId);

        IdempotencyKey key = IdempotencyKey.of(idempotencyKey);
        return recorded(idempotency.execute(
                backerId,
                UPGRADE + ":" + id,
                key,
                request,
                HttpStatus.OK.value(),
                () -> PledgeResponse.of(supplements.upgrade(id, backerId, request.rewardTierId()))));
    }

    /**
     * §4.8's PM-10: the pledge manager's add-on store.
     *
     * <p>The body says what to add rather than what the pledge should end up with —
     * {@link BuyAddonsRequest} says why the difference matters — and the lines are
     * recorded against the purchase rather than merged into the campaign's own
     * {@code pledge_addons}, which V39 argues at length. The places are claimed either
     * way, so a limited add-on cannot be oversold by being bought late.
     */
    @PostMapping(path = "/v1/pledges/{id}/addons", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> buyAddons(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody BuyAddonsRequest request) {

        UUID backerId = callerOf(accessToken);
        enforcePledgeRateLimit(backerId);

        IdempotencyKey key = IdempotencyKey.of(idempotencyKey);
        return recorded(idempotency.execute(
                backerId,
                BUY_ADDONS + ":" + id,
                key,
                request,
                HttpStatus.OK.value(),
                () -> PledgeResponse.of(supplements.buyAddons(id, backerId, request.selections()))));
    }

    /**
     * The bytes that were recorded, with the status they were recorded under.
     *
     * <p>{@code String} rather than the object, so that the response and its replay
     * are the same bytes and not two serialisations of the same idea.
     */
    private static ResponseEntity<String> recorded(RecordedResponse response) {
        return ResponseEntity.status(response.status())
                .contentType(MediaType.APPLICATION_JSON)
                .body(response.body());
    }

    /** §17.3: ten pledges a minute per account. */
    private void enforcePledgeRateLimit(UUID backerId) {
        PledgeProperties.RateLimit limits = properties.rateLimit();
        RateLimits.enforce(rateLimiter.recordAttempt("pledge:" + backerId, limits.pledgesPerUser(), limits.window()));
    }

    /** The account making the request, as our own signature establishes it. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
