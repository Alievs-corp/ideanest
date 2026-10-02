import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CardTitle, Meta } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { colors, radius, size, spacing } from '../../theme';
import { SETTINGS_SECTIONS, sectionLabelKey, sectionPath } from './sections';
import { SettingsPage } from './settings-page';

/**
 * `settings` — the list the web skips by redirecting to notifications (#161). On a phone the list
 * is the hub, and `/settings` from a link or a push has to land somewhere meaningful.
 */
export function SettingsListScreen() {
  const t = useT();
  const router = useRouter();
  return (
    <SettingsPage
      section={null}
      title={t('shell.actions.settings')}
      offlineNotice={false}
      testID="settings-list"
    >
      <View style={styles.card}>
        {SETTINGS_SECTIONS.map((section) => {
          const label = t(sectionLabelKey(section));
          return (
            <Pressable
              key={section}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.push(sectionPath(section))}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`settings-row-${section}`}
            >
              <CardTitle style={styles.label} accessibilityElementsHidden importantForAccessibility="no">
                {label}
              </CardTitle>
              <Meta style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                ›
              </Meta>
            </Pressable>
          );
        })}
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
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
    gap: spacing[4],
    minHeight: size.touchTarget + spacing[2],
    paddingVertical: spacing[2],
  },
  pressed: { opacity: 0.6 },
  label: { flex: 1 },
  chevron: { color: colors.textTertiary },
});
