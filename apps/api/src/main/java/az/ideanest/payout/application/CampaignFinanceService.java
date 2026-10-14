package az.ideanest.payout.application;

import az.ideanest.fee.application.FeeBreakdown;
import az.ideanest.fee.application.FeeSchedules;
import az.ideanest.ledger.application.LedgerBalance;
import az.ideanest.ledger.application.LedgerReader;
import az.ideanest.payment.application.CampaignFunds;
import az.ideanest.payment.application.PayoutGateway;
import az.ideanest.payout.PayoutProperties;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.domain.PayoutState;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.shared.access.ProjectAuthorisation;
import az.ideanest.shared.access.ProjectCapability;
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
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §4.7's CD-16 — the creator's financial summary. Issue #99.
 *
 * <h2>Why this is in the payout module</h2>
 *
 * Because everything it reports is already decided here. {@code PayoutService} prices a
 * campaign against §5.2's schedule, takes the fees off the gross and the refunds off what is
 * left, and stores all six figures on the row; this answers the same question one step earlier
 * and, once a payout exists, answers it by reading that row rather than by computing it again.
 * A second implementation of the same arithmetic in a dashboard module is a second answer to
 * "what am I owed", and the two would disagree the first time §5.2's rates changed.
 *
 * <h2>Projected and settled are different statements</h2>
 *
 * Before a payout is calculated there is no fee that has been charged — there is a schedule and
 * what it would price today. That is worth showing, and it is not the same as "this is what you
 * were paid". {@link CampaignFinance.Basis} says which one the caller is looking at, and the
 * fee schedule's identifier is on the record either way, so a campaign quoted before a rate
 * change and paid after one has an explicable difference rather than a discrepancy.
 *
 * <h2>WHAT `reconciled` MEANS, AND WHAT IT DOES NOT</h2>
 *
 * It means the campaign's ledger entries balance: summed per currency across every account,
 * the debits equal the credits. V41's deferred constraint trigger already refuses a posting
 * that does not, so it can only be false if a row arrived past both the application and the
 * trigger — which is precisely the day somebody needs to see it rather than be reassured.
 *
 * <p>It does <strong>not</strong> mean the figures above it were derived from the ledger. They
 * are not, and cannot be yet:
 *
 * <ul>
 *   <li><strong>The fee split is never posted.</strong> A collection debits escrow and credits
 *       the creator; a payout does the reverse for the <em>net</em>. Nothing writes
 *       {@code platform_fee}, so the difference stays in escrow as a balance no account claims,
 *       and the creator's account keeps a residual credit equal to the fees for ever.
 *       The collection and {@code PayoutPostings} each said the other one posted the
 *       split; neither does. That is #69's to close and it is named here rather than papered
 *       over, because a summary claiming to be reconciled to books that do not carry the fee
 *       would be claiming more than it can.
 *   <li><strong>{@code tax_payable} has no writer either</strong>, for a different and better
 *       reason: §4.10's tax collection is #78 and is blocked on a legal answer, so there is no
 *       tax to post.
 * </ul>
 *
 * <p>Both balances are published on the response as they actually are, which is what lets a
 * creator — or whoever they show it to — see the gap rather than take a total on trust.
 */
@Service
public class CampaignFinanceService {

    private final ProjectAuthorisation projects;
    private final PayoutGateway gateway;
    private final FeeSchedules fees;
    private final PayoutRepository payouts;
    private final LedgerReader ledger;
    private final PayoutProperties properties;
    private final Clock clock;

