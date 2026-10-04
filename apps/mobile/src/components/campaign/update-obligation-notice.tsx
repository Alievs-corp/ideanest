import { Glyphs } from '../../icons';
import type { UpdateObligation } from '@ideanest/campaign/obligation';
import { formatDay, useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { NoticeCard, NoticeText } from './notice-card';

/**
 * Block 10 — the web's `UpdateObligationNotice` (#155): §5.5's monthly update, stated as a fact.
 *
 * <p>Drawn only for `NEVER_UPDATED`, `LAPSED` and `COMPLETE`. A creator who is up to date gets
 * nothing, and one whose month is nearly up (`DUE_SOON`) gets nothing either — that is between the
 * platform and the creator, and publishing it would turn a reminder into a countdown to somebody's
 * failure. A notice that only ever appeared when something was wrong would be a badge by its
 * presence, which is why "fulfilment is finished" is said too.
 *
 * <p>The dates are **UTC days**, as the web prints them: "last posted on 14 March" is a day, and a
 * zone boundary would change it at most by one. Neutral colours throughout (`NoticeCard`) — not
 * lime (the person who has to act is the creator, who is not reading this) and not success
 * (nobody here has checked that rewards arrived).
 */
export function UpdateObligationNotice({ obligation }: { readonly obligation: UpdateObligation }) {
  const t = useT('campaign.obligation');
  const locale = useLocale();

  if (obligation.state === 'CURRENT' || obligation.state === 'DUE_SOON') return null;

  const due = formatDay(obligation.dueAt, locale, 'UTC');
  // An unreadable due date draws nothing rather than "late by Invalid Date".
  if (due === null) return null;
  const lastUpdate = formatDay(obligation.lastUpdateAt, locale, 'UTC');
  const complete = obligation.state === 'COMPLETE';

  return (
    <NoticeCard
      icon={complete ? Glyphs.TickCircle : Glyphs.Calendar}
      title={complete ? t('completeHeading') : t('lateHeading')}
      testID="obligation-notice"
    >
      <NoticeText kind="reading">
        {complete
          ? t('completeBody')
          : obligation.state === 'NEVER_UPDATED' || lastUpdate === null
            ? t('neverUpdatedBody', { due })
            : t('lateBody', { lastUpdate, due })}
      </NoticeText>
      <NoticeText kind="aside">{t('rule')}</NoticeText>
    </NoticeCard>
  );
}
