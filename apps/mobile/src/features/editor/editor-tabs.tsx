import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { EDITOR_TABS, type EditorTabKey } from '@ideanest/campaign-editor/tabs';
import { TONES, useFocusRing } from '../../components/ui';
import { colors, font, fontSize, radius, size, spacing } from '../../theme';

/**
 * Basics · Rewards · Story · FAQ · Pre-launch · Review — the web `EditorShell`'s section row, in
 * `@ideanest/campaign-editor/tabs` order (#162).
 *
 * <p>A row of pills that scrolls sideways, like the dashboard's. Each pill is drawn 34pt tall, the
 * web's height, inside a 44pt pressable so the thumb's target is the platform minimum. The chosen
 * one is white with near-black words and a heavier weight (never lime: a section is not urgent);
 * the others are `surface2` with `white/64`. `tab` roles with `selected`, in a `tablist`, and the
 * chosen pill is scrolled into view whenever it changes.
 *
 * <p>No press animation: the editor's motion budget is the save indicator only.
 */

/** Where a tab lives in the app: `campaigns/[id]/edit/{tab}`. The shared `editorTabHref` is the web's. */
export function editorTabHref(projectId: string, tab: EditorTabKey) {
  return { pathname: `/campaigns/[id]/edit/${tab}`, params: { id: projectId } } as const;
}

/** The tab a path shows: its last segment, or Basics for the bare editor. */
export function editorTabOf(pathname: string): EditorTabKey {
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return EDITOR_TABS.find((tab) => tab.segment === last)?.key ?? 'basics';
}

const GUTTER = spacing[5];
const PILL_HEIGHT = 34;

export function EditorTabs({
  active,
  labels,
  sectionsLabel,
  onSelect,
}: {
  readonly active: EditorTabKey;
  readonly labels: Readonly<Record<EditorTabKey, string>>;
  /** Names the row for assistive technology (`campaignEditor.sectionsLabel`). */
  readonly sectionsLabel: string;
  readonly onSelect: (tab: EditorTabKey) => void;
}) {
  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState<Partial<Record<EditorTabKey, { x: number; w: number }>>>({});

  const frame = frames[active];
  useEffect(() => {
    if (frame === undefined || width === 0) return;
    scroller.current?.scrollTo({ x: Math.max(0, frame.x + frame.w / 2 - width / 2), animated: false });
  }, [frame, width]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
      accessibilityLabel={sectionsLabel}
      style={styles.bar}
      contentContainerStyle={styles.row}
      testID="editor-tabs"
    >
      {EDITOR_TABS.map((tab) => (
        <TabPill
          key={tab.key}
          label={labels[tab.key]}
          current={tab.key === active}
          onPress={() => {
            if (tab.key !== active) onSelect(tab.key);
          }}
          onLayout={(event: LayoutChangeEvent) => {
            const { x, width: w } = event.nativeEvent.layout;
            setFrames((prev) =>
              prev[tab.key]?.x === x && prev[tab.key]?.w === w ? prev : { ...prev, [tab.key]: { x, w } },
            );
          }}
          testID={`editor-tab-${tab.key}`}
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
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      onLayout={onLayout}
      onFocus={onFocus}
      onBlur={onBlur}
      style={styles.target}
      testID={testID}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: current ? colors.whiteSurface : pressed ? colors.surface3 : colors.surface2,
              borderColor: current ? colors.whiteSurface : colors.border,
            },
            ring,
          ]}
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
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: colors.surface1 },
  row: { gap: spacing[2], paddingVertical: spacing[1], paddingHorizontal: GUTTER },
  // The thumb's target: 44pt tall, the drawn pill centred in it.
  target: { minHeight: size.touchTarget, justifyContent: 'center' },
  pill: {
    minHeight: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: fontSize.caption },
  labelCurrent: { ...font.semibold },
  labelOther: { ...font.medium },
});
