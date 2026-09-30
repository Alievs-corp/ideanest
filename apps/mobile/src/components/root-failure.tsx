import { Pressable, StyleSheet, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { isLocale, type Locale } from '@ideanest/messages';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { currentLocale } from '../lib/locale';
import { colors, radius, size, spacing } from '../theme';
import { Body, CardTitle, Heading } from './text';

/**
 * The boundary of last resort — issue #150. The app's `app/global-error.tsx`.
 *
 * <h2>Outside every provider, so it borrows none</h2>
 *
 * The root layout exports this as its `ErrorBoundary`, and Expo Router wraps the root layout
 * itself in it — so when it renders, the gesture root, the safe-area provider, the query cache
 * and the intl provider are exactly what failed to render. Anything that reads one of them
 * (`useT`, `FailureState`'s WhatsApp sheet, a safe-area inset) would throw a second error
 * inside the handler for the first, which is how a blank screen happens.
 *
 * So it depends on React Native, the theme's constants and the text roles, which are both plain
 * values, and nothing else. The words come straight from the bundled catalogue (the four files
 * the provider would have used, already in the bundle), in the language `lib/locale.ts` holds —
 * a synchronous read of a variable resolved at startup — and in English when even that cannot
 * be read. Unlike the web's `global-error.tsx`, which is English only, these are catalogue keys
 * (`shell.failure.pages.fatal`), so the four languages cannot drift.
 *
 * <h2>What the action does</h2>
 *
 * `expo-updates` is not installed and `DevSettings.reload` exists only in development, so the
 * app cannot restart its own JavaScript. `retry()` is the next best thing and a real one: it
 * clears the boundary, which mounts the root layout — and every provider under it — afresh.
 * A fault that was a bad moment (a storage read that failed once) is gone; one that is not
 * lands back here, which is honest. The pill is white, as on every failure screen, never lime.
 *
 * Never `error.message`, never a stack: see `route-error-boundary.tsx`.
 */
export function RootFailure({ retry }: ErrorBoundaryProps) {
  const copy = fatalCopy(fatalLocale());
  return (
    <View style={styles.screen}>
      {/* The tree that set light glyphs is gone; the surface under them is still dark. */}
      <StatusBar style="light" />
      <Heading accessibilityRole="header" style={styles.centred}>
        {copy.title}
      </Heading>
      <Body style={styles.centred}>{copy.description}</Body>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.action}
        onPress={() => void retry()}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <CardTitle tone="onWhite" accessibilityElementsHidden importantForAccessibility="no">
          {copy.action}
        </CardTitle>
      </Pressable>
    </View>
  );
}

type FatalCopy = (typeof en)['shell']['failure']['pages']['fatal'];

const FATAL: Record<Locale, FatalCopy> = {
  az: az.shell.failure.pages.fatal,
  en: en.shell.failure.pages.fatal,
  ru: ru.shell.failure.pages.fatal,
  tr: tr.shell.failure.pages.fatal,
};

/** The fatal screen's words in a language, from the catalogue itself; English for anything else. */
export function fatalCopy(locale: string): FatalCopy {
  return isLocale(locale) ? FATAL[locale] : FATAL.en;
}

/** The language in use, if it can be read at all; English if the read itself fails. */
function fatalLocale(): string {
  try {
    return currentLocale();
  } catch {
    return 'en';
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    paddingHorizontal: size.cardPaddingLarge,
    backgroundColor: colors.surface1,
  },
  centred: { textAlign: 'center' },
  pill: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: size.cardPaddingLarge,
    borderRadius: radius.full,
    backgroundColor: colors.whiteSurface,
  },
  pillPressed: { backgroundColor: colors.whiteMuted },
});
