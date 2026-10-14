package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.project.application.PledgeAcceptance;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a backer does with a pledge: make one, read it, change it, and withdraw it.
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
 * <p><strong>Nothing here charges anything.</strong> A pledge is paid for on the
 * provider's page — {@code PledgeCheckout} opens it and {@code PledgePayments} settles it,
 * recording {@link PledgeConfirmedEvent} there. Until #45 this class also had
 * {@code confirm}, the stored-card model's {@code DRAFT --> CONFIRMED} with nothing
 * charged; IDN-EXT-01 retired it and #45 removed it.
 */
@Service
public class PledgeService {

    private final ReservationService reservations;
    private final PledgeAcceptance acceptance;
    private final PledgeRepository pledges;
    private final PledgeAddonRepository addons;
    private final PledgeDetails details;
    private final Clock clock;

    public PledgeService(
            ReservationService reservations,
            PledgeAcceptance acceptance,
            PledgeRepository pledges,
            PledgeAddonRepository addons,
            PledgeDetails details,
            Clock clock) {
        this.reservations = reservations;
        this.acceptance = acceptance;
        this.pledges = pledges;
        this.addons = addons;
        this.details = details;
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
        acceptance.requireAcceptingPledges(command.projectId());
        // Never a late pledge: IDN-EXT-01 (#36) switched them off, so every pledge counts
        // towards the goal the campaign is judged on. The flag goes with stage 4 (#45).
        return detailOf(reservations.draft(command));
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
            // The clock decides, not the state: §8.4's sweep runs every minute and the
            // backer does not, so a draft whose window closed forty seconds ago is still
            // DRAFT in the table, and editing it would re-price a place the tier has
            // already promised to give back.
            throw new ReservationExpiredException(pledge.getId(), pledge.getReservationExpiresAt());
        }
        // Whether the campaign still takes pledges — live, in its seven days, or extended.
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
