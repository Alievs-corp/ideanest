import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { isLocale, type Locale } from '@ideanest/messages';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { Glyphs } from '../icons';
import { reportBoundaryError } from '../lib/crash/reporting';
import { currentLocale } from '../lib/locale';
import { colors, radius, size, spacing } from '../theme';
import { Body, Heading } from './text';
import { Icon } from './ui/icon';
import { Pill } from './ui/pill';

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
 * So it depends on React Native, the theme's constants, the text roles and two kit leaves that
 * read no provider (`Icon`, and `Pill`, whose context reads all have defaults), and nothing else.
 * Its insets are `initialWindowMetrics`, the safe-area module's static launch reading, not the
 * provider's live one. The words come straight from the bundled catalogue (the four files
 * the provider would have used, already in the bundle), in the language `lib/locale.ts` holds.
 * That is a synchronous read of a variable resolved when the module loaded, which cannot throw
 * here: a module that failed to load would have taken this file down with it. English is the
 * answer only for a value the catalogues do not have (`fatalCopy`). Unlike the web's `global-error.tsx`, which is English only, these are catalogue keys
 * (`shell.failure.pages.fatal`), so the four languages cannot drift.
 *
 * <h2>What the action does</h2>
 *
 * `expo-updates` is not installed and `DevSettings.reload` exists only in development, so the
 * app cannot restart its own JavaScript. `retry()` is the next best thing and a real one: it
 * clears the boundary, which mounts the root layout — and every provider under it — afresh.
 * A fault that was a bad moment (a storage read that failed once) is gone; one that is not
 * lands back here, which is honest. The pill is the kit's white primary, as on every failure
 * screen, never lime, and nothing animates in.
 *
 * Never `error.message`, never a stack: see `route-error-boundary.tsx`. The error does go to crash
 * reporting when the build has it (#165) — a plain function call, which reads no provider. Without
 * `traceIdOfError`: that is `api/client.ts`'s, whose imports are most of the app, and this file
 * stays off them. The report still carries the last trace id the app saw (`api/last-trace.ts`).
 */
export function RootFailure({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => reportBoundaryError(error, 'root', null), [error]);
  const copy = fatalCopy(currentLocale());
  const insets = initialWindowMetrics?.insets;
  const padding = {
    paddingTop: (insets?.top ?? 0) + spacing[6],
    paddingBottom: (insets?.bottom ?? 0) + spacing[6],
    paddingLeft: size.cardPaddingLarge + (insets?.left ?? 0),
    paddingRight: size.cardPaddingLarge + (insets?.right ?? 0),
  };
  return (
    // Scrolls, so the words and the pill stay reachable at a large font scale.
    <ScrollView style={styles.fill} contentContainerStyle={[styles.screen, padding]}>
      {/* The tree that set light glyphs is gone; the surface under them is still dark. */}
      <StatusBar style="light" />
      <View style={styles.disc}>
        <Icon icon={Glyphs.Danger} variant="bulk" size={32} color={colors.textPrimary} />
      </View>
      <Heading accessibilityRole="header" style={styles.centred}>
        {copy.title}
      </Heading>
      <Body style={styles.centred}>{copy.description}</Body>
      <Pill label={copy.action} onPress={() => void retry()} size="lg" />
    </ScrollView>
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

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  screen: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    backgroundColor: colors.surface1,
  },
  disc: {
    width: spacing[16],
    height: spacing[16],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  centred: { textAlign: 'center' },
});
