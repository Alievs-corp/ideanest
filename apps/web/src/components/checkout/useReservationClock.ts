'use client';

import { useEffect, useState } from 'react';
import { reservationLabel } from '@ideanest/checkout/reservation';

/**
 * How long the stock is held for — PL-13's five minutes, counted down.
 *
 * <h2>It does not animate, and that is a rule rather than a preference</h2>
 *
 * `docs/motion-system.md` §6 is explicit: "The countdown must not animate. The
 * number simply changes." A per-second animation means the page never settles and
 * the battery never rests, and checkout's budget (§5) is "near zero" before any
 * of that is considered. So this is a `setInterval` that writes a number, and the
 * component that renders it applies no transition to it.
 *
 * <h2>The ticking value is not announced</h2>
 *
 * The label is ordinary text, deliberately outside any live region. A polite
 * region that updated every second would talk over everything else on the page,
 * and an assertive one would make the screen unusable. A screen-reader user reads
 * the remaining time when they reach it, exactly as a sighted user reads it when
 * they look at it; what IS announced is the expiry, once, by the alert that
 * replaces it — the same division `CharacterCount` makes in docs/ui-kit.md §7.13.
 */

export interface ReservationClock {
  /** Milliseconds left, floored at zero. Zero when there is no reservation. */
  readonly remainingMs: number;
  /** True once a reservation that existed has run out. Never true without one. */
  readonly expired: boolean;
  /** `m:ss`, or an empty string when there is nothing to count. */
  readonly label: string;
}

export function useReservationClock(expiresAt: string | null | undefined): ReservationClock {
  /*
   * `Date.parse` rather than a `Date` object in state: the deadline is a fixed
   * instant and re-parsing it on every tick would be work per second for a value
   * that cannot change. NaN — a malformed timestamp — is treated as "no
   * reservation" rather than as "expired", because showing somebody an expiry
   * that has not happened costs them a reservation that is still good.
   */
  const deadline = expiresAt == null ? null : Date.parse(expiresAt);
  const valid = deadline !== null && Number.isFinite(deadline);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return;

    // Re-read immediately: the effect may be running after a tab was in the
    // background, where timers are throttled and the last value written is old.
    setNow(Date.now());

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [valid, deadline]);

  if (!valid || deadline === null) {
    return { remainingMs: 0, expired: false, label: '' };
  }

  const remainingMs = Math.max(0, deadline - now);
  return { remainingMs, expired: remainingMs === 0, label: reservationLabel(remainingMs) };
}
