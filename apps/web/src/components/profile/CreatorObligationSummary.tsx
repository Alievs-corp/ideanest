import { CalendarClock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { CreatorObligations } from '../../lib/obligations/api';

/**
 * §22.3's "creator's project history visible", on the profile — issues #437 and #439.
 *
 * <h2>Why this is on the profile and not only on the campaign page</h2>
 *
 * The campaign page states one campaign's obligation to the people already reading about it.
 * This states the pattern to somebody deciding whether to back a *new* campaign by the same
 * person — which is the consequence §22.3 actually names, and the whole reason #437 built a
 * clock rather than a penalty: "a creator whose last campaign went eight months without an
 * update, shown on the page where they are asking for money again".
 *
 * <h2>It says how many and nothing else</h2>
 *
 * A count and a sentence. Not a list of the late campaigns, and not the dates — those are on
 * each campaign's own page, one click away, where they sit beside the campaign they are about.
 * A profile that itemised them would be a rap sheet, which is exactly what #437 refuses: "not a
 * badge of shame — a fact, stated neutrally".
 *
 * <h2>Nothing is drawn for a creator who is up to date</h2>
 *
 * Including one who has run twelve campaigns and delivered all of them. A green panel saying
 * "no late updates" would be the platform certifying somebody, which is a claim about a
 * person's future conduct that nobody here has checked — and §22.3 asks for transparency
 * rather than endorsement. The absence of the panel is the information.
 *
 * <h2>Colour carries nothing</h2>
 *
 * CLAUDE.md: colour alone must never carry meaning. An icon and words, on the same neutral
 * surface the rest of the profile uses. Deliberately not `--lime-500`, which docs/ui-kit.md
 * §2.4 reserves for "act now" addressed to the reader — the person who has to act here is the
 * creator, who is not the one looking at this.
 *
 * <h2>Motion: none</h2>
 *
 * The profile animates nothing (see the page's own comment), and this is a statement about
 * somebody's record rather than a piece of the page's arrival.
 */

export interface CreatorObligationSummaryProps {
  readonly obligations: CreatorObligations;
  /** The creator's display name, so the sentence is about a person rather than about "this user". */
  readonly name: string;
}

export async function CreatorObligationSummary({
  obligations,
  name,
}: CreatorObligationSummaryProps) {
  const t = await getTranslations('profile.obligations');

  /*
   * Nothing for a creator with no late campaigns, and nothing for one who has never run a
   * campaign that funded. Both are the same absence to a reader, and both are the state most
   * profiles are in.
   */
  if (obligations.lapsedCount <= 0) return null;

  return (
    <section
      aria-labelledby="profile-obligations"
      className="mt-6 flex flex-col gap-2 rounded-lg border border-fg/8 bg-surface-2 p-5 sm:p-6"
    >
      <h2
        id="profile-obligations"
        className="flex items-center gap-2 text-base font-medium text-fg"
      >
        <CalendarClock aria-hidden="true" className="size-5 text-fg-64" />
        {t('heading', { count: obligations.lapsedCount })}
      </h2>

      <p className="max-w-[68ch] text-sm leading-relaxed text-reading">
        {t('body', { name, count: obligations.lapsedCount })}
      </p>

      {/*
        The rule, so the count above is readable by somebody who does not already know what the
        platform asks. Without it "two campaigns" is a number rather than a statement — and the
        second sentence is the one that keeps this a fact rather than an accusation: the
        platform mediates and does not adjudicate (§9.7).
      */}
      <p className="max-w-[68ch] text-sm leading-relaxed text-fg-64">{t('rule')}</p>
    </section>
  );
}
