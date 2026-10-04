import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, motion, radius, size, spacing, spring, tracking } from '../../theme';
import { AnimatedAmount, type AnimatedAmountMode } from './animated-amount';
import { announce } from './announce';
import { errorTextColor, useFieldControl } from './field';
import { useFocusRing } from './focus';
import { haptics } from './haptics';
import { Icon } from './icon';
import {
  EMPTY_KEYPAD,
  KEYPAD_KEYS,
  MONEY_MAX_AMOUNT,
  KEYPAD_OPERATORS,
  OPERATOR_SYMBOL,
  chooseOperator,
  commitResult,
  entryValue,
  exceeds,
  figureOf,
  groupFigure,
  normaliseEntry,
  plainOf,
  pressKey,
  resultOf,
  type KeypadKey,
  type KeypadOperator,
  type KeypadState,
} from './keypad-math';
import { useMotionAllowed } from './motion-budget';
import { usePressScale } from './press-scale';
import { BLOCK, TONES, blockSurface, useSurface } from './surface';

/**
 * Amount entry — issue #280, `mobile-design` skill §6.4 and `references/motion-recipes.md`.
 *
 * <h2>The value is right before anything moves</h2>
 *
 * A key changes the amount in its press handler, synchronously, so the digit is in the amount and
 * in its accessible name on the frame the press lands. The soft rise of the new character
 * (`AnimatedAmount` in `enter` mode) is decoration over a value that is already correct, and it is
 * gone under Reduce Motion.
 *
 * <h2>Arithmetic on Decimals</h2>
 *
 * The operator row (`+ − × ÷`) shows `amount op operand` with the operation muted and a result
 * chip `= value`; tapping the chip commits it, and the amount rolls to it. Every figure is a string
 * and every operation a `Decimal` (`keypad-math.ts`), rounded half-even to the currency's minor
 * units once, at the result. The point stops accepting digits at the minor units, and a leading
 * zero is replaced rather than followed.
 *
 * <h2>Refusals are instant</h2>
 *
 * An amount or a result over `max`, a division by zero and a result below zero show an inline
 * message at once — no shake, no fade — and it is announced. The result chip cannot commit a
 * result that is refused.
 *
 * <h2>Semi-controlled</h2>
 *
 * `value` is the amount as the field holds it (`''`, `'45'`, `'45.5'`), and `onChange` receives
 * the same shape — never a trailing point, so a half-typed `45.` is not handed on as an invalid
 * amount. The operator, the operand and the point being typed live here. A `value` from outside
 * (a reward chosen, which sets its price) replaces the amount and clears any pending operation; it
 * is read in the keypad's plain form, so `45.00` is typed on as `45`.
 *
 * <h2>A pending operation is not the amount</h2>
 *
 * While `143 × 2 = 286` is on screen, `value` is still 143. Before the amount is used, the screen
 * calls `settle()` on the keypad's ref: a valid result is committed (and handed to `onChange`),
 * anything else is refused with its message — an unfinished operation says so — and nothing is
 * used.
 *
 * <p>Inside a `Field`, the amount takes the field's label as its accessible name and the field's
 * error as its hint; the keys are separate stops, so the field should be `grouped`.
 */

export type KeypadSettle = 'unchanged' | 'committed' | 'refused';

export interface AmountKeypadHandle {
  /**
   * Settles a pending operation before the amount is used: `unchanged` when there is none,
   * `committed` when its result became the amount, `refused` when the result is not one to take
   * (its message is shown and said).
   */
  readonly settle: () => KeypadSettle;
}

export interface AmountKeypadProps {
  /** The amount: `''` or digits with an optional point and up to `scale` decimals. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The ISO code, shown after the amount and said with it. */
  readonly currency: string;
  /** The largest amount the keypad takes, as a decimal string. Defaults to the `numeric(14,2)` ceiling. */
  readonly max?: string | null;
  /** What to say when the amount or a result is over `max`. Defaults to the kit's own sentence. */
  readonly overLimitMessage?: string;
  /** Digits after the point. Defaults to `MONEY_SCALE`, the minor units of every collected currency. */
  readonly scale?: number;
  readonly disabled?: boolean;
  readonly ref?: Ref<AmountKeypadHandle>;
  readonly testID?: string;
}

const KEY_HEIGHT = spacing[12];
const OPERATOR_HEIGHT = size.touchTarget;
const CHIP_RISE = 6;
const CHIP_SCALE = 0.85;

/** The result chip's arrival: the same soft rise as a typed character. */
function chipIn(): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: CHIP_RISE }, { scale: CHIP_SCALE }] },
      animations: {
        opacity: withTiming(1, { duration: motion.fast }),
        transform: [{ translateY: withSpring(0, spring.snappy) }, { scale: withSpring(1, spring.snappy) }],
      },
    };
  };
}

