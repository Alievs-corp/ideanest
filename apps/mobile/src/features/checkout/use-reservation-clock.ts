import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { reservationClockAt, type ReservationClock } from '@ideanest/checkout/reservation';

/** Ticks once a second and recomputes on resume: the interval sleeps in the background, the hold does not. */
export function useReservationClock(expiresAt: string | null | undefined): ReservationClock {
  const [now, setNow] = useState(() => Date.now());
  const counting = expiresAt != null;

  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [counting, expiresAt]);

  return reservationClockAt(expiresAt, now);
}
