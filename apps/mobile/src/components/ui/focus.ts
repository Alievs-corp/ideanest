import { useState } from 'react';
import type { NativeSyntheticEvent, TargetedEvent, ViewStyle } from 'react-native';
import { focusRingColor, useSurface } from './surface';

/**
 * A visible focus ring, drawn from state — CLAUDE.md §2: "focus must be visible on every
 * interactive element, including on lime".
 *
 * <p>React Native has no `:focus-visible`. A hardware keyboard, a switch-control user and an
 * Android TV remote all move focus between controls, and without this nothing on the screen says
 * where it is. So each interactive primitive tracks focus itself and draws the web's ring: 2pt,
 * offset 2pt, lime on a dark surface and near-black on lime or white (`focusRingColor`).
 *
 * <p>`outline*` rather than a border, for the web's reason: an outline takes no layout space, so
 * gaining focus does not shift the control by two points.
 */
export function useFocusRing(): {
  readonly ring: ViewStyle | undefined;
  readonly onFocus: (event: NativeSyntheticEvent<TargetedEvent>) => void;
  readonly onBlur: (event: NativeSyntheticEvent<TargetedEvent>) => void;
} {
  const surface = useSurface();
  const [focused, setFocused] = useState(false);

  return {
    ring: focused
      ? {
          outlineWidth: 2,
          outlineOffset: 2,
          outlineStyle: 'solid',
          outlineColor: focusRingColor(surface),
        }
      : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
