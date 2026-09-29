import { useEffect } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { siteUrl } from '../api/config';
import { currentLocale } from '../lib/locale';
import { isGuarded, signInHrefFor } from '../lib/guard';
import { useT } from '../lib/i18n';
import { useSession } from '../lib/use-session';
import { colors, size, spacing } from '../theme';
import { Button } from './form';
import { Body, Heading } from './text';

/**
 * The placeholder behind every route whose real screen is not built yet — issue #150.
 *
 * A deep link never dead-ends while the epic rolls out: the button opens the same page
 * on the web, in the reader's language. Each later issue deletes the placeholder it
 * replaces. It also applies the session guard, so a signed-out reader reaching a private
 * route is offered sign-in with the way back preserved.
 *
 * @param webPath the web path, locale stripped (`/projects/<id>/back`, not `/az/projects/…`)
 */
export function WebFallback({
  titleKey,
  webPath,
}: {
  /** A catalogue key, e.g. `shell.nav.pricing`. */
  readonly titleKey: string;
  readonly webPath: string;
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

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Heading accessibilityRole="header">{tAll(titleKey)}</Heading>
      <Body>{t('body')}</Body>
      <Button
        label={t('open')}
        onPress={() => void WebBrowser.openBrowserAsync(`${siteUrl()}/${currentLocale()}${webPath}`)}
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
