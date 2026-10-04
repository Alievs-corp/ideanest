import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * How much a surface may move, as something a component can ask.
 *
 * <h2>Every surface moves now</h2>
 *
 * The web keeps `docs/motion-system.md` §5's per-surface budget. The mobile app does not: the
 * `mobile-design` skill (§6, issue #273) gives every surface, checkout included, the same motion
 * vocabulary, under its input and performance rules. So the default is `full` and no route
 * declares a level.
 *
 * <p>The levels stay as an explicit opt-down — the kit gallery and the tests use them to pin a
 * primitive's behaviour at each level — and every primitive still asks `useMotionAllowed`, which
 * is also where Reduce Motion stops everything.
 */
export type MotionLevel = 'none' | 'minimal' | 'moderate' | 'full';

const ORDER: Record<MotionLevel, number> = {
  none: 0,
  minimal: 1,
  moderate: 2,
  full: 3,
};

const MotionBudgetContext = createContext<MotionLevel>('full');

export function MotionBudgetProvider({
  level,
  children,
}: {
  level: MotionLevel;
  children: ReactNode;
}) {
  return <MotionBudgetContext.Provider value={level}>{children}</MotionBudgetContext.Provider>;
}

export function useMotionBudget(): MotionLevel {
  return useContext(MotionBudgetContext);
}

/**
 * Whether the device has asked for less motion.
 *
 * Built on `AccessibilityInfo` rather than on Reanimated's `useReducedMotion`, for two reasons. It
 * is the platform's own answer — "Reduce Motion" on iOS, "Remove animations" on Android — rather
 * than a library's reading of it, and it is a core React Native API, which means it behaves under
 * Jest instead of needing the animation runtime that does not exist there.
 *
 * The subscription matters as much as the initial read. Somebody who turns the setting on because
 * a screen is making them ill should not have to restart the application for it to take effect.
 *
 * <h2>One subscription, however many components ask</h2>
 *
 * Every `Pill` and every `FadeUp` asks, so a per-component subscription was fifty platform
 * listeners and fifty asynchronous reads on a screen of fifty cards — and each new card started
 * from "not reduced" until its own read came back. The answer lives in one module-level store
 * instead: the first subscriber opens the platform listener and reads the setting, later ones get
 * the value already known, and the listener closes when the last one leaves.
 */
let reducedNow = false;
const listeners = new Set<() => void>();
let platform: { remove: () => void } | null = null;

function publish(value: boolean): void {
  if (value === reducedNow) return;
  reducedNow = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (platform === null) {
    platform = AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
    void AccessibilityInfo.isReduceMotionEnabled().then(publish);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && platform !== null) {
      platform.remove();
      platform = null;
    }
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reducedNow);
}

/**
 * Whether motion that needs at least `level` may run here: the surface's budget allows it AND the
 * device has not asked for less. Every animated primitive in the kit asks this one question, so
 * the two answers can never be combined differently in two places.
 *
 * <p>With Reduce Motion on, the answer is no at every level. §9.1: the setting is a request to
 * stop moving things, not to move them faster.
 */
export function useMotionAllowed(level: Exclude<MotionLevel, 'none'>): boolean {
  const budget = useMotionBudget();
  const reduced = useReducedMotion();
  return !reduced && ORDER[budget] >= ORDER[level];
}
