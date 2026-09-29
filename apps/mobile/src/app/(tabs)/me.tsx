import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { siteUrl } from '../../api/config';
import { Button } from '../../components/form';
import { Body, CardTitle, Meta, Subheading } from '../../components/text';
import { signOut } from '../../lib/auth';
import { biometricCapability, canLock, type BiometricCapability } from '../../lib/biometrics';
import { useT } from '../../lib/i18n';
import { currentLocale } from '../../lib/locale';
import { forgetPersistedCache } from '../../lib/offline';
import { disableLock, enableLock } from '../../lib/session';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * The Me tab — issue #150. The web's account menu, settings list and footer, in one place.
 *
 * It replaces `app/account.tsx`, and the biometric lock moves here unchanged in
 * behaviour under "This phone" (the switch is offered only when the device can honour it,
 * and signing out clears the offline cache because #115 keeps the saved and pledge lists
 * on disk).
 *
 * Every word is a catalogue key: the web's own where the web has the sentence, the
 * `mobile` namespace where only the app does. The staff console link is never rendered:
 * administration is not in the app.
 */

interface Row {
  /** A catalogue key. */
  readonly label: string;
  readonly href?: Href;
  readonly web?: string;
}

const YOUR_ACCOUNT: readonly Row[] = [
  { label: 'account.links.campaigns.label', href: '/account/campaigns' },
  { label: 'account.links.following.label', href: '/account/following' },
  { label: 'account.links.surveys.label', href: '/account/surveys' },
  { label: 'account.links.deliveries.label', href: '/account/deliveries' },
];

const CREATOR: readonly Row[] = [
  { label: 'shell.actions.startCampaign', href: '/campaigns/new' },
  { label: 'shell.nav.pricing', href: '/pricing' },
];

const SETTINGS: readonly Row[] = [
  { label: 'shell.actions.settings', href: '/settings' },
  { label: 'mobile.me.language', href: '/settings/language' },
];

const LANGUAGE_ONLY: readonly Row[] = [{ label: 'mobile.me.language', href: '/settings/language' }];

const ABOUT: readonly Row[] = [
  { label: 'shell.footer.links.about', web: '/about' },
  { label: 'shell.footer.links.howItWorks', web: '/how-it-works' },
  { label: 'shell.footer.links.trustSafety', web: '/trust' },
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
  const t = useT();
  const label = t(row.label);
  return (
    <Pressable
      // In-app rows are buttons; only the ones that leave for the browser are links.
      accessibilityRole={row.web === undefined ? 'button' : 'link'}
      accessibilityLabel={label}
      onPress={() => {
        if (row.href !== undefined) router.push(row.href);
        else if (row.web !== undefined) {
          void WebBrowser.openBrowserAsync(`${siteUrl()}/${currentLocale()}${row.web}`);
        }
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <CardTitle style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </CardTitle>
      <Meta style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
        ›
      </Meta>
    </Pressable>
  );
}

function Group({ titleKey, rows }: { readonly titleKey: string; readonly rows: readonly Row[] }) {
  const t = useT();
  return (
    <View style={styles.section}>
      <Subheading accessibilityRole="header">{t(titleKey)}</Subheading>
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
  const t = useT();
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

  const lockLabel = t(lockLabelKey(capability));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {signedIn ? (
        <>
          <Group titleKey="account.groups.yourAccount" rows={YOUR_ACCOUNT} />
          <Group titleKey="shell.footer.groups.creators" rows={CREATOR} />
          <Group titleKey="account.groups.settings" rows={SETTINGS} />
        </>
      ) : (
        <>
          <View style={styles.section}>
            <Body>{t('shell.tagline')}</Body>
            <Button
              label={t('shell.actions.register')}
              onPress={() =>
                void WebBrowser.openBrowserAsync(`${siteUrl()}/${currentLocale()}/register`)
              }
            />
            <Button
              label={t('shell.actions.signIn')}
              variant="secondary"
              onPress={() => router.push('/sign-in')}
            />
          </View>
          <Group titleKey="account.groups.settings" rows={LANGUAGE_ONLY} />
        </>
      )}

      {signedIn ? (
        <View style={styles.section}>
          <Subheading accessibilityRole="header">{t('mobile.me.thisPhone')}</Subheading>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Body tone="primary">{lockLabel}</Body>
                <Meta>{t(lockDetailKey(capability, locked, unlocked))}</Meta>
              </View>
              {capability !== null && canLock(capability) ? (
                <Switch
                  value={locked}
                  onValueChange={(next) => void toggleLock(next)}
                  disabled={busy}
                  accessibilityLabel={lockLabel}
                  trackColor={{ false: colors.surface3, true: colors.lime500 }}
                  thumbColor={locked ? colors.textOnLime : colors.textTertiary}
                />
              ) : null}
            </View>
            {refused ? (
              <Body accessibilityRole="alert" style={{ color: colors.danger }}>
                {t('mobile.lock.refused')}
              </Body>
            ) : null}
          </View>
        </View>
      ) : null}

      <Group titleKey="shell.footer.groups.about" rows={ABOUT} />

      {signedIn ? (
        <Button
          label={t('shell.actions.signOut')}
          variant="secondary"
          busy={busy}
          onPress={() => void endIt()}
        />
      ) : null}
    </ScrollView>
  );
}

/** What to call the control, in the words of whatever the device actually has. */
function lockLabelKey(capability: BiometricCapability | null): string {
  switch (capability) {
    case 'face':
      return 'mobile.lock.face';
    case 'fingerprint':
      return 'mobile.lock.fingerprint';
    case 'other':
      return 'mobile.lock.other';
    case 'not-enrolled':
      return 'mobile.lock.notEnrolled';
    case 'unavailable':
      return 'mobile.lock.unavailable';
    case null:
      return 'mobile.lock.checking';
  }
}

function lockDetailKey(
  capability: BiometricCapability | null,
  locked: boolean,
  unlocked: boolean,
): string {
  if (capability === null) return 'mobile.lock.wait';
  if (capability === 'unavailable') return 'mobile.lock.keychain';
  if (capability === 'not-enrolled') return 'mobile.lock.enrol';
  if (!locked) return 'mobile.lock.keychain';
  return unlocked ? 'mobile.lock.open' : 'mobile.lock.armed';
}
