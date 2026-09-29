package az.ideanest.pledge.api;

import az.ideanest.pledge.application.PledgeDetail;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A pledge as its backer sees it.
 *
 * <p>The response of all three endpoints — draft, read, and confirm — for
 * {@code RewardResponse}'s reason: one shape means a client applies the same update
 * to its state whichever call it made, and an endpoint cannot quietly start
 * returning a field the others do not.
 *
 * <p><strong>Nulls are written out.</strong> The default for this service is
 * {@code non_null}, and here that would be wrong in the one place it matters: a
 * confirmed pledge has no {@code reservationExpiresAt} and a support-only pledge has
 * no {@code rewardTierId}, and an absent key cannot be told from a value the client
 * failed to parse.
 *
 * @param state one of §6.2's twelve
 * @param amounts all six, always. Five columns and the generated total — see
 *     {@link Amounts}
 * @param reservationExpiresAt when this draft stops holding its place, and
 *     <strong>null once it is not a draft</strong>. The column keeps its value after
 *     the transition, deliberately (V17: it is a true statement about the window the
 *     backer had), but to a client the field means "your reservation runs out at",
 *     and a confirmed pledge holds no reservation. Answering with the old instant
 *     would put a countdown on a screen that has nothing to count down to
 * @param paymentMethodId what the backer said to charge later, echoed. Null until
 *     #55 exists to give them one
 * @param cardVerified <strong>whether §9.2's phase 1 actually happened, and today it
 *     never has.</strong> The verification authorisation, 3-D Secure, the stored
 *     token and the void are {@code PledgeCapability.CARD_VERIFICATION} — #55,
 *     blocked on #60 — so this is false on every confirmed pledge the platform holds.
 *     It is in the body rather than left to be inferred because the alternative is a
 *     client reading {@code state: "CONFIRMED"} as "the card is good", which is a
 *     stronger claim than the platform can make.
 *     <p>It does <em>not</em> mean a charge failed or succeeded. §9.2 is explicit
 *     that no money moves at confirmation and no ledger entry is written under any
 *     circumstances; collection is phase 2, at the close of a successful campaign,
 *     and belongs to epic #59
 * @param supplements §4.8's PM-09 and PM-10 (#76): what this backer bought after the
 *     campaign closed, each of them charged separately from the pledge and none of
 *     them charged yet. Empty on every pledge until somebody upgrades
 * @param latePledge §4.5's PL-16 (#81): whether this pledge was taken after the
 *     campaign closed, in a window its creator reopened. Read from the row rather than
 *     derived from the campaign's state, which will have moved on by the time anybody
 *     looks
 * @param raisable #171: whether this pledge may be raised now, with
 *     {@code POST /v1/pledges/{id}/raise} — it is paid for and its campaign is taking pledges
 * @param latestRaise #171: the most recent attempt to raise it, or null. A page the payment provider
 *     sent the backer back to reads its state: {@code PENDING} is a payment still settling,
 *     {@code SUCCEEDED} is applied, and anything else changed nothing
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PledgeResponse(
        UUID id,
        UUID projectId,
        String state,
        UUID rewardTierId,
        List<PledgeAddonBody> addons,
        Amounts amounts,
        String shippingCountry,
        boolean isAnonymous,
        Instant reservationExpiresAt,
        Instant confirmedAt,
        Instant canceledAt,
        UUID paymentMethodId,
        boolean cardVerified,
        boolean latePledge,
        /**
         * §21.2's rate retention (#327): the currency this pledge was approximated in at
         * confirmation, or null when the backer was shown the campaign's own.
         *
         * <p>Null for most pledges, and that is the honest record rather than a missing
         * value — there was no approximation to keep. V60's
         * {@code pledges_display_currency_differs} refuses the case where it would equal
         * {@link Amounts}' currency.
         */
        String displayCurrency,
        /**
         * Units of the pledge's currency per ONE unit of {@link #displayCurrency}, as a
         * string.
         *
         * <p>A string for the reason every amount on this platform is one: a JSON number is
         * an IEEE 754 double, and a rate is what money is computed from — so it crosses as
         * text for the same reason an amount does, one step earlier.
         *
         * <p><strong>The rate and never the converted amount.</strong> The amount is a
         * product of {@code amounts.total} and this, and sending both would be sending a
         * figure that can disagree with its own inputs. The client multiplies once, when it
         * draws it.
         */
        String displayRate,
        List<PledgeSupplementBody> supplements,
        boolean raisable,
        PledgeRaiseBody latestRaise) {

    /**
     * §4.5's PL-06, broken out: what the backer is charged, and what it is made of.
     *
     * <p>The five columns §7.2 stores plus the total PostgreSQL generates from them.
     * All six are always present. A response that carried only the total would be one
     * a backer cannot be shown and a support agent cannot explain, and one that
     * omitted a zero would make a client guess whether "no shipping line" means free
     * postage or an unanswered question.
     *
     * @param tax {@code "0.00"} until #78 builds a tax model. The zero is deliberate
     *     rather than missing — see {@code TaxPolicy}
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Amounts(Money base, Money addons, Money bonus, Money shipping, Money tax, Money total) {

        static Amounts of(Pledge pledge) {
            String currency = pledge.getCurrency();
            return new Amounts(
                    Money.of(pledge.getBaseAmount(), currency),
                    Money.of(pledge.getAddonsAmount(), currency),
                    Money.of(pledge.getBonusAmount(), currency),
                    Money.of(pledge.getShippingAmount(), currency),
                    Money.of(pledge.getTaxAmount(), currency),
                    // The database's number, not a sum computed here. total_amount is
                    // a generated column precisely so that the receipt cannot disagree
                    // with the lines above it, and adding them up again in Java would
                    // be a second answer free to differ from the stored one.
                    Money.of(pledge.getTotalAmount(), currency));
        }
    }

    public static PledgeResponse of(PledgeDetail detail) {
        Pledge pledge = detail.pledge();
        return new PledgeResponse(
                pledge.getId(),
                pledge.getProjectId(),
                pledge.getState().name(),
                pledge.getRewardTierId(),
                PledgeAddonBody.of(detail.addons()),
                Amounts.of(pledge),
                pledge.getShippingCountry(),
                pledge.isAnonymous(),
                pledge.isDraft() ? pledge.getReservationExpiresAt() : null,
                pledge.getConfirmedAt(),
                pledge.getCanceledAt(),
                pledge.getPaymentMethodId(),
                // Never true yet, and it is a field rather than a constant in the
                // client so that #55 changes one expression here and nothing there.
                false,
                pledge.isLatePledge(),
                pledge.getDisplayCurrency(),
                // `toPlainString` and never `toString`: a BigDecimal whose scale and
                // precision line up renders in scientific notation, and a client parsing
                // `2.0484E-2` with a decimal library that does not accept exponents gets
                // nothing rather than a rate.
                pledge.getDisplayRate() == null ? null : pledge.getDisplayRate().toPlainString(),
                PledgeSupplementBody.of(detail),
                detail.raisable(),
                detail.latestRaise() == null ? null : PledgeRaiseBody.of(detail.latestRaise()));
    }
}
