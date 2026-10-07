import { useId, useMemo, useRef, useState, type Ref } from 'react';
import {
  InputAccessoryView,
  Platform,
  StyleSheet,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import type { StoryToolbarCopy } from '@ideanest/campaign-editor/copy';
import type { MarkToggle } from '@ideanest/campaign-editor/story';
import { Textarea } from '../../../components/ui';
import { colors, spacing } from '../../../theme';
import { StoryMarkToolbar, activeMarks } from './story-mark-toolbar';
import { useStoryScroll } from './story-scroll';

/**
 * A run of marked text — the web's `StoryTextField`, on a phone (#162).
 *
 * <p>A real multiline input with the Bold/Italic toolbar above it, as on the web; on iOS the same
 * toolbar is mirrored above the keyboard in an `InputAccessoryView`, so it stays in reach while
 * typing. The text is the inline mark syntax (`**bold**`, `*italic*`); the block turns it into
 * spans with the shared `parseSpans`.
 *
 * <p>The selection is tracked from `onSelectionChange`, because the toolbar's state and the
 * marks both act on it. Applying a mark changes the value and then RESTORES the selection over the
 * same characters (`toggleMark` says where they moved to) through the controlled `selection` prop,
 * which is released again the moment the creator moves the caret, so it never fights them.
 *
 * <p>On focus the field asks the story's scroll view to bring it, toolbar and all, into view.
 */
export interface StoryTextFieldProps {
  readonly toolbar: StoryToolbarCopy;
  readonly value: string;
  /** The field's accessible name, and what the toolbar says it formats. */
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  /** An error or a requirement, read after the name. */
  readonly accessibilityHint?: string;
  readonly autoFocus?: boolean;
  readonly onChange: (text: string) => void;
  readonly onBlur?: () => void;
  readonly inputRef?: Ref<RNTextInput>;
  readonly testID?: string;
}

type Selection = { readonly start: number; readonly end: number };

export function StoryTextField({
  toolbar,
  value,
  label,
  placeholder,
  disabled = false,
  invalid,
  accessibilityHint,
  autoFocus = false,
  onChange,
  onBlur,
  inputRef,
  testID = 'story-text',
}: StoryTextFieldProps) {
  const accessoryId = `story-marks-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const wrapper = useRef<View>(null);
  const input = useRef<RNTextInput | null>(null);
  const { reveal, release } = useStoryScroll();
  const [selection, setSelection] = useState<Selection>({ start: value.length, end: value.length });
  /** Set only while a mark's result is being put back; released on the next caret move. */
  const [forced, setForced] = useState<Selection | null>(null);

  function apply(result: MarkToggle): void {
    const restored = { start: result.selectionStart, end: result.selectionEnd };
    setSelection(restored);
    setForced(restored);
    onChange(result.text);
    input.current?.focus();
  }

  function setInput(node: RNTextInput | null): void {
    input.current = node;
    if (typeof inputRef === 'function') inputRef(node);
    else if (inputRef !== null && inputRef !== undefined) (inputRef as { current: RNTextInput | null }).current = node;
  }

  // Once per selection, however many toolbars draw it (two on iOS).
  const active = useMemo(() => activeMarks(value, selection), [value, selection]);

  const marks = (suffix: string) => (
    <StoryMarkToolbar
      copy={toolbar}
      value={value}
      selection={selection}
      active={active}
      label={label}
      disabled={disabled}
      onApply={apply}
      testID={`${testID}-marks${suffix}`}
    />
  );

  return (
    <View ref={wrapper} style={styles.field}>
      {marks('')}
      <Textarea
        ref={setInput}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        autoFocus={autoFocus}
        selection={forced ?? undefined}
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
        onSelectionChange={(event) => {
          setSelection(event.nativeEvent.selection);
          setForced(null);
        }}
        onChangeText={onChange}
        onFocus={() => reveal(wrapper.current)}
        onBlur={() => {
          release(wrapper.current);
          onBlur?.();
        }}
        testID={testID}
      />
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryId} backgroundColor={colors.surface2}>
          <View style={styles.accessory}>{marks('-keyboard')}</View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing[2] },
  accessory: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
