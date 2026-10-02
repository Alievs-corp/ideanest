import { InlineAlert } from '../../components/ui';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { AppLockCard } from './app-lock';
import { InlineLink, SettingsPage } from './settings-page';
import { TwoFactorCard } from './two-factor';

/**
 * `settings/security` — the web's two-factor page plus this phone's app lock (#161).
 *
 * <p>Its own offline notice rather than `SettingsPage`'s: offline, two-factor waits for a
 * connection but the lock does not, and "changes can be saved once the connection is back" would
 * say otherwise about the lock.
 */
export function SecuritySettingsScreen() {
  const t = useT('settings.pages.security');
  const tAll = useT();
  const online = useOnline();
  return (
    <SettingsPage
      section="security"
      title={t('title')}
      intro={t.rich('intro', {
        devices: (chunks) => <InlineLink href="/settings/sessions">{chunks}</InlineLink>,
      })}
      offlineNotice={false}
    >
      {online ? null : (
        <InlineAlert
          variant="warning"
          politeness="polite"
          description={tAll('mobile.settings.security.offline')}
          testID="settings-offline"
        />
      )}
      <TwoFactorCard />
      <AppLockCard />
    </SettingsPage>
  );
}
