export interface ReservationClock {
  readonly remainingMs: number;
  readonly expired: boolean;
  readonly label: string;
}

export function reservationLabel(remainingMs: number): string {
  const total = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function reservationClockAt(expiresAt: string | null | undefined, now: number): ReservationClock {
  const deadline = expiresAt == null ? Number.NaN : Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return { remainingMs: 0, expired: false, label: '' };
  const remainingMs = Math.max(0, deadline - now);
  return { remainingMs, expired: remainingMs === 0, label: reservationLabel(remainingMs) };
}
