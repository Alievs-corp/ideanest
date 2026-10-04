import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Stack, useRouter, type Href } from 'expo-router';
import {
  Body,
  Card,
  ContentSheet,
  Heading,
  InlineAlert,
  Subheading,
  TONES,
  useSurface,
} from '../../components/ui';
import { useOnline } from '../../lib/connectivity';
import { signInHrefFor } from '../../lib/guard';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/use-session';
import { colors, font, formMeasure, spacing } from '../../theme';
import { sectionPath, type SettingsSection } from './sections';

const LeavingContext = createContext<() => void>(() => undefined);

/**
 * Tells the frame the screen is ending the session itself and navigating on, so the signed-in
 * gate does not race it to sign-in with a different `returnTo`.
 */
export function useLeavingSettings(): () => void {
  return useContext(LeavingContext);
}

/**
 * The frame every `settings/*` screen sits in (#161): signed-in only, the web's
 * `AccountPageHeader` and one offline notice saying changes wait for a connection on the dark
 * canvas, and the screen's content in a white `ContentSheet` below them (`mobile-design` skill
 * §2) — so its cards, fields and controls take their on-white skins. A stack route without the
 * tab bar: the sheet runs under the home indicator and pads its content clear of it.
 */
export function SettingsPage({
  section,
  title,
  intro,
  children,
  offlineNotice = true,
  requireSession = true,
  testID,
}: {
  /** `null` for the list at `/settings`. */
  readonly section: SettingsSection | null;
  readonly title: string;
  readonly intro?: ReactNode;
  readonly children: ReactNode;
  readonly offlineNotice?: boolean;
  /** False only for Language, which a signed-out reader can still set on this phone. */
  readonly requireSession?: boolean;
  readonly testID?: string;
}) {
  const router = useRouter();
  const { signedIn } = useSession();
  const online = useOnline();
  const t = useT();
  const insets = useContext(SafeAreaInsetsContext);
  const leaving = useRef(false);
  const markLeaving = useCallback(() => {
    leaving.current = true;
  }, []);

  useEffect(() => {
    if (!requireSession || signedIn || leaving.current) return;
    router.replace(signInHrefFor(section === null ? '/settings' : sectionPath(section)));
  }, [requireSession, router, section, signedIn]);

  return (
    <LeavingContext.Provider value={markLeaving}>
      <>
      <Stack.Screen options={{ title }} />
      {signedIn || !requireSession ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.fill}
            // The sheet's tail pulls back exactly this much, as it does under `Screen`.
            contentContainerStyle={[styles.content, { paddingBottom: insets?.bottom ?? 0 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            testID={testID}
          >
            <View style={[styles.column, styles.header]}>
              <Heading accessibilityRole="header">{title}</Heading>
              {intro === undefined ? null : <Body>{intro}</Body>}
              {offlineNotice && !online ? (
                <InlineAlert
                  variant="warning"
                  politeness="polite"
                  description={t('mobile.settings.offline')}
                  testID="settings-offline"
                />
              ) : null}
            </View>
            <ContentSheet>
              <View style={styles.column}>{children}</View>
            </ContentSheet>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
    </>
    </LeavingContext.Provider>
  );
}

/**
 * One titled card of a settings screen, the web's `rounded-2xl bg-surface-2` section: inside the
 * page's white sheet, the sheet's nested `whiteMuted` block.
 */
export function SettingsCard({
  title,
  intro,
  children,
  testID,
}: {
  readonly title?: string;
  readonly intro?: ReactNode;
  readonly children?: ReactNode;
  readonly testID?: string;
}) {
  return (
    <Card size="md" testID={testID}>
      <View style={styles.card}>
        {title === undefined ? null : <Subheading accessibilityRole="header">{title}</Subheading>}
        {intro === undefined ? null : <Body>{intro}</Body>}
        {children}
      </View>
    </Card>
  );
}

/** An in-app link inside a sentence from `t.rich`. */
export function InlineLink({
  href,
  children,
  testID,
}: {
  readonly href: Href;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const router = useRouter();
  const ink = TONES[useSurface()].primary;
  return (
    <Text
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={[styles.link, { color: ink }]}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** Bold words inside a sentence from `t.rich`. */
export function Strong({ children }: { readonly children: ReactNode }) {
  return <Text style={[styles.strong, { color: TONES[useSurface()].primary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  // `Screen`'s 20pt gutter, which the `ContentSheet` bleeds through.
  content: { flexGrow: 1, paddingHorizontal: spacing[5], paddingTop: spacing[6], gap: spacing[6] },
  column: { width: '100%', maxWidth: formMeasure, alignSelf: 'center', gap: spacing[6] },
  header: { gap: spacing[2] },
  card: { gap: spacing[4] },
  link: { textDecorationLine: 'underline' },
  strong: { ...font.medium },
});
