import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * How much a surface may move — `docs/motion-system.md` §5, as something a component can ask.
 *
 * <h2>Why a budget and not a per-component switch</h2>
 *
 * §5's rule is about the surface, not the element: "when the user is spending money or doing
 * work, motion decreases". A `Pill` does not know whether it is on the home screen or on the
 * last step of a pledge, and it should not have to. The route declares its level once, and every
 * animated primitive underneath — `FadeUp`, the pill's press scale, a dialog's entry, the
 * skeleton crossfade — asks whether its kind of motion fits.
 *
 * <p>The levels, from §5's table:
 *
 * <ul>
 *   <li>`full` — home.</li>
 *   <li>`moderate` — the project page.</li>
 *   <li>`minimal` — discovery, search, the creator dashboard. The skeleton crossfade and one
 *       heading fade survive; §5.1 lists exactly what else does not.</li>
 *   <li>`none` — checkout, the campaign editor, authentication and settings. Nothing moves.</li>
 * </ul>
 *
 * <p>A screen that declares nothing gets `minimal`, not `full`. The direction of the default is
 * the direction of the rule: a screen somebody forgot to classify should move too little rather
 * than too much, and a missing declaration on the checkout route must not be what animates it.
 */
export type MotionLevel = 'none' | 'minimal' | 'moderate' | 'full';

const ORDER: Record<MotionLevel, number> = {
  none: 0,
  minimal: 1,
  moderate: 2,
  full: 3,
};

const MotionBudgetContext = createContext<MotionLevel>('minimal');

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
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let current = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (current) setReduced(value);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  return reduced;
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
