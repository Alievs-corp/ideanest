import { usePathname } from 'expo-router';
import { isQuietRoute, useAppUpdate } from '../lib/app-update';
import { useT } from '../lib/i18n';
import { Dialog, InlineAlert, Pill } from './ui';

/**
 * "A new version is ready" — the over-the-air update offer (`lib/app-update.ts`).
 *
 * The kit's `Dialog`: a white panel over the dim, primary first. No corner X and no scrim tap,
 * because "Later" is the way out and says what it means; Android back and the iOS escape gesture
 * still choose it. While the restart runs, nothing closes the dialog. A refused restart is said
 * at once in the panel, never animated in.
 */
export function UpdatePrompt() {
  const update = useAppUpdate();
  const pathname = usePathname();
  const t = useT('mobile.update');

  return (
    <Dialog
      open={update.offered && !isQuietRoute(pathname)}
      onClose={update.restarting ? noop : update.later}
      title={t('title')}
      description={t('description')}
      showClose={false}
      dismissOnScrim={false}
      testID="update-prompt"
      footer={
        <>
          <Pill
            label={t('restart')}
            onPress={update.restart}
            busy={update.restarting}
            fullWidth
            testID="update-restart"
          />
          <Pill
            label={t('later')}
            onPress={update.later}
            variant="ghost"
            disabled={update.restarting}
            fullWidth
            testID="update-later"
          />
        </>
      }
    >
      {update.failed ? (
        <InlineAlert variant="danger" description={t('failed')} politeness="assertive" />
      ) : null}
    </Dialog>
  );
}

function noop() {}
