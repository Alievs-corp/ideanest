import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { SaveState } from '@ideanest/campaign-editor/autosave';
import type { SaveStatusCopy } from '@ideanest/campaign-editor/copy';
import { Icon, announce, useReducedMotion } from '../../components/ui';
import { Glyphs } from '../../icons';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';

/**
 * Whether the work is safe — the web's `SaveStatus`, in the stack header's right slot (#162).
 *
 * <ul>
 *   <li>idle: nothing;</li>
 *   <li>saving: the platform spinner and "Saving". Under Reduce Motion the spinner is replaced by
 *       a still glyph — the one moving thing in the editor stops too;</li>
 *   <li>saved: a success tick and "Saved" — `success`, never lime: a saved draft is not urgent;</li>
 *   <li>not saved: a danger mark and "Not saved".</li>
 * </ul>
 *
 * <p>Colour is never the state: each is a word beside a glyph. Only the two outcomes are
 * announced, politely, as the web's live region does; "Saving" after every pause in typing would
 * drown the one message that matters.
 */
export function SaveStatus({ state, copy }: { readonly state: SaveState; readonly copy: SaveStatusCopy }) {
  const reduced = useReducedMotion();
  const previous = useRef<SaveState>(state);

  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    if (state === 'saved') announce(copy.saved);
    if (state === 'failed') announce(copy.notSaved);
  }, [state, copy.saved, copy.notSaved]);

  if (state === 'idle') return <View style={styles.row} testID="save-status" />;

  const words = state === 'saving' ? copy.saving : state === 'saved' ? copy.saved : copy.notSaved;
  const tone =
    state === 'saving' ? colors.textTertiary : state === 'saved' ? colors.success : colors.danger;

  return (
    <View style={styles.row} accessible accessibilityLabel={words} testID="save-status">
      {state === 'saving' ? (
        reduced ? (
          <View testID="save-status-still">
            <Icon icon={Glyphs.Refresh} size={16} color={tone} />
          </View>
        ) : (
          <ActivityIndicator size="small" color={tone} testID="save-status-spinner" />
        )
      ) : (
        <Icon icon={state === 'saved' ? Glyphs.TickCircle : Glyphs.Danger} size={16} color={tone} />
      )}
      <Text style={[styles.words, { color: tone }]} importantForAccessibility="no" accessibilityElementsHidden>
        {words}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], minHeight: 24 },
  words: { ...font.medium, fontSize: fontSize.caption, lineHeight: lineHeight.small },
});
