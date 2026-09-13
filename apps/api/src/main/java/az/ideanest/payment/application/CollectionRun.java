package az.ideanest.payment.application;

import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.PaymentProperties;
import az.ideanest.payment.domain.ChargeResult;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.StoredCard;
import az.ideanest.payment.domain.StoredCardChargeRequest;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.pledge.application.ChargeablePledge;
import az.ideanest.pledge.application.CollectionStage;
import az.ideanest.pledge.application.PledgeCollection;
import az.ideanest.project.application.CampaignCollections;
import az.ideanest.project.application.CollectingCampaign;
import az.ideanest.shared.money.Money;
import az.ideanest.shared.outbox.Outbox;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * One pledge, one card, one transaction (#64, #65).
 *
 * <p>The single most consequential method on the platform is {@link #collectNext}, and
 * everything about how it is arranged is chosen to make one sentence true:
 * <strong>a backer's card is charged at most once per attempt, and every charge that
 * happens is recorded, posted and announced in the same commit.</strong>
 *
 * <h2>The transaction covers the provider call, deliberately</h2>
 *
 * <p>{@code PledgeCollection#claimNextDue} takes the pledge with {@code FOR UPDATE SKIP
 * LOCKED}, and that lock is held across the HTTP call to the provider. Holding a
 * database lock across a network call is normally a mistake, and here it is the design:
 * it is what serialises everything about one pledge, so a second replica cannot make
 * attempt three while this one is waiting to hear about attempt three. {@code SKIP
 * LOCKED} means the second replica takes a different pledge rather than waiting.
 *
 * <p>What it costs is a pooled connection held for the duration of a provider call,
 * which is why the pass is bounded by {@code charges-per-pass} and why an adapter is
 * expected to have a short timeout. The alternative — claim, commit, charge, commit
 * again — has a window in which the process can die after charging and before
 * recording, and the recovery from that is reading somebody's card statement.
 *
 * <h2>What happens for each answer</h2>
 *
 * <ul>
 *   <li><strong>Approved.</strong> The pledge becomes {@code COLLECTED}, a
 *       {@code SUCCEEDED} transaction is written, the ledger is posted, and
 *       {@code pledge.collected} goes out. Four writes, one commit.
 *   <li><strong>Declined.</strong> The pledge becomes {@code CHARGE_FAILED} with its next
 *       slot from §9.6, a {@code FAILED} transaction is written with the provider's
 *       decline code, and — from the second attempt on — the backer is told. No ledger
 *       entry: nothing moved.
 *   <li><strong>Accepted and undecided.</strong> Nothing moves. A {@code PENDING}
 *       transaction is written once, the attempt is <em>not</em> counted, and the pledge
 *       is asked about again shortly. Counting it would burn one of the backer's four
 *       chances on an answer nobody has received, and it would change the idempotency key
 *       — so the next call would be a second charge rather than a question about the
 *       first.
 *   <li><strong>Unreachable.</strong> A {@code FAILED} transaction with
 *       {@code provider_unreachable}, the attempt not counted, the breaker told, and the
 *       pledge left where it was. §9.6's four attempts are four chances at a card, not
 *       four chances at a network.
 * </ul>
 *
 * <h2>Nothing happens in a deployed environment</h2>
 *
 * <p>{@link PaymentProviders#primary()} is empty, because #60 has not chosen a provider
 * and §9.2 refuses a stub. {@link #collectNext} therefore returns
 * {@link CollectionOutcome#NO_PROVIDER} without touching a pledge, and it does so before
 * anything is claimed. That single refusal is what keeps the batching, the breaker,
 * §9.6's schedule and the ledger posting inert until there is something real behind
 * them.
 */
@Service
public class CollectionRun {

    private static final Logger log = LoggerFactory.getLogger(CollectionRun.class);

    /**
     * The failure code for a pledge with no saved card.
     *
     * <p>The platform's own, like {@code PaymentTransaction.UNREACHABLE}, and for the
     * same reason: V41 requires a {@code FAILED} row to say why, and no provider will
     * ever send this because no provider was asked.
     *
     * <p>It is the code every pledge on the platform would produce today, and it never
     * appears, because the run refuses before it gets here while no provider is
     * configured. See {@code StoredCards}.
     */
    public static final String NO_PAYMENT_METHOD = "payment_method_missing";

    private final PaymentProviders providers;
    private final StoredCards storedCards;
    private final ProviderCircuitBreaker breaker;
    private final PledgeCollection pledges;
    private final CampaignCollections campaigns;
    private final PaymentTransactionRepository transactions;
    private final Ledger ledger;
    private final Outbox outbox;
    private final RetrySchedule schedule;
    private final PaymentProperties.Collection properties;

    public CollectionRun(
            PaymentProviders providers,
            StoredCards storedCards,
            ProviderCircuitBreaker breaker,
            PledgeCollection pledges,
            CampaignCollections campaigns,
            PaymentTransactionRepository transactions,
            Ledger ledger,
            Outbox outbox,
            RetrySchedule schedule,
            PaymentProperties paymentProperties) {
        this.providers = providers;
        this.storedCards = storedCards;
        this.breaker = breaker;
        this.pledges = pledges;
        this.campaigns = campaigns;
        this.transactions = transactions;
        this.ledger = ledger;
        this.outbox = outbox;
        this.schedule = schedule;
        this.properties = paymentProperties.collection();
    }

    /**
     * Takes the next pledge due an attempt in this queue and charges it.
     *
     * <p>{@link Propagation#REQUIRES_NEW} rather than the default, for
     * {@code CampaignFinalizer}'s reason and one of its own. The sweep that calls this
     * has no transaction, so one is started here; a test — or a future caller — driving
     * it from inside one would otherwise silently turn "one pledge per transaction" into
     * "one pass per transaction", which is the property this class exists to have. One
     * pledge's failure must not roll back the twenty before it, and twenty pledges must
     * not hold one transaction open across twenty provider calls.
     *
     * @param stage which of §9.6's two queues to drain
     * @param now the pass's instant
     * @return what happened, so that the pass can decide whether to carry on
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public CollectionOutcome collectNext(CollectionStage stage, Instant now) {
        // collecting() and not primary(): under IDN-EXT-01 a configured provider that cannot
        // collect stored cards (Epoint) charges at confirmation, and must not start this.
        Optional<PaymentProvider> configured = providers.collecting();
        if (configured.isEmpty()) {
            return CollectionOutcome.NO_PROVIDER;
        }
        PaymentProvider provider = configured.get();

        // Checked before anything is claimed, so an open breaker costs one call to a map
        // rather than a claimed pledge that is then put back.
        if (!breaker.isAvailable(provider.name())) {
            return CollectionOutcome.PROVIDER_UNAVAILABLE;
        }

        Optional<ChargeablePledge> claimed = pledges.claimNextDue(stage, now);
        if (claimed.isEmpty()) {
            return CollectionOutcome.NOTHING_DUE;
        }
        return charge(provider, claimed.get(), now);
    }

    private CollectionOutcome charge(PaymentProvider provider, ChargeablePledge pledge, Instant now) {
        Optional<CollectingCampaign> campaign = campaigns.describe(pledge.projectId());
        if (campaign.isEmpty()) {
            // Unreachable today -- nothing deletes a campaign -- and it is a refusal rather
            // than a charge anyway: without the creator's identifier there is no account to
            // credit, and a collection with no ledger posting is money nobody can account
            // for. The pledge stays where it is and the next pass tries again.
            log.error("Pledge {} names campaign {}, which is gone; not charging.", pledge.pledgeId(), pledge.projectId());
            return CollectionOutcome.FAILED;
        }
        if (!campaign.get().currency().equals(pledge.amount().currency())) {
            // §21.2 has no rate at which this could be reconciled, so it is refused rather
            // than converted. It cannot happen -- a pledge is quoted in its campaign's
            // currency -- and if it ever does, the ledger posting would be the thing that
            // silently mixed two currencies on one campaign's books.
            log.error(
                    "Pledge {} is in {} on a campaign in {}; not charging.",
                    pledge.pledgeId(),
                    pledge.amount().currency(),
                    campaign.get().currency());
            return CollectionOutcome.FAILED;
        }

        String key = idempotencyKeyFor(pledge);
        Optional<StoredCard> card = storedCards.forPledge(pledge.pledgeId(), pledge.paymentMethodId());
        if (card.isEmpty()) {
            return recordNoPaymentMethod(pledge, key, now);
        }

        ChargeResult result;
        try {
            result = provider.chargeStoredCard(new StoredCardChargeRequest(
                    pledge.pledgeId(),
                    pledge.projectId(),
                    card.get(),
                    pledge.amount(),
                    properties.statementDescriptor(),
                    pledge.attemptNumber(),
                    key));
        } catch (ProviderUnavailableException e) {
            return recordUnreachable(pledge, provider, key, e, now);
        }

        // An answer of any kind is evidence the provider is up. See ProviderCircuitBreaker
        // for why a decline resets the counter rather than advancing it.
        breaker.recordAnswered(provider.name());

        if (result.isApproved()) {
            return recordCollected(pledge, campaign.get(), provider, result, key, now);
        }
        if (result.isPending()) {
            return recordUnresolved(pledge, provider, result, key, now);
        }
        return recordDeclined(pledge, provider, result, key, now);
    }

    // ------------------------------------------------------------------
    // The four outcomes
    // ------------------------------------------------------------------

    private CollectionOutcome recordCollected(
            ChargeablePledge pledge,
            CollectingCampaign campaign,
            PaymentProvider provider,
            ChargeResult result,
            String key,
            Instant now) {
        PaymentTransaction transaction = transactions.save(PaymentTransaction.charge(
                pledge.pledgeId(),
                pledge.projectId(),
                pledge.amount(),
                provider.name(),
                result,
                pledge.attemptNumber(),
                key));

        ledger.post(post(transaction.getId(), campaign, pledge.amount()));
        pledges.recordCollected(pledge.pledgeId(), now);
        outbox.record(
                CollectionEvents.AGGREGATE_TYPE,
                pledge.pledgeId(),
                CollectionEvents.PledgeCollected.EVENT_TYPE,
                new CollectionEvents.PledgeCollected(
                        pledge.pledgeId(), pledge.projectId(), pledge.backerId(), pledge.amount(), now));

        // The identifiers and the attempt, and no amount: §18.1 keeps money out of the log
        // stream. What was collected is in the ledger, which is queryable and
        // access-controlled, unlike a log aggregator.
        log.info(
                "Collected pledge {} on campaign {} at attempt {} (transaction {}).",
                pledge.pledgeId(),
                pledge.projectId(),
                pledge.attemptNumber(),
                transaction.getId());
        return CollectionOutcome.COLLECTED;
    }

    /**
     * §9.5's collection arrow, and only that one.
     *
     * <p><strong>Two lines: escrow is debited and the creator's account is credited with
     * the whole amount.</strong> The fee split is <em>not</em> posted here, and that is a
     * decision rather than an omission.
     *
     * <p>§9.5's diagram is explicit about where the split happens: {@code Escrow
     * --14-day hold--> Distribution}, and the distribution is what fans out to the
     * creator, the platform fee, the provider's fee and tax. Posting it at collection
     * would mean this class computing §5.2's rates — which §5.2 says live in a
     * {@code fee_schedules} table that is not built, so they would have to be invented
     * here as configuration, in the issue that is supposed to be about batching charges.
     * #69 owns the payout and therefore owns the split; the arithmetic is written once,
     * where the hold ends.
     *
     * <p>The books come out in the same place either way. At payout, #69 debits the
     * creator's account for the gross and credits escrow with the net alongside the fee
     * accounts, so escrow ends holding exactly the fees and the creator's account ends at
     * zero.
     *
     * <p>§9.2's sequence diagram says "debit escrow, credit creator and fees" at the
     * approval step, which disagrees with §9.5. {@code docs/architecture.md} is amended
     * in the same change to say which one the platform does.
     */
    private Posting post(UUID transactionId, CollectingCampaign campaign, Money amount) {
        return Posting.of(transactionId, campaign.projectId())
                .debit(LedgerAccount.ESCROW, amount)
                .credit(LedgerAccount.creator(campaign.creatorId()), amount)
                .build();
    }

    private CollectionOutcome recordDeclined(
            ChargeablePledge pledge, PaymentProvider provider, ChargeResult result, String key, Instant now) {
        transactions.save(PaymentTransaction.charge(
                pledge.pledgeId(),
                pledge.projectId(),
                pledge.amount(),
                provider.name(),
                result,
                pledge.attemptNumber(),
                key));

        Instant closedAt = schedule.closedAtFrom(pledge.windowEndsAt());
        Instant nextAttemptAt = schedule.nextAttemptAt(closedAt, pledge.attemptNumber());
        pledges.recordFailure(pledge.pledgeId(), nextAttemptAt);
        announceFailure(pledge, nextAttemptAt, now);

        log.info(
                "Pledge {} was declined at attempt {} with {}; next attempt {}.",
                pledge.pledgeId(),
                pledge.attemptNumber(),
                result.failureCode(),
                nextAttemptAt);
        return CollectionOutcome.DECLINED;
    }

    private CollectionOutcome recordNoPaymentMethod(ChargeablePledge pledge, String key, Instant now) {
        // A declined attempt in every respect except that no provider was asked. It counts
        // against §9.6's four, because the failure is a property of the pledge rather than
        // of the network -- a pledge with no card will not acquire one by being retried,
        // and it should reach its window and be dropped rather than sit in the queue for
        // ever. The distinct code is what lets a report tell the two apart.
        ChargeResult refusal = new ChargeResult(
                ProviderOutcome.DECLINED,
                null,
                NO_PAYMENT_METHOD,
                "The pledge has no stored card; §9.2's phase one is #55, blocked on #60.",
                null);
        return recordDeclined(pledge, providers.collecting().orElseThrow(), refusal, key, now);
    }

    private CollectionOutcome recordUnresolved(
            ChargeablePledge pledge, PaymentProvider provider, ChargeResult result, String key, Instant now) {
        // Once, not once per re-poll. V41's unique index is partial over the settled
        // states, so it would not refuse a second PENDING row; what makes this read
        // correct is that the pledge is locked, so nothing else is deciding about it.
        if (!transactions.existsByIdempotencyKey(key)) {
            transactions.save(PaymentTransaction.charge(
                    pledge.pledgeId(),
                    pledge.projectId(),
                    pledge.amount(),
                    provider.name(),
                    result,
                    pledge.attemptNumber(),
                    key));
        }
        pledges.recordUnresolved(pledge.pledgeId(), schedule.recheckAt(now));

        log.info(
                "Pledge {} has an undecided charge at attempt {}; asking again after {}.",
                pledge.pledgeId(),
                pledge.attemptNumber(),
                properties.unresolvedRecheck());
        return CollectionOutcome.UNRESOLVED;
    }

    private CollectionOutcome recordUnreachable(
            ChargeablePledge pledge,
            PaymentProvider provider,
            String key,
            ProviderUnavailableException failure,
            Instant now) {
        // Recorded, and this is the row that matters most in an incident: the platform
        // sent an instruction and does not know what became of it. Written under the same
        // key, so a later reconciliation against the provider's statement can match it.
        if (!transactions.existsByIdempotencyKey(key)) {
            transactions.save(PaymentTransaction.unreachable(
                    pledge.pledgeId(),
                    pledge.projectId(),
                    pledge.amount(),
                    provider.name(),
                    failure.getMessage(),
                    pledge.attemptNumber(),
                    key));
        }

        // The attempt is deliberately not counted: §9.6 gives a backer four chances at
        // their card, not four chances at a network. The same attempt is retried shortly,
        // with the same key, so a charge that did reach the provider is answered rather
        // than repeated.
        pledges.recordUnresolved(pledge.pledgeId(), schedule.recheckAt(now));
        breaker.recordUnavailable(provider.name());

        log.warn("Could not reach {} for pledge {}; the attempt is not counted.", provider.name(), pledge.pledgeId(), failure);
        return CollectionOutcome.PROVIDER_UNAVAILABLE;
    }

    // ------------------------------------------------------------------
    // §9.6's notifications
    // ------------------------------------------------------------------

    private void announceFailure(ChargeablePledge pledge, Instant nextAttemptAt, Instant now) {
        if (!schedule.notifiesBacker(pledge.attemptNumber())) {
            // §9.6's first row has no channel. RetrySchedule#notifiesBacker carries the
            // argument, including where §9 disagrees with itself about it.
            return;
        }
        if (schedule.isFinalAttempt(pledge.attemptNumber())) {
            outbox.record(
                    CollectionEvents.AGGREGATE_TYPE,
                    pledge.pledgeId(),
                    CollectionEvents.FinalPaymentWarning.EVENT_TYPE,
                    new CollectionEvents.FinalPaymentWarning(
                            pledge.pledgeId(),
                            pledge.projectId(),
                            pledge.backerId(),
                            pledge.amount(),
                            pledge.attemptNumber(),
                            pledge.windowEndsAt(),
                            now));
            return;
        }
        outbox.record(
                CollectionEvents.AGGREGATE_TYPE,
                pledge.pledgeId(),
                CollectionEvents.PaymentFailed.EVENT_TYPE,
                new CollectionEvents.PaymentFailed(
                        pledge.pledgeId(),
                        pledge.projectId(),
                        pledge.backerId(),
                        pledge.amount(),
                        pledge.attemptNumber(),
                        nextAttemptAt,
                        now));
    }

    /**
     * §9.3's R-08: the key this attempt is made under.
     *
     * <p><strong>Derived, never generated.</strong> A random key would make every retry a
     * new charge, which is the failure R-08 is on the list to prevent. Derived from the
     * pledge and the attempt number, it has exactly the property the whole design needs:
     * the same for every repeat of one attempt — so a request whose answer was lost can
     * be replayed safely — and different for the next attempt, so a genuinely new charge
     * is not mistaken for a repeat.
     *
     * <p>It is also why {@code Pledge#chargeUnresolved} does not advance the counter. An
     * undecided charge asked about again must ask about the same charge, and the key is
     * what makes it the same one.
     */
    static String idempotencyKeyFor(ChargeablePledge pledge) {
        return "collect:" + pledge.pledgeId() + ":" + pledge.attemptNumber();
    }
}
