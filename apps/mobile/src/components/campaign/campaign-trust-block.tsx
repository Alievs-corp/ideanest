import type { ReactNode } from 'react';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import type { ProjectState } from '@ideanest/campaign/states';
import { successThresholdOf } from '@ideanest/campaign/threshold';
import type { CampaignPage } from '../../lib/campaign-page';
import { formatInstant, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { NoticeCard, NoticeStrong, NoticeText } from './notice-card';

/**
 * Block 9 — the web's `CampaignTrustBlock` (#155): the platform's rule in fixed copy, then what
 * the rule means for this campaign.
 *
 * <p>The fixed paragraph is `campaign.trust.body` on every campaign, closed ones included — a
 * reader of a campaign that failed a year ago is entitled to the rule that decided its refunds.
 *
 * <p>The second sentence names the amount — 80% of the goal, rounded **up** to the cent by the
 * shared `successThresholdOf`, `decimal.js` only — and the deadline **in the device's time zone,
 * with the zone named** (`formatInstant`). Open campaigns are told in the future tense, closed
 * ones in the past; a campaign with no deadline gets the fixed paragraph alone rather than an
 * invented date.
 *
 * <p>A neutral raised block (`NoticeCard`, the first block of the page's white sheet): not lime
 * (it is the opposite of urgency) and not success (that would read as the platform vouching for
 * this campaign).
 */

/** The states whose outcome is still ahead — decided by the state, never by the clock. */
const OPEN_STATES: readonly ProjectState[] = ['PRELAUNCH', 'LIVE', 'CLOSING_WINDOW', 'EXTENDED'];

export function CampaignTrustBlock({ campaign }: { readonly campaign: CampaignPage }) {
  const t = useT('campaign.trust');
  const locale = useLocale();
  const open = OPEN_STATES.includes(campaign.state);
  const deadline = formatInstant(campaign.deadline, locale);

  const strong = (chunks: ReactNode) => <NoticeStrong>{chunks}</NoticeStrong>;
  const when = () => <NoticeStrong>{deadline}</NoticeStrong>;

  let sentence: ReactNode = null;
  if (deadline !== null) {
    sentence = !open
      ? t.rich('closed', { deadline: when })
      : campaign.goal === null
        ? t.rich('openNoGoal', { deadline: when })
        : t.rich('open', {
            deadline: when,
            b: strong,
            threshold: formatMoney(successThresholdOf(campaign.goal)),
            goal: formatMoney(campaign.goal),
          });
  }

  return (
    <NoticeCard icon={Glyphs.ShieldTick} title={t('heading')} testID="trust-block">
      <NoticeText kind="reading">{t('body')}</NoticeText>
      {sentence === null ? null : (
        <NoticeText kind="aside" testID="trust-sentence">
          {sentence}
        </NoticeText>
      )}
    </NoticeCard>
  );
}
