import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, BackHandler } from 'react-native';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { FailureState } from '../components/failure-state';
import { useT } from '../lib/i18n';
import { useLocale } from '../lib/locale';
import {
  POLL_INTERVAL_MS,
  createPoller,
  firstPollDelayMs,
  inMaintenance,
  leaveMaintenance,
  serviceAnswers,
  useCurrentMaintenance,
  type Poller,
} from '../lib/maintenance';
import { untilMessage } from '../lib/maintenance-copy';

/**
 * The maintenance screen — issues #150 and #214. Pushed by the root layout
 * (`lib/maintenance-gate.ts`) when `lib/maintenance.ts` meets the maintenance problem; see
 * there for why that, and not any 503, is the signal.
 *
 * <h2>The web's words, and a way out that is a check</h2>
 *
 * Title and description are the web `/maintenance` page's own
 * (`shell.failure.pages.maintenance`), so the outage reads the same on both, with the announced
 * end under them — "Back around 02:30", in the reader's language and time zone — or that none
 * is announced. When the proxy answered (`source: "edge"`), the service is not running and
 * nobody announced anything: an unplanned crash looks the same from here, so the screen says
 * only that IdeyaNest is unavailable and is being worked on (`shell.maintenance.edge`), never
 * "planned". Each poll updates this: an extended end, or the edge taking over. The web's action
 * is a link home, which on the web is a new request; here the equivalent is to ask the service
 * now, so the white pill says "Try again" (`shell.failure.pages.error.retry`) and does exactly
 * that — busy while it asks, and saying the description again when the answer is still no, so a
 * screen reader hears that the press did something. There are no "elsewhere" links, as on the
 * web: every one of them leads into the outage.
 *
 * <h2>No way back into the broken stack</h2>
 *
 * The root stack registers this route with no header and no swipe-back, and Android's back
 * button is swallowed while this screen is focused (only then: a sheet opened above it keeps
 * its own back). The screens underneath are the ones that just failed; the way back to them is
 * the service answering, and then the screen leaves by itself.
 *
 * <h2>Leaving, once</h2>
 *
 * Through its own navigation object, so the pop is aimed at this route and nothing else;
 * to Home when there is nothing under it. Once: a "Try again" and a return to the foreground
 * can both answer during the exit animation, and a second pop would take the reader's own
 * screen with it. Then every query on screen is fetched again, so the screens underneath show
 * data instead of the error they rendered as the outage began.
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
  const tMaintenance = useT('shell.maintenance');
  const tError = useT('shell.failure.pages.error');
  const locale = useLocale();
  const maintenance = useCurrentMaintenance();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const poller = useRef<Poller | null>(null);
  const leave = useRef<() => void>(() => {});
  const done = useRef(false);
  const mounted = useRef(true);

  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => back.remove();
    }, []),
  );

  useEffect(() => {
    mounted.current = true;

    // Reached with nothing to wait for — a stray `ideanest://maintenance`. Nothing to show.
    if (!inMaintenance()) {
      done.current = true;
      router.replace('/');
      return;
    }

    leave.current = () => {
      if (done.current) return;
      done.current = true;
      poller.current?.stop();
      leaveMaintenance();
      if (navigation.canGoBack()) navigation.goBack();
      else router.replace('/');
      void queryClient.refetchQueries({ type: 'active' });
    };

    const polling = createPoller(serviceAnswers, () => leave.current());
    poller.current = polling;
    polling.start(firstPollDelayMs());

    const appState = AppState.addEventListener('change', (state) => {
      if (done.current) return;
      if (state === 'active') polling.start(0);
      else polling.stop();
    });

    return () => {
      mounted.current = false;
      polling.stop();
      poller.current = null;
      appState.remove();
    };
  }, [navigation, queryClient, router]);

  const edge = maintenance?.source === 'edge';
  const title = edge ? tMaintenance('edge.title') : t('title');
  const description = edge ? tMaintenance('edge.description') : t('description');
  const until = maintenance === null ? null : untilMessage(maintenance, locale);

  const tryAgain = async () => {
    if (busy || done.current) return;
    setBusy(true);
    poller.current?.stop();
    const up = await serviceAnswers();
    if (!mounted.current || done.current) return;
    setBusy(false);
    if (up) {
      leave.current();
      return;
    }
    AccessibilityInfo.announceForAccessibility(description);
    poller.current?.start(POLL_INTERVAL_MS);
  };

  return (
    <FailureState
      title={title}
      description={description}
      note={until === null ? null : tMaintenance(until.key, until.values)}
      actionLabel={tError('retry')}
      busy={busy}
      onAction={() => void tryAgain()}
    />
  );
}

// A render error stays on this screen, with "Try again" (components/route-error-boundary.tsx).
export { RouteErrorBoundary as ErrorBoundary } from '../components/route-error-boundary';
