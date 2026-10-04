import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { Tabs } from 'expo-router';
import { Glyphs, type IconGlyph } from '../icons';
import { colors, motion, radius, size, spacing, spring } from '../theme';
import { useFocusRing } from './ui/focus';
import { haptics } from './ui/haptics';
import { Icon } from './ui/icon';
import { useMotionAllowed } from './ui/motion-budget';
import { AnimatedPressable, usePressScale } from './ui/press-scale';

/**
 * The floating tab bar — issue #276, `mobile-design` skill §3.
 *
 * A pill over the content, `spacing[4]` in from the edges and lifted above the bottom safe area:
 * Home · Search · [ + ] · Pledges · Me. The centre is the Create button, not a tab — it has its
 * own name, no selected state and a haptic. Anything that does not fit five slots lives in the Me
 * hub; a sixth slot or a "More" tab is never the answer.
 *
 * The active tab is one white capsule that springs between the measured slots (`spring.snappy`)
 * while the glyph crossfades Linear → Bold: a change of shape and fill, never colour alone.
 *
 * Every tab screen pads its content with {@link useTabBarInset}, so the last row scrolls clear of
 * the bar and the home indicator. Stack routes cover the tab group, so the bar is never drawn over
 * them; on Android it also steps away while the keyboard is up, because the resized window would
 * otherwise carry it up onto the keyboard.
 */

export type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export const TAB_BAR_HEIGHT = 64;
const CREATE_DIAMETER = 56;
const CAPSULE_WIDTH = 56;
const CAPSULE_HEIGHT = 48;
const TAB_GLYPH = 24;

/** Where the bar's bottom edge sits: above the inset, and never flush with a zero one. */
export function tabBarOffset(bottomInset: number): number {
  return Math.max(bottomInset + spacing[2], spacing[3]);
}

/** The space a tab screen leaves under its content: the bar, its lift, and a gutter. */
export function tabBarFootprint(bottomInset: number): number {
  return tabBarOffset(bottomInset) + TAB_BAR_HEIGHT + spacing[4];
}

const TabBarInsetContext = createContext(0);

/** Publishes the bar's footprint to the tab screens. Outside it, the inset is zero. */
export function TabBarInsetProvider({ children }: { readonly children: ReactNode }) {
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <TabBarInsetContext.Provider value={tabBarFootprint(insets?.bottom ?? 0)}>
      {children}
    </TabBarInsetContext.Provider>
  );
}

/** The bottom padding a tab screen's scrolling content takes. Zero on a stack route. */
export function useTabBarInset(): number {
  return useContext(TabBarInsetContext);
}

export interface FloatingTabBarProps extends TabBarProps {
  /** The glyph for each tab, by route name. A route without one is not drawn. */
  readonly glyphs: Readonly<Record<string, IconGlyph>>;
  /** The Create button's accessible name. */
  readonly createLabel: string;
  readonly onCreate: () => void;
}

interface Slot {
  readonly x: number;
  readonly width: number;
}

