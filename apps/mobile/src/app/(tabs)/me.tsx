import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import * as Application from 'expo-application';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { siteUrl } from '../../api/config';
import { Avatar } from '../../components/avatar';
import { Button } from '../../components/form';
import { InlineAlert } from '../../components/states';
import { Body, CardTitle, Meta, Subheading } from '../../components/text';
import { WhatsAppSheet } from '../../components/whatsapp-sheet';
import { canReadAccount, useMe, useSessionState, type Me } from '../../lib/account';
import { signOut } from '../../lib/auth';
import { biometricCapability, canLock, type BiometricCapability } from '../../lib/biometrics';
import { useT, type MessageKey } from '../../lib/i18n';
import { currentLocale } from '../../lib/locale';
import { forgetPersistedCache } from '../../lib/offline';
import { disableLock, enableLock } from '../../lib/session';
import { useSession } from '../../lib/use-session';
import { colors, fontSize, radius, size, spacing } from '../../theme';

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
 *
 * <h2>Three layouts, from `GET /v1/me` rather than from the keychain</h2>
 *
 * - **signed-in**: who you are, what needs your attention, then the web's `ACCOUNT_GROUPS`,
 *   the creator rows, this phone, About and sign-out;
 * - **signed-out**: the invitation to register or sign in, the language, About;
 * - **unknown** (a token on the phone and the service unreachable, a 5xx, or the biometric
 *   lock not unlocked): This phone, About with the WhatsApp row, and Sign out. Nothing
 *   account-shaped, and above all no "Sign in" — offering one to somebody who is signed in,
 *   during an outage, is the mistake `lib/account.ts` exists to avoid. This phone and Sign out
 *   stay because they need no answer from the service, and they are the only way out of a
 *   lock the reader no longer wants. While the first answer is still on its way the identity
 *   row is a skeleton, so the screen does not jump when the name arrives.
 *
 * All three end with the web footer's last row (`Colophon`), and Sign out asks first.
 */

interface Row {
  /** A catalogue key. */
  readonly label: MessageKey;
  readonly href?: Href;
  /** A tab rather than a screen: switched to, so the tab keeps its own history. */
  readonly tab?: boolean;
  readonly web?: string;
}

/** `ACCOUNT_GROUPS.yourAccount`, in its order. Pledges and Saved are tabs here. */
const YOUR_ACCOUNT: readonly Row[] = [
  { label: 'account.links.pledges.label', href: '/pledges', tab: true },
  { label: 'account.links.campaigns.label', href: '/account/campaigns' },
  { label: 'account.links.saved.label', href: '/saved', tab: true },
  { label: 'account.links.following.label', href: '/account/following' },
  { label: 'account.links.surveys.label', href: '/account/surveys' },
  { label: 'account.links.deliveries.label', href: '/account/deliveries' },
];

const CREATOR: readonly Row[] = [
  { label: 'shell.actions.startCampaign', href: '/campaigns/new' },
  { label: 'shell.nav.pricing', href: '/pricing' },
];

/** `ACCOUNT_GROUPS.settings`, in its order: one row per `settings/<key>`. */
const SETTINGS: readonly Row[] = (
  [
    'profile',
    'notifications',
    'sessions',
    'email',
    'password',
    'security',
    'privacy',
    'payout',
    'language',
  ] as const
).map((key) => ({ label: `account.links.${key}.label`, href: `/settings/${key}` as const }));

const LANGUAGE_ONLY: readonly Row[] = [{ label: 'mobile.me.language', href: '/settings/language' }];

/** The web footer's `FOOTER_GROUPS.about`, with the same paths. */
const ABOUT: readonly Row[] = [
  { label: 'shell.footer.links.about', web: '/about' },
  { label: 'shell.footer.links.howItWorks', web: '/how-it-works' },
  { label: 'shell.footer.links.trustSafety', web: '/trust-safety' },
  { label: 'shell.footer.links.legal', web: '/legal' },
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
  identity: { paddingVertical: spacing[4] },
  bone: { backgroundColor: colors.surface3, borderRadius: radius.sm },
  boneAvatar: { width: size.avatarInCard, height: size.avatarInCard, borderRadius: radius.full },
  boneName: { width: '50%', height: fontSize.lg },
  boneEmail: { width: '70%', height: fontSize.xs },
  alertLink: { minHeight: size.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
  alertLinkText: { textDecorationLine: 'underline' },
  colophon: { textAlign: 'center' },
});

