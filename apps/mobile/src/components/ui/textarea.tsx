import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput as RNTextInput,
  View,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors } from '../../theme';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';
import { inputFrame, inputText } from './text-input';

/**
 * Multi-line text in the input skin — the native `Textarea` (`docs/ui-kit.md` §7.13).
 *
 * <p>96pt at rest, the web's minimum, so a box asking for a paragraph looks like it wants one.
 * It grows with its content — the web's `autoGrow` — up to `maxHeight`, and from there it
 * scrolls. Growing without a ceiling would push the submit button under the keyboard on a long
 * answer; never growing would make somebody edit a paragraph through a four-line slot.
 *
 * <p>The height follows `onContentSizeChange` and is set, not animated: a box that eased to its
 * new height on every line break would move under the caret as it was being typed into — and
 * the `mobile-design` skill §6.1 forbids animating height at all.
 */

export const TEXTAREA_MIN_HEIGHT = 96;
const VERTICAL_PADDING = 12;

export interface TextareaProps extends Omit<RNTextInputProps, 'style' | 'editable' | 'multiline'> {
  /** Overrides the surrounding `Field`'s invalid state. */
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  /** The tallest it grows before it scrolls. 240 by default: about nine lines at 14pt. */
  readonly maxHeight?: number;
  readonly style?: StyleProp<ViewStyle>;
}

export const Textarea = forwardRef<RNTextInput, TextareaProps>(function Textarea(
  {
    invalid,
    disabled = false,
    maxHeight = 240,
    style,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
    onFocus,
    onBlur,
    onContentSizeChange,
    ...rest
  },
  ref,
) {
  const field = useFieldControl({ accessibilityLabel, accessibilityHint, invalid });
  const { ring, onFocus: ringFocus, onBlur: ringBlur } = useFocusRing();
  const ceiling = Math.max(maxHeight, TEXTAREA_MIN_HEIGHT);
  const [content, setContent] = useState(0);
  /*
   * `contentSize.height` already includes the input's own vertical padding on both platforms
   * (iOS measures the whole text view; Android's content-size watcher adds the padding), so it
   * is the box's height as it stands. Adding the padding again made the box 24pt too tall and
   * started the scrolling early.
   */
  const height = Math.min(Math.max(content, TEXTAREA_MIN_HEIGHT), ceiling);
  const full = content >= ceiling;

  return (
    <View
      style={[
        ...inputFrame({ focused: ring !== undefined, invalid: field.invalid, disabled }),
        styles.frame,
        { height },
        ring,
        style,
      ]}
    >
      <RNTextInput
        ref={ref}
        {...rest}
        multiline
        textAlignVertical="top"
        scrollEnabled={full}
        editable={!disabled}
        accessibilityLabel={field.accessibilityLabel}
        accessibilityHint={field.accessibilityHint}
        accessibilityState={{ ...accessibilityState, disabled }}
        placeholderTextColor={colors.textTertiary}
        onContentSizeChange={(event) => {
          setContent(event.nativeEvent.contentSize.height);
          onContentSizeChange?.(event);
        }}
        onFocus={(event) => {
          ringFocus(event);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          ringBlur(event);
          onBlur?.(event);
        }}
        style={[inputText('md'), styles.text]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { alignItems: 'stretch' },
  text: { flex: 1, paddingVertical: VERTICAL_PADDING },
});
