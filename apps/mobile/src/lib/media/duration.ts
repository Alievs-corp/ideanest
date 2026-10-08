/**
 * A clip's length for people (#331): whole seconds, and the `m:ss` a player shows.
 *
 * The service measures `durationMs` on the transcoded file; a 59.6-second clip is "1:00" on every
 * player a viewer has used, so it is rounded rather than floored. Never below zero, and nothing
 * that is not a finite number becomes a length.
 */
export function wholeSeconds(durationMs: number): number {
  return Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs / 1000)) : 0;
}

/** `m:ss` — "0:07", "0:45", "1:00". Digits only, so it needs no translation. */
export function clockDuration(durationMs: number): string {
  const total = wholeSeconds(durationMs);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
