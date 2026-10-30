import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { EDITOR_TABS, type EditorTabKey } from '@ideanest/campaign-editor/tabs';
import { Icon, Sheet, SelectOptionRow, haptics, useFocusRing, usePressScale } from '../../components/ui';
import { Glyphs } from '../../icons';
import { colors, font, fontSize, radius, size, spacing } from '../../theme';

/**
 * Basics · Rewards · Story · FAQ · Pre-launch · Review — the editor's sections, in
 * `@ideanest/campaign-editor/tabs` order (#162).
 *
 * <p>ONE PILL AND A SHEET, NOT A ROW (#616). The six pills did not fit a phone in any language and
 * scrolled sideways: some sections were cut mid-word and the rest were off the edge with nothing
 * saying they were there, Review among them — the one that says whether the campaign can be
 * submitted. The web made the same change below `md` (#614).
 *
 * <p>The pill names the section being edited and its place in the list ("Story 3/6"), so the sheet
 * only has to be opened to move. The sheet is the kit's white `Sheet` with the `Select`'s option
 * rows, so "pick one of these" looks one way across the app: each row at least 44pt, announced as
 * a radio with its checked state, the current one on `whiteMuted` with a Bold `TickCircle`.
 * Choosing closes the sheet at once and hands the section to `onSelect`; focus returns to the pill.
 *
 * <p>Motion is the kit's: `PressableScale`'s press and the sheet's own rise, both of which honour
 * reduced motion.
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

export function EditorTabs({
  active,
  labels,
  sectionsLabel,
  openLabel,
  onSelect,
}: {
  readonly active: EditorTabKey;
  readonly labels: Readonly<Record<EditorTabKey, string>>;
  /** The sheet's title and the list's name (`campaignEditor.sectionsLabel`). */
  readonly sectionsLabel: string;
  /** The pill's spoken action, before the section's name (`campaignEditor.sectionsOpen`). */
  readonly openLabel: string;
  readonly onSelect: (tab: EditorTabKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null);
  const press = usePressScale();
  const { ring, onFocus, onBlur } = useFocusRing();
  const position = EDITOR_TABS.findIndex((tab) => tab.key === active) + 1;

  return (
    <View style={styles.bar} testID="editor-tabs">
      <Animated.View style={press.style}>
        <Pressable
          ref={trigger}
          accessibilityRole="button"
          accessibilityLabel={`${openLabel}: ${labels[active]}`}
          accessibilityState={{ expanded: open }}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onPress={() => {
            // A keyboard left up by the tab's last field would cover the sheet's rows.
            Keyboard.dismiss();
            setOpen(true);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: pressed ? colors.surface3 : colors.surface2, borderColor: colors.border },
            ring,
          ]}
          testID="editor-sections-open"
        >
          <Text numberOfLines={1} style={[styles.label, { color: colors.textPrimary }]}>
            {labels[active]}
          </Text>
          {/* A glance, not a sentence: the name already said which section this is. */}
          <Text
            style={[styles.count, { color: colors.textTertiary }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {`${position}/${EDITOR_TABS.length}`}
          </Text>
          <Icon icon={Glyphs.ArrowDown2} size={16} color={colors.textTertiary} />
        </Pressable>
      </Animated.View>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sectionsLabel}
        returnFocusTo={trigger}
        testID="editor-sections-sheet"
      >
        <View accessibilityRole="radiogroup" accessibilityLabel={sectionsLabel} style={styles.options}>
          {EDITOR_TABS.map((tab) => (
            <SelectOptionRow
              key={tab.key}
              option={{ value: tab.key, label: labels[tab.key] }}
              selected={tab.key === active}
              onChoose={() => {
                setOpen(false);
                if (tab.key === active) return;
                haptics.selectReward();
                onSelect(tab.key);
              }}
              testID={`editor-tab-${tab.key}`}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface1, paddingHorizontal: GUTTER, paddingVertical: spacing[1] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: size.touchTarget,
    paddingLeft: spacing[5],
    paddingRight: spacing[4],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, ...font.medium, fontSize: fontSize.row },
  count: { ...font.regular, fontSize: fontSize.caption, fontVariant: ['tabular-nums'] },
  options: { gap: spacing[1] },
});