function NavRow({ row, onPress }: { readonly row: Row; readonly onPress?: () => void }) {
  const router = useRouter();
  const t = useT();
  const label = t(row.label);
  return (
    <Pressable
      // In-app rows are buttons; only the ones that leave for the browser are links.
      accessibilityRole={row.web === undefined ? 'button' : 'link'}
      accessibilityLabel={label}
      onPress={() => {
        if (onPress !== undefined) onPress();
        else if (row.href !== undefined) {
          if (row.tab === true) router.navigate(row.href);
          else router.push(row.href);
        } else if (row.web !== undefined) {
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

function Group({
  titleKey,
  rows,
  children,
}: {
  readonly titleKey: MessageKey;
  readonly rows: readonly Row[];
  /** Rows that do something other than navigate, after the ones that do. */
  readonly children?: ReactNode;
}) {
  const t = useT();
  return (
    <View style={styles.section}>
      <Subheading accessibilityRole="header">{t(titleKey)}</Subheading>
      <View style={styles.card}>
        {rows.map((row) => (
          <NavRow key={row.label} row={row} />
        ))}
        {children}
      </View>
    </View>
  );
}

/**
 * Who is signed in: the web account menu's avatar, name and address, and the way to the
 * public profile (`shell.actions.profile`).
 *
 * The avatar is decorative here for the reason `AccountMenu` gives: the name is written beside
 * it, and a label on both is the name read twice. One stop for the whole row, which says the
 * name and the address, and a hint that says where it goes.
 */
function IdentityRow({ me }: { readonly me: Me }) {
  const router = useRouter();
  const t = useT();
  const name = me.name ?? me.email ?? '';
  const email = me.email ?? '';
  const slug = me.slug;
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={email === '' ? name : `${name}, ${email}`}
        accessibilityHint={t('shell.actions.profile')}
        disabled={slug === undefined}
        onPress={() => {
          if (slug !== undefined) router.push({ pathname: '/u/[slug]', params: { slug } });
        }}
        style={({ pressed }) => [styles.row, styles.identity, pressed && styles.rowPressed]}
      >
        <Avatar name={name} decorative />
        <View style={styles.rowText}>
          <CardTitle numberOfLines={1}>{name}</CardTitle>
          <Meta numberOfLines={1}>{email}</Meta>
        </View>
        <Meta style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
          ›
        </Meta>
      </Pressable>
    </View>
  );
}

/**
 * The identity row's shape before the account has answered. Hidden from screen readers: it
 * says nothing, and the row it stands in for is announced when it arrives.
 */
function IdentitySkeleton() {
  return (
    <View
      testID="identity-skeleton"
      style={styles.card}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.row, styles.identity]}>
        <View style={[styles.bone, styles.boneAvatar]} />
        <View style={styles.rowText}>
          <View style={[styles.bone, styles.boneName]} />
          <View style={[styles.bone, styles.boneEmail]} />
        </View>
      </View>
    </View>
  );
}

/**
 * What the account needs from its owner, in the web account menu's words.
 *
 * Unverified first, as `AccountMenu` has it: verification is required (§4.1 A-01) and this is
 * the one place somebody who closed the email would find out. A scheduled closure second, with
 * the way to the page that cancels it — the settings namespace's own sentence, so the Me tab
 * and the closure panel describe the same state in the same words.
 */
function AccountAlerts({ me }: { readonly me: Me }) {
  const router = useRouter();
  const t = useT();
  return (
    <>
      {me.emailVerified === false ? (
        <InlineAlert
          variant="warning"
          detail={t('shell.actions.unverified', { email: me.email ?? '' })}
        />
      ) : null}
      {me.deletionScheduledAt ? (
        <InlineAlert
          variant="warning"
          title={t('settings.panels.closure.scheduledTitle')}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('account.links.privacy.label')}
              onPress={() => router.push('/settings/privacy')}
              style={({ pressed }) => [styles.alertLink, pressed && styles.rowPressed]}
            >
              <Body
                tone="primary"
                style={styles.alertLinkText}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {t('account.links.privacy.label')}
              </Body>
            </Pressable>
          }
        />
      ) : null}
    </>
  );
}

