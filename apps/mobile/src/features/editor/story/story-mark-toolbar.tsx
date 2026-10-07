import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { StoryToolbarCopy } from '@ideanest/campaign-editor/copy';
import { isMarkActive, toggleMark, type MarkToggle, type StoryMark } from '@ideanest/campaign-editor/story';
import { Icon, useFocusRing } from '../../../components/ui';
import { AnimatedPressable, usePressScale } from '../../../components/ui/press-scale';
import { Glyphs } from '../../../icons';
import { colors, radius, size as measure, spacing } from '../../../theme';

/**
 * Bold and Italic for one run of story text — the web's `StoryMarkToolbar`, on a phone (#162).
 *
 * <p>Two 44pt buttons named "Bold" and "Italic" (no "Control B": a phone has no shortcut to
 * announce). Each carries `accessibilityState.selected` when every selected character already has
 * the mark — the shared `isMarkActive`, so the state is ANNOUNCED, not only drawn. Active is a
 * white fill with a near-black glyph (and the glyph turns Bold), never lime: emphasising a word is
 * not urgent.
 *
 * <p>It does not own the text. A press runs the shared `toggleMark` over the selection and hands
 * the result — the new text and where the selection now is — to the field, which owns the
 * controlled value and restores the selection. The stored markdown is therefore the web's, byte
 * for byte.
 */
const MARKS: readonly { mark: StoryMark; glyph: typeof Glyphs.TextBold }[] = [
  { mark: 'strong', glyph: Glyphs.TextBold },
  { mark: 'em', glyph: Glyphs.TextItalic },
];

export interface StoryMarkToolbarProps {
  readonly copy: StoryToolbarCopy;
  readonly value: string;
  readonly selection: { readonly start: number; readonly end: number };
  /** Names what this toolbar formats, e.g. "Paragraph 2 of 7: …". */
  readonly label: string;
  readonly disabled?: boolean;
  readonly onApply: (result: MarkToggle) => void;
  readonly testID?: string;
}

export function StoryMarkToolbar({
  copy,
  value,
  selection,
  label,
  disabled = false,
  onApply,
  testID = 'story-marks',
}: StoryMarkToolbarProps) {
  return (
    <View
      style={styles.row}
      accessibilityRole="toolbar"
      accessibilityLabel={fillPlaceholders(copy.formattingFor, { label })}
      testID={testID}
    >
      {MARKS.map(({ mark, glyph }) => (
        <MarkButton
          key={mark}
          glyph={glyph}
          label={mark === 'strong' ? copy.bold : copy.italic}
          active={isMarkActive(value, selection.start, selection.end, mark)}
          disabled={disabled}
          onPress={() => onApply(toggleMark(value, selection.start, selection.end, mark))}
          testID={`${testID}-${mark === 'strong' ? 'bold' : 'italic'}`}
        />
      ))}
    </View>
  );
}

function MarkButton({
  glyph,
  label,
  active,
  disabled,
  onPress,
  testID,
}: {
  readonly glyph: typeof Glyphs.TextBold;
  readonly label: string;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const press = usePressScale();
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      style={[styles.button, active ? styles.active : styles.idle, disabled && styles.disabled, ring, press.style]}
    >
      <Icon
        icon={glyph}
        variant={active ? 'bold' : 'linear'}
        size={20}
        color={active ? colors.textOnWhite : colors.textSecondary}
      />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[2] },
  button: {
    width: measure.touchTarget,
    height: measure.touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idle: { backgroundColor: colors.surface3 },
  active: { backgroundColor: colors.whiteSurface },
  disabled: { opacity: 0.4 },
});