export function AmountKeypad({
  value,
  onChange,
  currency,
  max = MONEY_MAX_AMOUNT,
  overLimitMessage,
  scale,
  disabled = false,
  ref,
  testID = 'amount-keypad',
}: AmountKeypadProps) {
  const t = useT('mobile.kitMoney');
  const surface = useSurface();
  const tones = TONES[surface];
  const field = useFieldControl({});
  const moves = useMotionAllowed('minimal');

  const [state, setState] = useState<KeypadState>(() => ({ ...EMPTY_KEYPAD, entry: normaliseEntry(value) }));
  const [synced, setSynced] = useState(value);
  const [mode, setMode] = useState<AnimatedAmountMode>('enter');
  const [nudged, setNudged] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setState({ ...EMPTY_KEYPAD, entry: normaliseEntry(value) });
    setMode('enter');
    setNudged(false);
  }

  const options = { scale, max };
  const apply = (next: KeypadState, committing = false) => {
    if (next === state) return;
    setState(next);
    setNudged(false);
    setMode(committing ? 'roll' : 'enter');
    const out = entryValue(next.entry);
    if (out !== entryValue(state.entry)) {
      setSynced(out);
      onChange(out);
    }
  };

  const press = (key: KeypadKey) => {
    haptics.keypadKey();
    apply(pressKey(state, key, scale));
  };
  const operate = (operator: KeypadOperator) => {
    haptics.keypadKey();
    const next = chooseOperator(state, operator, options);
    apply(next, next.entry !== state.entry);
  };
  const result = resultOf(state, options);
  const commit = () => {
    haptics.keypadKey();
    apply(commitResult(state, options), true);
  };

  let message: string | null = null;
  if (result.kind === 'divide-by-zero') message = t('divideByZero');
  else if (result.kind === 'below-zero') message = t('belowZero');
  else if (result.kind === 'over-limit' || exceeds(figureOf(state.entry), max)) {
    message = overLimitMessage ?? t('overLimit');
  } else if (nudged && state.operator !== null) message = t('unfinished');

  useImperativeHandle(ref, () => ({
    settle: () => {
      if (state.operator === null) return 'unchanged';
      if (result.kind === 'ok') {
        apply(commitResult(state, options), true);
        return 'committed';
      }
      if (result.kind === 'none') setNudged(true);
      else if (message !== null) announce(message, { assertive: true });
      return 'refused';
    },
  }));

  const empty = state.entry === '';
  const shown = empty ? '0' : groupFigure(state.entry);
  const point = shown.indexOf('.');
  const operation =
    state.operator === null ? '' : `${OPERATOR_SYMBOL[state.operator]} ${groupFigure(state.operand)}`.trimEnd();
  const resultText =
    result.kind === 'ok' || result.kind === 'over-limit' ? groupFigure(plainOf(result.value)) : null;

  const spokenAmount = `${shown} ${currency}`;
  const spokenOperation =
    state.operator === null ? '' : ` ${t(state.operator)} ${groupFigure(state.operand)}`.trimEnd();
  const spoken = `${field.label === undefined ? '' : `${field.label}, `}${spokenAmount}${spokenOperation}`;

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.display}>
        <View style={styles.amountRow}>
          <AnimatedAmount
            value={shown}
            mode={mode}
            minorFrom={point === -1 ? shown.length : point}
            style={[styles.major, { color: empty ? tones.tertiary : tones.primary }]}
            minorStyle={[styles.minor, { color: tones.tertiary }]}
            accessibilityLabel={spoken}
            testID={`${testID}-amount`}
          />
          <Text style={[styles.currency, { color: tones.tertiary }]} accessibilityElementsHidden importantForAccessibility="no">
            {currency}
          </Text>
        </View>
        {operation === '' && resultText === null ? null : (
          <View style={styles.operationRow}>
            {operation === '' ? null : (
              <Text
                style={[styles.operation, { color: tones.secondary }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
                testID={`${testID}-operation`}
              >
                {operation}
              </Text>
            )}
            {resultText === null ? null : (
              <Animated.View key={resultText} entering={moves ? chipIn() : undefined}>
                <ResultChip
                  text={`= ${resultText}`}
                  label={t('useResult', { amount: `${resultText} ${currency}` })}
                  disabled={disabled || result.kind !== 'ok'}
                  onPress={commit}
                  testID={`${testID}-result`}
                />
              </Animated.View>
            )}
          </View>
        )}
        {message === null ? null : <KeypadMessage text={message} testID={`${testID}-message`} />}
      </View>

      <View style={styles.keys}>
        <View style={styles.operators}>
          {KEYPAD_OPERATORS.map((operator) => (
            <View key={operator} style={styles.operatorCell}>
              <Key
                role="button"
                label={t(operator)}
                selected={state.operator === operator}
                height={OPERATOR_HEIGHT}
                disabled={disabled}
                onPress={() => operate(operator)}
                testID={`${testID}-op-${operator}`}
              >
                {OPERATOR_SYMBOL[operator]}
              </Key>
            </View>
          ))}
        </View>

        <View style={styles.grid}>
          {KEYPAD_KEYS.map((key) => (
            <View key={key} style={styles.cell}>
              <Key
                role="keyboardkey"
                label={key === 'point' ? t('point') : key === 'backspace' ? t('backspace') : key}
                height={KEY_HEIGHT}
                disabled={disabled}
                onPress={() => press(key)}
                testID={`${testID}-key-${key}`}
              >
                {key === 'backspace' ? (
                  <Icon icon={Glyphs.ArrowLeft} size={24} color={tones.primary} />
                ) : key === 'point' ? (
                  '.'
                ) : (
                  key
                )}
              </Key>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Key({
  role,
  label,
  selected,
  height,
  disabled,
  onPress,
  children,
  testID,
}: {
  readonly role: 'button' | 'keyboardkey';
  readonly label: string;
  readonly selected?: boolean;
  readonly height: number;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly testID: string;
}) {
  const surface = useSurface();
  const tones = TONES[surface];
  const block = BLOCK[blockSurface(surface)];
  const inverted = INVERTED[blockSurface(surface)];
  const press = usePressScale();
  const { ring, onFocus, onBlur } = useFocusRing();
  const on = selected === true;
  const ink = on ? inverted.text : tones.primary;

  return (
    <Animated.View style={[styles.keyWrap, press.style]}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={({ pressed }) => [
          styles.key,
          { minHeight: height, backgroundColor: on ? inverted.fill : pressed ? block.pressed : block.rest },
          disabled && styles.blocked,
          ring,
        ]}
      >
        {typeof children === 'string' ? (
          <Text style={[styles.keyText, { color: ink }]} accessibilityElementsHidden importantForAccessibility="no">
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    </Animated.View>
  );
}

function ResultChip({
  text,
  label,
  disabled,
  onPress,
  testID,
}: {
  readonly text: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const surface = useSurface();
  const inverted = INVERTED[blockSurface(surface)];
  const press = usePressScale();
  const { ring, onFocus, onBlur } = useFocusRing();
  const reach = Math.max(0, (size.touchTarget - CHIP_HEIGHT) / 2);
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        hitSlop={{ top: reach, bottom: reach }}
        testID={testID}
        style={[styles.chip, { backgroundColor: inverted.fill }, disabled && styles.blocked, ring]}
      >
        <Text style={[styles.chipText, { color: inverted.text }]} accessibilityElementsHidden importantForAccessibility="no">
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** A refusal, drawn as `Field` draws an error: the sentence in legible ink, a danger glyph beside it. */
function KeypadMessage({ text, testID }: { readonly text: string; readonly testID: string }) {
  const surface = useSurface();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (text === last.current) return;
    last.current = text;
    announce(text, { assertive: true });
  }, [text]);
  return (
    <View style={styles.message} accessible accessibilityLabel={text} testID={testID}>
      <Icon icon={Glyphs.Warning2} size={14} color={colors.danger} />
      <Text style={[styles.messageText, { color: errorTextColor(surface) }]}>{text}</Text>
    </View>
  );
}

const CHIP_HEIGHT = 32;

/** The selected operator and the result chip: the surface's own ink as a fill, as `primary` inverts. */
const INVERTED = {
  white: { fill: colors.surface1, text: colors.textPrimary },
  dark: { fill: colors.whiteSurface, text: colors.textOnWhite },
} as const;

const styles = StyleSheet.create({
  root: { gap: spacing[4] },
  display: { gap: spacing[2] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: spacing[2] },
  major: { ...font.semibold, fontSize: fontSize.h1, lineHeight: lineHeight.h1, letterSpacing: tracking.h1 },
  minor: { ...font.medium, fontSize: fontSize.base, letterSpacing: tracking.body },
  currency: { ...font.medium, fontSize: fontSize.base, lineHeight: lineHeight.body },
  operationRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  operation: {
    ...font.medium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    fontVariant: ['tabular-nums'],
  },
  chip: {
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...font.medium, fontSize: fontSize.sm, lineHeight: lineHeight.small, fontVariant: ['tabular-nums'] },
  message: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  messageText: { ...font.regular, fontSize: fontSize.caption, lineHeight: lineHeight.small, flexShrink: 1 },
  // The cells pad themselves, so the outer keys line up with the sheet's edge.
  keys: { gap: spacing[2], marginHorizontal: -spacing[1] },
  operators: { flexDirection: 'row' },
  operatorCell: { flex: 1, paddingHorizontal: spacing[1] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[2] },
  cell: { width: '33.333%', paddingHorizontal: spacing[1] },
  keyWrap: { flex: 1 },
  key: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  keyText: { ...font.medium, fontSize: fontSize.h3, lineHeight: lineHeight.h3, fontVariant: ['tabular-nums'] },
  blocked: { opacity: 0.4 },
});
