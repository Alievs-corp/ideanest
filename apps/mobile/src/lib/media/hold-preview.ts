import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Press-and-hold video previews — the phone's answer to the web's hover preview.
 *
 * A campaign card whose campaign has a video, and a reward card with a clip, play that clip,
 * muted and looping, while a finger holds them, and stop when it lets go. ONE PLAYS AT A TIME,
 * app-wide: the newest hold takes the preview from whichever card had it, so two lists on one
 * screen (or a card left playing under a pushed screen) can never play together.
 *
 * <p>The store is module-level rather than a context because the cards that ask are anywhere —
 * Home, Discover, a profile, a campaign page — and a provider at the root would be one more
 * thing every test tree has to remember to draw.
 */

let previewing: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Make `id` the one preview playing, stopping any other. */
export function startPreview(id: string): void {
  if (previewing === id) return;
  previewing = id;
  emit();
}

/** Stop `id`'s preview; a no-op when another one has taken over since. */
export function stopPreview(id: string): void {
  if (previewing !== id) return;
  previewing = null;
  emit();
}

/** The preview playing now, if any. For tests and the odd screen that must stop it. */
export function currentPreview(): string | null {
  return previewing;
}

export interface HoldPreview {
  /** This card's clip is the one playing. */
  readonly playing: boolean;
  /** Hand to `onLongPress`: starts this card's preview. */
  readonly start: () => void;
  /** Hand to `onPressOut`: stops it when the finger lifts or the press is taken by a scroll. */
  readonly stop: () => void;
}

/**
 * One card's hold preview. `enabled` false — no clip, or Reduce Motion — makes `start` a no-op.
 * Unmounting stops the card's own preview, so a card scrolled out of a recycled list does not
 * leave a clip playing nowhere.
 */
export function useHoldPreview(id: string, enabled: boolean): HoldPreview {
  const playing = useSyncExternalStore(subscribe, () => previewing === id);
  const start = useCallback(() => {
    if (enabled) startPreview(id);
  }, [enabled, id]);
  const stop = useCallback(() => stopPreview(id), [id]);
  useEffect(() => () => stopPreview(id), [id]);
  useEffect(() => {
    if (!enabled) stopPreview(id);
  }, [enabled, id]);
  return { playing: playing && enabled, start, stop };
}
