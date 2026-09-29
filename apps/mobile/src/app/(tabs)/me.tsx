import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { deviceLocale, siteUrl } from '../../api/config';
import { Button } from '../../components/form';
import { Body, CardTitle, Meta, Subheading } from '../../components/text';
import { signOut } from '../../lib/auth';
import { biometricCapability, canLock, type BiometricCapability } from '../../lib/biometrics';
import { forgetPersistedCache } from '../../lib/offline';
import { disableLock, enableLock } from '../../lib/session';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * The Me tab — issue #150. The web's account menu, settings list and footer, in one place.
 *
 * It replaces `app/account.tsx`, and the biometric lock moves here unchanged in
 * behaviour under "This phone" (see the notes that used to head that file: the switch is
 * offered only when the device can honour it, and signing out clears the offline cache
 * because #115 keeps the saved and pledge lists on disk).
 *
 * The staff console link is never rendered: administration is not in the app.
 */

interface Row {
  readonly label: string;
  readonly href?: Href;
  readonly web?: string;
}

const YOUR_ACCOUNT: readonly Row[] = [
  { label: 'My campaigns', href: '/account/campaigns' },
  { label: 'Following', href: '/account/following' },
  { label: 'Surveys', href: '/account/surveys' },
  { label: 'Deliveries', href: '/account/deliveries' },
];

const CREATOR: readonly Row[] = [
  { label: 'Start a campaign', href: '/campaigns/new' },
  { label: 'Pricing', href: '/pricing' },
];

const ABOUT: readonly Row[] = [
  { label: 'About IdeyaNest', web: '/about' },
  { label: 'How it works', web: '/how-it-works' },
  { label: 'Trust and safety', web: '/trust' },
];

const styles = StyleSheet.create({
  content: { padding: size.cardPaddingLarge, gap: spacing[6], paddingBottom: spacing[10] },
  section: { gap: spacing[3] },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: size.cardPaddingSmall,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    minHeight: size.touchTarget + spacing[2],
    paddingVertical: spacing[2],
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: spacing[1] },
  chevron: { color: colors.textTertiary },
});

function NavRow({ row }: { readonly row: Row }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={row.label}
      onPress={() => {
        if (row.href !== undefined) router.push(row.href);
        else if (row.web !== undefined) {
          void WebBrowser.openBrowserAsync(`${siteUrl()}/${deviceLocale()}${row.web}`);
        }
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <CardTitle style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no">
        {row.label}
      </CardTitle>
      <Meta style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
        ›
      </Meta>
    </Pressable>
  );
}

function Group({ title, rows }: { readonly title: string; readonly rows: readonly Row[] }) {
  return (
    <View style={styles.section}>
      <Subheading accessibilityRole="header">{title}</Subheading>
      <View style={styles.card}>
        {rows.map((row) => (
          <NavRow key={row.label} row={row} />
        ))}
      </View>
    </View>
  );
}

export default function MeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signedIn, locked, unlocked } = useSession();

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let live = true;
    void biometricCapability().then((answer) => {
      if (live) setCapability(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggleLock = useCallback(
    async (next: boolean): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setRefused(false);
      try {
        // Both directions can be refused, and for the same reason: turning the
        // lock off has to read the token, which is what presents the prompt.
        const moved = next ? await enableLock() : await disableLock();
        if (!moved) setRefused(true);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  async function endIt(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      queryClient.clear();
      forgetPersistedCache();
      router.navigate('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {signedIn ? (
        <>
          <Group title="Your account" rows={YOUR_ACCOUNT} />
          <Group title="Creators" rows={CREATOR} />
          <Group title="Settings" rows={[{ label: 'All settings', href: '/settings' }]} />
        </>
      ) : (
        <View style={styles.section}>
          <Subheading accessibilityRole="header">Welcome to IdeyaNest</Subheading>
          <Body>
            Discovery and search work without an account. Saved campaigns and pledges need one.
          </Body>
          <Button label="Sign in" onPress={() => router.push('/sign-in')} />
          <Button
            label="Create an account"
            variant="secondary"
            onPress={() =>
              void WebBrowser.openBrowserAsync(`${siteUrl()}/${deviceLocale()}/register`)
            }
          />
        </View>
      )}

      {signedIn ? (
        <View style={styles.section}>
          <Subheading accessibilityRole="header">This phone</Subheading>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Body tone="primary">{lockLabel(capability)}</Body>
                <Meta>{lockDetail(capability, locked, unlocked)}</Meta>
              </View>
              {capability !== null && canLock(capability) ? (
                <Switch
                  value={locked}
                  onValueChange={(next) => void toggleLock(next)}
                  disabled={busy}
                  accessibilityLabel={lockLabel(capability)}
                  trackColor={{ false: colors.surface3, true: colors.lime500 }}
                  thumbColor={locked ? colors.textOnLime : colors.textTertiary}
                />
              ) : null}
            </View>
            {refused ? (
              <Body accessibilityRole="alert" style={{ color: colors.danger }}>
                The device did not confirm it was you, so nothing changed.
              </Body>
            ) : null}
          </View>
        </View>
      ) : null}

      <Group title="About" rows={ABOUT} />

      {signedIn ? (
        <Button label="Sign out" variant="secondary" busy={busy} onPress={() => void endIt()} />
      ) : null}
    </ScrollView>
  );
}

/** What to call the control, in the words of whatever the device actually has. */
function lockLabel(capability: BiometricCapability | null): string {
  switch (capability) {
    case 'face':
      return 'Require Face ID';
    case 'fingerprint':
      return 'Require your fingerprint';
    case 'other':
      return 'Require a device unlock';
    case 'not-enrolled':
      return 'Device unlock is not set up';
    case 'unavailable':
      return 'This phone has no biometric unlock';
    case null:
      return 'Checking what this phone can do';
  }
}

function lockDetail(
  capability: BiometricCapability | null,
  locked: boolean,
  unlocked: boolean,
): string {
  if (capability === null) return 'One moment.';
  if (capability === 'unavailable') {
    return 'Your session stays in the keychain, readable while the phone is unlocked.';
  }
  if (capability === 'not-enrolled') {
    return 'Add a fingerprint, a face or a passcode in your phone’s settings, then come back.';
  }
  if (!locked) {
    return 'Your session stays in the keychain, readable while the phone is unlocked.';
  }
  return unlocked
    ? 'On. This session is open until the app has been away for a few minutes.'
    : 'On. The next time your pledges are read, the phone will ask for you.';
}
