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
import { colors, font, fontSize, radius, spacing, tint } from '../../theme';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';
import { TONES, useSurface, type Surface } from './surface';

/**
 * Single-line text input — the native `TextInput` (`docs/ui-kit.md` §7.13, `mobile-design`
 * skill §2).
 *
 * <h2>Two skins, chosen by where it sits</h2>
 *
 * On the dark canvas the input is a `surface3` well with `textPrimary` text. Inside a white sheet
 * or dialog (`useSurface() === 'white'`) it is a `whiteMuted` block with `textOnWhite` text — the
 * skill's "nested blocks inside a sheet use `whiteMuted`; dark text tokens are never used on
 * white". Nobody passes a prop for this: a field moved into a `Sheet` simply reads on white.
 *
 * <p>A hairline border that strengthens when focused (the phone has no hover), `radius.lg`, a
 * placeholder in the surface's tertiary tone — never `--text-disabled`, which measures 2.6:1.
 * Invalid draws the border in `--danger`, always alongside the `Field`'s sentence and icon.
 * Disabled is 40% and not editable. Nothing here animates: an invalid state appears at once.
 *
 * <h2>Focus: the border AND the ring</h2>
 *
 * Focus is the stronger border plus the 2pt ring from `useFocusRing`, which is lime on the dark
 * canvas and near-black on white, where lime would vanish.
 *
 * <h2>Sizes</h2>
 *
 * `md` (44) is the default and `lg` is 48. The web's `sm` (36) is not offered: it cannot meet the
 * 44pt touch target, and an input cannot borrow `hitSlop` — the caret lands where the finger does.
 *
 * <p>`forwardRef` so a form can chain `returnKeyType="next"` to the next field's `focus()`. The
 * label is visible in the surrounding `Field` and is this input's `accessibilityLabel`; outside a
 * `Field`, pass `accessibilityLabel` yourself.
 */

export type TextInputSize = 'md' | 'lg';
/** `rounded` (`radius.lg`) for form fields; `pill` (`radius.full`) for a single-line search. */
export type TextInputShape = 'rounded' | 'pill';

export const INPUT_HEIGHT: Record<TextInputSize, number> = { md: 44, lg: 48 };
const INPUT_TEXT: Record<TextInputSize, number> = { md: fontSize.sm, lg: fontSize.row };
const INPUT_PADDING: Record<TextInputSize, number> = { md: 14, lg: 16 };

/** The skin's colours on one surface. White has its own; every other surface takes the dark well. */
export interface InputTones {
  readonly fill: string;
  readonly border: string;
  readonly borderFocused: string;
  readonly text: string;
  readonly placeholder: string;
  /** A muted glyph inside the input: the search lens, a chevron. */
  readonly icon: string;
}

const DARK_TONES: InputTones = {
  fill: colors.surface3,
  border: colors.border,
  borderFocused: colors.borderStrong,
  text: TONES.dark.primary,
  placeholder: TONES.dark.tertiary,
  icon: TONES.dark.tertiary,
};

/** The dark row's hairlines, mirrored: the same 8% and 16% of near-black over white. */
const WHITE_TONES: InputTones = {
  fill: colors.whiteMuted,
  border: tint(colors.black, 0.08),
  borderFocused: tint(colors.black, 0.16),
  text: TONES.white.primary,
  placeholder: TONES.white.tertiary,
  icon: TONES.white.tertiary,
};

export function inputTones(surface: Surface = 'dark'): InputTones {
  return surface === 'white' ? WHITE_TONES : DARK_TONES;
}

/**
 * The skin's frame, shared by every control that looks like an input — `Textarea`, `Select`,
 * `SearchField` — so they cannot drift apart. Not exported from the kit's barrel: screens compose
 * the controls, not the skin. `surface` defaults to the dark canvas; pass `useSurface()`.
 */
export function inputFrame({
  focused,
  invalid,
  disabled,
  surface = 'dark',
}: {
  focused: boolean;
  invalid: boolean;
  disabled: boolean;
  surface?: Surface;
}): ViewStyle[] {
  const tones = inputTones(surface);
  return [
    skin.frame,
    {
      backgroundColor: tones.fill,
      borderColor: invalid ? colors.danger : focused ? tones.borderFocused : tones.border,
    },
    disabled ? skin.disabled : {},
  ];
}

/** The skin's text, at a size, on a surface. */
export function inputText(size: TextInputSize, surface: Surface = 'dark'): TextStyle {
  return {
    ...skin.text,
    color: inputTones(surface).text,
    fontSize: INPUT_TEXT[size],
    paddingHorizontal: INPUT_PADDING[size],
  };
}

export interface TextInputProps extends Omit<RNTextInputProps, 'style' | 'editable'> {
  readonly size?: TextInputSize;
  readonly shape?: TextInputShape;
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
    shape = 'rounded',
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
  const surface = useSurface();
  const field = useFieldControl({ accessibilityLabel, accessibilityHint, invalid });
  const { ring, onFocus: ringFocus, onBlur: ringBlur } = useFocusRing();
  const focused = ring !== undefined;
  const hasLeading = leading !== undefined && leading !== null;
  const hasTrailing = trailing !== undefined && trailing !== null;

  return (
    <View
      style={[
        ...inputFrame({ focused, invalid: field.invalid, disabled, surface }),
        shape === 'pill' && skin.pill,
        { minHeight: INPUT_HEIGHT[size] },
        ring,
        style,
      ]}
    >
      {hasLeading ? (
        <View
          style={[skin.leading, shape === 'pill' && skin.pillLeading]}
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
        placeholderTextColor={inputTones(surface).placeholder}
        // The caret and selection in the surface's ink, never lime on white.
        selectionColor={surface === 'white' ? TONES.white.primary : undefined}
        onFocus={(event) => {
          ringFocus(event);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          ringBlur(event);
          onBlur?.(event);
        }}
        style={[
          inputText(size, surface),
          skin.fill,
          hasLeading && skin.afterLeading,
          hasTrailing && skin.beforeTrailing,
        ]}
      />
      {hasTrailing ? <View style={skin.trailing}>{trailing}</View> : null}
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
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  pill: { borderRadius: radius.full },
  disabled: { opacity: 0.4 },
  text: { ...font.regular },
  fill: { flex: 1, alignSelf: 'stretch', paddingVertical: 0 },
  leading: { paddingLeft: spacing[3], justifyContent: 'center' },
  // A pill's curve starts further in, so its leading icon does too.
  pillLeading: { paddingLeft: spacing[4] },
  afterLeading: { paddingLeft: spacing[2] },
  trailing: { paddingRight: TRAILING_INSET, justifyContent: 'center' },
  beforeTrailing: { paddingRight: spacing[2] },
});
