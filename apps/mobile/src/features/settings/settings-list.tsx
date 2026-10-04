import { useRouter } from 'expo-router';
import { FadeUp } from '../../components/motion';
import { useT } from '../../lib/i18n';
import { SETTINGS_SECTIONS, sectionGlyph, sectionLabelKey, sectionPath } from './sections';
import { SettingsPage } from './settings-page';
import { NavRow, RowGroup } from './settings-row';

/**
 * `settings` — the list the web skips by redirecting to notifications (#161). On a phone the list
 * is the hub, and `/settings` from a link or a push has to land somewhere meaningful. One group of
 * rows in the page's white sheet, rising in as the first screenful.
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
      <FadeUp>
        <RowGroup>
          {SETTINGS_SECTIONS.map((section) => (
            <NavRow
              key={section}
              label={t(sectionLabelKey(section))}
              icon={sectionGlyph(section)}
              onPress={() => router.push(sectionPath(section))}
              testID={`settings-row-${section}`}
            />
          ))}
        </RowGroup>
      </FadeUp>
    </SettingsPage>
  );
}