/**
 * The web footer's last row (`SiteFooter`), and what only the app has to add to it: which
 * build this is, the first thing support asks.
 *
 * <p>"© IdeyaNest" without a year, for the web's reason — a year from `new Date()` is a value
 * that changes under a screen nobody touched. The currency is the web's heading and value,
 * because phase 1 collects in manat whatever the reader's language. The version and build are
 * the native ones (`expo-application`), not `app.config.ts`'s, since the binary is what a bug
 * report has to name; neither exists outside a native build, so the line is left out there.
 *
 * <p>One text, so a screen reader reads the block in one stop, and meta-sized and tertiary
 * like the web's: it is information, not a control.
 */
function Colophon() {
  const t = useT();
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  const lines = [
    t('mobile.me.copyright'),
    `${t('shell.footer.currencyHeading')}: ${t('shell.footer.currencyValue')}`,
    ...(version !== null && build !== null ? [t('mobile.me.version', { version, build })] : []),
  ];
  return <Meta style={styles.colophon}>{lines.join('\n')}</Meta>;
}

export default function MeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const session = useSession();
  const { locked, unlocked } = session;
  const state = useSessionState();
  const me = useMe();
  const account = state === 'signed-in' ? (me.data ?? null) : null;
  /**
   * Unknown because the answer is on its way — not because asking failed or would prompt, and
   * not because the read is paused for a connection (issue #150): a paused query is neither
   * fetching nor an error, and a skeleton for it would wait as long as the phone is offline.
   */
  const loading =
    state === 'unknown' && canReadAccount(session) && !me.isError && me.fetchStatus === 'fetching';
  /*
   * A session on this phone that the service has not denied. Signed in, or unknown with a token
   * — an outage, or the lock not unlocked. Either way This phone and Sign out stay: they are the
   * way out of a lock the reader no longer wants, and neither needs the account to answer.
   */
  const holdsSession = session.signedIn && state !== 'signed-out';

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [contacting, setContacting] = useState(false);

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

  /**
   * Sign out, once the reader has said so. It ends the session and forgets the offline copy of
   * their pledges and saved projects, and one stray tap at the foot of a scrolled list should
   * not do that — so the pill asks first, as a native alert with the destructive action named
   * in the pill's own words and Cancel as the way back.
   */
  function confirmSignOut(): void {
    if (busy) return;
    Alert.alert(t('mobile.me.signOutConfirm.title'), t('mobile.me.signOutConfirm.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('shell.actions.signOut'), style: 'destructive', onPress: () => void endIt() },
    ]);
  }

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
      {loading ? <IdentitySkeleton /> : null}

      {account !== null ? (
        <>
          <IdentityRow me={account} />
          <AccountAlerts me={account} />
          <Group titleKey="account.groups.yourAccount" rows={YOUR_ACCOUNT} />
          <Group titleKey="shell.footer.groups.creators" rows={CREATOR} />
          <Group titleKey="account.groups.settings" rows={SETTINGS} />
        </>
      ) : null}

      {holdsSession ? (
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

      {state === 'signed-out' ? (
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
      ) : null}

      <Group titleKey="shell.footer.groups.about" rows={ABOUT}>
        <NavRow row={{ label: 'shell.whatsapp.open' }} onPress={() => setContacting(true)} />
      </Group>

      <Colophon />

      {holdsSession ? (
        <Button
          label={t('shell.actions.signOut')}
          variant="secondary"
          busy={busy}
          onPress={confirmSignOut}
        />
      ) : null}

      <WhatsAppSheet visible={contacting} onClose={() => setContacting(false)} />
    </ScrollView>
  );
}

/** What to call the control, in the words of whatever the device actually has. */
function lockLabelKey(capability: BiometricCapability | null): MessageKey {
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
): MessageKey {
  if (capability === null) return 'mobile.lock.wait';
  if (capability === 'unavailable') return 'mobile.lock.keychain';
  if (capability === 'not-enrolled') return 'mobile.lock.enrol';
  if (!locked) return 'mobile.lock.keychain';
  return unlocked ? 'mobile.lock.open' : 'mobile.lock.armed';
}
