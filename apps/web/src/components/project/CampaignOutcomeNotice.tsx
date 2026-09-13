import { CircleCheck, CircleSlash } from 'lucide-react';
import { formatMoney } from '../../lib/money';
import type { CampaignPage } from '../../lib/projects/publicPage';
import { getTranslations } from 'next-intl/server';

/**
 * What happened at the deadline — §5.1, as a backer reads it.
 *
 * <h2>Why this is a separate block from the funding figures</h2>
 *
 * `CampaignSummary` shows what the campaign has raised <em>now</em>. This shows what it had
 * raised when it closed, and V29 is the argument for the difference: the live total keeps
 * moving after the deadline as charges are refunded, so a campaign that funded at 125% can
 * drift downwards for weeks afterwards. #63's
 * rule is that a later collection failure reduces the payout and never the outcome — a page
 * that showed only the live total would eventually contradict the word "Funded" printed
 * beside it.
 *
 * So both numbers are on the page, each labelled as what it is. A backer looking at a
 * closed campaign is entitled to know it succeeded and entitled to know what has actually
 * been collected since; conflating them is how somebody concludes their pledge vanished.
 *
 * <h2>Colour</h2>
 *
 * `--success` for a campaign that funded and a neutral surface for one that did not.
 * **Never lime for either** (ui-kit §2.4): lime means "act now", and there is nothing left
 * to act on. Both carry an icon and a sentence, because colour alone carries no meaning
 * (§9.2) — and "did not fund" is precisely the message a reader must not have to infer from
 * a hue.
 */
export interface CampaignOutcomeNoticeProps {
  readonly campaign: CampaignPage;
}

export async function CampaignOutcomeNotice({ campaign }: CampaignOutcomeNoticeProps) {
  const t = await getTranslations('campaign.outcome');

  const { outcome } = campaign;
  if (outcome === null) return null;

  /*
   * The state decides the wording, not the numbers. Recomputing "did it reach its goal"
   * here from the two frozen amounts would be a second implementation of §5.1 in the
   * browser, and the day it disagreed with the service it would disagree on somebody's
   * campaign page. `UNSUCCESSFUL` is the only public state §6.1 reaches from a failed
   * deadline; everything from SUCCESSFUL onwards funded.
   */
  const funded = campaign.state !== 'UNSUCCESSFUL' && campaign.state !== 'CANCELED';

  const closed = new Date(outcome.finalisedAt);
  const closedLabel = Number.isNaN(closed.getTime())
    ? null
    : closed.toISOString().slice(0, 10);

  return (
    <section
      aria-labelledby="campaign-outcome"
      className="flex flex-col gap-3 rounded-lg border border-white/8 bg-surface-2 p-5 sm:p-6"
    >
      <h2 id="campaign-outcome" className="flex items-center gap-2 text-base font-medium text-white">
        {funded ? (
          <CircleCheck aria-hidden="true" className="size-5 text-success" />
        ) : (
          <CircleSlash aria-hidden="true" className="size-5 text-white/64" />
        )}
        {funded ? t('funded') : t('notFunded')}
      </h2>

      <p className="text-sm text-reading">
        {outcome.pledged === null || outcome.goal === null ? (
          funded ? (
            t('reached')
          ) : (
            t('notReached')
          )
        ) : (
          <>{t('raised')}<strong className="font-medium text-white">{formatMoney(outcome.pledged)}</strong> of a{' '}
            {formatMoney(outcome.goal)} goal from{' '}
            {outcome.backersCount === 1 ? '1 backer' : `${outcome.backersCount} backers`}
            {closedLabel === null ? '' : ` on ${closedLabel}`}.
          </>
        )}
      </p>

      <p className="text-sm text-white/64">
        {funded
          ? /*
             * §5.1's successful branch, stated plainly because it is the sentence a backer
             * most wants after the deadline. The figures above are frozen when the campaign
             * closed; a refund afterwards — an upheld dispute during the payout hold — lowers
             * the payout and never the outcome (IDN-EXT-01, §9.7), which is why the two numbers
             * on this page are allowed to differ.
             */
            t('settling')
          : /*
             * §5.1's unsuccessful branch under IDN-EXT-01 (#44): a pledge was charged when it
             * was made, so the honest sentence is that it comes back in full, not that nothing
             * was taken.
             */
            t('refunded')}
      </p>
    </section>
  );
}
