import { useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Application from 'expo-application';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { siteUrl } from '../../api/config';
import { Body, CardTitle, Meta, Subheading } from '../../components/text';
import { Avatar, InlineAlert, MotionBudgetProvider, Pill, Skeleton } from '../../components/ui';
import { WhatsAppSheet } from '../../components/whatsapp-sheet';
import { SETTINGS_SECTIONS, sectionLabelKey, sectionPath } from '../../features/settings/sections';
import { canReadAccount, useMe, useSessionState, type Me } from '../../lib/account';
import { signOut } from '../../lib/auth';
import { useT, type MessageKey } from '../../lib/i18n';
import { currentLocale } from '../../lib/locale';
import { forgetPersistedCache } from '../../lib/offline';
import { useSession } from '../../lib/use-session';
import { colors, fontSize, radius, size, spacing } from '../../theme';

/**
 * The Me tab — issue #150. The web's account menu, settings list and footer, in one place.
 *
 * It replaces `app/account.tsx`. "This phone" is the way to the biometric lock, which lives in
 * `settings/security` (#161) because it belongs to this phone rather than to the account; signing
 * out clears the offline cache because §4.12 MB-04 keeps the saved and pledge lists on disk.
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
 * All three end with the web footer's last row (`Colophon`), after Sign out where there is one,
 * and Sign out asks first.
 *
 * <h2>Kit controls, and no lime</h2>
 *
 * The actions are the kit's pills (issue #151): Register is the white primary, Sign in and Sign
 * out are outlines beside or below it, and nothing here is the lime accent — this tab has no
 * urgent action.
 *
 * <h2>Motion: none</h2>
 *
 * The tab is the web's account menu and settings, which `docs/motion-system.md` §5 gives no
 * motion: the route declares `none`, so the skeleton does not shimmer and a pill does not scale
 * under the thumb.
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
const SETTINGS: readonly Row[] = SETTINGS_SECTIONS.map((section) => ({
  label: sectionLabelKey(section),
  href: sectionPath(section),
}));

const LANGUAGE_ONLY: readonly Row[] = [{ label: 'mobile.me.language', href: '/settings/language' }];

/** The app lock, which is this phone's rather than the account's (#161). */
const THIS_PHONE: readonly Row[] = [
  { label: 'mobile.settings.security.appLockLink', href: '/settings/security' },
];

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
        <Avatar name={name} size="md" decorative />
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
        <Skeleton circle height={size.avatarInCard} />
        <View style={styles.rowText}>
          <Skeleton width="50%" height={fontSize.lg} />
          <Skeleton width="70%" height={fontSize.xs} />
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
 *
 * <p>Both are warnings to look at, and both are polite: they are standing conditions of the
 * account, not something that just happened, and an assertive warning here would interrupt a
 * screen reader every time the Me tab is opened.
 */
function AccountAlerts({ me }: { readonly me: Me }) {
  const router = useRouter();
  const t = useT();
  return (
    <>
      {me.emailVerified === false ? (
        <InlineAlert
          variant="warning"
          politeness="polite"
          description={t('shell.actions.unverified', { email: me.email ?? '' })}
        />
      ) : null}
      {me.deletionScheduledAt ? (
        <InlineAlert
          variant="warning"
          politeness="polite"
          title={t('settings.panels.closure.scheduledTitle')}
          action={
            // The alert's one way out, as the kit draws it inside an alert: a small ghost pill.
            <Pill
              label={t('account.links.privacy.label')}
              onPress={() => router.push('/settings/privacy')}
              variant="ghost"
              size="sm"
            />
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

  const [busy, setBusy] = useState(false);
  const [contacting, setContacting] = useState(false);
  /*
   * Refs, not state, for the two guards: a second tap lands before the re-render that would
   * carry `busy`, so a state guard lets it through — two alerts queued, and each confirm a
   * second `signOut()` and a second navigation. `asking` is held from the alert opening to
   * its answer (or to the end of the sign-out it started); `ending` covers the sign-out itself.
   */
  const asking = useRef(false);
  const ending = useRef(false);

  /**
   * Sign out, once the reader has said so. It ends the session and forgets the offline copy of
   * their pledges and saved projects, and one stray tap at the foot of a scrolled list should
   * not do that — so the pill asks first, as a native alert with the destructive action named
   * in the pill's own words and Cancel as the way back.
   */
  function confirmSignOut(): void {
    if (busy || asking.current) return;
    asking.current = true;
    const release = () => {
      asking.current = false;
    };
    Alert.alert(
      t('mobile.me.signOutConfirm.title'),
      t('mobile.me.signOutConfirm.body'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: release },
        {
          text: t('shell.actions.signOut'),
          style: 'destructive',
          onPress: () => void endIt().finally(release),
        },
      ],
      // Android: a tap outside the dialog or the back button closes it without either choice.
      { cancelable: true, onDismiss: release },
    );
  }

  async function endIt(): Promise<void> {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    try {
      await signOut();
      queryClient.clear();
      forgetPersistedCache();
      router.navigate('/');
    } finally {
      ending.current = false;
      setBusy(false);
    }
  }

  return (
    <MotionBudgetProvider level="none">
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

        {holdsSession ? <Group titleKey="mobile.me.thisPhone" rows={THIS_PHONE} /> : null}

        {state === 'signed-out' ? (
          <>
            <View style={styles.section}>
              <Body>{t('shell.tagline')}</Body>
              <Pill
                label={t('shell.actions.register')}
                size="lg"
                fullWidth
                onPress={() =>
                  void WebBrowser.openBrowserAsync(`${siteUrl()}/${currentLocale()}/register`)
                }
              />
              <Pill
                label={t('shell.actions.signIn')}
                variant="outline"
                size="lg"
                fullWidth
                onPress={() => router.push('/sign-in')}
              />
            </View>
            <Group titleKey="account.groups.settings" rows={LANGUAGE_ONLY} />
          </>
        ) : null}

        <Group titleKey="shell.footer.groups.about" rows={ABOUT}>
          <NavRow row={{ label: 'shell.whatsapp.open' }} onPress={() => setContacting(true)} />
        </Group>

        {holdsSession ? (
          <Pill
            label={t('shell.actions.signOut')}
            variant="outline"
            size="lg"
            fullWidth
            busy={busy}
            onPress={confirmSignOut}
          />
        ) : null}

        <Colophon />

        <WhatsAppSheet visible={contacting} onClose={() => setContacting(false)} />
      </ScrollView>
    </MotionBudgetProvider>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
