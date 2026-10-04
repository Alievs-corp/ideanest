import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Glyphs } from '../../icons';
import { Body, Icon, useFocusRing } from '../../components/ui';
import { colors, radius, size, spacing } from '../../theme';

/**
 * The quiet links of the auth screens — "Forgot your password?", "No account yet? Create one" —
 * and the two-factor step's disclosure (issue #152).
 *
 * <p>Underlined text rather than a pill: on the web these are links, and a second button-shaped
 * control under the submit pill would compete with the one action the screen is for. The touch
 * target is still {@link size.touchTarget} tall, because a thumb is not a pointer.
 */
export function AuthLink({
  label,
  onPress,
  prompt,
  role = 'link',
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  /** The sentence before the link, read with it: "No account yet?" before "Create one". */
  readonly prompt?: string;
  /** `button` for an action that stays on the screen ("Use a different account"). */
  readonly role?: 'link' | 'button';
  readonly testID?: string;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <View style={styles.row}>
      {prompt === undefined ? null : <Body>{prompt}</Body>}
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={label}
        onPress={onPress}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={({ pressed }) => [styles.target, ring, pressed && styles.pressed]}
      >
        <Body tone="primary" style={styles.underlined}>
          {label}
        </Body>
      </Pressable>
    </View>
  );
}

interface LinkSpec {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID?: string;
}

/**
 * Two links on one line with a middle dot between them — "Ask for a new link · Sign in". The dot
 * is decoration and is not read out; each link is its own stop for the screen reader.
 */
export function AuthLinkPair({ first, second }: { readonly first: LinkSpec; readonly second: LinkSpec }) {
  return (
    <View style={styles.row}>
      <AuthLink {...first} />
      <Body accessibilityElementsHidden importantForAccessibility="no">
        ·
      </Body>
      <AuthLink {...second} />
    </View>
  );
}

/**
 * A native accordion row: collapsed by default, `accessibilityState.expanded` said with it.
 * The web's `<details>`; nothing animates open — an accordion would animate height, which the
 * `mobile-design` skill §6.1 rules out.
 */
export function Disclosure({
  label,
  children,
  open: controlled,
  onToggle,
  testID,
}: {
  readonly label: string;
  readonly children: ReactNode;
  /** Controlled when given, for a parent that has to know whether its contents are showing. */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  readonly testID?: string;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const toggle = () => {
    if (controlled === undefined) setOwn(!open);
    onToggle?.(!open);
  };
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={({ pressed }) => [styles.summary, ring, pressed && styles.pressed]}
      >
        <Body style={styles.summaryText}>{label}</Body>
        <Icon icon={open ? Glyphs.ArrowUp2 : Glyphs.ArrowDown2} size={16} color={colors.textTertiary} />
      </Pressable>
      {open ? <View style={styles.details}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    columnGap: spacing[1],
  },
  target: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[1],
    borderRadius: radius.sm,
  },
  pressed: { opacity: 0.8 },
  underlined: { textDecorationLine: 'underline' },
  disclosure: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  summary: {
    minHeight: size.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
  },
  summaryText: { flex: 1 },
  details: { paddingHorizontal: spacing[4], paddingBottom: spacing[4] },
});
