import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '@ideanest/messages';
import { saveAccountLocale } from '../../api/client';
import { Button } from '../../components/form';
import { Body, CardTitle, Heading } from '../../components/text';
import { useT } from '../../lib/i18n';
import { setLocale, useLocale } from '../../lib/locale';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * Language — issue #150. The device half of the web's language and currency page.
 *
 * A radio list of the four languages, each named in its own language and spoken in it
 * (`accessibilityLanguage`) so a screen reader pronounces it correctly. Choosing one
 * re-renders the app immediately and persists the choice. When signed in the account is
 * updated too (`PATCH /v1/me/locale`); if that fails the local choice stays and the reader
 * is told the account was not saved, with a retry. The currency half belongs to the
 * settings issue.
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

  async function saveToAccount(locale: Locale): Promise<void> {
    if (!signedIn) return;
    setUnsaved((await saveAccountLocale(locale)) ? null : locale);
  }

  function choose(locale: Locale): void {
    setLocale(locale);
    setUnsaved(null);
    void saveToAccount(locale);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
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
