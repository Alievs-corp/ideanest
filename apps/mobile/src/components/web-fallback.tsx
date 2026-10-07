import { useEffect } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { siteUrl } from '../api/config';
import { currentLocale } from '../lib/locale';
import { isGuarded, signInHrefFor } from '../lib/guard';
import { useT, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/use-session';
import { colors, size, spacing } from '../theme';
import { Body, Heading } from './text';
import { Pill } from './ui';

/**
 * The placeholder behind every route whose real screen is not built yet — issue #150.
 *
 * A deep link never dead-ends while the epic rolls out: the button opens the same page
 * on the web, in the reader's language. Each later issue deletes the placeholder it
 * replaces. It also applies the session guard, so a signed-out reader reaching a private
 * route is offered sign-in with the way back preserved.
 *
 * <p>The way to the web is a white pill, the kit's primary: it is this screen's only action, but
 * not an urgent one, and lime is kept for the action that is.
 *
 * It names its own header from the same title key. None of these routes is registered in
 * the root stack, and an unregistered route's header shows its file name — `u/[slug]`,
 * `campaigns/[id]/back` — which is a path, not a title.
 *
 * @param webPath the web path, locale stripped (`/projects/<id>/back`, not `/az/projects/…`)
 */
export function WebFallback({
  titleKey,
  webPath,
  ownHeader = true,
}: {
  /** A catalogue key, e.g. `shell.nav.pricing`. */
  readonly titleKey: MessageKey;
  readonly webPath: string;
  /**
   * Whether this names the stack header. False inside a frame that names it already — the
   * campaign editor's tabs not yet built for the app (#162), whose header is the project title.
   */
  readonly ownHeader?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { signedIn } = useSession();
  const t = useT('mobile.fallback');
  const tAll = useT();
  const blocked = isGuarded(pathname) && !signedIn;

  useEffect(() => {
    if (blocked) router.replace(signInHrefFor(pathname));
  }, [blocked, pathname, router]);

  if (blocked) return null;

  const title = tAll(titleKey);
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {ownHeader ? <Stack.Screen options={{ title }} /> : null}
      <Heading accessibilityRole="header">{title}</Heading>
      <Body>{t('body')}</Body>
      <Pill
        label={t('open')}
        size="lg"
        onPress={() =>
          void WebBrowser.openBrowserAsync(`${siteUrl()}/${currentLocale()}${webPath}`)
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing[4],
    padding: size.cardPaddingLarge,
    backgroundColor: colors.surface1,
  },
});
