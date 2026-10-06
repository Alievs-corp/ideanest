import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, type LayoutChangeEvent } from 'react-native';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, radius, size, spacing, tint } from '../../theme';
import { TONES, useFocusRing } from '../../components/ui';
import { AnimatedPressable, usePressScale } from '../../components/ui/press-scale';
import { GUTTER } from './sheet-list';

/**
 * Created · Backed · About — the web's `ProfileTabs` (#156), as a native tab list.
 *
 * <p>The tab is local state over the screen (mirrored to `?tab=`), so `tablist` / `tab` with
 * `selected` is the honest description; the web's arrow-key handling is the platform's tab
 * semantics here, and there is no swipe between tabs. The row scrolls sideways with no indicator.
 *
 * <p>Pills, 34pt drawn and 44pt to the thumb. The chosen one is white with on-white words, the
 * others `surface2` with a white/8 edge — and the chosen label is heavier, so colour is never the
 * only signal. A count is printed only when the caller knows a total (`knownTotal`), and it is part
 * of the tab's name: "Backed, 12".
 */

export type ProfileTabId = 'created' | 'backed' | 'about';
export const PROFILE_TABS: readonly ProfileTabId[] = ['created', 'backed', 'about'];

export function profileTabFrom(value: string | undefined): ProfileTabId {
  return value === 'backed' || value === 'about' ? value : 'created';
}

/** The drawn pill; the touch target reaches 44pt around it. */
const PILL_HEIGHT = 34;
const REACH = (size.touchTarget - PILL_HEIGHT) / 2;

export function ProfileTabs({
  active,
  onSelect,
  counts,
}: {
  readonly active: ProfileTabId;
  readonly onSelect: (tab: ProfileTabId) => void;
  readonly counts: Partial<Record<ProfileTabId, number>>;
}) {
  const t = useT('profile');
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<Partial<Record<ProfileTabId, { x: number; w: number }>>>({});

  // The chosen pill is scrolled fully into view, so a tab picked at the edge is never left clipped.
  const frame = frames[active];
  useEffect(() => {
    if (frame === undefined || width === 0) return;
    scroller.current?.scrollTo({ x: Math.max(0, frame.x + frame.w + GUTTER - width), animated: false });
  }, [frame, width]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={styles.bleed}
      accessibilityRole="tablist"
      accessibilityLabel={t('tabsLabel')}
      contentContainerStyle={styles.row}
      testID="profile-tabs"
    >
      {PROFILE_TABS.map((tab) => (
        <TabPill
          key={tab}
          label={t(`tabs.${tab}`)}
          count={counts[tab]}
          current={tab === active}
          onPress={() => onSelect(tab)}
          onLayout={(event: LayoutChangeEvent) => {
            const { x, width: w } = event.nativeEvent.layout;
            setFrames((prev) => (prev[tab]?.x === x && prev[tab]?.w === w ? prev : { ...prev, [tab]: { x, w } }));
          }}
          testID={`profile-tab-${tab}`}
        />
      ))}
    </ScrollView>
  );
}

function TabPill({
  label,
  count,
  current,
  onPress,
  onLayout,
  testID,
}: {
  readonly label: string;
  readonly count: number | undefined;
  readonly current: boolean;
  readonly onPress: () => void;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly testID: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const fill = current ? colors.whiteSurface : press.pressed ? colors.surface3 : colors.surface2;
  const name = count === undefined ? label : `${label}, ${count}`;
  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityLabel={name}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onLayout={onLayout}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={onFocus}
      onBlur={onBlur}
      hitSlop={{ top: REACH, bottom: REACH }}
      style={[
        styles.pill,
        { backgroundColor: fill, borderColor: current ? colors.whiteSurface : colors.border },
        ring,
        press.style,
      ]}
      testID={testID}
    >
      <Text
        style={[styles.label, current ? styles.labelCurrent : styles.labelOther, { color: current ? colors.textOnWhite : TONES.dark.secondary }]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
        {count === undefined ? null : (
          <Text style={{ color: current ? tint(colors.textOnWhite, 0.64) : TONES.dark.tertiary }}>
            {` ${count}`}
          </Text>
        )}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // The vertical reach is inside the scroll view, so the 44pt target is not clipped.
  row: { gap: spacing[2], paddingVertical: REACH, paddingHorizontal: GUTTER },
  // The row runs to the screen's edges, so a pill scrolls out under the edge rather than being cut at the gutter.
  bleed: { marginHorizontal: -GUTTER },
  pill: {
    minHeight: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: fontSize.caption, fontVariant: ['tabular-nums'] },
  labelCurrent: { ...font.medium },
  labelOther: { ...font.regular },
});
