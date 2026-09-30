import { useEffect, useRef } from 'react';
import { AppState, BackHandler } from 'react-native';
import { useRouter } from 'expo-router';
import { FailureState } from '../components/failure-state';
import { useT } from '../lib/i18n';
import {
  createPoller,
  firstPollDelayMs,
  leaveMaintenance,
  serviceAnswers,
  type Poller,
} from '../lib/maintenance';

/**
 * The maintenance screen — issue #150. Pushed by the root layout when `lib/maintenance.ts`
 * sees a 503; see there for why a 503 is the signal.
 *
 * <h2>The web's words, and a way out that is a check</h2>
 *
 * Title and description are the web `/maintenance` page's own
 * (`shell.failure.pages.maintenance`), so the outage reads the same on both. The web's action
 * is a link home, which on the web is a new request; here the equivalent is to ask the service
 * now, so the white pill says "Try again" (`shell.failure.pages.error.retry`) and does exactly
 * that. There are no "elsewhere" links, as on the web: every one of them leads into the outage.
 *
 * <h2>No way back into the broken stack</h2>
 *
 * The root stack registers this route with no header and no swipe-back, and Android's back
 * button is swallowed here. The screens underneath are the ones that just failed; the only way
 * back to them is the service answering, and then the screen leaves by itself.
 *
 * <h2>Polling, and only while somebody is looking</h2>
 *
 * The first check waits as long as the edge's `Retry-After` asked, then every thirty seconds.
 * It stops when the application is put away and asks once, immediately, when it comes back —
 * a phone in a pocket has no reason to wake the radio for a screen nobody sees — and it stops
 * for good when the screen unmounts.
 */
export default function MaintenanceScreen() {
  const t = useT('shell.failure.pages.maintenance');
  const tError = useT('shell.failure.pages.error');
  const router = useRouter();
  const poller = useRef<Poller | null>(null);

  useEffect(() => {
    const polling = createPoller(serviceAnswers, () => {
      leaveMaintenance();
      // Back to where the reader was; to Home when this was the first screen (a cold start).
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
    poller.current = polling;
    polling.start(firstPollDelayMs());

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.start(0);
      else polling.stop();
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);

    return () => {
      polling.stop();
      poller.current = null;
      appState.remove();
      back.remove();
    };
  }, [router]);

  return (
    <FailureState
      title={t('title')}
      description={t('description')}
      actionLabel={tError('retry')}
      onAction={() => poller.current?.start(0)}
    />
  );
}
