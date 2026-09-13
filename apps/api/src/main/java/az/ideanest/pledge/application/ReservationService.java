package az.ideanest.pledge.application;

import az.ideanest.pledge.PledgeProperties;
import az.ideanest.pledge.domain.NewPledge;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.domain.PledgeQuote;
import az.ideanest.pledge.domain.PledgeSelection;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.domain.QuotedLine;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import az.ideanest.reward.application.RewardStock;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SortedMap;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Holds a limited reward's place for the backer who is checking out, for as long
 * as §4.5 gives them to finish.
 *
 * <p><strong>The reservation is a DRAFT pledge.</strong> §6.2 already says so —
 * {@code [*] -> DRAFT}, and {@code DRAFT -> EXPIRED: reservation TTL} — so what
 * this class creates is a row in {@code pledges} whose existence is the claim on
 * the stock. V17's header carries the argument for why that lives in PostgreSQL
 * rather than in the Redis key §4.5's capability table mentions; the short version
 * is that taking the place and recording who took it have to be one transaction,
 * and across two datastores they are not.
 *
 * <p><strong>What makes it correct is one statement, not this class.</strong>
 * {@link RewardStock#reservePlaces} is a conditional {@code UPDATE} that takes
 * PostgreSQL's row lock and re-reads the counts behind it, so two checkouts racing
 * for the last places are serialised by the database. Everything here is ordering
 * and error messages. If this code is wrong, V7's
 * {@code reward_tiers_stock_is_within_the_limit} refuses the transaction rather
 * than letting the tier oversell — which is the property {@code ReservationTests}
 * exercises with real threads against a real PostgreSQL, because it is the only
 * way to find out.
 *
 * <p><strong>The order of the three writes is deliberate.</strong> The caller's
 * own stale draft is settled first, then the place is taken, then the pledge is
 * inserted. Taking the place before inserting means a failure of the insert rolls
 * the place back inside the same transaction; inserting first would leave a window
 * in which a draft exists that holds nothing, and it is the drafts that the sweep
 * counts.
 *
 * <p><strong>#52 added {@link #draft}, and it is now the checkout's way in.</strong>
 * {@link #reserve} is what #51 built — a place, priced at the tier — and it remains
 * the smallest statement of what a reservation is, which is what
 * {@code ReservationTests} drives. The new method prices the whole of §4.5's PL-01
 * to PL-06 before it takes anything, and then takes the place and writes the row
 * through the same three steps. Both go through {@link #hold}; the difference
 * between them is only how much has been decided by the time the row is written.
 *
 * <p><strong>#56 added {@link #edit}, which is the only method here that moves
 * places rather than taking or giving them.</strong> It takes the new places before
 * releasing the old, so that a backer whose edit is refused still holds what they
 * already had; that ordering is the single most important line in this class and its
 * javadoc carries the argument. It also re-quotes through the same
 * {@link #selectionFor} the checkout uses, so a draft and an edit of that draft
 * cannot come to two different totals for one selection.
 *
 * <p><strong>#203 made the add-ons hold stock too, and turned "the place" into
 * "the places".</strong> An add-on is a {@code reward_tiers} row with
 * {@code is_addon} set (V7), so it carries {@code limit_quantity},
 * {@code claimed_quantity} and {@code reserved_quantity} exactly as a selectable tier
 * does and {@code reward_tiers_stock_is_within_the_limit} applies to it — and until
 * #203 nothing ever wrote those counters for one, so two backers could each take the
 * last of a limited add-on and the constraint could not see it, because the count it
 * guards never moved. What a pledge holds is now a map from tier to a number of
 * places — see {@link HeldPlaces}, which also carries why the map is sorted — and
 * every path below moves one of those: the draft takes them, {@link #confirm} moves
 * them from reserved to claimed, {@link #cancel} gives them back,
 * {@link #edit} takes the difference and releases the difference, and
 * {@link ReservationExpiry} walks {@code pledge_addons} when a draft lapses. The
 * reward tier is a line in the same map with a quantity of one, so there is one rule
 * rather than a rule and an exception.
 *
 * <p><strong>What is not here.</strong>
 *
 * <ul>
 *   <li><strong>Whether the campaign will take a pledge at all.</strong> A
 *       reservation on a campaign that is not live, or one past its deadline
 *       without late pledging enabled, is a request that should never reach this
 *       far. That is a question about {@code projects}, which is another module's
 *       state machine, and it belongs with the endpoint that has already loaded
 *       the campaign to render it (#52). Checking it here would mean this module
 *       depending on the project module in order to say no twice — so #52 put it
 *       in {@link PledgeService}, one call above this one, and this class still
 *       names nothing in {@code az.ideanest.project}.
 *   <li><strong>§10.3's {@code Idempotency-Key}.</strong> Recorded on the row, and
 *       enforced a layer above by {@code shared.idempotency}. Nothing here is
 *       replay-safe on its own, and it does not need to be: the machinery runs this
 *       at most once per key.
 *   <li><strong>Whether a tier the backer named as an add-on really is one.</strong>
 *       Nothing here reads {@code is_addon}, so a client that sent a reward tier in
 *       the {@code addons} list holds places on it and is quoted for them. That is
 *       the behaviour #52 shipped and #203 has not changed; what #203 changes is that
 *       the places are now genuinely held either way, so the count and the pledges
 *       agree whichever the client meant.
 * </ul>
 */
@Service
public class ReservationService {

    private static final Logger log = LoggerFactory.getLogger(ReservationService.class);

    /**
     * §7.2's "one pledge per backer per project", as PostgreSQL names it. V17 creates
     * it, {@code PledgeState.ACTIVE} is the set of states it covers, and it is the
     * only constraint on {@code pledges} this class translates into an answer.
     */
    private static final String ONE_ACTIVE_PLEDGE_PER_BACKER = "pledges_project_backer_active_key";

    /**
     * The only currency the platform settles in, for a pledge that has no reward
     * tier to take one from.
     *
     * <p>Duplicated from {@code RewardService}, and deliberately not shared, for
     * the reason stated there: the real answer is the campaign's own
     * {@code currency} column, which this module cannot read. When a second
     * currency exists, both constants are replaced by that lookup. A pledge that
     * <em>does</em> name a tier takes the currency off the tier, which is where the
     * price came from.
     */
    private static final String SUPPORTED_CURRENCY = "AZN";

    private final PledgeRepository pledges;
    private final PledgeAddonRepository addons;
    private final PledgeConflicts conflicts;
    private final RewardStock stock;
    private final ReservationExpiry expiry;
    private final PledgeProperties properties;
    private final Clock clock;

    public ReservationService(
            PledgeRepository pledges,
            PledgeAddonRepository addons,
            PledgeConflicts conflicts,
            RewardStock stock,
            ReservationExpiry expiry,
            PledgeProperties properties,
            Clock clock) {
        this.pledges = pledges;
        this.addons = addons;
        this.conflicts = conflicts;
        this.stock = stock;
        this.expiry = expiry;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Reserves a place on a reward tier and returns the draft pledge holding it.
     *
     * <p>The draft lapses at {@code now + ttl} and is released by §8.4's
     * {@code reservation-cleaner} — see {@link ReservationCleanerJob}. Nothing has
     * been charged and no card has been seen; that is confirmation's job (#52).
     *
     * @param rewardTierId null for §4.5's PL-02, a pledge that supports the
     *     campaign without taking a reward. Nothing is reserved in that case,
     *     because there is no limited thing to hold — the draft still expires, so
     *     that an abandoned checkout does not block the backer from starting
     *     another one for ever
     * @throws UnknownRewardTierException when the campaign has no such tier
     * @throws RewardSoldOutException when it has no places left — §10.4's
     *     {@code REWARD_SOLD_OUT}
     * @throws PledgeAlreadyExistsException when this backer already has a live
     *     pledge on this campaign. §7.2: one per backer per project
     */
    @Transactional
    public Pledge reserve(UUID projectId, UUID backerId, UUID rewardTierId) {
        // Truncated to what the column can hold: PostgreSQL stores microseconds, so
        // an expiry written at nanosecond precision comes back as a different
        // instant, and this one is compared against by a sweep.
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        settleAnyExistingPledge(projectId, backerId, now);

        BigDecimal amount = BigDecimal.ZERO;
        String currency = SUPPORTED_CURRENCY;
        if (rewardTierId != null) {
            RewardStock.RewardTierPrice price = stock.priceOf(projectId, rewardTierId)
                    .orElseThrow(() -> new UnknownRewardTierException(projectId, rewardTierId));
            amount = price.amount();
            currency = price.currency();

            takeThePlaces(projectId, HeldPlaces.of(rewardTierId, List.of()), false);
        }

        return insert(Pledge.draft(projectId, backerId, rewardTierId, amount, currency, lapsesAt(now)));
    }

    /**
     * A whole checkout: prices §4.5's PL-01 to PL-06, takes the place, and writes the
     * draft that holds it. #52.
     *
     * <p><strong>Priced before anything is taken.</strong> The quote is arithmetic
     * over reads, so doing it first costs nothing and means a selection that cannot
     * be quoted — a destination the creator never priced, a contribution below the
     * tier — never holds a place while the backer is told about it. After that the
     * order is #51's, unchanged and for #51's reason: take the place, then insert the
     * row, so that a failure of the insert rolls the place back inside the same
     * transaction.
     *
     * <p><strong>The add-on places are taken with the reward's, in one pass (#203).</strong>
     * Each add-on holds §4.5's PL-04 quantity and the reward holds one, and they go in
     * the order {@link HeldPlaces} sorts them — which is what keeps two checkouts
     * selecting the same two add-ons in opposite orders from deadlocking on each
     * other's rows. A tier that has too few left refuses the whole draft, so a backer
     * is never quietly sold two of something they asked for three of.
     *
     * <p>The add-on lines are written last because they reference the pledge, and
     * they are written at all because {@code addons_amount} is a sum: see
     * {@code PledgeAddon} for what needs the lines and V18 for why the table is an
     * addition to §7.2 rather than a reading of it.
     *
     * <p>Nothing here is charged and no card has been seen. That is confirmation's,
     * and confirmation does not charge anything either — §9.2.
     *
     * @throws UnknownRewardTierException when the campaign has no such tier, whether
     *     it was named as the reward or as an add-on
     * @throws ContributionBelowRewardPriceException when the backer offered less than
     *     the reward costs
     * @throws ShippingDestinationUnpricedException when something in the selection is
     *     posted and the destination has no rate
     * @throws RewardSoldOutException when the reward tier, or any add-on, has too few
     *     places left — §10.4's {@code REWARD_SOLD_OUT}, naming whichever it was
     * @param latePledge what {@code PledgeAcceptance} answered about the campaign's
     *     funding window -- §4.5's PL-16 (#81). A parameter rather than a field on
     *     {@code DraftPledge}, because that record is what a client sent and this is
     *     what the platform decided; a backer must not be able to choose which of a
     *     campaign's two totals their money counts towards
     * @throws PledgeAlreadyExistsException when this backer already has a live pledge
     *     on this campaign. §7.2: one per backer per project
     */
    @Transactional
    public Pledge draft(DraftPledge command, boolean latePledge) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        settleAnyExistingPledge(command.projectId(), command.backerId(), now);

        PledgeQuote quote = PledgeQuote.of(selectionFor(
                command.projectId(),
                command.rewardTierId(),
                command.addons(),
                command.contribution(),
                command.shippingCountry()));

        takeThePlaces(command.projectId(), HeldPlaces.of(command.rewardTierId(), command.addons()), false);

        Pledge pledge = insert(Pledge.draft(new NewPledge(
                command.projectId(),
                command.backerId(),
                command.rewardTierId(),
                quote,
                command.shippingCountry(),
                command.anonymous(),
                command.referrerCode(),
                command.idempotencyKey(),
                lapsesAt(now),
                latePledge)));

        if (!command.addons().isEmpty()) {
            addons.saveAll(command.addons().stream()
                    .map(addon -> PledgeAddon.of(
                            pledge.getId(), command.projectId(), addon.rewardTierId(), addon.quantity()))
                    .toList());
        }
        return pledge;
    }

    /**
     * §4.5's PL-09: a new selection on a pledge that already exists, re-quoted, with
     * its place moved if the reward changed. #56.
     *
     * <p><strong>Priced, then the place is moved, then the row is written.</strong>
     * The same order as {@link #draft} and for a sharper version of its reason: a
     * selection that cannot be quoted — a destination the creator never priced, a
     * contribution below the new tier — must not cost the backer the place they
     * already hold, and pricing first means it never can.
     *
     * <p><strong>Take the new places before giving the old ones back. This is the
     * whole of the hard part.</strong> The other order is the tempting one, because
     * it keeps {@code claimed + reserved} from rising, and it is wrong in the way
     * that matters most: between the release and the take, the backer holds nothing,
     * and if the take then fails — the new tier sold its last place a moment ago —
     * they have lost the reward they already had in exchange for one they never got.
     * Taking first means the worst case is a refusal that changes nothing, which is
     * what a failed edit ought to be. The cost is that a backer switching between two
     * tiers momentarily holds a place on each, so a tier can refuse a switch it would
     * have allowed had the release come first; that is a refusal somebody can retry,
     * and losing a reservation is not.
     *
     * <p>The whole method is one transaction, so the take, the release, the re-quote
     * and the add-on rows either all happen or none do. That is what lets the
     * refusal above be a genuine no-op rather than a promise.
     *
     * <p><strong>Which column moves depends on the pledge, not on the tier.</strong>
     * A {@code DRAFT} holds <em>reserved</em> places and a {@code CONFIRMED} pledge
     * holds <em>claimed</em> ones, so an edit moves like for like — see
     * {@link RewardStock#claimPlaces} and
     * {@link RewardStock#releaseClaimedPlaces}. Moving a confirmed backer's place
     * through {@code reserved_quantity} would leave a reservation against a pledge
     * that is not a draft, which is exactly the row §8.4's sweep hunts for.
     *
     * <p><strong>An add-on's quantity moves the difference, in the same two
     * passes (#203).</strong> The places the pledge holds before and after are two
     * maps, and the edit is their difference: raising a quantity from two to three
     * takes one place, lowering it to one gives one back, and dropping the add-on
     * gives back all of them. Only the difference moves, so an edit that changes a
     * destination and nothing else issues no stock statement at all — and the
     * ordering above holds across every line at once, not merely for the reward, so
     * an edit that raises one add-on past its limit is refused with the pledge
     * exactly as it was.
     *
     * @param pledge the backer's own pledge, already established to be theirs and to
     *     be in a state they may change. This method does not re-decide either: see
     *     {@link PledgeService#edit}, which is where the campaign's deadline and
     *     §6.2's states are composed into one rule
     * @param existingAddons the add-on lines as they stand, read by the caller inside
     *     this transaction. Passed in rather than read again because they are needed
     *     twice — to resolve an absent {@code addons} field, and to decide whether
     *     the rows have to be rewritten at all
     * @throws UnknownRewardTierException when the campaign has no such tier
     * @throws ContributionBelowRewardPriceException when the backer offered less than
     *     the reward now costs
     * @throws ShippingDestinationUnpricedException when the new selection is posted
     *     and the destination has no rate
     * @throws RewardSoldOutException when the newly chosen tier, or an add-on whose
     *     quantity went up, has too few places left — §10.4's
     *     {@code REWARD_SOLD_OUT}, and the pledge is left exactly as it was
     */
    @Transactional
    public Pledge edit(Pledge pledge, EditPledge command, List<PledgeAddon> existingAddons) {
        UUID projectId = pledge.getProjectId();

        UUID rewardTierId =
                command.rewardTierId().isPresent() ? command.rewardTierId().value() : pledge.getRewardTierId();
        String shippingCountry = command.shippingCountry().isPresent()
                ? command.shippingCountry().value()
                : pledge.getShippingCountry();
        boolean anonymous =
                command.anonymous().isPresent() ? command.anonymous().value() : pledge.isAnonymous();
        UUID paymentMethodId = command.paymentMethodId().isPresent()
                ? command.paymentMethodId().value()
                : pledge.getPaymentMethodId();
        List<DraftPledge.AddonSelection> addonSelections = selectedAddons(command, existingAddons);
        Money contribution =
                command.contribution().isPresent() ? command.contribution().value() : contributionOf(pledge);

        // The same rule the checkout applies, from the same method, against a
        // selection the checkout never saw. See DraftPledge.
        DraftPledge.requireDistinctSelections(rewardTierId, addonSelections);

        PledgeQuote quote = PledgeQuote.of(
                selectionFor(projectId, rewardTierId, addonSelections, contribution, shippingCountry));

        // IDN-EXT-01 (#35): a confirmed pledge may only be raised. Checked against the quote and
        // before any place moves, so a refused edit leaves the pledge and every counter exactly as
        // they were. A draft is still being chosen and is not held to it.
        if (pledge.getState() == PledgeState.CONFIRMED
                && quote.totalAmount().compareTo(pledge.getTotalAmount()) < 0) {
            throw new PledgeDecreaseNotAllowedException(pledge.getId(), pledge.getTotalAmount(), quote.totalAmount());
        }

        moveThePlaces(pledge, HeldPlaces.of(rewardTierId, addonSelections), existingAddons);

        pledge.edit(quote, rewardTierId, shippingCountry, anonymous, paymentMethodId);
        replaceAddons(pledge, existingAddons, addonSelections);

        // saveAndFlush for draft's second reason: total_amount is generated, so the
        // response cannot be built until the UPDATE has run. The version check that
        // comes with it is the point of the flush being here rather than at the
        // commit — a backer editing in one tab while another confirms is exactly the
        // race Pledge's @Version exists for, and it has to surface as an answer
        // rather than at a commit nothing can translate.
        return pledges.saveAndFlush(pledge);
    }

    /**
     * §6.2's {@code DRAFT --> CONFIRMED}: the backer commits, and every place they
     * were holding is committed with them. #52, extended by #203.
     *
     * <p><strong>Here rather than in {@link PledgeService} because it moves
     * stock.</strong> #52 put the single {@code commitOnePlace} call beside the
     * transition, which was defensible while a pledge held one place; a pledge that
     * holds places on its reward tier <em>and</em> on each of its add-ons is the same
     * map every other method in this class moves, and leaving one of the five paths
     * outside would be the one place a future change could forget.
     *
     * <p><strong>Reserved becomes claimed, in one statement per tier.</strong> The sum
     * never changes, so no other checkout sees a place appear or disappear and V7's
     * constraint is evaluated against a total that did not move —
     * {@code RewardTierRepository#commitPlaces} carries the argument for why a release
     * followed by a claim is wrong in both orders.
     *
     * <p><strong>A tier with nothing to convert is logged, and the confirmation goes
     * ahead.</strong> This transaction holds the pledge and its version, so a mismatch
     * is an invariant violation rather than a race; refusing would strand a backer who
     * did everything right in front of a state only we can repair. The count is
     * recoverable from the pledges, and a lost commitment is not.
     *
     * <p>Nothing is charged. §9.2 is explicit that no money moves at confirmation, and
     * §9.2's phase 1 — the verification authorisation — is #55, blocked on #60.
     *
     * @param pledge the backer's own draft, already established to be theirs, to be a
     *     draft, and to be inside its window. {@link PledgeService#confirm} decides all
     *     three, because two of them need the clock and one needs an answer a client
     *     can act on
     * @param heldAddons the add-on lines as they stand, read by the caller inside this
     *     transaction — the same lines the response is built from, so what is committed
     *     and what is reported cannot disagree
     */
    @Transactional
    public Pledge confirm(Pledge pledge, List<PledgeAddon> heldAddons, Instant now, UUID paymentMethodId) {
        for (Map.Entry<UUID, Integer> line : HeldPlaces.heldBy(pledge, heldAddons).entrySet()) {
            if (!stock.commitPlaces(line.getKey(), line.getValue())) {
                log.error(
                        "Pledge {} was confirmed against reward tier {}, which had no {} reserved places to commit.",
                        pledge.getId(),
                        line.getKey(),
                        line.getValue());
            }
        }

        // Where §9.2's phase 1 goes: authorise, 3-D Secure, store the token, void.
        // PledgeCapability.CARD_VERIFICATION — #55, blocked on #60.
        pledge.confirm(now, paymentMethodId);
        return pledge;
    }

    /**
     * IDN-EXT-01 (#39): a paid draft commits the places it was holding and becomes {@code COLLECTED}.
     *
     * <p>The same commit {@link #confirm} makes — a draft holds <em>reserved</em> places and a paid
     * pledge holds <em>claimed</em> ones — without the stop at {@code CONFIRMED}, because under the
     * charge-now model a pledge is confirmed by being paid for.
     */
    public Pledge collect(Pledge pledge, List<PledgeAddon> heldAddons, Instant now) {
        for (Map.Entry<UUID, Integer> line : HeldPlaces.heldBy(pledge, heldAddons).entrySet()) {
            if (!stock.commitPlaces(line.getKey(), line.getValue())) {
                log.error(
                        "Pledge {} was paid for against reward tier {}, which had no {} reserved places to commit.",
                        pledge.getId(),
                        line.getKey(),
                        line.getValue());
            }
        }
        pledge.paid(now);
        return pledge;
    }

    /**
     * §4.5's PL-10: the backer withdraws, and every place they held goes back. #56,
     * extended by #203.
     *
     * <p><strong>Which places go back depends on what the pledge was holding.</strong>
     * A {@code DRAFT} gives back <em>reserved</em> places and a {@code CONFIRMED}
     * pledge gives back <em>claimed</em> ones. They are different statements against
     * different columns, and releasing the wrong one leaves the tier counting a place
     * nobody holds while it is short of one somebody does — with the sum, which is
     * what the limit is checked against, still looking correct.
     *
     * <p><strong>Nothing is refunded, because nothing was collected.</strong> §9.7's
     * row for this case says so in terms, and §9.2 puts the only collection at the
     * close of a successful campaign. There is no transaction to reverse and no
     * ledger entry to write; the refund of a pledge that <em>was</em> collected is
     * #67's.
     *
     * <p>The state change and the credit are one transaction, for
     * {@link ReservationExpiry}'s reason: a pledge that says cancelled while the tier
     * still counts its place is a place nothing will ever release. That now covers the
     * add-on lines as well: a cancellation that gave back the reward's place and left
     * three mugs held would be stock nobody could ever buy, and nothing would notice.
     *
     * @param pledge the backer's own pledge, already established to be theirs and to
     *     be in a state they may withdraw. See {@link PledgeService#cancel}
     * @param heldAddons the add-on lines as they stand, read by the caller inside this
     *     transaction
     */
    @Transactional
    public void cancel(Pledge pledge, List<PledgeAddon> heldAddons, Instant now) {
        SortedMap<UUID, Integer> held = HeldPlaces.heldBy(pledge, heldAddons);
        // Read before the transition, because it is the old state that says which
        // column the places are counted in.
        boolean committed = pledge.isConfirmed();

        pledge.cancelByBacker(now);
        releaseTheHeldPlaces(pledge, held, committed);
        pledges.saveAndFlush(pledge);
    }

    /**
     * The same release, when it is the campaign that stopped rather than the backer —
     * #103.
     *
     * <p>Here beside {@link #cancel} because it moves stock, which is what every method
     * in this class has in common: the places a halted campaign's pledges were holding go
     * back through the same statements, from whichever column was holding them. What
     * differs is one state name, and it differs because "I changed my mind" and "the
     * campaign was taken down" are different facts on every screen that reports why a
     * place came back.
     *
     * @param pledge a {@code DRAFT} or a {@code CONFIRMED} pledge, already established to
     *     be one by {@code PledgeCancellationService} — which skips the states a halt
     *     does not end rather than refusing them
     */
    @Transactional
    public void cancelByProject(Pledge pledge, List<PledgeAddon> heldAddons, Instant now) {
        SortedMap<UUID, Integer> held = HeldPlaces.heldBy(pledge, heldAddons);
        // Read before the transition, because it is the old state that says which column
        // the places are counted in.
        boolean committed = pledge.isConfirmed();

        pledge.cancelByProject(now);
        releaseTheHeldPlaces(pledge, held, committed);
        pledges.saveAndFlush(pledge);
    }

    /**
     * The add-on selection after the edit: the one that was sent, or the one already
     * stored.
     *
     * <p>{@code "addons": null} is an empty selection — a backer who removed all of
     * them — and an absent field leaves them alone. Collapsing those two would make
     * an edit of the contribution alone silently strip every extra off the pledge.
     */
    private static List<DraftPledge.AddonSelection> selectedAddons(
            EditPledge command, List<PledgeAddon> existingAddons) {

        if (!command.addons().isPresent()) {
            return existingAddons.stream()
                    .map(addon -> new DraftPledge.AddonSelection(addon.getRewardTierId(), addon.getQuantity()))
                    .toList();
        }
        List<DraftPledge.AddonSelection> sent = command.addons().value();
        return sent == null ? List.of() : List.copyOf(sent);
    }

    /**
     * What the backer chose to give, reconstructed from the pledge when the edit does
     * not say.
     *
     * <p><strong>Base plus bonus, which is the definition rather than a
     * reconstruction.</strong> {@code PledgeQuote} splits a contribution into the
     * tier's price and the support above it, so adding the two back together returns
     * the number the backer actually chose — and it does so for a support-only pledge
     * as well, where the base is the whole of it and the bonus is zero. Add-ons,
     * shipping and tax are excluded because they were never part of it.
     *
     * <p><strong>When the tier changes and the contribution does not</strong>, the
     * backer's old number is quoted against the new tier's price. Moving to something
     * cheaper leaves the difference as PL-03 bonus support, which is what they are
     * still paying and what they will still be charged. Moving to something dearer is
     * refused with {@code CONTRIBUTION_BELOW_REWARD_PRICE} rather than silently
     * raised — quietly charging somebody more for a tier they upgraded to is the one
     * outcome no client could defend, and the refusal names both amounts so the
     * client can offer the new figure.
     */
    private static Money contributionOf(Pledge pledge) {
        return Money.of(pledge.getBaseAmount().add(pledge.getBonusAmount()), pledge.getCurrency());
    }

    /**
     * Moves the pledge from the places it held to the places it now names.
     *
     * <p>Nothing happens for a tier whose count did not change, which is the common
     * edit — a new destination, a hidden name, a bigger contribution. Only the
     * differences move, so an edit that touches no selection issues no statement
     * against {@code reward_tiers} at all.
     *
     * <p><strong>Every take before every release, and both in
     * {@link HeldPlaces}' order.</strong> The first half is {@link #edit}'s argument,
     * unchanged and now spanning several tiers: a refusal must cost the backer
     * nothing, so nothing is given up until everything asked for has been obtained.
     * The second is the deadlock argument on {@link HeldPlaces} — within each half the
     * rows are taken in one order every transaction agrees on.
     *
     * @throws RewardSoldOutException when a tier the edit needs more of has too few
     *     left. Thrown <em>before</em> anything is given back, so the transaction rolls
     *     back with the backer still holding exactly what they had
     */
    private void moveThePlaces(Pledge pledge, SortedMap<UUID, Integer> wanted, List<PledgeAddon> heldAddons) {
        SortedMap<UUID, Integer> held = HeldPlaces.heldBy(pledge, heldAddons);
        if (held.equals(wanted)) {
            return;
        }

        // Read before the state changes, because it decides which of the two columns
        // this pledge's places live in.
        boolean committed = pledge.isConfirmed();

        takeThePlaces(pledge.getProjectId(), HeldPlaces.extraIn(wanted, held), committed);
        releaseTheHeldPlaces(pledge, HeldPlaces.extraIn(held, wanted), committed);
    }

    /**
     * Takes every place in the map, or says which tier could not give them.
     *
     * <p>One conditional {@code UPDATE} per tier — see
     * {@link RewardStock#reservePlaces}. Somebody taking the last place while this
     * backer was reading the page is the ordinary case, not an error, and §10.4
     * answers it with the alternatives that are left rather than with a bare refusal.
     *
     * <p>The map is sorted, and every caller here passes one, for the deadlock reason
     * {@link HeldPlaces} carries.
     *
     * @param claimed true when the pledge is already {@code CONFIRMED}, so the places
     *     are taken as claimed ones rather than reserved. See
     *     {@link RewardStock#claimPlaces}
     * @throws RewardSoldOutException naming the first tier that refused. The
     *     transaction rolls back, so the tiers before it in the order give their places
     *     straight back
     */
    private void takeThePlaces(UUID projectId, SortedMap<UUID, Integer> places, boolean claimed) {
        for (Map.Entry<UUID, Integer> line : places.entrySet()) {
            boolean taken = claimed
                    ? stock.claimPlaces(line.getKey(), line.getValue())
                    : stock.reservePlaces(line.getKey(), line.getValue());
            if (!taken) {
                throw new RewardSoldOutException(projectId, line.getKey());
            }
        }
    }

    /**
     * Gives back the places a pledge was holding, from whichever column was holding
     * them.
     *
     * <p>A tier with nothing to give back is logged rather than refused, for
     * {@link ReservationExpiry}'s reason: this transaction owns the pledge, so a
     * mismatch is an invariant violation rather than a race, and refusing would
     * strand a backer in front of a state only we can repair. The count is
     * recoverable from the pledges; a lost edit or a lost cancellation is not.
     */
    private void releaseTheHeldPlaces(Pledge pledge, SortedMap<UUID, Integer> places, boolean committed) {
        for (Map.Entry<UUID, Integer> line : places.entrySet()) {
            boolean released = committed
                    ? stock.releaseClaimedPlaces(line.getKey(), line.getValue())
                    : stock.releasePlaces(line.getKey(), line.getValue());
            if (!released) {
                log.error(
                        "Pledge {} held {} {} places on reward tier {} that the tier had no record of.",
                        pledge.getId(),
                        line.getValue(),
                        committed ? "claimed" : "reserved",
                        line.getKey());
            }
        }
    }

    /**
     * Rewrites the add-on lines, and only when they actually changed.
     *
     * <p><strong>Compared before it is written, because the common edit changes
     * nothing here.</strong> A backer raising their contribution or hiding their name
     * sends the same add-ons back, and deleting and re-inserting identical rows would
     * be two statements and a composite foreign key check for no change at all.
     *
     * <p>When they have changed, the set is replaced wholesale — V18 says so, and
     * {@code EditPledge} carries the argument for why a per-line patch is the wrong
     * shape. The rows are removed as entities rather than by a bulk {@code DELETE}:
     * a bulk statement leaves the persistence context still holding the rows it
     * deleted, and the insert that follows would then be turned into an {@code
     * UPDATE} of a row that no longer exists. The flush between the two is what lets
     * a tier that survived the edit be written again under the primary key it just
     * gave up.
     */
    private void replaceAddons(
            Pledge pledge, List<PledgeAddon> existingAddons, List<DraftPledge.AddonSelection> selections) {

        Map<UUID, Integer> before = new LinkedHashMap<>();
        for (PledgeAddon addon : existingAddons) {
            before.put(addon.getRewardTierId(), addon.getQuantity());
        }
        Map<UUID, Integer> after = new LinkedHashMap<>();
        for (DraftPledge.AddonSelection selection : selections) {
            after.put(selection.rewardTierId(), selection.quantity());
        }
        if (before.equals(after)) {
            return;
        }

        if (!existingAddons.isEmpty()) {
            addons.deleteAll(existingAddons);
            addons.flush();
        }
        if (!selections.isEmpty()) {
            addons.saveAll(selections.stream()
                    .map(selection -> PledgeAddon.of(
                            pledge.getId(), pledge.getProjectId(), selection.rewardTierId(), selection.quantity()))
                    .toList());
        }
    }

    /**
     * Turns what the backer named into what {@link PledgeQuote} can add up.
     *
     * <p>One read of the reward module for every line at once — the reward and each
     * add-on, with the rate for the destination already resolved. Asking per line
     * would be a query per add-on plus one per rate table, on the request somebody is
     * waiting on with their card out.
     *
     * <p><strong>The two refusals here are also refusals in {@link PledgeQuote},
     * and that is deliberate.</strong> That class is arithmetic with no HTTP in it,
     * so it can only throw a sentence; §10.4 needs a code the client branches on and
     * a {@code meta} naming which tier and which country. So the checkout refuses
     * first, where those are known, and the quote's own refusal stays as the backstop
     * that makes it impossible to price a pledge nobody costed — including for
     * whatever calls it next.
     *
     * <p><strong>Taken apart from {@link DraftPledge} by #56</strong>, which quotes a
     * selection that was never one: an edit resolves a partial body against a stored
     * pledge, and what comes out is a reward, some add-ons, a contribution and a
     * destination with no command object around them. Both callers price through this
     * method, so a draft and an edit of that same draft cannot come to two different
     * totals for one selection — which is the only property that matters here, and it
     * is exactly what a second copy of this method would have quietly given up.
     */
    private PledgeSelection selectionFor(
            UUID projectId,
            UUID rewardTierId,
            List<DraftPledge.AddonSelection> addonSelections,
            Money contribution,
            String shippingCountry) {

        List<UUID> selected = new ArrayList<>(addonSelections.size() + 1);
        if (rewardTierId != null) {
            selected.add(rewardTierId);
        }
        addonSelections.stream().map(DraftPledge.AddonSelection::rewardTierId).forEach(selected::add);

        Map<UUID, RewardStock.SelectableTier> tiers = tiersFor(projectId, selected, shippingCountry);

        String currency = currencyOf(tiers.values());
        if (!currency.equals(contribution.currency())) {
            // Adding the two would produce a number in neither currency, and the
            // pledge has one currency column to record it in. Refused here rather
            // than in the quote so that the message names both.
            throw new IllegalArgumentException("This campaign is priced in " + currency
                    + " and the contribution is in " + contribution.currency());
        }

        QuotedLine reward = null;
        if (rewardTierId != null) {
            RewardStock.SelectableTier tier = tiers.get(rewardTierId);
            if (contribution.amount().compareTo(tier.amount()) < 0) {
                throw new ContributionBelowRewardPriceException(
                        contribution.amount(), tier.amount(), tier.currency());
            }
            // Always one. §7.2 gives a pledge a single reward_tier_id, so two of a
            // tier is two pledges or it is an add-on, and both of those already have
            // a shape.
            reward = lineFor(tier, 1, shippingCountry);
        }

        List<QuotedLine> addonLines = new ArrayList<>(addonSelections.size());
        for (DraftPledge.AddonSelection addon : addonSelections) {
            addonLines.add(lineFor(tiers.get(addon.rewardTierId()), addon.quantity(), shippingCountry));
        }

        return new PledgeSelection(currency, shippingCountry, reward, addonLines, contribution.amount());
    }

    /**
     * The campaign's tiers, with the rate for the destination already resolved.
     *
     * <p>One read of the reward module for every line at once, and the check that
     * every identifier the caller named belongs to this campaign. Extracted from
     * {@link #selectionFor} by #76 so that the post-campaign purchases can ask the
     * same question without going through a whole selection — a second copy of the
     * lookup would be a second place for "is this tier on this campaign" to be
     * answered, which is the check that keeps one campaign's backer from buying
     * another campaign's stock.
     *
     * @throws UnknownRewardTierException naming the first identifier that is not this
     *     campaign's. Absent from {@code RewardStock.selectionOf}'s answer means "not
     *     this campaign's", and that class leaves the distinction to the caller
     *     because only the caller knows which selection went missing
     */
    private Map<UUID, RewardStock.SelectableTier> tiersFor(
            UUID projectId, List<UUID> selected, String shippingCountry) {

        Map<UUID, RewardStock.SelectableTier> tiers = new LinkedHashMap<>();
        for (RewardStock.SelectableTier tier : stock.selectionOf(projectId, selected, shippingCountry)) {
            tiers.put(tier.rewardTierId(), tier);
        }
        for (UUID selectedTierId : selected) {
            if (!tiers.containsKey(selectedTierId)) {
                throw new UnknownRewardTierException(projectId, selectedTierId);
            }
        }
        return tiers;
    }

    /**
     * §4.8's PM-09: what one reward tier costs today, delivered to this destination.
     *
     * <p>Both sides of an upgrade are priced through this, at the same moment, so the
     * difference between them is a real difference rather than one measured against a
     * rate that no longer exists. A tier's <em>price</em> cannot move after launch —
     * §5.3 freezes it, and {@code LockedField.REWARD_PRICE} is what refuses the edit —
     * but a shipping rate can, and a heavier tier posted to Berlin is what an upgrade
     * usually changes.
     *
     * @throws UnknownRewardTierException when the tier is not this campaign's
     * @throws ShippingDestinationUnpricedException when the tier ships and the
     *     destination has no rate
     */
    @Transactional(readOnly = true)
    public PledgeQuote priceOfTier(UUID projectId, UUID rewardTierId, String destination) {
        RewardStock.SelectableTier tier =
                tiersFor(projectId, List.of(rewardTierId), destination).get(rewardTierId);

        return PledgeQuote.of(new PledgeSelection(
                tier.currency(), destination, lineFor(tier, 1, destination), List.of(), tier.amount()));
    }

    /**
     * §4.8's PM-10: what a set of add-ons costs today, delivered to this destination.
     *
     * <p>The contribution is zero and that is the whole trick: with no reward line,
     * {@link PledgeQuote} treats what the backer chose to give as the base — §4.5's
     * PL-02 — so a zero contribution prices exactly the add-ons and their postage, with
     * no bonus and nothing of the original pledge in it. That is precisely what a
     * post-campaign purchase costs.
     *
     * @throws UnknownRewardTierException when a tier is not this campaign's
     * @throws ShippingDestinationUnpricedException when a line ships and the
     *     destination has no rate
     */
    @Transactional(readOnly = true)
    public PledgeQuote priceOfAddons(
            UUID projectId, List<DraftPledge.AddonSelection> selections, String destination) {

        List<UUID> selected =
                selections.stream().map(DraftPledge.AddonSelection::rewardTierId).toList();
        Map<UUID, RewardStock.SelectableTier> tiers = tiersFor(projectId, selected, destination);

        String currency = currencyOf(tiers.values());
        List<QuotedLine> lines = new ArrayList<>(selections.size());
        for (DraftPledge.AddonSelection selection : selections) {
            lines.add(lineFor(tiers.get(selection.rewardTierId()), selection.quantity(), destination));
        }
        return PledgeQuote.of(new PledgeSelection(currency, destination, null, lines, BigDecimal.ZERO));
    }

    /**
     * §4.8's PM-09: moves the pledge's claimed place from one tier to the other.
     *
     * <p><strong>Take before release, exactly as {@link #edit} does</strong>, and for
     * the reason that method's javadoc gives: a backer whose upgrade is refused because
     * the better tier sold out while they were reading the page must still be holding
     * the tier they already had. Releasing first would leave them with neither on the
     * one path where the refusal is ordinary.
     *
     * <p>Claimed rather than reserved on both sides. A supplement is only ever bought
     * against a pledge that has been confirmed, so its places are in
     * {@code claimed_quantity} — there is no five-minute window here, because there is
     * no checkout to abandon: the purchase is complete when this returns.
     *
     * @throws RewardSoldOutException when the tier the backer is upgrading to has no
     *     places left, leaving the pledge exactly as it was
     */
    @Transactional
    public void moveClaimedPlace(Pledge pledge, UUID fromTierId, UUID toTierId) {
        if (!stock.claimPlaces(toTierId, 1)) {
            throw new RewardSoldOutException(pledge.getProjectId(), toTierId);
        }
        if (fromTierId != null && !stock.releaseClaimedPlaces(fromTierId, 1)) {
            // Logged rather than refused, for releaseTheHeldPlaces' reason: this
            // transaction owns the pledge, so a mismatch is an invariant violation
            // rather than a race, and refusing would strand a backer who has already
            // been given the tier they asked for.
            log.error(
                    "Pledge {} held a claimed place on reward tier {} that the tier had no record of.",
                    pledge.getId(),
                    fromTierId);
        }
    }

    /**
     * §4.8's PM-10: claims the places a post-campaign purchase takes.
     *
     * <p>The same statements as every other stock path in this class, against the
     * claimed column for {@link #moveClaimedPlace}'s reason. Sorted, for the deadlock
     * reason {@link HeldPlaces} carries: two backers buying the same two add-ons in
     * opposite orders would each hold the row the other wanted.
     *
     * @throws RewardSoldOutException naming the first add-on that refused. The
     *     transaction rolls back, so the ones before it give their places straight back
     */
    @Transactional
    public void claimPurchasedPlaces(UUID projectId, List<DraftPledge.AddonSelection> selections) {
        takeThePlaces(projectId, HeldPlaces.of(null, selections), true);
    }

    /**
     * One selected tier as a line of the quote.
     *
     * <p>A shipped line with no rate for the destination is refused rather than
     * quoted at zero — including when there is no destination at all. §7.2's
     * "anywhere the creator has priced" is the rule, and a zero would make the
     * creator pay the carrier out of their own funding, silently.
     */
    private QuotedLine lineFor(RewardStock.SelectableTier tier, int quantity, String destination) {
        if (!tier.shipped()) {
            return QuotedLine.notShipped(tier.amount(), tier.currency(), quantity);
        }
        if (destination == null || tier.shippingRate() == null) {
            throw new ShippingDestinationUnpricedException(tier.rewardTierId(), destination);
        }
        // The weight comes with the tier because the items that carry it are the
        // reward module's, and it is passed on rather than defaulted so that a
        // per-kilogram rate (#77) prices the parcel the backer is actually getting.
        return QuotedLine.shipped(
                tier.amount(), tier.currency(), quantity, tier.shippingRate(), tier.unitWeightGrams());
    }

    /**
     * The campaign's currency, taken from what the backer selected.
     *
     * <p>A tier carries its campaign's currency (§7.2), so any selected tier answers
     * this. A pledge that selected nothing — PL-02, support only — has nothing to
     * take it from, and falls back to the one currency the platform settles in for
     * the reason given on {@link #SUPPORTED_CURRENCY}.
     *
     * <p>Tiers disagreeing with each other is not decided here: {@link PledgeQuote}
     * refuses a selection spanning two currencies, and it is the right place for it
     * because that is where the amounts would be added together.
     */
    private static String currencyOf(Iterable<RewardStock.SelectableTier> tiers) {
        for (RewardStock.SelectableTier tier : tiers) {
            return tier.currency();
        }
        return SUPPORTED_CURRENCY;
    }

    /**
     * Writes the draft, and turns the one race the read above cannot win into the
     * same refusal the read gives.
     *
     * <p><strong>{@code settleAnyExistingPledge} is a read, and a read cannot decide
     * this.</strong> Two checkouts by one backer arriving together both find no
     * pledge, both conclude the backer has none, and both insert;
     * {@code pledges_project_backer_active_key} refuses the second. That is not an
     * exotic race — it is somebody double-clicking a button, or a client retrying
     * with a fresh idempotency key instead of the one it already had — and before
     * this it reached the backer as a 500, which tells them nothing and pages
     * somebody. The read decides what to say; the index decides what is true, and
     * this is where the index gets to say it.
     *
     * <p><strong>{@code saveAndFlush}, so the statement runs here.</strong> A plain
     * {@code save} queues the insert until something forces it — possibly the commit,
     * which is outside this method and outside anything that could translate it. The
     * flush is load-bearing for a second reason: {@code total_amount} is a generated
     * column whose value only exists once the {@code INSERT} has run, and the
     * response is built inside this transaction.
     *
     * <p>The campaign and the backer are read off the draft rather than passed in, so
     * that what is looked up afterwards cannot describe a different row from the one
     * that was refused.
     *
     * @throws PledgeAlreadyExistsException when the index refused this insert because
     *     the backer already has a live pledge on the campaign — §7.2
     */
    private Pledge insert(Pledge draft) {
        try {
            return pledges.saveAndFlush(draft);
        } catch (DataIntegrityViolationException violation) {
            throw refusalFor(violation, draft.getProjectId(), draft.getBackerId());
        }
    }

    /**
     * The answer for a violated constraint, or the violation itself when it is one
     * this class has nothing to say about.
     *
     * <p><strong>One constraint by name, and nothing broader — that is the whole
     * point.</strong> Catching {@code DataIntegrityViolationException} and calling
     * every one of them "you already have a pledge" would be a comfortable lie: the
     * other constraint reachable from this transaction is V7's
     * {@code reward_tiers_stock_is_within_the_limit}, and reporting an oversold
     * reward as a duplicate pledge would hide the one failure this module exists to
     * make impossible, behind a message plausible enough that nobody would look. The
     * same goes for the composite reference to {@code reward_tiers}, the state check,
     * and the idempotency index: each of those means a bug somewhere, and a bug that
     * answers 409 is a bug nobody finds.
     *
     * <p>So the constraint is matched by name and everything else is rethrown
     * untouched — a 500, loudly, exactly as it behaves today.
     */
    private RuntimeException refusalFor(
            DataIntegrityViolationException violation, UUID projectId, UUID backerId) {

        if (!ONE_ACTIVE_PLEDGE_PER_BACKER.equals(violatedConstraintOf(violation))) {
            return violation;
        }

        // Read outside this transaction, which the violation has already doomed —
        // see PledgeConflicts. The pledge that refused this insert is committed by
        // definition, so this normally finds it, and the backer gets the identifier
        // of the pledge they already have exactly as the read path gives it: they
        // cannot tell which of the two refused them, and should not be able to.
        Pledge existing = conflicts.activePledgeOf(projectId, backerId).orElse(null);
        if (existing == null) {
            // The pledge that won the race stopped being active in the moment since —
            // cancelled, or a draft the sweep expired. "You already have a pledge" is
            // no longer true and there is no identifier to hand over, so nothing
            // truthful can be said and the violation is not dressed up as an answer.
            // A retry succeeds, because the read at the top of the checkout will find
            // nothing too.
            log.error(
                    "Pledge insert for backer {} on campaign {} was refused by {}, and no active pledge explains it.",
                    backerId,
                    projectId,
                    ONE_ACTIVE_PLEDGE_PER_BACKER);
            return violation;
        }
        return new PledgeAlreadyExistsException(projectId, backerId, existing.getId(), existing.getState());
    }

    /**
     * Which constraint PostgreSQL refused, as it named it.
     *
     * <p>Spring wraps the driver's error in a {@code DataIntegrityViolationException}
     * that says only that <em>something</em> was violated, which is why the name has
     * to be dug out: Hibernate's own exception carries it, extracted by the
     * PostgreSQL dialect from the message the server sent.
     *
     * @return null when the cause chain holds no Hibernate constraint violation, or
     *     when it holds one that could not be named — both of which are "this is not
     *     the constraint we are looking for"
     */
    private static String violatedConstraintOf(DataIntegrityViolationException violation) {
        for (Throwable cause = violation; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException hibernate) {
                return hibernate.getConstraintName();
            }
        }
        return null;
    }

    /** §4.5's five minutes, from the injected clock and the configured TTL. */
    private Instant lapsesAt(Instant now) {
        return now.plus(properties.reservation().ttl());
    }

    /**
     * Deals with the pledge this backer already has on this campaign, if any.
     *
     * <p>Two outcomes, and the difference matters to whoever is standing at the
     * checkout. A pledge that is still live — a draft with time left, or a
     * confirmed pledge — is §7.2's one-per-backer rule and they are told about it.
     * A draft whose five minutes have run out is released here and now, rather than
     * when the sweep next runs: the backer is the person whose reservation it was,
     * and making them wait up to a minute to be allowed to try again would be a
     * refusal caused entirely by our own scheduling.
     *
     * <p>Racing another request that is doing the same thing is safe in both
     * branches. The release is a conditional update that exactly one caller wins,
     * and if this read misses a pledge that another transaction is inserting,
     * {@code pledges_project_backer_active_key} refuses the second insert. This
     * read decides what to say; the index decides what is true.
     *
     * <p><strong>And when the index is the one that decides, it says the same
     * thing.</strong> {@link #insert} translates that one constraint into the same
     * {@link PledgeAlreadyExistsException} raised here, so a backer who
     * double-clicked cannot tell which of the two paths refused them. Before that
     * translation the race reached them as a 500.
     */
    private void settleAnyExistingPledge(UUID projectId, UUID backerId, Instant now) {
        Optional<Pledge> existing = pledges.findActive(projectId, backerId, PledgeState.ACTIVE);
        if (existing.isEmpty()) {
            return;
        }

        Pledge pledge = existing.get();
        if (!pledge.hasLapsed(now)) {
            throw new PledgeAlreadyExistsException(projectId, backerId, pledge.getId(), pledge.getState());
        }
        expiry.release(pledge.getId(), now);
    }
}
