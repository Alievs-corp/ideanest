'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  describeRemaining,
  isUrgent,
  remainingMs,
  splitRemaining,
  tickIntervalMs,
} from '../../lib/dashboard/clock';
import type { CampaignClockCopy } from '../../lib/i18n/dashboard-copy';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * "Time remaining" — the last quarter of §4.7's CD-01.
 *
 * <h2>It counts down against the service's clock, not the reader's</h2>
 *
 * The service sends `deadline` and `serverTime` and no `secondsRemaining`, because a
 * remainder computed there is wrong the moment it is sent. This measures the difference
 * between `serverTime` and the browser's clock once, when the response arrives, and
 * subtracts it from every tick afterwards — so a creator whose machine is forty minutes
 * fast is told the truth rather than being told it forty minutes early.
 *
 * <h2>It ticks at the resolution it displays</h2>
 *
 * Three weeks out it re-renders once a minute and shows days; in the last hour it
 * re-renders once a second and shows seconds. A component showing "27 days left" that
 * woke the main thread every second would change nothing 86,400 times a day, on a screen
 * creators leave open — and docs/motion-system.md's objection to a permanent animation is
 * about exactly that.
 *
 * <h2>Colour</h2>
 *
 * Lime is urgency and nothing else (ui-kit §2.4). Inside 48 hours the clock is a lime
 * surface with near-black text on it; outside, it is ordinary text. It is never lime
 * *text* — that measures 1.3:1. And the urgency is stated in words as well as in colour,
 * because colour alone carries nothing to a reader who cannot see it (§9.2).
 */

export interface CampaignClockProps {
  /** The campaign's deadline, or null on one that has not launched. */
  readonly deadline: string | null;
  /** Milliseconds the browser's clock is ahead of the service's. */
  readonly skewMs: number;
  /** Injected by tests so the boundaries can be asserted without waiting for them. */
  readonly nowImpl?: () => number;
  /**
   * The countdown's four sentences, resolved on the server — #79.
   *
   * The locale is not a prop beside them: this is a client component under `[locale]`, so
   * `useRouteLocale` reads the segment the router already matched, and `pluralise` needs the
   * language rather than a sentence.
   */
  readonly copy: CampaignClockCopy;
}

export function CampaignClock({ deadline, skewMs, nowImpl, copy }: CampaignClockProps) {
  const locale = useRouteLocale();
  const now = nowImpl ?? Date.now;
  const [remaining, setRemaining] = useState<number | null>(() => remainingMs(deadline, now(), skewMs));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (cancelled) return;
      const left = remainingMs(deadline, now(), skewMs);
      setRemaining(left);
      // Rescheduled from the value just computed rather than set on a fixed interval, so
      // the cadence follows the countdown across its own boundaries -- an interval fixed
      // at mount would still be ticking once a minute during the final sixty seconds.
      timer = setTimeout(tick, tickIntervalMs(left ?? 0));
    };

    tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `now` is stable in production (Date.now) and fixed per test; re-running on it would
    // restart the timer on every render of a parent that passed an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, skewMs]);

  if (remaining === null) {
    return <p className="text-sm text-white/64">{copy.none}</p>;
  }

  const parts = splitRemaining(remaining);
  const urgent = isUrgent(remaining);
  const label = describeRemaining(parts, copy, locale);

  return (
    <div
      className={
        urgent
          ? 'inline-flex items-center gap-2 rounded-[10px] bg-[--lime-500] px-3 py-2 text-[--text-on-lime]'
          : 'inline-flex items-center gap-2 text-white'
      }
    >
      <Clock className="size-4" aria-hidden />
      {/*
        aria-live is off: a countdown that announced itself every second would make the
        page unusable with a screen reader running. The value is readable on demand and is
        not an alert.
      */}
      <span className="text-sm font-medium tabular-nums" aria-live="off">
        {label}
      </span>
      {urgent ? (
        // The word, not only the colour. ui-kit §9.2.
        <span className="text-xs font-semibold uppercase tracking-[0.08em]">{copy.urgent}</span>
      ) : null}
    </div>
  );
}
