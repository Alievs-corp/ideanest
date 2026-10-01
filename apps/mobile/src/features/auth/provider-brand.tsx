import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusRing } from '../../components/ui';
import { font, fontSize, radius, size, spacing } from '../../theme';
import { GOOGLE, GOOGLE_G } from './google-brand';

/**
 * Google's sign-in button. Its colours and the "G" are Google's, from `google-brand.ts` — the one
 * file under `src` allowed colour literals (issue #152); see there. Apple's button is the native
 * control (`AppleAuthenticationButton`) and needs nothing of ours.
 */

/** The "G", decorative: the button's label already says Google. */
function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {GOOGLE_G.map(({ fill, d }) => (
        <Path key={fill} fill={fill} d={d} />
      ))}
    </Svg>
  );
}

/** The height both provider buttons share — the large pill's, so the column reads as one. */
export const PROVIDER_BUTTON_HEIGHT = 48;

export function GoogleButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  const blocked = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      testID="provider-google"
      style={[styles.google, ring, blocked && !busy && styles.dimmed]}
    >
      <View style={styles.mark}>
        {busy ? <ActivityIndicator size="small" color={GOOGLE.ink} /> : <GoogleMark />}
      </View>
      <Text style={styles.googleLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  google: {
    minHeight: Math.max(PROVIDER_BUTTON_HEIGHT, size.touchTarget),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: GOOGLE.border,
    backgroundColor: GOOGLE.fill,
  },
  dimmed: { opacity: 0.6 },
  mark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  googleLabel: { ...font.medium, fontSize: fontSize.base, color: GOOGLE.ink },
});
