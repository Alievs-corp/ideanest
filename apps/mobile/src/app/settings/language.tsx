import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { LOCALE_NAMES, SUPPORTED_LOCALES, isLocale, type Locale } from '@ideanest/messages';
import { Heading } from '../../components/text';
import { InlineAlert, MotionBudgetProvider, Pill, Radio, RadioGroup } from '../../components/ui';
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
 *
 * <p>The list is the kit's `RadioGroup` (issue #151): each row one `Radio`, the whole row the
 * target, the name spoken in its own language, and "selected" said by the control's state and
 * its dot rather than by colour. A failed save is a warning `InlineAlert` with the retry as a
 * ghost pill — trying again is not the urgent thing on the screen.
 *
 * <p>Motion: none. It is a settings screen, which `docs/motion-system.md` §5 keeps still.
 */

const styles = StyleSheet.create({
  content: { padding: size.cardPaddingLarge, gap: spacing[5] },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: size.cardPaddingSmall,
    paddingVertical: spacing[1],
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
    <MotionBudgetProvider level="none">
      <ScrollView contentContainerStyle={styles.content}>
        {/* Unregistered in the root stack, so it names its own header rather than showing its path. */}
        <Stack.Screen options={{ title: t('mobile.language.title') }} />
        <Heading accessibilityRole="header">{t('mobile.language.title')}</Heading>

        <View style={styles.card}>
          <RadioGroup
            label={t('mobile.language.title')}
            value={active}
            onChange={(value) => {
              if (isLocale(value)) choose(value);
            }}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <Radio
                key={locale}
                value={locale}
                label={LOCALE_NAMES[locale]}
                accessibilityLanguage={locale}
              />
            ))}
          </RadioGroup>
        </View>

        {unsaved === null ? null : (
          <InlineAlert
            variant="warning"
            description={t('mobile.language.saveFailed')}
            action={
              <Pill
                label={t('mobile.language.retry')}
                variant="ghost"
                size="sm"
                onPress={() => void saveToAccount(unsaved)}
              />
            }
          />
        )}
      </ScrollView>
    </MotionBudgetProvider>
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../../components/route-error-boundary';
