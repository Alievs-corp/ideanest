import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, type LayoutChangeEvent } from 'react-native';
import { TONES, useFocusRing } from '../../components/ui';
import { AnimatedPressable, usePressScale } from '../../components/ui/press-scale';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, radius, size, spacing } from '../../theme';

/**
 * Overview · Funding and backers · Backers · Finance · Surveys — the web's `DashboardNav` (#163).
 *
 * <p>A row of pills that scrolls sideways. The web's row neither wraps nor scrolls and runs off a
 * narrow screen (#136); five segments in a fixed control cannot hold "Funding and backers" at
 * 320pt with the largest text, so the row scrolls and every label keeps its full words at any
 * font scale. The chosen pill is white with on-white words and a heavier weight, so colour is
 * never the only signal, and it is scrolled into view whenever it changes.
 *
 * <p>Each pill is a `tab` with `selected` in a `tablist`, 44pt tall. A tab is an address, not
 * local state: choosing one replaces the route (`router.replace`), so Back leaves the dashboard
 * rather than stepping through the tabs.
 */

export type DashboardTab = 'overview' | 'charts' | 'backers' | 'finance' | 'surveys';

/** The web's order. */
export const DASHBOARD_TABS: readonly DashboardTab[] = ['overview', 'charts', 'backers', 'finance', 'surveys'];

/** The tab a dashboard path shows: its last segment, or Overview for the bare dashboard. */
export function dashboardTabOf(pathname: string): DashboardTab {
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return DASHBOARD_TABS.find((tab) => tab !== 'overview' && tab === last) ?? 'overview';
}

export type DashboardTabHref =
  | { readonly pathname: '/campaigns/[id]/dashboard'; readonly params: { readonly id: string } }
  | {
      readonly pathname: `/campaigns/[id]/dashboard/${Exclude<DashboardTab, 'overview'>}`;
      readonly params: { readonly id: string };
    };

export function dashboardTabHref(id: string, tab: DashboardTab): DashboardTabHref {
  return tab === 'overview'
    ? { pathname: '/campaigns/[id]/dashboard', params: { id } }
    : { pathname: `/campaigns/[id]/dashboard/${tab}`, params: { id } };
}

const GUTTER = spacing[5];

export function DashboardTabs({
  active,
  onSelect,
}: {
  readonly active: DashboardTab;
  readonly onSelect: (tab: DashboardTab) => void;
}) {
  const t = useT('dashboard.nav');
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<Partial<Record<DashboardTab, { x: number; w: number }>>>({});

  const frame = frames[active];
  useEffect(() => {
    if (frame === undefined || width === 0) return;
    // Centred where the row allows, so a tab chosen at either edge is never left clipped.
    scroller.current?.scrollTo({ x: Math.max(0, frame.x + frame.w / 2 - width / 2), animated: false });
  }, [frame, width]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
      accessibilityLabel={t('label')}
      style={styles.bar}
      contentContainerStyle={styles.row}
      testID="dashboard-tabs"
    >
      {DASHBOARD_TABS.map((tab) => (
        <TabPill
          key={tab}
          label={t(tab)}
          current={tab === active}
          onPress={() => {
            if (tab !== active) onSelect(tab);
          }}
          onLayout={(event: LayoutChangeEvent) => {
            const { x, width: w } = event.nativeEvent.layout;
            setFrames((prev) => (prev[tab]?.x === x && prev[tab]?.w === w ? prev : { ...prev, [tab]: { x, w } }));
          }}
          testID={`dashboard-tab-${tab}`}
        />
      ))}
    </ScrollView>
  );
}

function TabPill({
  label,
  current,
  onPress,
  onLayout,
  testID,
}: {
  readonly label: string;
  readonly current: boolean;
  readonly onPress: () => void;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly testID: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const press = usePressScale();
  const fill = current ? colors.whiteSurface : press.pressed ? colors.surface3 : colors.surface2;
  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onLayout={onLayout}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={onFocus}
      onBlur={onBlur}
      style={[
        styles.pill,
        { backgroundColor: fill, borderColor: current ? colors.whiteSurface : colors.border },
        ring,
        press.style,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.label,
          current ? styles.labelCurrent : styles.labelOther,
          { color: current ? colors.textOnWhite : TONES.dark.secondary },
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: colors.surface1 },
  row: { gap: spacing[2], paddingVertical: spacing[2], paddingHorizontal: GUTTER },
  pill: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: fontSize.sm },
  labelCurrent: { ...font.semibold },
  labelOther: { ...font.medium },
});
