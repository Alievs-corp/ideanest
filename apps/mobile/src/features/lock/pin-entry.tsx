import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Body, Icon, PinDots, PinPad, Subheading, TONES, useSurface, type PinPadAction } from '../../components/ui';
import { Glyphs } from '../../icons';
import { PIN_LENGTH } from '../../lib/pin';
import { colors, size, spacing } from '../../theme';

/**
 * Six digits, entered and handed on — the one shape every PIN step of the app lock takes (#319):
 * the lock screen, choosing a PIN, confirming it, and "confirm it's you" in settings.
 *
 * <p>The entry clears itself once `onComplete` has settled, whatever it decided, so a wrong PIN
 * is never left on the pad to be added to. While it settles the pad takes nothing and a spinner
 * names what is happening — the derivation is deliberately not instant (`lib/pin.ts`).
 *
 * <p>A refusal (`error`) appears at once under the dots, with the danger glyph and the surface's
 * own ink: never colour alone, and never animated in. The screens announce it themselves, when
 * they set it, so the same sentence twice is still said twice.
 */
export interface PinEntryProps {
  readonly title: string;
  readonly intro?: string | null;
  readonly error?: string | null;
  /** Said beside the spinner while `onComplete` runs. */
  readonly busyLabel: string;
  readonly onComplete: (pin: string) => Promise<void> | void;
  readonly action?: PinPadAction | null;
  /** Under the pad: "Forgot your PIN?", "Turn the lock off instead". */
  readonly footer?: ReactNode;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function PinEntry({
  title,
  intro = null,
  error = null,
  busyLabel,
  onComplete,
  action = null,
  footer = null,
  disabled = false,
  testID = 'pin-entry',
}: PinEntryProps) {
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const complete = (pin: string) => {
    setWorking(true);
    void Promise.resolve()
      .then(() => onComplete(pin))
      .finally(() => {
        if (!mounted.current) return;
        setValue('');
        setWorking(false);
      });
  };

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.head}>
        <Subheading accessibilityRole="header" style={styles.center}>
          {title}
        </Subheading>
        {intro === null ? null : <Body style={styles.center}>{intro}</Body>}
        <PinDots count={value.length} length={PIN_LENGTH} testID={`${testID}-dots`} />
        <View style={styles.status}>
          {working ? (
            <Working label={busyLabel} />
          ) : error === null ? null : (
            <Refusal text={error} testID={`${testID}-error`} />
          )}
        </View>
      </View>
      <PinPad
        value={value}
        onChange={setValue}
        onComplete={complete}
        length={PIN_LENGTH}
        disabled={disabled || working}
        action={action}
        testID={`${testID}-pad`}
      />
      {footer === null ? null : <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

function Working({ label }: { readonly label: string }) {
  const tones = TONES[useSurface()];
  return (
    <View style={styles.line} accessible accessibilityLabel={label} accessibilityState={{ busy: true }}>
      <ActivityIndicator color={tones.secondary} />
      <Body>{label}</Body>
    </View>
  );
}

function Refusal({ text, testID }: { readonly text: string; readonly testID: string }) {
  const tones = TONES[useSurface()];
  return (
    <View style={styles.line}>
      <Icon icon={Glyphs.Warning2} size={18} color={colors.danger} />
      <Body style={[styles.refusal, { color: tones.primary }]} testID={testID}>
        {text}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing[6] },
  head: { gap: spacing[3], alignItems: 'stretch' },
  center: { textAlign: 'center' },
  status: { minHeight: size.touchTarget, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: spacing[2] },
  refusal: { flexShrink: 1 },
  footer: { gap: spacing[3], alignItems: 'stretch' },
});
