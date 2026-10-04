import type { ReactNode } from 'react';
import { Glyphs } from '../../icons';
import { formatMoney } from '@ideanest/money';
import type { CampaignPage } from '../../lib/campaign-page';
import { formatDay, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors } from '../../theme';
import { NoticeCard, NoticeStrong, NoticeText } from './notice-card';

/**
 * The Campaign tab's first block — the web's `CampaignOutcomeNotice` (#155): how a closed campaign
 * ended, from the figures the service froze when it closed.
 *
 * <p>Funded is every state but UNSUCCESSFUL and CANCELED — read from the state, never recomputed
 * from the figures, so the page cannot disagree with the service about somebody's refund. Funded
 * takes `success` on its icon (with the words beside it); not funded is a neutral `Slash`.
 *
 * <p>"It raised **X** of a Y goal from N backers on {date}" is the catalogue's sentence, with the
 * backers declined by ICU and the day the campaign closed as a UTC day, as the web prints it.
 * Without the figures it says only whether 80% was reached.
 */
export function CampaignOutcomeNotice({ campaign }: { readonly campaign: CampaignPage }) {
  const t = useT('campaign.outcome');
  const locale = useLocale();
  const { outcome } = campaign;
  if (outcome === null) return null;

  const funded = campaign.state !== 'UNSUCCESSFUL' && campaign.state !== 'CANCELED';
  const closedOn = formatDay(outcome.finalisedAt, locale, 'UTC');
  const strong = (chunks: ReactNode) => <NoticeStrong>{chunks}</NoticeStrong>;

  return (
    <NoticeCard
      icon={funded ? Glyphs.TickCircle : Glyphs.Slash}
      iconColor={funded ? colors.success : undefined}
      title={funded ? t('funded') : t('notFunded')}
      testID="outcome-notice"
    >
      <NoticeText kind="reading">
        {outcome.pledged === null || outcome.goal === null
          ? funded
            ? t('reached')
            : t('notReached')
          : t.rich(closedOn === null ? 'summaryUndated' : 'summary', {
              b: strong,
              pledged: formatMoney(outcome.pledged),
              goal: formatMoney(outcome.goal),
              backers: outcome.backersCount,
              date: closedOn ?? '',
            })}
      </NoticeText>
      <NoticeText kind="aside">{funded ? t('settling') : t('refunded')}</NoticeText>
    </NoticeCard>
  );
}
