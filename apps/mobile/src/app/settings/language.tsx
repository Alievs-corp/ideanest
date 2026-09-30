import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '@ideanest/messages';
import { Button } from '../../components/form';
import { Body, CardTitle, Heading } from '../../components/text';
import { useT } from '../../lib/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_KEYS } from '../../lib/account';
import { currentLocale, useLocale } from '../../lib/locale';
import { chooseLocale, pushPendingLocale } from '../../lib/locale-sync';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * Language — issues #150 and #216. The device half of the web's language and currency page.
 *
 * A radio list of the four languages, each named in its own language and spoken in it
 * (`accessibilityLanguage`) so a screen reader pronounces it correctly. Choosing one
 * re-renders the app immediately and persists the choice. When signed in the account is
 * updated too (`PATCH /v1/me/locale`), because the latest explicit choice is the account's
 * language (#216); success records it as the last-synced value. If that fails the local
 * choice stays, marked pending so a stale account value cannot switch it back, and the reader
 * is told the account was not saved, with a retry here; `AccountSync` also retries it on the
 * next foreground. The currency half belongs to the settings issue.
 */

const styles = StyleSheet.create({
  content: { padding: size.cardPaddingLarge, gap: spacing[5] },
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
    minHeight: size.touchTarget + spacing[2],
    gap: spacing[4],
  },
  failure: {
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    backgroundColor: colors.surface2,
  },
});

export default function LanguageScreen() {
  const t = useT();
  const active = useLocale();
  const { signedIn } = useSession();
  const [unsaved, setUnsaved] = useState<Locale | null>(null);
  const queryClient = useQueryClient();

  async function saveToAccount(locale: Locale): Promise<void> {
    if (!signedIn) return;
    // `null`: nothing pending any more — a foreground retry got there first.
    const saved = await pushPendingLocale();
    if (saved === true) void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEYS.me });
    // A slow answer for a language that has since been replaced says nothing about the
    // current choice, and a retry of it would overwrite the account with the older one.
    if (locale === currentLocale()) setUnsaved(saved === false ? locale : null);
  }

  function choose(locale: Locale): void {
    chooseLocale(locale, signedIn);
    // Category names, collection titles and facet labels arrive already translated.
    void queryClient.invalidateQueries();
    setUnsaved(null);
    void saveToAccount(locale);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Unregistered in the root stack, so it names its own header rather than showing its path. */}
      <Stack.Screen options={{ title: t('mobile.language.title') }} />
      <Heading accessibilityRole="header">{t('mobile.language.title')}</Heading>

      <View style={styles.card} accessibilityRole="radiogroup">
        {SUPPORTED_LOCALES.map((locale) => {
          const selected = locale === active;
          return (
            <Pressable
              key={locale}
              accessibilityRole="radio"
              accessibilityLabel={LOCALE_NAMES[locale]}
              accessibilityLanguage={locale}
              accessibilityState={{ selected }}
              onPress={() => choose(locale)}
              style={styles.row}
            >
              <CardTitle
                tone={selected ? 'primary' : 'secondary'}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {LOCALE_NAMES[locale]}
              </CardTitle>
              <CardTitle
                style={{ color: colors.lime500 }}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {selected ? '✓' : ''}
              </CardTitle>
            </Pressable>
          );
        })}
      </View>

      {unsaved === null ? null : (
        <View style={styles.failure} accessibilityRole="alert">
          <Body>{t('mobile.language.saveFailed')}</Body>
          <Button
            label={t('mobile.language.retry')}
            variant="secondary"
            onPress={() => void saveToAccount(unsaved)}
          />
        </View>
      )}
    </ScrollView>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
