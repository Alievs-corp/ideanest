package az.ideanest.pledge.application;

import az.ideanest.pledge.PledgeProperties;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.domain.PledgeQuote;
import az.ideanest.pledge.domain.PledgeRaise;
import az.ideanest.pledge.domain.PledgeRaiseLine;
import az.ideanest.pledge.domain.PledgeRaiseState;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRaiseLineRepository;
import az.ideanest.pledge.infrastructure.PledgeRaiseRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.project.application.CampaignTotals;
import az.ideanest.project.application.PledgeAcceptance;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Raising a paid pledge while its campaign takes pledges, and charging the difference — #171.
 *
 * <h2>Why this exists</h2>
 *
 * <p>IDN-EXT-01 (#39) charges a pledge when it is made, so almost every pledge a backer holds is
 * {@code COLLECTED}, and §4.5's PL-09 edit only moves {@code DRAFT} and {@code CONFIRMED} ones. The
 * screens have promised since #35 that a pledge can be raised while the campaign runs; this is the
 * half of that promise that takes money. The owner's decision, recorded in §4.5: a paid pledge may be
 * raised — a better tier, more add-ons, a larger contribution — never lowered and never withdrawn,
 * and the difference is charged at once, the way the confirmation charge is.
 *
 * <h2>The same two requests as a confirmation</h2>
 *
 * <p>{@link #prepare} is {@code PledgePayments#prepare} for a raise: every refusal, then a hold. It
 * prices the new selection with the checkout's own pricing, refuses anything that is not an increase,
 * refuses a figure other than the one the backer was shown, holds the places the new selection needs
 * beyond what the pledge already claims, and writes a {@code PENDING} {@link PledgeRaise}. Then
 * {@code PledgeRaiseCheckout} opens the provider's page for the difference, outside the transaction.
 * {@link #recordPaid} and {@link #recordFailed} are {@code PledgePayments#recordPaid} for a raise, run
 * in the webhook's transaction by the payment module, beside the settled charge and its ledger
 * posting. <strong>The pledge changes only there</strong>: a raise nobody paid for changes nothing.
 *
 * <h2>Concurrency, in one rule</h2>
 *
 * <p>Every writer locks the pledge row first and the raise row second. {@link #prepare} holds the
 * pledge's lock while it looks for a raise already in flight, and V83's partial unique index allows
 * one {@code PENDING} raise per pledge, so two raises started at once cannot both be priced against
 * the same total. A raise is applied only to the pledge version it was priced against: whatever moved
 * the pledge since — another raise, a refund, a post-campaign upgrade — makes the charge a payment
 * for nothing, and it is recorded {@code UNAPPLIED} and returned by the campaign-refunds job.
 */
@Service
public class PledgeRaiseService {

    private static final Logger log = LoggerFactory.getLogger(PledgeRaiseService.class);

    private final PledgeRepository pledges;
    private final PledgeAddonRepository addons;
    private final PledgeRaiseRepository raises;
    private final PledgeRaiseLineRepository lines;
    private final ReservationService reservations;
    private final PledgeAcceptance acceptance;
    private final CampaignTotals totals;
    private final Outbox outbox;
    private final PledgeProperties properties;
    private final Clock clock;

    public PledgeRaiseService(
            PledgeRepository pledges,
            PledgeAddonRepository addons,
            PledgeRaiseRepository raises,
            PledgeRaiseLineRepository lines,
            ReservationService reservations,
            PledgeAcceptance acceptance,
            CampaignTotals totals,
            Outbox outbox,
            PledgeProperties properties,
            Clock clock) {
        this.pledges = pledges;
        this.addons = addons;
        this.raises = raises;
        this.lines = lines;
        this.reservations = reservations;
        this.acceptance = acceptance;
        this.totals = totals;
        this.outbox = outbox;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Refuses a raise that cannot be paid for, and holds the places of one that can.
     *
     * <p>The refusals, in order: whose pledge it is (a stranger's is not found, exactly as on every
     * read), whether it is a paid pledge, whether the campaign still takes pledges, whether a raise is
     * already waiting for its payment, whether the new selection can be priced at all, whether it is an
     * increase, and whether the increase is the figure the backer agreed to. Only then is anything
     * held, so every refusal leaves the pledge and every counter exactly as they were.
     *
     * @throws PledgeNotFoundException when there is no such pledge of this backer's
     * @throws PledgeNotRaisableException when the pledge is not {@code COLLECTED}
     * @throws az.ideanest.project.application.ProjectNotAcceptingPledgesException when the campaign
     *     has stopped taking pledges
     * @throws PledgeRaiseInProgressException when another raise is waiting for its payment
     * @throws PledgeDecreaseNotAllowedException when the new selection costs less
     * @throws RaiseNotAnIncreaseException when it costs the same
     * @throws RaiseAmountChangedException when the difference is not the one the backer was shown
     * @throws RewardSoldOutException when a tier the raise needs more of has too few places left
     */
    @Transactional
    public PayableRaise prepare(RaisePledge command) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        // Locked before anything is read from it, so the total the raise is measured from is the
        // committed one and stays so until this transaction ends.
        Pledge pledge = pledges.findByIdForUpdate(command.pledgeId())
                .filter(found -> found.getBackerId().equals(command.backerId()))
                .orElseThrow(() -> new PledgeNotFoundException(command.pledgeId()));

        if (pledge.getState() != PledgeState.COLLECTED) {
            throw new PledgeNotRaisableException(pledge.getId(), pledge.getState());
        }
        acceptance.requireAcceptingPledges(pledge.getProjectId());
        // A pledge whose money is being or has been returned is not taken more money for: the raise
        // would not be applied when it was paid (recordPaid), only refunded.
        if (raises.hasRefundOfPledgeMoney(pledge.getId())) {
            throw PledgeNotRaisableException.refunded(pledge.getId());
        }

        Optional<PledgeRaise> inFlight = raises.findPendingForUpdate(pledge.getId());
        if (inFlight.isPresent()) {
            PledgeRaise pending = inFlight.get();
            if (!pending.hasLapsed(now)) {
                throw new PledgeRaiseInProgressException(pledge.getId(), pending.getId(), pending.getHoldExpiresAt());
            }
            // The cleaner has not reached it yet. It would release it within the minute; doing it here
            // spares the backer a refusal for a hold that has already run out.
            expire(pledge, pending, now);
        }

        List<PledgeAddon> existing = addons.findByPledge(pledge.getId());
        ReservationService.PlannedSelection planned = reservations.plan(pledge, command.asEdit(), existing);
        PledgeQuote quote = planned.quote();

        int comparison = quote.totalAmount().compareTo(pledge.getTotalAmount());
        if (comparison < 0) {
            throw new PledgeDecreaseNotAllowedException(pledge.getId(), pledge.getTotalAmount(), quote.totalAmount());
        }
        if (comparison == 0) {
            throw new RaiseNotAnIncreaseException(pledge.getId(), pledge.getTotalAmount());
        }

        Money difference = Money.of(quote.totalAmount().subtract(pledge.getTotalAmount()), quote.currency());
        if (!difference.equals(command.expectedAmount())) {
            throw new RaiseAmountChangedException(pledge.getId(), command.expectedAmount(), difference);
        }

        SortedMap<UUID, Integer> hold = reservations.holdForRaise(pledge, existing, planned.places());

        Instant heldUntil = now.plus(properties.reservation().paymentWindow());
        PledgeRaise raise = raises.saveAndFlush(PledgeRaise.pending(
                pledge, quote, planned.rewardTierId(), planned.shippingCountry(), heldUntil));

        List<PledgeRaiseLine> written = new ArrayList<>();
        for (DraftPledge.AddonSelection addon : planned.addons()) {
            written.add(PledgeRaiseLine.of(
                    raise.getId(), PledgeRaiseLine.Kind.ADDON, addon.rewardTierId(), addon.quantity()));
        }
        for (Map.Entry<UUID, Integer> line : hold.entrySet()) {
            written.add(PledgeRaiseLine.of(raise.getId(), PledgeRaiseLine.Kind.HOLD, line.getKey(), line.getValue()));
        }
        lines.saveAll(written);

        log.info("Pledge {} is being raised by raise {}; the page opens next.", pledge.getId(), raise.getId());
        return new PayableRaise(
                raise.getId(),
                raise.getChargeKey(),
                new PayablePledge(pledge.getId(), pledge.getProjectId(), pledge.getBackerId(), difference, heldUntil),
                Money.of(quote.totalAmount(), quote.currency()));
    }

    /**
     * The payment page could not be opened: nothing was charged, so the hold goes back at once rather
     * than when it lapses, and the backer may try again straight away.
     */
    @Transactional
    public void abandon(UUID raiseId) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Optional<PledgeRaise> found = raises.findById(raiseId);
        if (found.isEmpty()) {
            return;
        }
        pledges.findByIdForUpdate(found.get().getPledgeId());
        PledgeRaise raise = raises.findByIdForUpdate(raiseId).orElseThrow();
        if (!raise.isPending()) {
            return;
        }
        reservations.releaseRaiseHold(raise.getPledgeId(), holdOf(raise));
        raise.abandoned(now);
        log.info("Raise {} of pledge {} abandoned: no payment page could be opened.", raiseId, raise.getPledgeId());
    }

    /**
     * Whether a charge pays for a raise rather than for a draft.
     *
     * <p>By its idempotency key, which a raise derives from its own identifier and a client never sends
     * — a client's key is a UUID, and a raise's starts with {@link PledgeRaise#CHARGE_KEY_PREFIX}.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean isRaiseCharge(String chargeKey) {
        return chargeKey != null
                && chargeKey.startsWith(PledgeRaise.CHARGE_KEY_PREFIX)
                && raises.findPledgeIdByChargeKey(chargeKey).isPresent();
    }

    /**
     * The provider says the difference was paid: the raise is applied, counted and announced — or,
     * when it can no longer be applied, recorded as owing the charge back.
     *
     * <p>In the caller's transaction, which is the one the charge is settled and posted in, so the
     * money, the pledge and the campaign's total commit together. Never throws for a raise that cannot
     * be applied: that would roll back the record of money the provider has already taken.
     *
     * <p><strong>When it is applied.</strong> The raise was waiting for this payment, the pledge is
     * still {@code COLLECTED} and the version the raise was priced against, the campaign still takes
     * pledges, and none of the pledge's money is being or has been refunded. A raise whose hold lapsed
     * before the payment arrived is still applied if no newer raise was started and the places it
     * needs can be claimed again; a payment is not refused for arriving late.
     *
     * <p><strong>Why the campaign and the refunds.</strong> A campaign that failed or was halted while
     * a raise was on the provider's page refunds every charge of the pledge, one at a time; applying
     * the raise then would add to the campaign's total a difference that is about to be refunded, after
     * its outcome was decided. And a refund decided before the raise was paid for was measured against
     * the pledge as it was. So the raise is {@code UNAPPLIED} and its charge refunded on its own
     * ({@code RAISE_NOT_APPLIED}); the pledge is left exactly as its refunds found it. Recording and
     * settling a refund take the pledge's row lock too, so neither slips between the other's read and
     * write.
     *
     * <p>A raise that was {@code FAILED} or {@code ABANDONED} and whose charge settled anyway is
     * recorded {@code UNAPPLIED} too: the money is returned rather than kept for a raise nobody sees.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public RaiseSettlement recordPaid(String chargeKey, Instant at) {
        Optional<UUID> pledgeId = raises.findPledgeIdByChargeKey(chargeKey);
        if (pledgeId.isEmpty()) {
            return RaiseSettlement.unknown();
        }
        Optional<Pledge> found = pledges.findByIdForUpdate(pledgeId.get());
        PledgeRaise raise = raises.findByChargeKeyForUpdate(chargeKey).orElseThrow();
        if (raise.getState() == PledgeRaiseState.SUCCEEDED || raise.getState() == PledgeRaiseState.UNAPPLIED) {
            return new RaiseSettlement(RaiseSettlement.Outcome.ALREADY_SETTLED, raise.getId(), raise.getPledgeId(), null);
        }
        Pledge pledge = found.orElseThrow(() -> new IllegalStateException("Raise " + raise.getId() + " has no pledge"));

        SortedMap<UUID, Integer> hold = raise.isPending() ? holdOf(raise) : null;
        boolean applicable = raise.awaitsPayment()
                && pledge.getState() == PledgeState.COLLECTED
                && pledge.getVersion() == raise.getBaseVersion()
                && (raise.isPending() || !raises.existsNewer(pledge.getId(), raise.getId(), raise.getCreatedAt()))
                && acceptance.isAcceptingPledges(pledge.getProjectId())
                && !raises.hasRefundOfPledgeMoney(pledge.getId());

        boolean applied = applicable
                && reservations.applyRaise(
                        pledge,
                        addons.findByPledge(pledge.getId()),
                        raise.getToRewardTierId(),
                        addonsOf(raise),
                        raise.getShippingCountry(),
                        raise.quote(),
                        hold);

        if (!applied) {
            if (!applicable && hold != null) {
                reservations.releaseRaiseHold(pledge.getId(), hold);
            }
            raise.unapplied(at);
            log.warn(
                    "Raise {} of pledge {} was paid for and could not be applied (pledge {}, version {} against {});"
                            + " the charge is owed back.",
                    raise.getId(),
                    pledge.getId(),
                    pledge.getState(),
                    pledge.getVersion(),
                    raise.getBaseVersion());
            return new RaiseSettlement(
                    RaiseSettlement.Outcome.UNAPPLIED, raise.getId(), pledge.getId(), pledge.getBackerId());
        }

        raise.succeeded(at);
        Money difference = Money.of(raise.getAmount(), raise.getCurrency());
        totals.addRaised(pledge.getProjectId(), difference);
        outbox.record(
                PledgeRaisedEvent.AGGREGATE_TYPE,
                pledge.getId(),
                PledgeRaisedEvent.EVENT_TYPE,
                new PledgeRaisedEvent(
                        pledge.getId(),
                        pledge.getProjectId(),
                        pledge.getBackerId(),
                        Money.of(pledge.getTotalAmount(), pledge.getCurrency()),
                        difference,
                        at));
        log.info("Raise {} applied to pledge {}.", raise.getId(), pledge.getId());
        return new RaiseSettlement(RaiseSettlement.Outcome.APPLIED, raise.getId(), pledge.getId(), pledge.getBackerId());
    }

    /**
     * The provider says the payment failed: the held places go back and the pledge is as it was.
     *
     * <p>Nothing is counted and nothing is owed. The backer may start another raise straight away.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordFailed(String chargeKey, Instant at) {
        Optional<UUID> pledgeId = raises.findPledgeIdByChargeKey(chargeKey);
        if (pledgeId.isEmpty()) {
            return;
        }
        pledges.findByIdForUpdate(pledgeId.get());
        PledgeRaise raise = raises.findByChargeKeyForUpdate(chargeKey).orElseThrow();
        if (!raise.awaitsPayment()) {
            return;
        }
        if (raise.isPending()) {
            reservations.releaseRaiseHold(raise.getPledgeId(), holdOf(raise));
        }
        raise.failed(at);
        log.info("Raise {} of pledge {} failed at the provider; nothing changed.", raise.getId(), raise.getPledgeId());
    }

    /**
     * The reservation cleaner's half: a raise nobody paid for within the window gives its places back.
     *
     * @return whether a lapsed raise was released
     */
    @Transactional
    public boolean releaseLapsed(UUID pledgeId, Instant now) {
        Optional<Pledge> pledge = pledges.findByIdForUpdate(pledgeId);
        if (pledge.isEmpty()) {
            return false;
        }
        Optional<PledgeRaise> pending = raises.findPendingForUpdate(pledgeId);
        if (pending.isEmpty() || !pending.get().hasLapsed(now)) {
            return false;
        }
        expire(pledge.get(), pending.get(), now);
        return true;
    }

    /**
     * The reservation cleaner's third walk: a raise whose charge settled without the raise being
     * settled with it, settled now exactly as the webhook would have — applied while it still can be,
     * otherwise {@code UNAPPLIED} so that campaign-refunds returns the charge.
     *
     * <p>The webhook records the charge and settles the raise in one transaction, so this only finds a
     * charge recorded by something that did not know about raises: a node of the previous release
     * during a rolling deployment (V83). The charge and its ledger posting are already there; only the
     * raise is missing its half.
     *
     * @return what the settlement did
     */
    @Transactional
    public RaiseSettlement settlePaidCharge(String chargeKey, Instant now) {
        RaiseSettlement settlement = recordPaid(chargeKey, now);
        if (settlement.outcome() == RaiseSettlement.Outcome.APPLIED
                || settlement.outcome() == RaiseSettlement.Outcome.UNAPPLIED) {
            log.warn(
                    "Raise {} of pledge {} had been paid for and never settled; settled now: {}.",
                    settlement.raiseId(),
                    settlement.pledgeId(),
                    settlement.outcome());
        }
        return settlement;
    }

    /**
     * Keeps the address of the provider's page a pending raise was sent to, so a backer who leaves it
     * can go back while the hold lasts ({@code latestRaise.resumeUrl}).
     *
     * <p>After the page opened, in the caller's transaction when there is one — under the endpoint, the
     * idempotency store's, in which the raise was prepared. Only the raise's row is locked; this reads
     * nothing of the pledge's, and {@link PledgeRaise#recordPage} refuses nothing, so it cannot turn
     * that transaction into a rollback after the provider has opened a page.
     */
    @Transactional
    public void recordPage(UUID raiseId, URI page) {
        raises.findByIdForUpdate(raiseId).ifPresent(raise -> raise.recordPage(page));
    }

    private void expire(Pledge pledge, PledgeRaise raise, Instant now) {
        reservations.releaseRaiseHold(pledge.getId(), holdOf(raise));
        raise.expired(now);
        // Flushed here so a raise started in the same transaction does not meet V83's one-pending index.
        raises.saveAndFlush(raise);
        log.info("Raise {} of pledge {} lapsed unpaid; its places went back.", raise.getId(), pledge.getId());
    }

    private SortedMap<UUID, Integer> holdOf(PledgeRaise raise) {
        SortedMap<UUID, Integer> hold = new TreeMap<>();
        for (PledgeRaiseLine line : lines.findByRaise(raise.getId())) {
            if (line.getKind() == PledgeRaiseLine.Kind.HOLD) {
                hold.put(line.getRewardTierId(), line.getQuantity());
            }
        }
        return hold;
    }

    private List<DraftPledge.AddonSelection> addonsOf(PledgeRaise raise) {
        return lines.findByRaise(raise.getId()).stream()
                .filter(line -> line.getKind() == PledgeRaiseLine.Kind.ADDON)
                .map(line -> new DraftPledge.AddonSelection(line.getRewardTierId(), line.getQuantity()))
                .toList();
    }
}
