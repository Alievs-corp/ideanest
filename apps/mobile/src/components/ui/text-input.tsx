import { forwardRef, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput as RNTextInput,
  View,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, font, fontSize, radius } from '../../theme';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';

/**
 * Single-line text input in the web's `inputSkin` — the native `TextInput` (`docs/ui-kit.md`
 * §7.13).
 *
 * <h2>The skin</h2>
 *
 * `--surface-3`, because §3 assigns it to "nested block, input": a field inside a surface-2 card
 * has to read as a well, not as another card. A hairline `--border` that becomes
 * `--border-strong` when focused (the phone has no hover, so focus is the only state that earns
 * it), radius-md 14, a placeholder in `--text-tertiary` — never `--text-disabled`, which measures
 * 2.6:1 and is prohibited for text. Invalid draws the border in `--danger`, always alongside the
 * `Field`'s sentence and icon. Disabled is 40% and not editable.
 *
 * <h2>Focus: the border AND the ring</h2>
 *
 * The table in §7.13 says focus is `--border-strong` plus the global lime ring, and that the ring
 * is never removed. So both are drawn: the border from the focus state, and the 2pt ring outside
 * it from `useFocusRing`, which switches to near-black on a lime or white surface where a lime
 * ring would vanish. Lime as a border is legal; lime as text is not, and nothing here sets it.
 *
 * <h2>Sizes</h2>
 *
 * `md` (44) is the default and `lg` is 48. The web's `sm` (36) is not offered: it cannot meet the
 * 44pt touch target, and an input is not a control that can borrow `hitSlop` — the caret lands
 * where the finger does.
 *
 * <p>`forwardRef` so a form can chain `returnKeyType="next"` to the next field's `focus()`. The
 * label is visible in the surrounding `Field` and is this input's `accessibilityLabel`; outside a
 * `Field`, pass `accessibilityLabel` yourself.
 */

export type TextInputSize = 'md' | 'lg';

export const INPUT_HEIGHT: Record<TextInputSize, number> = { md: 44, lg: 48 };
const INPUT_TEXT: Record<TextInputSize, number> = { md: fontSize.sm, lg: fontSize.row };
const INPUT_PADDING: Record<TextInputSize, number> = { md: 14, lg: 16 };

/**
 * The skin's frame, shared by every control that looks like an input — `Textarea`, `Select`,
 * `SearchField` — so the four cannot drift apart. Not exported from the kit's barrel: screens
 * compose the controls, not the skin.
 */
export function inputFrame({
  focused,
  invalid,
  disabled,
}: {
  focused: boolean;
  invalid: boolean;
  disabled: boolean;
}): ViewStyle[] {
  return [
    skin.frame,
    {
      borderColor: invalid ? colors.danger : focused ? colors.borderStrong : colors.border,
    },
    disabled ? skin.disabled : {},
  ];
}

/** The skin's text, at a size. */
export function inputText(size: TextInputSize): TextStyle {
  return { ...skin.text, fontSize: INPUT_TEXT[size], paddingHorizontal: INPUT_PADDING[size] };
}

export interface TextInputProps extends Omit<RNTextInputProps, 'style' | 'editable'> {
  readonly size?: TextInputSize;
  /** Overrides the surrounding `Field`'s invalid state. */
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  /** Decoration before the text: a currency code, an icon. Hidden from the screen reader. */
  readonly leading?: ReactNode;
  /** After the text. May be interactive — a reveal or a clear button. */
  readonly trailing?: ReactNode;
  /** The frame's outer style: margins, width. The skin itself is not overridable. */
  readonly style?: StyleProp<ViewStyle>;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  {
    size = 'md',
    invalid,
    disabled = false,
    leading,
    trailing,
    style,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const field = useFieldControl({ accessibilityLabel, accessibilityHint, invalid });
  const { ring, onFocus: ringFocus, onBlur: ringBlur } = useFocusRing();
  const focused = ring !== undefined;

  return (
    <View
      style={[
        ...inputFrame({ focused, invalid: field.invalid, disabled }),
        { minHeight: INPUT_HEIGHT[size] },
        ring,
        style,
      ]}
    >
      {leading !== undefined && leading !== null ? (
        <View
          style={skin.leading}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {leading}
        </View>
      ) : null}
      <RNTextInput
        ref={ref}
        {...rest}
        editable={!disabled}
        accessibilityLabel={field.accessibilityLabel}
        accessibilityHint={field.accessibilityHint}
        accessibilityState={{ ...accessibilityState, disabled }}
        placeholderTextColor={colors.textTertiary}
        onFocus={(event) => {
          ringFocus(event);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          ringBlur(event);
          onBlur?.(event);
        }}
        style={[
          inputText(size),
          skin.fill,
          leading !== undefined && leading !== null && skin.afterLeading,
          trailing !== undefined && trailing !== null && skin.beforeTrailing,
        ]}
      />
      {trailing !== undefined && trailing !== null ? (
        <View style={skin.trailing}>{trailing}</View>
      ) : null}
    </View>
  );
});

/*
 * The trailing slot's inset puts a 32pt `IconButton` 6pt from the edge, which is where its
 * `hitSlop` reaches the frame's edge and it still measures 44pt.
 */
const TRAILING_INSET = (INPUT_HEIGHT.md - 32) / 2;

const skin = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  disabled: { opacity: 0.4 },
  text: {
    ...font.regular,
    color: colors.textPrimary,
  },
  fill: { flex: 1, alignSelf: 'stretch', paddingVertical: 0 },
  leading: { paddingLeft: 12, justifyContent: 'center' },
  afterLeading: { paddingLeft: 8 },
  trailing: { paddingRight: TRAILING_INSET, justifyContent: 'center' },
  beforeTrailing: { paddingRight: 8 },
});
