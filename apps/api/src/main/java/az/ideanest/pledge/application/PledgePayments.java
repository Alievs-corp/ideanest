package az.ideanest.pledge.application;

import az.ideanest.pledge.PledgeProperties;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.project.application.CampaignTotals;
import az.ideanest.project.application.PledgeAcceptance;
import az.ideanest.shared.legal.AgreementInForce;
import az.ideanest.shared.legal.AgreementKind;
import az.ideanest.shared.legal.Agreements;
import az.ideanest.shared.money.Money;
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
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The pledge's two halves of being paid for at confirmation — IDN-EXT-01 (#39), §6.2's
 * {@code DRAFT → COLLECTED}.
 *
 * <p>{@link #prepare} runs before the backer reaches the payment page: every refusal
 * {@code PledgeService#confirm} makes, then a hold on the draft's places for the payment window.
 * {@link #recordPaid} runs when the provider says the payment went through: the places are
 * committed, the pledge becomes {@code COLLECTED}, it is counted towards its campaign, and
 * {@code pledge.confirmed} is recorded — in the transaction the payment module settles the
 * charge and posts the ledger in, so the money, the pledge and the total commit together.
 */
@Service
public class PledgePayments {

    private static final Logger log = LoggerFactory.getLogger(PledgePayments.class);

    private final PledgeRepository pledges;
    private final PledgeAddonRepository addons;
    private final ReservationService reservations;
    private final PledgeAcceptance acceptance;
    private final Agreements agreements;
    private final DisplayRates displayRates;
    private final Outbox outbox;
    private final CampaignTotals totals;
    private final PledgeProperties properties;
    private final Clock clock;

    public PledgePayments(
            PledgeRepository pledges,
            PledgeAddonRepository addons,
            ReservationService reservations,
            PledgeAcceptance acceptance,
            Agreements agreements,
            DisplayRates displayRates,
            Outbox outbox,
            CampaignTotals totals,
            PledgeProperties properties,
            Clock clock) {
        this.pledges = pledges;
        this.addons = addons;
        this.reservations = reservations;
        this.acceptance = acceptance;
        this.agreements = agreements;
        this.displayRates = displayRates;
        this.outbox = outbox;
        this.totals = totals;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Refuses a draft that cannot be paid for, and holds the places of one that can.
     *
     * <p>The refusals are {@code confirm}'s, in its order, for its reasons: a pledge that is not a
     * draft, a draft whose five minutes ran out, a campaign that stopped taking pledges, and a
     * backer agreement not acknowledged at the version in force. The acknowledgement is recorded
     * here, before the payment — accepting is idempotent, so a second attempt after a failed
     * payment records nothing twice.
     *
     * @throws PledgeNotFoundException when there is no such pledge of this backer's
     * @throws PledgeNotDraftException when it has already been confirmed, paid for or ended
     * @throws ReservationExpiredException when its reservation has lapsed
     * @throws BackerAgreementRequiredException when the agreement in force was not acknowledged
     */
    @Transactional
    public PayablePledge prepare(UUID pledgeId, UUID backerId, Integer acknowledgedVersion) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        Pledge pledge = pledges.findOwned(pledgeId, backerId).orElseThrow(() -> new PledgeNotFoundException(pledgeId));
        if (!pledge.isDraft()) {
            throw new PledgeNotDraftException(pledgeId, pledge.getState());
        }
        if (pledge.hasLapsed(now)) {
            throw new ReservationExpiredException(pledgeId, pledge.getReservationExpiresAt());
        }
        acceptance.requireAcceptingPledges(pledge.getProjectId());

        Optional<AgreementInForce> required = agreements.inForce(AgreementKind.BACKER_AGREEMENT);
        if (required.isPresent()) {
            AgreementInForce agreement = required.get();
            if (acknowledgedVersion == null || acknowledgedVersion != agreement.version()) {
                throw new BackerAgreementRequiredException(pledgeId, agreement, acknowledgedVersion);
            }
            agreements.accept(backerId, agreement);
        }

        pledge.holdForPayment(now.plus(properties.reservation().paymentWindow()));
        return new PayablePledge(
                pledge.getId(),
                pledge.getProjectId(),
                pledge.getBackerId(),
                Money.of(pledge.getTotalAmount(), pledge.getCurrency()),
                pledge.getReservationExpiresAt());
    }

    /**
     * The provider says the pledge was paid for: {@code DRAFT → COLLECTED}, counted, announced.
     *
     * <p>Empty when the pledge cannot take the payment any more — already {@code COLLECTED}, which
     * is a redelivery and nothing to do, or ended, which is a paid pledge with no places left and is
     * logged for a refund (#40). In the caller's transaction, which is the one the charge is settled
     * and posted in.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<PaidPledge> recordPaid(UUID pledgeId, Instant at) {
        Optional<Pledge> found = pledges.findByIdForUpdate(pledgeId);
        if (found.isEmpty()) {
            log.error("A payment arrived for pledge {}, which does not exist.", pledgeId);
            return Optional.empty();
        }
        Pledge pledge = found.get();
        if (pledge.getState() == PledgeState.COLLECTED) {
            return Optional.empty();
        }
        if (!pledge.isDraft()) {
            log.error(
                    "Pledge {} was paid for while {}; it holds no places and the payment needs a refund (#40).",
                    pledgeId,
                    pledge.getState());
            return Optional.empty();
        }

        List<PledgeAddon> held = addons.findByPledge(pledgeId);
        Pledge collected = reservations.collect(pledge, held, at);
        displayRates
                .forBacker(collected.getBackerId(), collected.getCurrency())
                .ifPresent(rate -> collected.recordDisplayRate(rate.currency(), rate.rate()));

        Money total = Money.of(collected.getTotalAmount(), collected.getCurrency());
        totals.addCollected(collected.getProjectId(), total);
        outbox.record(
                PledgeConfirmedEvent.AGGREGATE_TYPE,
                collected.getId(),
                PledgeConfirmedEvent.EVENT_TYPE,
                PledgeConfirmedEvent.of(collected));
        log.debug("Pledge {} paid for and collected.", collected.getId());
        return Optional.of(new PaidPledge(collected.getId(), collected.getProjectId(), collected.getBackerId(), total));
    }
}
