'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  countdownIntervalMs,
  countdownLabel,
  formatDay,
  formatInstant,
  remainingUntil,
  viewerTimeZone,
} from '../../lib/projects/deadline';
import type { CampaignCountdownCopy } from '../../lib/i18n/campaign-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * The two things only the reader's browser knows: what time it is now, and what zone they
 * are in. §4.4's live countdown and its "deadline in the viewer's timezone" — issue #281.
 *
 * <h2>Why this is a client boundary, and why it is only one</h2>
 *
 * The campaign page's own comment says what a boundary costs on this route and #119 is why.
 * Two facts on this page are genuinely unavailable to a server render and neither can be
 * faked:
 *
 * <ul>
 *   <li><strong>The current time.</strong> A countdown rendered once on the server is a
 *       countdown that is wrong by however long the reader has had the tab open, and the
 *       page is cached for a minute besides, so the server's answer is stale before it is
 *       sent.
 *   <li><strong>The reader's time zone.</strong> Nothing carries it. It is not in a header,
 *       and a cookie that carried it would make this page uncacheable — which is the
 *       arrangement §4.4 exists to protect.
 * </ul>
 *
 * They are <strong>one</strong> boundary rather than two because they are one question asked
 * of one object. A separate module for the date would double the props crossing the
 * server/client seam for no reduction in shipped code: a bundler puts both in the same chunk
 * either way.
 *
 * <h2>Both components render the server's answer first, then correct it</h2>
 *
 * Every value below is passed in already formatted by the server and held as the initial
 * state. That is what makes the markup identical on both sides of hydration; computing the
 * first value in the browser instead would produce a countdown a minute out from the HTML it
 * is replacing, which React reports as a mismatch and repairs by throwing the server's
 * render away.
 *
 * It is also what makes the page work with no JavaScript at all: the countdown reads the
 * value the server computed and the deadline reads as a UTC instant. Neither is a spinner,
 * and neither is empty.
 *
 * <h2>The countdown does not shout</h2>
 *
 * `role="timer"` — whose implicit `aria-live` is `off`, restated here explicitly because
 * "restated" is cheaper than "assumed" — so a screen reader announces the value when the
 * reader arrives at it and never again. A `role="status"` or an `aria-live="polite"` region
 * here would interrupt whatever is being read, once a minute, for the whole time the page is
 * open, to say a number that has changed by one.
 *
 * The accessible name carries the whole sentence, because "2 days, 4 hours" announced on its
 * own is a quantity of nothing.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §6 puts countdowns under "a number that changes, not a number
 * that animates", and §5 gives this page a moderate budget that this component spends none
 * of. Nothing here imports `@ideanest/ui/motion`.
 */

export interface CampaignCountdownProps {
  /** Resolved by `CampaignSummary`, which is a Server Component. */
  readonly copy: CampaignCountdownCopy;
  /** The campaign's deadline, ISO-8601. */
  readonly deadline: string;
  /**
   * The countdown as the server computed it at render time.
   *
   * Passed rather than derived so the first client render matches the HTML byte for byte —
   * see the class comment. `null` when the deadline has already passed, in which case this
   * component renders nothing and the page's outcome notice does the talking.
   */
  readonly initialLabel: string | null;
}

export function CampaignCountdown({ copy, deadline, initialLabel }: CampaignCountdownProps) {
  const [label, setLabel] = useState<string | null>(initialLabel);

  useEffect(() => {
    /*
     * The interval is re-established on every tick rather than set once, because the right
     * period changes: a minute while the label's smallest unit is a minute, a second once it
     * carries seconds. `setInterval` at one second for a fortnight would be eighty-six
     * thousand renders a day to change a number eighty-six thousand times less often.
     */
    let timer: ReturnType<typeof setTimeout>;

    function tick(): void {
      const remaining = remainingUntil(deadline, new Date());
      if (remaining === null) return;

      /*
       * The formatted string is what goes into state, not the object. React bails out of a
       * re-render when the next state is identical, so a tick that produces the same words
       * costs nothing — which is what makes a one-second interval safe in the final hour and
       * free everywhere above it.
       */
      setLabel(countdownLabel(remaining));
      if (remaining.past) return;

      timer = setTimeout(tick, countdownIntervalMs(remaining));
    }

    const initial = remainingUntil(deadline, new Date());
    if (initial === null || initial.past) return;
    timer = setTimeout(tick, countdownIntervalMs(initial));

    return () => clearTimeout(timer);
  }, [deadline]);

  if (label === null) return null;

  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={fillPlaceholders(copy.label, { time: label })}
      className="inline-flex items-center gap-1.5 text-sm text-white/64 tabular-nums"
    >
      <Clock aria-hidden="true" className="size-3.5" />
      <span aria-hidden="true">{fillPlaceholders(copy.left, { time: label })}</span>
    </span>
  );
}

export interface ViewerInstantProps {
  /** The instant, ISO-8601. Also the machine-readable value of the `<time>` element. */
  readonly instant: string;
  /**
   * The instant as the server formatted it, in UTC and labelled as such.
   *
   * What a reader with no JavaScript sees, what a crawler indexes, and what the client render
   * starts from before it substitutes the reader's own zone.
   */
  readonly serverText: string;
  /** `instant` prints the time as well as the date; `day` prints only the date. */
  readonly precision?: 'instant' | 'day';
}

/**
 * An instant, rewritten in the reader's own time zone once there is a browser to ask.
 *
 * <strong>Always a `<time datetime>`.</strong> Whatever words are shown, the machine-readable
 * attribute is the unambiguous instant the service sent — which is what a crawler, a
 * translation tool and a "add to calendar" extension read, and what makes the localised text
 * a presentation rather than the only copy of the fact.
 */
export function ViewerInstant({ instant, serverText, precision = 'instant' }: ViewerInstantProps) {
  const [text, setText] = useState(serverText);
  /*
   * The same language the server rendered `serverText` in — both read the `[locale]` segment,
   * so the substitution below changes the zone and nothing else. That is the whole invariant
   * this component rests on, and #324 is when the locale stopped being a constant that
   * guaranteed it for free.
   */
  const locale = useRouteLocale();

  useEffect(() => {
    const zone = viewerTimeZone();
    const formatted =
      precision === 'day' ? formatDay(instant, zone, locale) : formatInstant(instant, zone, locale);
    /*
     * `null` means the runtime refused the zone or the instant — a browser can report a zone
     * name a given ICU build does not know. The server's UTC rendering stays, which is
     * correct rather than merely present.
     */
    if (formatted !== null) setText(formatted);
  }, [instant, precision, locale]);

  return <time dateTime={instant}>{text}</time>;
}
