package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.project.application.PledgeAcceptance;
import az.ideanest.shared.legal.AgreementInForce;
import az.ideanest.shared.legal.AgreementKind;
import az.ideanest.shared.legal.Agreements;
import az.ideanest.shared.outbox.Outbox;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a backer does with a pledge: make one, read it, confirm it, change it, and
 * withdraw it.
 *
 * <p>§4.5's flow, minus the two halves that belong elsewhere. Reserving the places,
 * pricing the selection and moving places from one tier to another are
 * {@link ReservationService}, which #51 built and #52, #56 and #203 extended;
 * replaying a retried request is {@code shared.idempotency}, which wraps every
 * mutation here. What is left is the ordering, the campaign's own answer about whether
 * it will take a pledge, and §6.2's transitions.
 *
 * <p><strong>Nothing here writes {@code reward_tiers} any more (#203).</strong>
 * Confirmation used to move its single place itself, which was reasonable while a
 * pledge held one; a pledge holding places on its reward <em>and</em> on each add-on
 * is the same map the other four stock paths move, so the fifth moved next to them.
 * One class writes the stock columns, which is the only way the five paths can be
 * checked against each other by reading them.
 *
 * <p><strong>{@link #requireEditable} is the one place that says whether a backer
 * may still act on a pledge.</strong> §4.5's PL-09 and PL-10 are each bounded by two
 * facts owned by two modules — §6.2's states here, the campaign's deadline in
 * {@code project} — and scattering that pair across the edit and the cancellation
 * would be two rules free to drift apart.
 *
 * <p><strong>Where the campaign check lives, and why here.</strong>
 * {@code ReservationService} deliberately does not ask whether the campaign is
 * taking pledges — its javadoc says so — because that is a question about
 * {@code projects} and answering it there would make the pledge module depend on the
 * project module in order to refuse the same request twice. It is asked here,
 * through {@link PledgeAcceptance}, which is the project module's application layer
 * and the only part of it this module may see. {@code ModuleBoundaryTests} fails the
 * build over the alternative.
 *
 * <p><strong>Nothing here charges anything.</strong> §9.2 is explicit: at
 * confirmation the card is verified and the verification is voided, no money moves,
 * and no ledger entry is written. Today not even the verification happens — see
 * {@link PledgeCapability#CARD_VERIFICATION}, which names the issue that owns it.
 *
 * <p><strong>{@link #confirm} is the one method here that announces anything</strong>
 * (#235). It records {@link PledgeConfirmedEvent} through §8.3's outbox, in the
 * transaction that performs the transition — see that method for why it is there and
 * nowhere else. The draft, the edit and the cancellation announce nothing yet, and
 * each is a separate piece of work with a consumer behind it rather than an event
 * recorded because it would be symmetrical.
 */
@Service
public class PledgeService {

    private static final Logger log = LoggerFactory.getLogger(PledgeService.class);

    private final ReservationService reservations;
    private final PledgeAcceptance acceptance;
    private final PledgeRepository pledges;
    private final PledgeAddonRepository addons;
    private final PledgeDetails details;
    private final Outbox outbox;
    private final DisplayRates displayRates;
    private final Agreements agreements;
    private final Clock clock;

    public PledgeService(
            ReservationService reservations,
            PledgeAcceptance acceptance,
            PledgeRepository pledges,
            PledgeAddonRepository addons,
            PledgeDetails details,
            Outbox outbox,
            DisplayRates displayRates,
            Agreements agreements,
            Clock clock) {
        this.reservations = reservations;
        this.acceptance = acceptance;
        this.pledges = pledges;
        this.addons = addons;
        this.details = details;
        this.outbox = outbox;
        this.displayRates = displayRates;
        this.agreements = agreements;
        this.clock = clock;
    }

    /**
     * {@code POST /v1/pledges/draft}: reserve the place, price the selection, write
     * the draft.
     *
     * <p><strong>The campaign is asked first</strong>, before a place is taken or a
     * price is read. A campaign that is not taking pledges refuses every selection,
     * so checking it after would mean reserving stock on a campaign that is over and
     * relying on the rollback — correct, and a lock taken for nothing on the one row
     * every checkout for that campaign contends on.
     *
     * @throws az.ideanest.project.application.ProjectNotFoundException when there is
     *     no such campaign
     * @throws az.ideanest.project.application.ProjectNotAcceptingPledgesException
     *     when it is not live — §10.4's {@code PROJECT_NOT_LIVE}
     */
    @Transactional
    public PledgeDetail draft(DraftPledge command) {
        // The answer, not just the refusal: a campaign has two funding windows since
        // #81, and which one this pledge was taken in is stamped on the row rather
        // than derived later from a campaign state that will have moved on.
        PledgeAcceptance.Window window = acceptance.requireAcceptingPledges(command.projectId());
        return detailOf(reservations.draft(command, window == PledgeAcceptance.Window.LATE));
    }

    /**
     * {@code GET /v1/pledges/{id}}: the backer's own pledge.
     *
     * @throws PledgeNotFoundException for an identifier that does not exist and for
     *     one belonging to somebody else, which are deliberately the same answer
     */
    @Transactional(readOnly = true)
    public PledgeDetail read(UUID pledgeId, UUID backerId) {
        return detailOf(pledges.findOwned(pledgeId, backerId)
                .orElseThrow(() -> new PledgeNotFoundException(pledgeId)));
    }

    /**
     * {@code POST /v1/pledges/{id}/confirm}: §6.2's {@code DRAFT --> CONFIRMED}.
     *
     * <p><strong>Two things happen, and they are one transaction.</strong> The held
     * places become claimed ones and the pledge becomes {@code CONFIRMED}. Either
     * alone is a lie: a confirmed pledge against places still counted as merely
     * reserved is one the sweep would give away if it ever saw the row as a draft
     * again, and claimed places against a pledge still in {@code DRAFT} are stock
     * nobody will ever release.
     *
     * <p><strong>Every place the pledge holds, which since #203 is the add-ons as
     * well as the reward.</strong> The move itself is
     * {@link ReservationService#confirm}, where the other four stock paths live; what
     * is left here is the three refusals below and the read of the add-on lines, which
     * are needed by the move and by the response and are read once for both. The move
     * per tier is one statement, not a release followed by a claim —
     * {@code RewardTierRepository#commitPlaces} carries the argument for why the tier
     * must never be momentarily short.
     *
     * <p><strong>What §9.2 says happens here and does not yet.</strong> Phase 1 of
     * card-on-file is a verification authorisation, 3-D Secure, storing the token and
     * the scheme transaction identifier, and voiding the authorisation. It is
     * {@link PledgeCapability#CARD_VERIFICATION} — #55, blocked on #60 — and it is
     * absent rather than stubbed. What §9.2 also says, and what makes the rest of
     * this correct without it, is that <em>no money moves at confirmation and no
     * ledger entry is written</em>: the charge is phase 2, at the close of a
     * successful campaign. So this transition commits a backer to a campaign, and
     * that is all it has ever done.
     *
     * <p>{@code paymentMethodId} is accepted and stored so that the shape a client
     * sends does not change when #55 lands. Nothing resolves it, nothing validates
     * it, and the response says {@code cardVerified: false} rather than letting a
     * client infer otherwise.
     *
     * <p><strong>The third thing that happens, and it is the same transaction
     * (#235).</strong> {@link PledgeConfirmedEvent} is recorded through §8.3's outbox,
     * so the row that says the pledge is confirmed and the row that says so to
     * everybody else are written by one commit. That is the entire reason the outbox
     * exists — {@code Outbox} is {@code MANDATORY} precisely so that this cannot
     * accidentally be recorded next to the transaction rather than inside it — and it
     * is what makes a consumer's answer unable to disagree with the pledge it is
     * about. Until this landed the pledge module announced nothing at all, and
     * {@code analytics}' attribution listener, built and tested against a real
     * outbox, saw no traffic in production.
     *
     * <p><strong>After the transition, and on the path that transitions.</strong>
     * Before it, the event would describe a confirmation that the three refusals below
     * may still prevent. And the two ways a confirmation is replayed both miss this
     * line, which is what makes it record once per pledge rather than once per
     * request: an ordinary retry carries the same {@code Idempotency-Key} and is
     * answered by {@code shared.idempotency} without this method running at all, and a
     * client that lost its key and sent a fresh one arrives at a pledge that is no
     * longer a {@code DRAFT} and is refused above. Neither reaches here. The outbox's
     * own delivery is separately at-least-once, which is the consumer's problem and is
     * the contract {@code OutboxMessage} states.
     *
     * <p><strong>The fourth thing that happens, and it is also the same transaction
     * (#427).</strong> §22.3 requires that "rewards are not guaranteed" is stated within the
     * pledge flow, and the sentence has been in the catalogues since #324 — what was missing
     * was the record that anybody saw it. So the confirmation carries the version of the
     * backer agreement the client showed, and an acceptance is written against it here.
     *
     * <p>At confirmation and not at registration, because the risk is a risk about
     * <em>this</em> campaign and <em>this</em> reward. A statement accepted at sign-up,
     * months earlier, on a platform the person was only browsing, is a statement nobody read
     * about a thing that did not exist yet. It is also the moment §9.2 makes a commitment:
     * nothing is charged, and the pledge counts towards whether the campaign succeeds.
     *
     * @param acknowledgedVersion the version of the backer agreement the client showed, or
     *     null when it showed none. Compared against the version in force rather than
     *     trusted, so a checkout page left open across a publication is refused and reloaded
     *     rather than recording an acknowledgement of a sentence nobody read
     * @throws PledgeNotFoundException when the pledge is not this backer's
     * @throws PledgeNotDraftException when it is not in {@code DRAFT} — §10.4's
     *     {@code PLEDGE_NOT_DRAFT}
     * @throws ReservationExpiredException when its five minutes ran out — §10.4's
     *     {@code RESERVATION_EXPIRED}
     * @throws BackerAgreementRequiredException when a backer agreement is in force and the
     *     request did not acknowledge that version — §10.4's {@code AGREEMENT_REQUIRED}
     */
    @Transactional
    public PledgeDetail confirm(UUID pledgeId, UUID backerId, UUID paymentMethodId, Integer acknowledgedVersion) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Pledge pledge = pledges.findOwned(pledgeId, backerId)
                .orElseThrow(() -> new PledgeNotFoundException(pledgeId));

        if (!pledge.isDraft()) {
            throw new PledgeNotDraftException(pledgeId, pledge.getState());
        }
        if (pledge.hasLapsed(now)) {
            // The clock decides, not the state: §8.4's sweep runs every minute and
            // the backer does not, so a draft whose window closed forty seconds ago
            // is still DRAFT in the table. Confirming it would commit a place the
            // tier has already promised to give back. See ReservationExpiredException
            // for why it is not expired here as well.
            throw new ReservationExpiredException(pledgeId, pledge.getReservationExpiresAt());
        }

        // Read once and used twice: the places to commit, and the lines the response
        // reports. Reading them again afterwards would let what was committed and what
        // was answered describe two different selections.
        List<PledgeAddon> heldAddons = addons.findByPledge(pledgeId);

        Pledge confirmed = reservations.confirm(pledge, heldAddons, now, paymentMethodId);

        /*
         * §22.3's acknowledgement (#427), recorded in this transaction.
         *
         * <p>After the transition and before the outbox, which is the same position and the
         * same argument the event has: before it, an acceptance would be recorded against a
         * confirmation the three refusals above may still prevent, and a person would be on
         * record as having acknowledged a risk they never took.
         *
         * <p>The refusal is here rather than at the top of the method for the same reason.
         * A backer whose reservation lapsed forty seconds ago should be told that, not told
         * to re-read a sentence about a pledge they can no longer make.
         *
         * <p>Nothing happens when no backer agreement has been published, which is this
         * repository's state until #439 seeds the text. `Agreements` argues why the legal
         * gates fail open where the subscription gate fails closed: a platform refusing every
         * confirmation until somebody writes a document is worse than one that starts asking
         * the day the document exists.
         */
        Optional<AgreementInForce> required = agreements.inForce(AgreementKind.BACKER_AGREEMENT);
        if (required.isPresent()) {
            AgreementInForce agreement = required.get();
            if (acknowledgedVersion == null || acknowledgedVersion != agreement.version()) {
                // A mismatch is a stale checkout page, and it is the case worth refusing:
                // the client acknowledged a sentence that is no longer the one in force.
                throw new BackerAgreementRequiredException(pledgeId, agreement, acknowledgedVersion);
            }
            agreements.accept(backerId, agreement);
        }

        /*
         * §21.2's rate retention (#327): "the rate used is stored on the pledge, for audit".
         *
         * <p>Resolved here rather than taken from the request, and that is the choice worth
         * defending. What §21.2 wants recorded is the approximation the backer was shown, and
         * the client is the thing that showed it — so the obvious design is for the checkout
         * to send back the rate it drew. It is also the design in which the one number nobody
         * can check is supplied by the party with an interest in it: a client that sent a
         * different rate would produce a pledge whose audit record says the platform quoted a
         * figure it never quoted.
         *
         * <p>The server reads the same hourly cache the display read, so the two agree except
         * across an hour boundary — and across one, the server's answer is the one that can be
         * reconciled against `exchange_rates`. `DisplayRates` returns nothing at all when the
         * backer reads amounts in the campaign's own currency, which is most of them.
         */
        displayRates
                .forBacker(backerId, confirmed.getCurrency())
                .ifPresent(rate -> confirmed.recordDisplayRate(rate.currency(), rate.rate()));

        // In this transaction, which is the whole guarantee. The instant is read back
        // off the row rather than taken from `now` again, so the event and
        // `pledges.confirmed_at` cannot come to two answers about when this happened.
        UUID eventId = outbox.record(
                PledgeConfirmedEvent.AGGREGATE_TYPE,
                confirmed.getId(),
                PledgeConfirmedEvent.EVENT_TYPE,
                PledgeConfirmedEvent.of(confirmed));

        // The two identifiers together, which is what lets an incident be traced from
        // a pledge to the event it produced and back. No amount and no backer: a log
        // line about a pledge should not be a record of what somebody spent.
        log.debug("Pledge {} confirmed; recorded outbox event {}.", confirmed.getId(), eventId);

        // Assembled from the lines this method already read rather than through
        // PledgeDetails, which would read them a second time inside the same
        // transaction. A confirmation cannot have supplements: they are bought after
        // the campaign closed and this pledge was a draft a moment ago.
        return new PledgeDetail(confirmed, heldAddons, List.of(), List.of());
    }

    /**
     * {@code PATCH /v1/pledges/{id}}: §4.5's PL-09, a backer changing their mind.
     *
     * <p>The whole {@code PledgeDetail} comes back, never the changed fields: a
     * client that merged a partial response would keep a stale total, which on this
     * endpoint is the number somebody is about to be charged.
     *
     * <p>Everything that touches money or stock is {@link ReservationService#edit} —
     * the re-quote and the move of the place, in that order and in one transaction.
     * What is here is the rule about <em>whether</em> the pledge may be changed at
     * all, which is {@link #requireEditable}, and the read of the add-on lines that
     * the edit resolves an absent {@code addons} field against.
     *
     * @throws PledgeNotFoundException when the pledge is not this backer's
     * @throws PledgeNotEditableException when its state has moved past editing
     * @throws ReservationExpiredException when it is a draft whose five minutes ran
     *     out
     * @throws az.ideanest.project.application.ProjectNotAcceptingPledgesException
     *     when the campaign has closed — §4.5's "until the deadline"
     */
    @Transactional
    public PledgeDetail edit(EditPledge command) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Pledge pledge = pledges.findOwned(command.pledgeId(), command.backerId())
                .orElseThrow(() -> new PledgeNotFoundException(command.pledgeId()));

        requireEditable(pledge, now, true);

        return detailOf(reservations.edit(pledge, command, addons.findByPledge(pledge.getId())));
    }

    /**
     * {@code DELETE /v1/pledges/{id}}: §4.5's PL-10 and §6.2's
     * {@code CANCELED_BY_BACKER}.
     *
     * <p><strong>Cancelling an already-cancelled pledge succeeds.</strong> It is the
     * first thing checked, before the campaign and before the state, and it returns
     * without moving a count. A retried cancellation has to be safe: the ordinary
     * retry carries the same {@code Idempotency-Key} and never reaches this method,
     * but a client that lost its key and sent a fresh one is asking for a state the
     * pledge is already in, and answering that with a 409 — or worse, releasing a
     * second place — would punish it for the one failure the header exists to
     * forgive. "It is cancelled" is true either way, and it stays true after the
     * campaign has closed, which is why this comes before the campaign check as well.
     *
     * <p><strong>A lapsed draft may still be cancelled</strong>, unlike edited. The
     * backer is asking for the place to go back and the sweep is about to do the same
     * thing; refusing would be our scheduling getting in their way. Whichever of the
     * two gets there first wins outright —
     * {@code PledgeRepository#expireLapsedDraft} matches only a row still in
     * {@code DRAFT} — so the place cannot be released twice.
     *
     * <p>Nothing is refunded. §9.7: nothing was collected. What is given back is every
     * place the pledge held — the reward's and each add-on's (#203) — from whichever
     * column was counting them.
     *
     * @throws PledgeNotFoundException when the pledge is not this backer's
     * @throws PledgeCannotBeCancelledException for anything past {@code DRAFT} — IDN-EXT-01
     * @throws PledgeNotEditableException when its state has moved past withdrawing
     * @throws az.ideanest.project.application.ProjectNotAcceptingPledgesException
     *     when the campaign has closed
     */
    @Transactional
    public void cancel(UUID pledgeId, UUID backerId) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Pledge pledge = pledges.findOwned(pledgeId, backerId)
                .orElseThrow(() -> new PledgeNotFoundException(pledgeId));

        if (pledge.isCanceledByBacker()) {
            return;
        }

        // IDN-EXT-01 (#35): a backer cannot cancel a pledge. What is left of PL-10 is abandoning
        // a checkout — a DRAFT charged nothing, and its place goes back as before. Checked after
        // the idempotent return, so a replayed cancellation of a draft still answers 204.
        if (pledge.getState() != PledgeState.DRAFT) {
            throw new PledgeCannotBeCancelledException(pledgeId, pledge.getState());
        }

        requireEditable(pledge, now, false);
        reservations.cancel(pledge, addons.findByPledge(pledgeId), now);
    }

    /**
     * <strong>The whole of "may this backer still change this pledge", in one
     * place.</strong>
     *
     * <p>§4.5's PL-09 says "until the deadline" and PL-10 says nothing about timing
     * at all, and neither is a complete rule on its own. Two facts decide it, they
     * are owned by two different modules, and this is the only method that composes
     * them.
     *
     * <ol>
     *   <li><strong>The pledge's state.</strong> {@code PledgeState.EDITABLE} — a
     *       {@code DRAFT} that is still being assembled, or a {@code CONFIRMED}
     *       pledge whose backer has changed their mind. That constant carries why the
     *       other ten states are out.
     *   <li><strong>The campaign.</strong> Launched, {@code LIVE}, and before its
     *       deadline — which is exactly {@link PledgeAcceptance}, the same question
     *       {@code POST /v1/pledges/draft} asks and the only part of the project
     *       module this one may see. "Until the deadline" is not a second rule that
     *       could drift from the checkout's; it is the checkout's rule, called again.
     * </ol>
     *
     * <p><strong>The campaign is checked last, and answered as
     * {@code PROJECT_NOT_LIVE}.</strong> The epic's contract puts a closed campaign
     * under {@code PLEDGE_NOT_EDITABLE}; this answers it with the code the draft
     * endpoint already gives, because one fact should have one answer across the four
     * endpoints that ask about it — and because that problem detail carries
     * {@code meta.deadline}, which is what lets a client say "this campaign ended on
     * Tuesday" instead of "you cannot do that". {@code PLEDGE_NOT_EDITABLE} is left
     * to mean what only it can mean: the pledge itself has moved on. The deviation is
     * recorded in the pull request rather than taken quietly.
     *
     * <p>The state is checked first because it is already loaded and because it is
     * the more specific answer: a {@code COLLECTED} pledge on a closed campaign is
     * better described by what happened to the pledge than by what happened to the
     * campaign.
     *
     * @param refuseALapsedDraft whether a draft past its window is refused. True for
     *     an edit, which would otherwise re-quote against a reservation that is
     *     already gone; false for a cancellation, which is asking for that same place
     *     to go back. See {@link #cancel}
     */
    private void requireEditable(Pledge pledge, Instant now, boolean refuseALapsedDraft) {
        if (!pledge.getState().isEditable()) {
            throw new PledgeNotEditableException(pledge.getId(), pledge.getState());
        }
        if (refuseALapsedDraft && pledge.hasLapsed(now)) {
            // The clock decides, not the state — confirm()'s reason, unchanged. A
            // draft whose window closed forty seconds ago is still DRAFT in the
            // table, and editing it would re-price a place the tier has already
            // promised to give back.
            throw new ReservationExpiredException(pledge.getId(), pledge.getReservationExpiresAt());
        }
        // The window the campaign is in now, and the answer is deliberately discarded.
        // An edit re-prices a pledge; it does not decide which total the pledge counts
        // towards, and re-stamping `is_late_pledge` here would move a pledge taken
        // during the campaign into the late column because its backer changed their
        // shirt size afterwards.
        acceptance.requireAcceptingPledges(pledge.getProjectId());
    }

    /**
     * The pledge with everything hanging off it, read inside the transaction that
     * loaded it.
     *
     * <p>Through {@link PledgeDetails} since #76 rather than assembled here: a pledge
     * is four tables now, two services answer with the same shape, and two copies of
     * this method is the arrangement in which one of them quietly stops including the
     * newest one.
     */
    private PledgeDetail detailOf(Pledge pledge) {
        return details.of(pledge);
    }
}
