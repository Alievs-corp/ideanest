import { CalendarClock, CircleCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { formatInstant, SERVER_TIME_ZONE } from '../../lib/projects/deadline';
import { localeOrDefault } from '../../lib/i18n/locale';
import type { UpdateObligation } from '../../lib/obligations/api';

/**
 * §5.5's monthly update, stated on the campaign page — issue #437, surfaced by #439.
 *
 * <h2>A fact, not a verdict</h2>
 *
 * §22.3 asks for "the creator's project history visible", and #437 is explicit about what that
 * has to look like: "not a badge of shame — a fact, stated neutrally, with the date of the last
 * update". So this says when the creator last posted and when the next update was due, and it
 * says nothing about what that means about them. A reader draws the conclusion; the platform
 * supplies the dates.
 *
 * It also never appears alone as an accusation. A creator who is up to date gets nothing at
 * all, and one who has finished fulfilling gets a sentence saying so — because a panel that
 * only ever appeared when something was wrong would be a badge by its presence, whatever the
 * words in it said.
 *
 * <h2>Colour carries nothing, and it is deliberately not lime</h2>
 *
 * CLAUDE.md: colour alone must never carry meaning. The state is in the words and in the icon,
 * and the panel is the same neutral surface `CampaignTrustBlock` uses in every state.
 *
 * <strong>`--lime-500` in particular is wrong here</strong>, and not merely unnecessary.
 * docs/ui-kit.md §2.4 gives lime one meaning — "act now" — addressed to the person reading the
 * page. The person who has to act on a late update is the creator, who is not reading this; to
 * a backer, lime would read as a call to do something about a situation the platform has just
 * told them it only mediates.
 *
 * `--success` is equally wrong for the completed state, for the mirror of the same reason: it
 * would read as the platform certifying that the rewards arrived, which is a claim about
 * somebody else's delivery that nobody here has checked. The completed sentence is the same
 * neutral panel with a different icon and different words.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 — motion decreases as money gets closer. This sits beside the trust
 * block on the page where somebody is deciding whether to pledge, and a panel about whether a
 * creator keeps their promises, fading in, reads as hesitation about the answer.
 *
 * <h2>The date is UTC on the server and the reader's zone after hydration is deliberately not
 * done</h2>
 *
 * Unlike the deadline, which `ViewerInstant` re-renders in the reader's own zone. A deadline is
 * a moment somebody has to act before, so an hour matters; this is "last posted on 14 March",
 * where a zone boundary changes the day at most and the cost of getting it is a client island
 * on a page whose largest contentful paint is the subject of #119.
 */

export interface UpdateObligationNoticeProps {
  readonly obligation: UpdateObligation;
}

export async function UpdateObligationNotice({ obligation }: UpdateObligationNoticeProps) {
  const locale = localeOrDefault(await getLocale());
  const t = await getTranslations('campaign.obligation');

  /*
   * Nothing at all for a creator who is up to date, and nothing for one whose month is merely
   * nearly up. `DUE_SOON` is between the platform and the creator — they have been emailed —
   * and publishing "this creator has six days left" to their backers would turn a reminder into
   * a countdown to somebody's failure, which is the tone #437 refuses.
   */
  if (obligation.state === 'CURRENT' || obligation.state === 'DUE_SOON') {
    return null;
  }

  const lastUpdate =
    obligation.lastUpdateAt === null
      ? null
      : formatInstant(obligation.lastUpdateAt, SERVER_TIME_ZONE, locale);
  const due = formatInstant(obligation.dueAt, SERVER_TIME_ZONE, locale);

  /*
   * An unreadable due date draws nothing. `formatInstant` answers `null` for an instant it
   * cannot parse, and every sentence below names a date — so the alternative is a panel saying
   * a creator is late "by Invalid Date", which is worse than saying nothing about a fact the
   * reader can also see in the updates tab.
   */
  if (due === null) return null;

  const complete = obligation.state === 'COMPLETE';

  return (
    <section
      aria-labelledby="campaign-obligation"
      className="mt-6 flex flex-col gap-2 rounded-lg border border-fg/8 bg-surface-2 p-5 sm:p-6"
    >
      <h2
        id="campaign-obligation"
        className="flex items-center gap-2 text-base font-medium text-fg"
      >
        {/*
          The icon is `--text-secondary` and carries no meaning colour has to decode
          (docs/ui-kit.md §9.2). It differs between the two states so that the heading is not
          the only thing distinguishing them for a reader scanning the page.
        */}
        {complete ? (
          <CircleCheck aria-hidden="true" className="size-5 text-fg-64" />
        ) : (
          <CalendarClock aria-hidden="true" className="size-5 text-fg-64" />
        )}
        {complete ? t('completeHeading') : t('lateHeading')}
      </h2>

      <p className="max-w-[68ch] text-sm leading-relaxed text-reading">
        {complete
          ? t('completeBody')
          : obligation.state === 'NEVER_UPDATED'
            ? t('neverUpdatedBody', { due })
            : /*
               * `LAPSED` means there *was* an earlier update, so `lastUpdateAt` is set — but a
               * date the formatter refused would leave a sentence with a hole in it, and the
               * honest fallback is the sentence that names no earlier update at all.
               */
              lastUpdate === null
              ? t('neverUpdatedBody', { due })
              : t('lateBody', { lastUpdate, due })}
      </p>

      {/*
        The rule itself, so the fact above is readable by somebody who does not already know
        what the platform asks of a creator. Without it "the last update was in March" is a
        date rather than a statement.
      */}
      <p className="max-w-[68ch] text-sm leading-relaxed text-fg-64">{t('rule')}</p>
    </section>
  );
}
