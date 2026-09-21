'use client';

import Decimal from 'decimal.js';
import { Users } from 'lucide-react';
import { useMemo } from 'react';
import { ProgressBar, StatBlock } from '@ideanest/ui/server';
import type { Money } from '../../lib/money';
import { formatMoney } from '../../lib/money';
import { completionOf } from '../../lib/projects/completion';
import type { LiveFundingCopy } from '../../lib/i18n/campaign-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralForm } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { counterChannel, realtimeUrl, addToTotal } from '../../lib/realtime/updates';
import { useCampaignUpdates } from '../../lib/realtime/useCampaignUpdates';

/**
 * The campaign's funding numbers, as the server rendered them, plus whatever has happened since.
 *
 * <h2>The one client component beneath the public campaign page, and what that costs</h2>
 *
 * That page's own comment says there is no `'use client'` anywhere beneath it, "because there is
 * nothing to load". This is still true of the *content*: every number below is in the initial
 * HTML, rendered from the server's read, and a reader with no JavaScript, a crawler and a link
 * unfurler all see the complete document. What hydration adds is arithmetic on top of it.
 *
 * That distinction is the whole justification for the island. A client component that *fetched*
 * these numbers would break #119; one that starts from them and adds to them does not.
 *
 * <h2>Deltas, never totals</h2>
 *
 * The socket carries "40.50 arrived since I last spoke", not "the campaign has raised 5,040.50" —
 * `ChannelWindow` argues why the server cannot say the second without reading another module's
 * table, and why the first is the better shape anyway. So the total here is the server's value
 * plus every delta received, which means a reader who missed a window is *behind* rather than
 * wrong, and a reload corrects them.
 *
 * <h2>`Decimal`, and the percentage recomputed rather than carried</h2>
 *
 * CLAUDE.md §3: money never touches floating point, and this is the one place on the platform
 * where an amount is accumulated repeatedly in a browser. The percentage is recomputed from the
 * new total with `completionOf` — the same function the server-side read uses — because a
 * percentage frozen at the server's value while the amount beside it moved would be two numbers
 * disagreeing on one page.
 *
 * <h2>What it may import, and why that is a rule rather than a preference</h2>
 *
 * <p>A client component pulls its whole import graph into the browser bundle. The two imports
 * that matter here both looked harmless and both cost tens of kilobytes on the platform's most
 * performance-sensitive route: {@code @ideanest/ui}'s barrel, whose lean half is
 * {@code @ideanest/ui/server} and which is the entry to use even from a client component; and
 * {@code lib/projects/publicPage}, which reasonably imports every reader the campaign page
 * needs. {@code lib/projects/completion} exists because of the second one.
 *
 * <h2>Its words are a prop, and the count is declined rather than switched</h2>
 *
 * <p>Four expressions were typed here in English until #99 — the bar's accessible name and
 * the three labels under the figures — on a page every other component of which reads the
 * catalogue. A reader who chose Azerbaijani met a translated campaign whose funding block
 * said "pledged" and "backers", and `apps/web/README.md` claimed the opposite. They arrive
 * as a prop for the reason `lib/i18n/campaign-copy.ts` sets out: there is no
 * `NextIntlClientProvider` on this platform, so a client component is handed its words by
 * whichever server component mounted it.
 *
 * <p><strong>The backer count picks a form rather than a plural.</strong> The ternary that
 * stood here chose between "backer" and "backers", which is the whole of English and none of
 * Russian — 1 бэкер, 2 бэкера, 5 бэкеров. `pluralForm` asks `Intl.PluralRules` instead, and
 * `lib/i18n/plurals.ts` explains why the browser decides this one and the server decides
 * nearly every other counted sentence on the platform.
 *
 * <p><strong>The backer count is deliberately not live.</strong> A window carries how many
 * pledges were confirmed, and a pledge is not always a new backer: somebody who raises their
 * pledge confirms again. Adding it would make the count drift upwards over a campaign's life
 * with no way to correct itself, which is worse than a count that is right at page load.
 */

export interface LiveFundingProps {
  readonly projectId: string;
  readonly goal: Money | null;
  readonly pledged: Money;
  readonly backersCount: number;
  /**
   * Where a socket may be opened, from `IDEANEST_REALTIME_ORIGIN`.
   *
   * Passed in rather than read here, so that this component is testable without a build-time
   * variable and so the page decides once. Undefined — the default — means no socket.
   */
  readonly realtimeOrigin: string | undefined;
  /** Resolved by `CampaignSummary`, which is a Server Component. */
  readonly copy: LiveFundingCopy;
}

export function LiveFunding({
  projectId,
  goal,
  pledged,
  backersCount,
  realtimeOrigin,
  copy,
}: LiveFundingProps) {
  /*
   * The language itself rather than a sentence, because `pluralForm` needs `Intl.PluralRules`
   * and the count it declines against is the one number on this block the server did not send
   * a word for. `useRouteLocale` reads the `[locale]` segment the router already matched.
   */
  const locale = useRouteLocale();
  const url = useMemo(
    () => realtimeUrl(realtimeOrigin, counterChannel(projectId)),
    [realtimeOrigin, projectId],
  );
  const { updates } = useCampaignUpdates(url);

  /*
   * Folded from the server's value on every render rather than kept in state. The list of
   * updates is the state; the total is derived from it, so a re-render can never produce a
   * different number from the same messages — which is the bug a `useState` total accumulated
   * inside an effect would have the first time React ran that effect twice.
   */
  const total = useMemo(
    () => updates.reduce((running, update) => addToTotal(running, update.amount), pledged),
    [updates, pledged],
  );

  const completion = completionOf(total, goal);
  const funded = completion !== null && completion.greaterThanOrEqualTo(new Decimal(100));

  if (goal === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <ProgressBar
        value={completion === null ? 0 : completion.toNumber()}
        size="md"
        /*
         * The only place the percentage becomes a JavaScript number, and it is a geometry
         * rather than an amount: the width of a track in pixels. Everything a reader is told is
         * rendered from the Decimal.
         */
        label={fillPlaceholders(copy.progressLabel, {
          percent: completion === null ? '0' : completion.toFixed(0),
        })}
      />

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <StatBlock size="md" value={formatMoney(total)} label={copy.pledged} />
        {completion !== null && (
          <StatBlock
            size="md"
            /*
             * Text as well as a bar, ui-kit §8.2. `--success` once the goal is reached and
             * never lime: reaching a goal is an achievement, and lime on this platform means
             * "act now".
             */
            value={<span className={funded ? 'text-success' : undefined}>{completion.toFixed(0)}%</span>}
            label={funded ? copy.funded : copy.ofGoal}
          />
        )}
        <StatBlock
          size="md"
          value={
            <span className="inline-flex items-center gap-2">
              <Users aria-hidden="true" className="size-5 text-white/48" />
              {backersCount}
            </span>
          }
          label={pluralForm(locale, copy.backers, backersCount)}
        />
      </div>
    </div>
  );
}
