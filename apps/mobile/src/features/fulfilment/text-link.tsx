import { StyleSheet } from 'react-native';
import { Body, Icon, PressableScale, TONES, useFocusRing, useSurface, type IconComponent } from '../../components/ui';
import { size, spacing } from '../../theme';

export interface TextLinkProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon?: IconComponent;
  /** What happens on press, where the words alone do not say (an external page). */
  readonly accessibilityHint?: string;
  /** The secondary tone, for the lesser of two links side by side. */
  readonly quiet?: boolean;
  readonly testID?: string;
}

/**
 * An underlined link in running content — the web's `underline underline-offset-4` link, as the
 * address screen's back link draws it: a full touch target, the press scale, and the focus ring
 * of the surface it sits on.
 */
export function TextLink({ label, onPress, icon, accessibilityHint, quiet = false, testID }: TextLinkProps) {
  const ring = useFocusRing();
  const tones = TONES[useSurface()];
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={styles.start}
      contentStyle={[styles.link, ring.ring]}
      testID={testID}
    >
      {icon === undefined ? null : <Icon icon={icon} size={18} color={quiet ? tones.secondary : tones.primary} />}
      <Body tone={quiet ? 'secondary' : 'primary'} style={styles.underlined}>
        {label}
      </Body>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start', maxWidth: '100%' },
  link: { minHeight: size.touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  underlined: { textDecorationLine: 'underline', flexShrink: 1 },
});