    public CampaignFinanceService(
            ProjectAuthorisation projects,
            PayoutGateway gateway,
            FeeSchedules fees,
            PayoutRepository payouts,
            LedgerReader ledger,
            PayoutProperties properties,
            Clock clock) {

        this.projects = projects;
        this.gateway = gateway;
        this.fees = fees;
        this.payouts = payouts;
        this.ledger = ledger;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * One campaign's finances, as they stand.
     *
     * <p>Guarded by {@link ProjectCapability#VIEW_FINANCES}, the same capability §4.7's backer
     * report takes and for the same reason: this is money, and a collaborator brought on to
     * write the story has no business reading it.
     *
     * @param accountId the authenticated caller, never a value from a request body
     * @throws az.ideanest.project.application.ProjectNotFoundException for a campaign that does
     *     not exist and for one this account has no part in, identically
     * @throws az.ideanest.project.application.CapabilityNotGrantedException for a collaborator
     *     whose grant does not include VIEW_FINANCES
     */
    @Transactional(readOnly = true)
    public CampaignFinance of(UUID projectId, UUID accountId) {
        projects.requireCapability(projectId, accountId, ProjectCapability.VIEW_FINANCES);

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        CampaignFunds funds = gateway.fundsOf(projectId, properties.currency());
        List<Payout> history = payouts.historyOf(projectId);
        List<LedgerBalance> balances = ledger.balancesOf(projectId);

        /*
         * The newest payout decides the basis, whatever became of it. A cancelled payout was
         * still priced against a real schedule, and reporting a campaign that has had one as
         * though nothing had ever been calculated would hide the fact that somebody looked.
         */
        Optional<Payout> newest = history.stream().findFirst();

        return newest.map(payout -> settled(projectId, funds, payout, history, balances, now))
                .orElseGet(() -> projected(projectId, funds, history, balances, now));
    }

    /** What a payout would come to, priced against the schedule in force now. */
    private CampaignFinance projected(
            UUID projectId,
            CampaignFunds funds,
            List<Payout> history,
            List<LedgerBalance> balances,
            Instant now) {

        String currency = funds.collected().currency();
        FeeBreakdown breakdown = fees.priceOf(funds.collected(), now, projectId);

        /*
         * The fees come off the gross and the refunds come off what is left, which is
         * `PayoutService.calculate`'s order and is the reading that does not take a platform
         * fee on money that went back to a backer. Clamped at zero: a campaign that has
         * refunded more than the fees left behind owes nothing rather than a negative amount,
         * and a screen showing a creator a negative payout would be inventing a debt.
         */
        Money net = atLeastZero(breakdown.net().minus(funds.refunded()));

        return new CampaignFinance(
                projectId,
                CampaignFinance.Basis.PROJECTED,
                currency,
                funds.collected(),
                funds.refunded(),
                breakdown.platformFee(),
                breakdown.processingFee(),
                Money.zero(currency),
                TAX_IS_COLLECTED,
                net,
                paidOut(history, currency),
                breakdown.scheduleId(),
                summarise(history),
                published(balances),
                balanced(balances),
                now);
    }

    /** What a payout actually came to, read from the row rather than recomputed. */
    private CampaignFinance settled(
            UUID projectId,
            CampaignFunds funds,
            Payout payout,
            List<Payout> history,
            List<LedgerBalance> balances,
            Instant now) {

        return new CampaignFinance(
                projectId,
                CampaignFinance.Basis.SETTLED,
                payout.net().currency(),
                payout.gross(),
                payout.refunded(),
                payout.platformFee(),
                payout.processingFee(),
                payout.taxWithheld(),
                TAX_IS_COLLECTED,
                payout.net(),
                paidOut(history, payout.net().currency()),
                payout.feeScheduleId(),
                summarise(history),
                published(balances),
                balanced(balances),
                now);
    }

    /**
     * §4.10's withholding, which the platform does not do.
     *
     * <p>A constant rather than a configuration flag, because there is nothing to configure:
     * #78 is blocked on a legal answer and no code path writes a non-zero
     * {@code pledges.tax_amount}. It exists so the response can distinguish "no tax was due"
     * from "this platform withholds none", which are different sentences to put in front of
     * somebody who has to file a return.
     */
    private static final boolean TAX_IS_COLLECTED = false;

    /** The sum of every payout that actually reached the creator. */
    private static Money paidOut(List<Payout> history, String currency) {
        Money total = Money.zero(currency);
        for (Payout payout : history) {
            if (payout.state() == PayoutState.PAID) {
                total = total.plus(payout.net());
            }
        }
        return total;
    }

    private static List<CampaignFinance.PayoutSummary> summarise(List<Payout> history) {
        List<CampaignFinance.PayoutSummary> summaries = new ArrayList<>(history.size());
        for (Payout payout : history) {
            summaries.add(new CampaignFinance.PayoutSummary(
                    payout.id(), payout.state().name(), payout.net(), payout.calculatedAt(), payout.sentAt()));
        }
        return List.copyOf(summaries);
    }

    private static List<CampaignFinance.AccountBalance> published(List<LedgerBalance> balances) {
        return balances.stream()
                .map(balance -> new CampaignFinance.AccountBalance(balance.account(), balance.net()))
                .toList();
    }

    /**
     * Whether this campaign's books balance, per currency.
     *
     * <p>Summed per currency and never across it: §21.2 has no rate at which two currencies add
     * up, so a campaign holding both balances in neither or in both, and a single total would
     * be a number nobody could reconcile.
     */
    private static boolean balanced(List<LedgerBalance> balances) {
        Map<String, BigDecimal> perCurrency = new LinkedHashMap<>();
        for (LedgerBalance balance : balances) {
            perCurrency.merge(balance.net().currency(), balance.net().amount(), BigDecimal::add);
        }
        return perCurrency.values().stream().allMatch(net -> net.signum() == 0);
    }

    private static Money atLeastZero(Money amount) {
        return amount.isNegative() ? Money.zero(amount.currency()) : amount;
    }
}
