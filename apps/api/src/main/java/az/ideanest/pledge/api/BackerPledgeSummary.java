package az.ideanest.pledge.api;

import az.ideanest.pledge.application.BackerArchive;
import az.ideanest.pledge.application.BackerPledge;
import az.ideanest.project.api.CoverImageBody;
import az.ideanest.project.application.ProfileCampaign;
import az.ideanest.shared.money.Money;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/**
 * One of a backer's own pledges, on the wire — §10.2's {@code GET /v1/me/pledges} (#287).
 *
 * <p><strong>A summary and not {@link PledgeResponse}.</strong> That record is the shape of
 * all three checkout endpoints and carries the add-on lines, §4.8's supplements, the
 * shipping destination, the payment method and the reservation clock; a page of twenty
 * would be forty extra reads to render twenty rows somebody is scrolling. What is dropped
 * is what a client fetches when the backer opens one, from the endpoint that already serves
 * it. What is <em>not</em> dropped is the campaign, because a pledge list whose rows say
 * only "45,00 ₼, CONFIRMED" is a list nobody can use.
 *
 * <p><strong>The amounts are {@link PledgeResponse.Amounts}, reused rather than
 * restated.</strong> Six values in one order, one serialisation, one place to change: a
 * second amounts record would be the one that gains a field late, and the difference would
 * show as a backer's total on the list disagreeing with the total on the pledge they tapped.
 *
 * <p><strong>Nulls are written out</strong>, following {@link PledgeResponse} and for its
 * reason: a support-only pledge has no {@code rewardTierId}, a pledge that was never
 * confirmed has no {@code confirmedAt}, and an absent key cannot be told from a value the
 * client failed to parse.
 *
 * @param state one of §6.2's twelve, by name. All twelve appear: a backer's own list shows
 *     the pledge they cancelled and the one whose card was refused, which is what they
 *     opened it to find
 * @param rewardTitle what the tier is called, or null — for §4.5's PL-02, support with no
 *     reward, and for a tier the campaign has since deleted. The two are deliberately not
 *     distinguished: to the reader they are the same row
 * @param isAnonymous §4.5's PL-12, as the backer set it. On their own list because it is
 *     the only place they can check what they chose — the public archive shows this pledge
 *     to nobody when it is true
 * @param project null when the campaign row no longer exists. The pledge is still served: it
 *     is the backer's money, and it is still theirs when the thing they backed has been
 *     removed
 * @param refundAwaitingBankTransfer #419: {@code PledgeResponse}'s field of the same name, so the
 *     list can tag a pledge whose refund waits for a bank transfer. Null when nothing does
 * @param refunded #436: {@code PledgeResponse}'s field of the same name — what has gone back, as sent
 * @param refundWithheldFee #436: {@code PledgeResponse}'s field of the same name — the provider's fee
 *     the refund keeps back, or null
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record BackerPledgeSummary(
        UUID pledgeId,
        String state,
        PledgeResponse.Amounts amounts,
        UUID rewardTierId,
        String rewardTitle,
        boolean isAnonymous,
        Instant confirmedAt,
        Instant canceledAt,
        Campaign project,
        Money refundAwaitingBankTransfer,
        Money refunded,
        Money refundWithheldFee) {

    /**
     * The campaign a pledge is on, as a row of this list needs it.
     *
     * <p><strong>Deliberately less than {@code ProfileProjectCard}</strong>, although the
     * projection behind both is the same one. That card is what a profile's grid renders and
     * carries the funding total, the goal and the backer count; this is a line beside
     * somebody's own pledge, where what is being reported is the pledge. The campaign's
     * progress is one tap away on its own page, and putting it here would make a backer's
     * private list a place to watch other people's numbers move.
     *
     * <p>Both slugs, because §10.2's public campaign page is
     * {@code /projects/{creatorSlug}/{projectSlug}} and one of them alone addresses nothing.
     * Either may be null when the creator row could not be joined — see
     * {@code ProfileCampaigns.ofAnyState}, which keeps the campaign rather than dropping it.
     *
     * @param state one of §6.1's sixteen, and not only the nine public ones. That is the
     *     point of it being here: the pledges most in need of explanation are on campaigns
     *     that have stopped being public
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Campaign(
            UUID id,
            String title,
            String slug,
            String creatorSlug,
            String state,
            Instant deadline,
            CoverImageBody coverImage) {

        static Campaign of(ProfileCampaign campaign) {
            return campaign == null
                    ? null
                    : new Campaign(
                            campaign.id(),
                            campaign.title(),
                            campaign.slug(),
                            campaign.creatorSlug(),
                            campaign.state(),
                            campaign.deadline(),
                            cover(campaign));
        }

        /**
         * The cover image in the shape every other campaign response uses.
         *
         * <p>{@code CoverImageBody.of} takes the project module's domain value object and
         * cannot be used here: this module may not name that package, which is why
         * {@code ProfileCampaign} carries its own three values. See that record.
         */
        private static CoverImageBody cover(ProfileCampaign campaign) {
            ProfileCampaign.Cover cover = campaign.cover();
            // No media identifier here, for the reason ProfileProjectCard gives.
            return cover == null ? null : new CoverImageBody(cover.url(), cover.width(), cover.height(), null);
        }
    }

    public static BackerPledgeSummary of(BackerArchive.PledgeEntry entry) {
        BackerPledge pledge = entry.pledge();
        return new BackerPledgeSummary(
                pledge.id(),
                pledge.state(),
                new PledgeResponse.Amounts(
                        pledge.base(),
                        pledge.addons(),
                        pledge.bonus(),
                        pledge.shipping(),
                        pledge.tax(),
                        // The database's number, not a sum computed here -- total_amount is
                        // a generated column so that the receipt cannot disagree with the
                        // lines above it, and adding them up again in Java would be a second
                        // answer free to differ from the stored one.
                        pledge.total()),
                pledge.rewardTierId(),
                entry.rewardTitle(),
                pledge.anonymous(),
                pledge.confirmedAt(),
                pledge.canceledAt(),
                Campaign.of(entry.campaign()),
                pledge.refundAwaitingBankTransfer(),
                pledge.refunded(),
                pledge.refundWithheldFee());
    }
}
