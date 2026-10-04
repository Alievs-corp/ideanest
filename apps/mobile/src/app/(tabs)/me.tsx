import { useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import * as Application from 'expo-application';
import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { siteUrl } from '../../api/config';
import { FadeUp } from '../../components/motion';
import { Body, Caption, Meta, Subheading } from '../../components/text';
import {
  Avatar,
  ContentSheet,
  Icon,
  InlineAlert,
  Pill,
  PressableScale,
  Screen,
  Skeleton,
} from '../../components/ui';
import { WhatsAppSheet } from '../../components/whatsapp-sheet';
import { SETTINGS_SECTIONS, sectionGlyph, sectionLabelKey, sectionPath } from '../../features/settings/sections';
import { NavRow, RowGroup } from '../../features/settings/settings-row';
import { Glyphs, type IconGlyph } from '../../icons';
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
 * <h2>Canvas and sheet</h2>
 *
 * The `mobile-design` skill §2: who you are (or the invitation to sign in) and the account's
 * warnings sit on the dark canvas; the rows sit in a white `ContentSheet` below, grouped, each a
 * Bulk glyph in a round badge with a trailing arrow. The actions are the kit's pills (issue #151):
 * Register is the white primary and Sign in an outline; Sign out, which ends the session and
 * empties the offline copy, is the danger pill. Nothing here is the lime accent — this tab has no
 * urgent action.
 *
 * <h2>Motion</h2>
 *
 * The `mobile-design` skill §6: the header and the groups rise in as the first screenful, rows and
 * pills give under the thumb, the skeleton shimmers, and Reduce Motion stops all of it.
 */

interface Row {
  /** A catalogue key. */
  readonly label: MessageKey;
  readonly icon: IconGlyph;
  readonly href?: Href;
  /** A tab rather than a screen: switched to, so the tab keeps its own history. */
  readonly tab?: boolean;
  readonly web?: string;
}

/** `ACCOUNT_GROUPS.yourAccount`, in its order. Pledges is a tab here; Saved is a screen (#276). */
const YOUR_ACCOUNT: readonly Row[] = [
  { label: 'account.links.pledges.label', icon: Glyphs.Heart, href: '/pledges', tab: true },
  { label: 'account.links.campaigns.label', icon: Glyphs.Lamp, href: '/account/campaigns' },
  { label: 'account.links.saved.label', icon: Glyphs.Bookmark, href: '/saved' },
  { label: 'account.links.following.label', icon: Glyphs.People, href: '/account/following' },
  { label: 'account.links.surveys.label', icon: Glyphs.DocumentText, href: '/account/surveys' },
  { label: 'account.links.deliveries.label', icon: Glyphs.Truck, href: '/account/deliveries' },
];

const CREATOR: readonly Row[] = [
  { label: 'shell.actions.startCampaign', icon: Glyphs.Add, href: '/campaigns/new' },
  { label: 'shell.nav.pricing', icon: Glyphs.Receipt, href: '/pricing' },
];

/** `ACCOUNT_GROUPS.settings`, in its order: one row per `settings/<key>`. */
const SETTINGS: readonly Row[] = SETTINGS_SECTIONS.map((section) => ({
  label: sectionLabelKey(section),
  icon: sectionGlyph(section),
  href: sectionPath(section),
}));

const LANGUAGE_ONLY: readonly Row[] = [
  { label: 'mobile.me.language', icon: Glyphs.Translate, href: '/settings/language' },
];

/** The app lock, which is this phone's rather than the account's (#161). */
const THIS_PHONE: readonly Row[] = [
  { label: 'mobile.settings.security.appLockLink', icon: Glyphs.Lock, href: '/settings/security' },
];

/** The web footer's `FOOTER_GROUPS.about`, with the same paths. */
const ABOUT: readonly Row[] = [
  { label: 'shell.footer.links.about', icon: Glyphs.InfoCircle, web: '/about' },
  { label: 'shell.footer.links.howItWorks', icon: Glyphs.Discover, web: '/how-it-works' },
  { label: 'shell.footer.links.trustSafety', icon: Glyphs.Verify, web: '/trust-safety' },
  { label: 'shell.footer.links.legal', icon: Glyphs.DocumentText, web: '/legal' },
];

/** Not a page: opens the WhatsApp sheet. */
const WHATSAPP: Row = { label: 'shell.whatsapp.open', icon: Glyphs.Messages2 };

const styles = StyleSheet.create({
  invitation: { gap: spacing[3] },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    minHeight: size.touchTarget,
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
  },
  identityPressed: { backgroundColor: colors.surface2 },
  identityText: { flex: 1, gap: spacing[1] },
  colophon: { textAlign: 'center' },
});

