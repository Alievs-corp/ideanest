import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { announce } from './announce';
import { useFocusRing } from './focus';
import { haptics } from './haptics';
import { Icon, type IconComponent } from './icon';
import { usePressScale } from './press-scale';
import { BLOCK, TONES, blockSurface, useSurface } from './surface';

/**
 * A PIN pad and the dots above it — the app lock's (issue #319).
 *
 * <h2>Not the amount keypad</h2>
 *
 * `AmountKeypad` is money: a point, operators, a result chip, an amount read back. A PIN has none
 * of that and one thing the amount does not: it must never be read back. So the digits entered are
 * shown as dots — a filled disc for each one entered, a ring for each still to come, so the count
 * is carried by shape and not by colour — and announced as "3 of 6 entered", never as the digits.
 *
 * <h2>Keys</h2>
 *
 * Twelve cells: 1–9, then an optional action (the biometric prompt on the lock screen), 0, and
 * delete. Every key is at least {@link size.touchTarget} high and named — a digit by itself,
 * delete and the action by their sentences. A press counts on the frame it lands; the press scale
 * is decoration (`usePressScale`, which stands still under Reduce Motion) and `haptics.pinKey`
 * the touch. No lime: nothing here is money about to move.
 *
 * <p>The pad is controlled: `value` is the digits so far and `onChange` gets the next string. It
 * stops taking digits at `length`, and calls `onComplete` with the whole PIN on the press that
 * filled it.
 */

export interface PinPadAction {
  readonly label: string;
  readonly icon: IconComponent;
  readonly onPress: () => void;
}

export interface PinPadProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Called with the whole PIN on the press that completed it. */
  readonly onComplete?: (pin: string) => void;
  readonly length?: number;
  readonly disabled?: boolean;
  /** The bottom-left key — "Use fingerprint" on the lock screen. Empty when absent. */
  readonly action?: PinPadAction | null;
  readonly testID?: string;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const KEY_HEIGHT = spacing[16];
const DOT = spacing[3];

export function PinPad({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  action = null,
  testID = 'pin-pad',
}: PinPadProps) {
  const t = useT('mobile.lock.pad');
  const surface = useSurface();
  const tones = TONES[surface];

  const say = (count: number) => announce(t('entered', { count, total: length }));

  /*
   * The value as the last press left it. Two presses that land in one batch both see the same
   * `value` prop; reading it would let both "complete" the PIN, so the presses read this instead,
   * and each render puts it back in step with the prop.
   */
  const latest = useRef(value);
  latest.current = value;

  const press = (digit: string) => {
    const current = latest.current;
    if (disabled || current.length >= length) return;
    haptics.pinKey();
    const next = current + digit;
    latest.current = next;
    onChange(next);
    say(next.length);
    if (next.length === length) onComplete?.(next);
  };

  const erase = () => {
    const current = latest.current;
    if (disabled || current === '') return;
    haptics.pinKey();
    const next = current.slice(0, -1);
    latest.current = next;
    onChange(next);
    say(next.length);
  };

  return (
    <View style={styles.grid} testID={testID}>
      {DIGITS.map((digit) => (
        <Cell key={digit}>
          <Key label={digit} disabled={disabled} onPress={() => press(digit)} testID={`${testID}-${digit}`}>
            {digit}
          </Key>
        </Cell>
      ))}
      <Cell>
        {action === null ? null : (
          <Key
            role="button"
            label={action.label}
            disabled={disabled}
            onPress={action.onPress}
            testID={`${testID}-action`}
          >
            <Icon icon={action.icon} size={24} color={tones.primary} />
          </Key>
        )}
      </Cell>
      <Cell>
        <Key label="0" disabled={disabled} onPress={() => press('0')} testID={`${testID}-0`}>
          0
        </Key>
      </Cell>
      <Cell>
        <Key
          role="button"
          label={t('delete')}
          disabled={disabled || value === ''}
          onPress={erase}
          testID={`${testID}-delete`}
        >
          <Icon icon={Glyphs.ArrowLeft} size={24} color={tones.primary} />
        </Key>
      </Cell>
    </View>
  );
}

/** The dots: one per digit, filled when entered. One element for a screen reader: "2 of 6 entered". */
export function PinDots({
  count,
  length = 6,
  testID = 'pin-dots',
}: {
  readonly count: number;
  readonly length?: number;
  readonly testID?: string;
}) {
  const t = useT('mobile.lock.pad');
  const tones = TONES[useSurface()];
  return (
    <View
      style={styles.dots}
      accessible
      accessibilityLabel={t('entered', { count, total: length })}
      testID={testID}
    >
      {Array.from({ length }, (_, index) => {
        const filled = index < count;
        return (
          <View
            key={index}
            testID={filled ? `${testID}-filled` : `${testID}-empty`}
            style={[
              styles.dot,
              filled
                ? { backgroundColor: tones.primary, borderColor: tones.primary }
                : { borderColor: tones.tertiary },
            ]}
          />
        );
      })}
    </View>
  );
}

function Cell({ children }: { readonly children?: ReactNode }) {
  return <View style={styles.cell}>{children}</View>;
}

function Key({
  role = 'keyboardkey',
  label,
  disabled,
  onPress,
  children,
  testID,
}: {
  readonly role?: 'button' | 'keyboardkey';
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
  readonly testID: string;
}) {
  const surface = useSurface();
  const tones = TONES[surface];
  const block = BLOCK[blockSurface(surface)];
  const press = usePressScale();
  const { ring, onFocus, onBlur } = useFocusRing();

  return (
    <Animated.View style={[styles.keyWrap, press.style]}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={({ pressed }) => [
          styles.key,
          { backgroundColor: pressed ? block.pressed : block.rest },
          disabled && styles.blocked,
          ring,
        ]}
      >
        {typeof children === 'string' ? (
          <Text
            style={[styles.keyText, { color: tones.primary }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing[2] },
  cell: { width: '33.333%', paddingHorizontal: spacing[1] },
  keyWrap: { width: '100%' },
  key: {
    minHeight: Math.max(KEY_HEIGHT, size.touchTarget),
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { ...font.medium, fontSize: fontSize.h2, lineHeight: lineHeight.h2, fontVariant: ['tabular-nums'] },
  blocked: { opacity: 0.4 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[4],
    minHeight: size.touchTarget,
    alignItems: 'center',
  },
  dot: { width: DOT, height: DOT, borderRadius: radius.full, borderWidth: 2 },
});
