import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { deviceLocale, siteUrl } from '../api/config';
import { isGuarded, signInHrefFor } from '../lib/guard';
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
  title,
  webPath,
}: {
  readonly title: string;
  readonly webPath: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { signedIn } = useSession();
  const blocked = isGuarded(pathname) && !signedIn;

  useEffect(() => {
    if (blocked) router.replace(signInHrefFor(pathname));
  }, [blocked, pathname, router]);

  if (blocked) return null;

  return (
    <View style={styles.screen}>
      <Heading accessibilityRole="header">{title}</Heading>
      <Body>This part of IdeyaNest is still being built for the app. It is ready on the web.</Body>
      <Button
        label="Open on the website"
        onPress={() => void WebBrowser.openBrowserAsync(`${siteUrl()}/${deviceLocale()}${webPath}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing[4],
    padding: size.cardPaddingLarge,
    backgroundColor: colors.surface1,
  },
});