function HubRow({ row, onPress }: { readonly row: Row; readonly onPress?: () => void }) {
  const router = useRouter();
  const t = useT();
  return (
    <NavRow
      label={t(row.label)}
      icon={row.icon}
      // In-app rows are buttons; only the ones that leave for the browser are links.
      accessibilityRole={row.web === undefined ? 'button' : 'link'}
      external={row.web !== undefined}
      onPress={() => {
        if (onPress !== undefined) onPress();
        else if (row.href !== undefined) {
          if (row.tab === true) router.navigate(row.href);
          else router.push(row.href);
        } else if (row.web !== undefined) {
          void WebBrowser.openBrowserAsync(`${siteUrl()}/${currentLocale()}${row.web}`);
        }
      }}
    />
  );
}

function Group({
  titleKey,
  rows,
  index,
  children,
}: {
  readonly titleKey: MessageKey;
  readonly rows: readonly Row[];
  /** Its place in the first screenful, for the entry stagger. */
  readonly index: number;
  /** Rows that do something other than navigate, after the ones that do. */
  readonly children?: ReactNode;
}) {
  const t = useT();
  return (
    <FadeUp index={index}>
      <RowGroup title={t(titleKey)}>
        {rows.map((row) => (
          <HubRow key={row.label} row={row} />
        ))}
        {children}
      </RowGroup>
    </FadeUp>
  );
}

/**
 * Who is signed in, on the canvas above the sheet: the web account menu's avatar, name and
 * address, and the way to the public profile (`shell.actions.profile`).
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
    <FadeUp index={0}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={email === '' ? name : `${name}, ${email}`}
        accessibilityHint={t('shell.actions.profile')}
        disabled={slug === undefined}
        onPress={() => {
          if (slug !== undefined) router.push({ pathname: '/u/[slug]', params: { slug } });
        }}
        contentStyle={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
      >
        <Avatar name={name} size="lg" decorative />
        <View style={styles.identityText}>
          <Subheading numberOfLines={1}>{name}</Subheading>
          <Caption numberOfLines={1}>{email}</Caption>
        </View>
        {slug === undefined ? null : (
          <Icon icon={Glyphs.ArrowRight2} size={18} color={colors.textTertiary} />
        )}
      </PressableScale>
    </FadeUp>
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
      style={styles.identity}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Skeleton circle height={size.avatarOnProfile} />
      <View style={styles.identityText}>
        <Skeleton width="50%" height={fontSize.h3} />
        <Skeleton width="70%" height={fontSize.caption} />
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

  // The groups' places in the first screenful, in the order they are drawn.
  let group = 0;
  const next = () => (group += 1);

  return (
    <>
      <Screen hasContent>
        {loading ? <IdentitySkeleton /> : null}

        {account !== null ? (
          <>
            <IdentityRow me={account} />
            <AccountAlerts me={account} />
          </>
        ) : null}

        {state === 'signed-out' ? (
          <FadeUp index={0}>
            <View style={styles.invitation}>
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
          </FadeUp>
        ) : null}

        <ContentSheet>
          {account !== null ? (
            <>
              <Group titleKey="account.groups.yourAccount" rows={YOUR_ACCOUNT} index={next()} />
              <Group titleKey="shell.footer.groups.creators" rows={CREATOR} index={next()} />
              <Group titleKey="account.groups.settings" rows={SETTINGS} index={next()} />
            </>
          ) : null}

          {holdsSession ? (
            <Group titleKey="mobile.me.thisPhone" rows={THIS_PHONE} index={next()} />
          ) : null}

          {state === 'signed-out' ? (
            <Group titleKey="account.groups.settings" rows={LANGUAGE_ONLY} index={next()} />
          ) : null}

          <Group titleKey="shell.footer.groups.about" rows={ABOUT} index={next()}>
            <HubRow row={WHATSAPP} onPress={() => setContacting(true)} />
          </Group>

          {holdsSession ? (
            <Pill
              label={t('shell.actions.signOut')}
              variant="danger"
              size="lg"
              fullWidth
              iconLeft={Glyphs.Logout}
              busy={busy}
              onPress={confirmSignOut}
            />
          ) : null}

          <Colophon />
        </ContentSheet>
      </Screen>

      <WhatsAppSheet visible={contacting} onClose={() => setContacting(false)} />
    </>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