export function FloatingTabBar({
  state,
  descriptors,
  navigation,
  insets,
  glyphs,
  createLabel,
  onCreate,
}: FloatingTabBarProps) {
  const moves = useMotionAllowed('minimal');
  const keyboard = useAndroidKeyboard();
  const routes = state.routes.filter((route) => glyphs[route.name] !== undefined);
  const half = Math.ceil(routes.length / 2);
  const focusedKey = state.routes[state.index]?.key;

  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const capsuleX = useSharedValue(0);
  const capsuleShown = useSharedValue(0);
  const target = focusedKey === undefined ? undefined : slots[focusedKey];

  useEffect(() => {
    if (target === undefined) {
      capsuleShown.value = 0;
      return;
    }
    const x = target.x + (target.width - CAPSULE_WIDTH) / 2;
    capsuleX.value = moves && capsuleShown.value === 1 ? withSpring(x, spring.snappy) : x;
    capsuleShown.value = 1;
  }, [target, moves, capsuleX, capsuleShown]);

  const capsuleStyle = useAnimatedStyle(() => ({
    opacity: capsuleShown.value,
    transform: [{ translateX: capsuleX.value }],
  }));

  const hidden = useSharedValue(0);
  useEffect(() => {
    hidden.value = moves ? withTiming(keyboard ? 1 : 0, { duration: motion.fast }) : keyboard ? 1 : 0;
  }, [keyboard, moves, hidden]);
  const barStyle = useAnimatedStyle(() => ({
    opacity: 1 - hidden.value,
    transform: [{ translateY: hidden.value * (TAB_BAR_HEIGHT + spacing[6]) }],
  }));

  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setSlots((current) =>
      current[key]?.x === x && current[key]?.width === width ? current : { ...current, [key]: { x, width } },
    );
  };

  const tab = (route: (typeof routes)[number]) => {
    const focused = route.key === focusedKey;
    const options = descriptors[route.key]?.options;
    const label = options?.tabBarAccessibilityLabel ?? options?.title ?? route.name;
    const glyph = glyphs[route.name] ?? Glyphs.Home;
    return (
      <TabSlot
        key={route.key}
        label={label}
        glyph={glyph}
        focused={focused}
        shaped={target !== undefined}
        onLayout={measure(route.key)}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      />
    );
  };

  return (
    <Animated.View
      pointerEvents={keyboard ? 'none' : 'box-none'}
      style={[styles.dock, { bottom: tabBarOffset(insets.bottom) }, barStyle]}
      testID="floating-tab-bar"
    >
      <View style={styles.bar} accessibilityRole="tablist">
        <Animated.View pointerEvents="none" style={[styles.capsule, capsuleStyle]} testID="tab-capsule" />
        {routes.slice(0, half).map(tab)}
        <CreateButton label={createLabel} onPress={onCreate} />
        {routes.slice(half).map(tab)}
      </View>
    </Animated.View>
  );
}

function TabSlot({
  label,
  glyph,
  focused,
  shaped,
  onPress,
  onLongPress,
  onLayout,
}: {
  readonly label: string;
  readonly glyph: IconGlyph;
  readonly focused: boolean;
  /** The capsule is behind this slot: until then the near-black Bold glyph would sit on the dark bar. */
  readonly shaped: boolean;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}) {
  const moves = useMotionAllowed('minimal');
  const ring = useFocusRing();
  const lit = focused && shaped;
  const active = useSharedValue(lit ? 1 : 0);

  useEffect(() => {
    active.value = moves ? withTiming(lit ? 1 : 0, { duration: motion.fast }) : lit ? 1 : 0;
  }, [lit, moves, active]);

  const boldStyle = useAnimatedStyle(() => ({ opacity: active.value }));
  const linearStyle = useAnimatedStyle(() => ({ opacity: 1 - active.value }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      onLayout={onLayout}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={[styles.slot, ring.ring]}
    >
      <View style={styles.glyph}>
        <Animated.View style={[styles.layer, linearStyle]}>
          <Icon icon={glyph} variant="linear" size={TAB_GLYPH} color={colors.textTertiary} />
        </Animated.View>
        <Animated.View style={[styles.layer, boldStyle]}>
          <Icon icon={glyph} variant="bold" size={TAB_GLYPH} color={colors.textOnWhite} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

function CreateButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const press = usePressScale();
  const ring = useFocusRing();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptics.create();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      testID="tab-create"
      style={[styles.create, press.pressed && styles.createPressed, ring.ring, press.style]}
    >
      <Icon icon={Glyphs.Add} variant="linear" size={TAB_GLYPH} color={colors.textOnWhite} />
    </AnimatedPressable>
  );
}

function useAndroidKeyboard(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: spacing[4], right: spacing[4] },
  bar: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 32, spreadDistance: -8, color: colors.black }],
  },
  capsule: {
    position: 'absolute',
    left: 0,
    top: (TAB_BAR_HEIGHT - CAPSULE_HEIGHT) / 2 - StyleSheet.hairlineWidth,
    width: CAPSULE_WIDTH,
    height: CAPSULE_HEIGHT,
    borderRadius: radius.full,
    backgroundColor: colors.whiteSurface,
  },
  slot: {
    flex: 1,
    height: CAPSULE_HEIGHT,
    minWidth: size.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  glyph: { width: TAB_GLYPH, height: TAB_GLYPH },
  layer: { position: 'absolute', top: 0, left: 0 },
  create: {
    width: CREATE_DIAMETER,
    height: CREATE_DIAMETER,
    marginHorizontal: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.whiteSurface,
  },
  createPressed: { backgroundColor: colors.whiteMuted },
});
